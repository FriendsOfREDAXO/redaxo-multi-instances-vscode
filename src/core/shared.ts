import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureCertificate, removeCertificate } from './certs';
import { Docker, Logger } from './docker';
import { Instance, SHARED_DIR, SHARED_NETWORK } from './model';
import { findFreePort, isPortFree } from './ports';
import { CoreSettings, PREFERRED_PORTS, SharedPorts, proxyUrl } from './settings';
import { canonicalPath } from './store';
import { ProxySite, renderCaddyfile, renderSharedCompose } from './templates';

export type SharedService = 'proxy' | 'mailpit' | 'adminer';

export const SHARED_CONTAINERS: Record<SharedService, string> = {
    proxy: 'redaxo-mi-proxy',
    mailpit: 'redaxo-mi-mailpit',
    adminer: 'redaxo-mi-adminer',
};

/** Container of the 1.x extension – replaced by the shared Adminer service. */
const LEGACY_ADMINER_CONTAINER = 'redaxo-adminer';

export class SharedServices {
    constructor(
        private readonly docker: () => Docker,
        private readonly settings: () => CoreSettings,
        private readonly log: Logger,
    ) {}

    get dir(): string {
        return path.join(this.settings().instancesDir, SHARED_DIR);
    }

    get certsDir(): string {
        return path.join(this.dir, 'certs');
    }

    private get stateFile(): string {
        return path.join(this.dir, 'state.json');
    }

    private cachedPorts?: { dir: string; ports: SharedPorts };

    /** Host ports of the shared services (allocated on first use and persisted). */
    async ports(reserved: ReadonlySet<number> = new Set()): Promise<SharedPorts> {
        if (this.cachedPorts?.dir === this.dir) {
            return this.cachedPorts.ports;
        }
        let ports: SharedPorts | undefined;
        try {
            ports = (JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as { ports?: SharedPorts }).ports;
        } catch {
            // not allocated yet
        }
        if (!ports) {
            ports = await this.allocatePorts(reserved);
            await this.savePorts(ports);
        }
        this.cachedPorts = { dir: this.dir, ports };
        return ports;
    }

    private async savePorts(ports: SharedPorts): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(this.stateFile, JSON.stringify({ ports }, null, 2) + '\n', 'utf8');
        this.cachedPorts = { dir: this.dir, ports };
    }

    /** 80/443 when free, otherwise the first free pair of a few well-known alternatives. */
    private async allocatePorts(reserved: ReadonlySet<number>, keep: Partial<SharedPorts> = {}): Promise<SharedPorts> {
        const taken = new Set(reserved);
        let proxy: [number, number] | undefined = keep.proxyHttp && keep.proxyHttps ? [keep.proxyHttp, keep.proxyHttps] : undefined;
        if (!proxy) {
            const pairs: Array<[number, number]> = [[80, 443], [8000, 8443], [8880, 8843], [9080, 9443], [10080, 10443]];
            for (const [http, https] of pairs) {
                if (!taken.has(http) && !taken.has(https) && await isPortFree(http) && await isPortFree(https)) {
                    proxy = [http, https];
                    break;
                }
            }
            proxy ??= [await findFreePort(10080, taken), await findFreePort(10443, taken)];
        }
        taken.add(proxy[0]).add(proxy[1]);
        const mailpit = keep.mailpit ?? await findFreePort(PREFERRED_PORTS.mailpit, taken);
        taken.add(mailpit);
        const adminer = keep.adminer ?? await findFreePort(PREFERRED_PORTS.adminer, taken);
        return { proxyHttp: proxy[0], proxyHttps: proxy[1], mailpit, adminer };
    }

    async url(service: 'adminer' | 'mailpit'): Promise<string> {
        return `${proxyUrl(await this.ports(), service === 'adminer' ? 'adminer.localhost' : 'mail.localhost')}/`;
    }

    async directUrl(service: 'adminer' | 'mailpit'): Promise<string> {
        const ports = await this.ports();
        return `http://localhost:${service === 'adminer' ? ports.adminer : ports.mailpit}/`;
    }

    /** Running state of the shared services that belong to the current instances folder. */
    async status(): Promise<Record<SharedService, boolean>> {
        const own = await canonicalPath(this.dir);
        const containers = await this.docker().containers();
        const isOwn = (name: string) => containers.some(c => c.name === name && c.state === 'running'
            && (!c.workingDir || c.workingDir === own || path.resolve(c.workingDir) === path.resolve(this.dir)));
        return {
            proxy: isOwn(SHARED_CONTAINERS.proxy),
            mailpit: isOwn(SHARED_CONTAINERS.mailpit),
            adminer: isOwn(SHARED_CONTAINERS.adminer),
        };
    }

    /** Removes shared containers created for another instances folder (after the folder was changed). */
    private async adoptForeignContainers(services: readonly SharedService[]): Promise<void> {
        const own = await canonicalPath(this.dir);
        for (const c of await this.docker().containers()) {
            const svc = services.find(s => SHARED_CONTAINERS[s] === c.name);
            if (svc && c.workingDir && (await canonicalPath(c.workingDir)) !== own) {
                this.log.info(`Taking over ${c.name} from ${c.workingDir}`);
                await this.docker().run(['rm', '-f', c.name], { allowFailure: true });
            }
        }
    }

    private async writeCompose(): Promise<void> {
        await fs.mkdir(path.join(this.dir, 'caddy'), { recursive: true });
        await fs.mkdir(this.certsDir, { recursive: true });
        await fs.writeFile(path.join(this.dir, 'compose.yml'), renderSharedCompose(await this.ports()), 'utf8');
        try {
            await fs.access(path.join(this.dir, 'caddy', 'Caddyfile'));
        } catch {
            await fs.writeFile(path.join(this.dir, 'caddy', 'Caddyfile'), renderCaddyfile([]), 'utf8');
        }
    }

    /**
     * Starts shared services. Ports that are taken by other programs are re-allocated
     * automatically (returns true when the proxy ports changed).
     */
    async ensureUp(services: readonly SharedService[], reserved: ReadonlySet<number> = new Set()): Promise<{ portsChanged: boolean }> {
        await this.docker().ensureNetwork(SHARED_NETWORK);
        const status = await this.status();
        const missing = services.filter(svc => !status[svc]);
        let portsChanged = false;
        if (missing.includes('adminer') && await this.docker().containerExists(LEGACY_ADMINER_CONTAINER)) {
            // the 1.x Adminer container blocks port 9200 – it is stateless and replaced by the shared service
            this.log.info('Removing the Adminer container of version 1.x');
            await this.docker().run(['rm', '-f', LEGACY_ADMINER_CONTAINER], { allowFailure: true });
        }
        if (missing.length > 0) {
            await this.adoptForeignContainers(missing);
            const current = await this.ports(reserved);
            const keep: Partial<SharedPorts> = { ...current };
            if (missing.includes('proxy') && !(await isPortFree(current.proxyHttp) && await isPortFree(current.proxyHttps))) {
                delete keep.proxyHttp;
                delete keep.proxyHttps;
                portsChanged = true;
            }
            if (missing.includes('mailpit') && !(await isPortFree(current.mailpit))) {
                delete keep.mailpit;
            }
            if (missing.includes('adminer') && !(await isPortFree(current.adminer))) {
                delete keep.adminer;
            }
            if (Object.keys(keep).length < 4) {
                const others = new Set([...reserved, ...Object.values(keep)]);
                const next = await this.allocatePorts(others, keep);
                this.log.info(`Shared service ports: proxy ${next.proxyHttp}/${next.proxyHttps}, Mailpit ${next.mailpit}, Adminer ${next.adminer}`);
                await this.savePorts(next);
            }
        }
        // back to the standard ports as soon as they are free again (e.g. another local web server was stopped)
        if (services.includes('proxy')) {
            const current = await this.ports(reserved);
            const std = { http: PREFERRED_PORTS.proxyHttp, https: PREFERRED_PORTS.proxyHttps };
            if ((current.proxyHttp !== std.http || current.proxyHttps !== std.https)
                && !reserved.has(std.http) && !reserved.has(std.https)
                && await isPortFree(std.http) && await isPortFree(std.https)) {
                this.log.info(`Standard ports ${std.http}/${std.https} are free again – moving the HTTPS proxy there`);
                await this.savePorts({ ...current, proxyHttp: std.http, proxyHttps: std.https });
                if (status.proxy && !missing.includes('proxy')) {
                    missing.push('proxy');
                }
                portsChanged = true;
            }
        }
        await this.writeCompose();
        if (missing.length === 0) {
            return { portsChanged };
        }
        this.log.info(`Starting shared services: ${missing.join(', ')}`);
        await this.docker().compose(this.dir, ['up', '-d', '--remove-orphans', ...missing]);
        return { portsChanged };
    }

    async stop(services: readonly SharedService[]): Promise<void> {
        try {
            await fs.access(path.join(this.dir, 'compose.yml'));
        } catch {
            return;
        }
        await this.docker().compose(this.dir, ['stop', ...services]);
    }

    /**
     * Writes certificates and the Caddyfile for all v2 instances and reloads the proxy.
     * Returns whether trusted (mkcert) certificates are in use.
     */
    async syncProxy(instances: readonly Instance[]): Promise<{ trusted: boolean }> {
        await this.writeCompose();
        const sites: ProxySite[] = [];
        let trusted = true;

        const sharedCert = await ensureCertificate(this.certsDir, '_shared', ['adminer.localhost', 'mail.localhost']);
        trusted &&= sharedCert !== undefined;
        sites.push(
            { name: 'Adminer', hosts: ['adminer.localhost'], upstream: `${SHARED_CONTAINERS.adminer}:8080`, cert: sharedCert },
            { name: 'Mailpit', hosts: ['mail.localhost'], upstream: `${SHARED_CONTAINERS.mailpit}:8025`, cert: sharedCert },
        );

        const keep = new Set(['_shared']);
        for (const instance of instances) {
            if (instance.format !== 'v2' || instance.urls.hosts.length === 0) {
                continue;
            }
            keep.add(instance.name);
            const cert = await ensureCertificate(this.certsDir, instance.name, instance.urls.hosts);
            trusted &&= cert !== undefined;
            sites.push({ name: instance.name, hosts: instance.urls.hosts, upstream: `${instance.layout.webContainer}:80`, cert });
        }

        // remove certificates of deleted instances
        try {
            for (const file of await fs.readdir(this.certsDir)) {
                const id = file.replace(/(-key)?\.(pem|hosts)$/, '');
                if (!keep.has(id)) {
                    await removeCertificate(this.certsDir, id);
                }
            }
        } catch {
            // no certs dir yet
        }

        const caddyfile = renderCaddyfile(sites);
        const file = path.join(this.dir, 'caddy', 'Caddyfile');
        let current = '';
        try {
            current = await fs.readFile(file, 'utf8');
        } catch {
            // first run
        }
        if (current !== caddyfile) {
            await fs.writeFile(file, caddyfile, 'utf8');
            if ((await this.status()).proxy) {
                this.log.info('Reloading HTTPS proxy configuration');
                await this.docker().exec(SHARED_CONTAINERS.proxy, ['caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile', '--force']);
            }
        }
        return { trusted };
    }
}
