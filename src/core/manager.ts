import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { DOCKER_ASSETS } from './assets.generated';
import { QUERY_SCRIPT, QueryResult, isReadOnlyStatement, isValidIdentifier, systemDatabases } from './database';
import { Docker, Logger, ProgressReporter } from './docker';
import { run } from './exec';
import {
    COMPOSER_CACHE_VOLUME, INSTANCE_CONFIG_FILE, Instance, InstanceConfig, InstanceKind, SHARED_DIR, SHARED_NETWORK,
    defaultLayout, validateDomain, validateInstanceName,
} from './model';
import { describeOccupant } from './diagnose';
import { DetectedProject, GitStatus, detectProject, gitClone, gitInit, prepareClonedRedaxo5, repoName } from './git';
import { findFreePort, generatePassword } from './ports';
import { CoreSettings } from './settings';
import { SharedServices } from './shared';
import {
    canonicalPath, composeProjectFromDir, findComposeFile, instanceFromConfig, listInstanceDirs, loadInstance, parseEnv,
    readInstanceConfig, statusFromContainers, writeInstanceConfig,
} from './store';
import {
    CUSTOM_SETUP_SCRIPT, IMAGE_FILES, defaultImageFiles, hashImageFiles, renderAgentsMd, renderClaudeMd,
    renderCompose, renderEnv, renderWelcomePage,
} from './templates';
import {
    DEFAULT_MARIADB_VERSION, DEFAULT_PHP_VERSION, REDAXO6_VERSION, SHARED_IMAGES, compareVersions, dockerHubTagExists, fetchRedaxoReleases, isPhpCompatibleWithRedaxo,
    isSupportedMariaDbVersion, isSupportedPhpVersion, getRedaxoMinPhp, resolvePhpImageTag,
} from './versions';

export class InstanceError extends Error {
    constructor(message: string, readonly code: 'not-found' | 'exists' | 'invalid' | 'legacy' | 'docker' | 'failed' = 'failed') {
        super(message);
        this.name = 'InstanceError';
    }
}

export interface CreateOptions {
    name: string;
    kind: InstanceKind;
    php: string;
    mariadb: string;
    /** `latest` or a release such as `5.21.6` (REDAXO instances only). */
    redaxoVersion?: string;
    /** REDAXO 6 development version: Composer project or core development (git clone). */
    redaxo6?: 'project' | 'core';
    domains?: string[];
    xdebug?: boolean;
    /** Start (and install) right away. Default: true. */
    start?: boolean;
    /**
     * Existing project files (e.g. a cloned repository) that become the web root. The directory is moved,
     * not copied. REDAXO is then not downloaded; REDAXO 6 projects get `composer install` + setup.
     */
    sourceDir?: string;
    /** Document root inside the container when it differs from the default (detected for existing projects). */
    docroot?: string;
}

export interface Snapshot {
    id: string;
    path: string;
    label: string;
    createdAt: string;
    databases: string[];
    sizeBytes: number;
    php: string;
    mariadb: string;
}

export interface InstanceResources {
    cpuPercent?: number;
    memoryBytes?: number;
    diskBytes?: number;
}

/** `512.3MiB`, `1.2GiB`, `800kB` → bytes. */
export function parseByteSize(value: string): number {
    const m = /([\d.]+)\s*([kKMGT]?i?B)/.exec(value.trim());
    if (!m) {
        return 0;
    }
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const base = unit.includes('i') ? 1024 : 1000;
    const exp = { b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 }[unit] ?? 0;
    return Math.round(n * base ** exp);
}

export interface StartResult {
    warnings: string[];
}

export interface ExportResult {
    archive: string;
    sizeBytes: number;
    databaseIncluded: boolean;
}

const EXPORT_MANIFEST = 'redaxo-mi-export.json';

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

/** Moves a directory, also across file systems (rename falls back to copy + delete). */
async function movePath(from: string, to: string): Promise<void> {
    try {
        await fs.rename(from, to);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
            throw error;
        }
        await fs.cp(from, to, { recursive: true, verbatimSymlinks: true });
        await fs.rm(from, { recursive: true, force: true });
    }
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
}

export class InstanceManager {
    private dockerClient?: Docker;
    readonly shared: SharedServices;

    constructor(private readonly getSettings: () => CoreSettings, readonly log: Logger) {
        this.shared = new SharedServices(() => this.docker, getSettings, log);
    }

    get settings(): CoreSettings {
        return this.getSettings();
    }

    get docker(): Docker {
        const bin = this.getSettings().dockerPath || 'docker';
        if (!this.dockerClient || this.dockerClient.bin !== bin) {
            this.dockerClient = new Docker(bin, this.log);
        }
        return this.dockerClient;
    }

    private instancePath(name: string): string {
        return path.join(this.settings.instancesDir, name);
    }

    // ───────────────────────────────────────────── listing

    async list(options: { withStatus?: boolean } = {}): Promise<Instance[]> {
        const dirs = await listInstanceDirs(this.settings.instancesDir);
        const ports = await this.shared.ports();
        const instances: Instance[] = [];
        for (const dir of dirs) {
            try {
                const instance = await loadInstance(dir, ports);
                if (instance) {
                    instances.push(instance);
                }
            } catch (error) {
                this.log.warn(`Skipping ${dir}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (options.withStatus !== false) {
            try {
                const running = await this.docker.runningContainerNames();
                for (const instance of instances) {
                    instance.status = statusFromContainers(instance, running);
                }
            } catch {
                // Docker not available – status stays "unknown"
            }
        }
        return instances;
    }

    async get(name: string, withStatus = true): Promise<Instance> {
        const dir = this.instancePath(name);
        const instance = await loadInstance(dir, await this.shared.ports());
        if (!instance) {
            throw new InstanceError(`Instance "${name}" not found`, 'not-found');
        }
        if (withStatus) {
            try {
                instance.status = statusFromContainers(instance, await this.docker.runningContainerNames());
            } catch {
                instance.status = 'unknown';
            }
        }
        return instance;
    }

    /** Ports used by instances (also stopped ones). */
    private async instancePorts(): Promise<Set<number>> {
        const ports = new Set<number>();
        for (const i of await this.list({ withStatus: false })) {
            for (const p of [i.ports.http, i.ports.https, i.ports.db]) {
                if (p) {
                    ports.add(p);
                }
            }
        }
        return ports;
    }

    // ───────────────────────────────────────────── files

    private async readImageFiles(dir: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        for (const name of IMAGE_FILES) {
            try {
                files[name] = await fs.readFile(path.join(dir, 'docker', name), 'utf8');
            } catch {
                files[name] = DOCKER_ASSETS[name];
            }
        }
        return files;
    }

    private async writeDockerDir(dir: string, overwrite: boolean): Promise<void> {
        const dockerDir = path.join(dir, 'docker');
        await fs.mkdir(path.join(dockerDir, 'initdb'), { recursive: true });
        for (const [name, content] of Object.entries(defaultImageFiles())) {
            const target = path.join(dockerDir, name);
            if (overwrite || !(await exists(target))) {
                await fs.writeFile(target, content, { encoding: 'utf8', mode: name.endsWith('.sh') ? 0o755 : 0o644 });
            }
        }
        const hook = path.join(dockerDir, 'custom-setup.sh');
        if (!(await exists(hook))) {
            await fs.writeFile(hook, CUSTOM_SETUP_SCRIPT, { encoding: 'utf8', mode: 0o755 });
        }
        const keep = path.join(dockerDir, 'initdb', '.gitkeep');
        if (!(await exists(keep))) {
            await fs.writeFile(keep, '');
        }
    }

    /** (Re-)writes compose, .env and AI instruction files of a v2 instance from its config. */
    async writeInstanceFiles(dir: string, cfg: InstanceConfig): Promise<void> {
        const filesHash = hashImageFiles(await this.readImageFiles(dir));
        const compose = renderCompose(cfg, {
            settings: this.settings,
            ports: await this.shared.ports(),
            filesHash,
            hostUid: process.platform === 'linux' ? process.getuid?.() : undefined,
            hostGid: process.platform === 'linux' ? process.getgid?.() : undefined,
        });
        await fs.writeFile(path.join(dir, 'docker-compose.yml'), compose, { encoding: 'utf8', mode: 0o600 });
        await fs.writeFile(path.join(dir, '.env'), renderEnv(cfg), { encoding: 'utf8', mode: 0o600 });
        await writeInstanceConfig(dir, cfg);
        await this.writeAiFiles(dir);
    }

    async writeAiFiles(dir: string): Promise<void> {
        const instance = await loadInstance(dir, await this.shared.ports());
        if (!instance) {
            return;
        }
        await fs.writeFile(path.join(dir, 'AGENTS.md'), renderAgentsMd(instance), 'utf8');
        const claude = path.join(dir, 'CLAUDE.md');
        if (!(await exists(claude))) {
            await fs.writeFile(claude, renderClaudeMd(), 'utf8');
        }
    }

    private async refreshV2Files(instance: Instance): Promise<void> {
        if (instance.format === 'v2' && instance.config) {
            await this.writeDockerDir(instance.path, false);
            await this.writeInstanceFiles(instance.path, instance.config);
        }
    }

    // ───────────────────────────────────────────── create

    async create(options: CreateOptions, progress: ProgressReporter = () => {}): Promise<Instance> {
        const nameError = validateInstanceName(options.name);
        if (nameError) {
            throw new InstanceError(`Invalid name "${options.name}": ${nameError}`, 'invalid');
        }
        if (!isSupportedPhpVersion(options.php)) {
            throw new InstanceError(`Unsupported PHP version ${options.php}`, 'invalid');
        }
        if (!isSupportedMariaDbVersion(options.mariadb)) {
            throw new InstanceError(`Unsupported MariaDB version ${options.mariadb}`, 'invalid');
        }
        for (const d of options.domains ?? []) {
            const err = validateDomain(d);
            if (err) {
                throw new InstanceError(`${d}: ${err}`, 'invalid');
            }
        }
        const dir = this.instancePath(options.name);
        if (await exists(dir)) {
            throw new InstanceError(`Instance "${options.name}" already exists`, 'exists');
        }

        let redaxoVersion: string | undefined;
        if (options.kind === 'redaxo' && options.redaxo6) {
            redaxoVersion = REDAXO6_VERSION;
            if (!isPhpCompatibleWithRedaxo(options.php, redaxoVersion)) {
                throw new InstanceError(`REDAXO 6 requires PHP ${getRedaxoMinPhp(redaxoVersion)} or newer`, 'invalid');
            }
        } else if (options.kind === 'redaxo') {
            redaxoVersion = options.redaxoVersion && options.redaxoVersion !== 'latest'
                ? options.redaxoVersion
                : (await fetchRedaxoReleases())[0].version;
            if (!isPhpCompatibleWithRedaxo(options.php, redaxoVersion)) {
                throw new InstanceError(`REDAXO ${redaxoVersion} requires PHP ${getRedaxoMinPhp(redaxoVersion)} or newer`, 'invalid');
            }
        }

        progress('Allocating ports…');
        const reserved = await this.instancePorts();
        const httpPort = await findFreePort(8080, reserved);
        reserved.add(httpPort);
        const dbPort = await findFreePort(3307, reserved);
        const phpImageTag = await resolvePhpImageTag(options.php, tag => dockerHubTagExists('php', tag));

        const cfg: InstanceConfig = {
            schema: 2,
            name: options.name,
            kind: options.kind,
            php: options.php,
            phpImageTag,
            mariadb: options.mariadb,
            redaxoVersion,
            redaxo6: options.kind === 'redaxo' ? options.redaxo6 : undefined,
            domains: [...new Set((options.domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean))],
            ports: { http: httpPort, db: dbPort },
            db: {
                name: options.kind === 'redaxo' ? 'redaxo' : options.name.replace(/-/g, '_'),
                user: options.kind === 'redaxo' ? 'redaxo' : options.name.replace(/-/g, '_').slice(0, 32),
                password: generatePassword(20),
                rootPassword: generatePassword(24),
            },
            admin: options.kind === 'redaxo' ? { user: 'admin', password: generatePassword(16) } : undefined,
            xdebug: options.xdebug ?? false,
            createdAt: new Date().toISOString(),
            layout: defaultLayout(options.name),
        };
        if (cfg.redaxo6 === 'core') {
            cfg.layout.docroot = '/var/www/html/project/public';
        }
        if (options.docroot) {
            cfg.layout.docroot = options.docroot;
        }

        progress('Writing configuration…');
        try {
            if (options.sourceDir) {
                await fs.mkdir(dir, { recursive: true });
                await movePath(options.sourceDir, path.join(dir, cfg.layout.webroot));
                if (options.kind === 'redaxo' && !options.redaxo6) {
                    await prepareClonedRedaxo5(path.join(dir, cfg.layout.webroot, path.posix.relative('/var/www/html', cfg.layout.docroot)));
                }
            } else {
                await fs.mkdir(path.join(dir, cfg.layout.webroot, cfg.redaxo6 ? '' : 'public'), { recursive: true });
            }
            await this.writeDockerDir(dir, true);
            if (options.kind === 'custom' && !options.sourceDir) {
                await fs.writeFile(path.join(dir, cfg.layout.webroot, 'public', 'index.php'), renderWelcomePage(cfg), 'utf8');
            }
            await fs.writeFile(path.join(dir, '.gitignore'), [
                '# REDAXO Multi-Instances',
                'redaxo-instance.json', '.env', 'docker-compose.yml', '.legacy/', 'docker/initdb/*.sql', '.snapshots/', '',
            ].join('\n'), 'utf8');
            await this.writeInstanceFiles(dir, cfg);
        } catch (error) {
            await fs.rm(dir, { recursive: true, force: true });
            throw error;
        }
        this.log.info(`Instance ${options.name} created in ${dir}`);

        if (options.start !== false) {
            await this.start(options.name, progress);
        }
        return this.get(options.name);
    }

    // ───────────────────────────────────────────── lifecycle

    /** Starts shared services, the instance and waits until the web server answers. */
    async start(name: string, progress: ProgressReporter = () => {}): Promise<StartResult> {
        const instance = await this.get(name, false);
        const warnings: string[] = [];

        progress('Starting shared services…');
        try {
            const { portsChanged } = await this.shared.ensureUp(['proxy', 'mailpit'], await this.instancePorts());
            if (portsChanged) {
                const p = await this.shared.ports();
                if (p.proxyHttps === 443) {
                    warnings.push('The HTTPS proxy now uses the standard ports 80/443 – addresses no longer need a port.');
                } else {
                    const occupants = await this.shared.standardPortOccupants();
                    warnings.push(`Ports 80/443 are in use (${occupants.map(describeOccupant).join('; ') || 'unknown program'}) – the HTTPS proxy uses ${p.proxyHttp}/${p.proxyHttps}.`);
                }
            }
        } catch (error) {
            warnings.push(`Shared services: ${error instanceof Error ? error.message : String(error)}`);
        }

        await this.docker.ensureVolume(COMPOSER_CACHE_VOLUME);
        await this.refreshV2Files(instance);
        const image = instance.format === 'v2' ? (await fs.readFile(path.join(instance.path, 'docker-compose.yml'), 'utf8')).match(/image:\s*(redaxo-mi-web:\S+)/)?.[1] : undefined;
        if (image && !(await this.docker.imageExists(image))) {
            progress(`Building PHP ${instance.php} image (first time only, takes a few minutes)…`);
        } else {
            progress('Starting containers…');
        }
        await this.docker.compose(instance.path, ['up', '-d', '--remove-orphans']);

        if (instance.format === 'v2') {
            progress('Updating HTTPS proxy…');
            try {
                const { trusted } = await this.shared.syncProxy(await this.list({ withStatus: false }));
                if (!trusted) {
                    warnings.push('mkcert is not installed (or `mkcert -install` was not run) – HTTPS uses untrusted certificates.');
                }
            } catch (error) {
                warnings.push(`Proxy: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        progress(instance.kind === 'redaxo' ? 'Waiting for REDAXO (first start installs REDAXO)…' : 'Waiting for the web server…');
        const ready = await this.waitForHttp(instance.urls.direct, 300_000);
        if (!ready) {
            warnings.push('The web server did not answer within 5 minutes – check the container logs.');
        }
        for (const w of warnings) {
            this.log.warn(w);
        }
        this.log.info(`Instance ${name} started`);
        return { warnings };
    }

    async waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
        const until = Date.now() + timeoutMs;
        while (Date.now() < until) {
            try {
                // any HTTP answer means Apache is up (the entrypoint finishes the setup before)
                await fetch(url.replace('://localhost', '://127.0.0.1'), { redirect: 'manual', signal: AbortSignal.timeout(5000) });
                return true;
            } catch {
                // not ready yet
            }
            await new Promise(r => setTimeout(r, 1500));
        }
        return false;
    }

    async stop(name: string): Promise<void> {
        const instance = await this.get(name, false);
        await this.docker.compose(instance.path, ['stop']);
        this.log.info(`Instance ${name} stopped`);
    }

    async restart(name: string, progress?: ProgressReporter): Promise<StartResult> {
        await this.stop(name);
        return this.start(name, progress);
    }

    /** Stops and deletes containers, volumes and all files of an instance. */
    async remove(name: string): Promise<void> {
        const instance = await this.get(name, false);
        const external = instance.layout.dbStorage.type === 'volume' && instance.layout.dbStorage.external;
        if (await findComposeFile(instance.path)) {
            await this.docker.compose(instance.path, ['down', '--remove-orphans', ...(external ? [] : ['-v'])], { allowFailure: true });
        }
        await this.removeDirectory(instance.path);
        try {
            await this.shared.syncProxy(await this.list({ withStatus: false }));
        } catch {
            // proxy not configured
        }
        this.log.info(`Instance ${name} deleted`);
    }

    /** Recreates the containers (and rebuilds the image of v2 instances). */
    async repair(name: string, progress: ProgressReporter = () => {}): Promise<StartResult> {
        const instance = await this.get(name, false);
        progress('Recreating containers…');
        await this.refreshV2Files(instance);
        await this.docker.compose(instance.path, ['down', '--remove-orphans']);
        if (instance.format === 'v2') {
            progress('Rebuilding image…');
            await this.docker.compose(instance.path, ['build', '--pull']);
        }
        return this.start(name, progress);
    }

    async logs(name: string, options: { tail?: number; service?: 'web' | 'db' } = {}): Promise<string> {
        const instance = await this.get(name, false);
        const service = options.service === 'db' ? instance.layout.dbService : options.service === 'web' ? instance.layout.webService : undefined;
        const res = await this.docker.compose(instance.path, ['logs', '--no-color', '--tail', String(options.tail ?? 200), ...(service ? [service] : [])], { onLine: () => {} });
        return res.stdout + res.stderr;
    }

    // ───────────────────────────────────────────── REDAXO + database

    private async requireRunning(instance: Instance): Promise<void> {
        if (!(await this.docker.isRunning(instance.layout.webContainer))) {
            throw new InstanceError(`Instance "${instance.name}" is not running`, 'failed');
        }
    }

    /** Path of bin/console inside the container (classic or modern structure), if REDAXO is installed. */
    async findConsole(instance: Instance): Promise<string | undefined> {
        const candidates = [...new Set([
            `${instance.layout.docroot}/redaxo/bin/console`,
            '/var/www/html/redaxo/bin/console',
            '/var/www/html/bin/console',
            '/var/www/html/project/bin/console',
            '/var/www/html/public/redaxo/bin/console',
        ])];
        const res = await this.docker.exec(instance.layout.webContainer, ['sh', '-c',
            `for f in ${candidates.join(' ')}; do if [ -f "$f" ]; then echo "$f"; exit 0; fi; done; exit 1`], { allowFailure: true });
        return res.code === 0 ? res.stdout.trim() : undefined;
    }

    /** Runs `bin/console` as www-data. `args` are passed verbatim (no shell). */
    async console(name: string, args: readonly string[]): Promise<{ code: number; output: string }> {
        const instance = await this.get(name, false);
        await this.requireRunning(instance);
        const consolePath = await this.findConsole(instance);
        if (!consolePath) {
            throw new InstanceError(`No REDAXO console found in "${name}"`, 'failed');
        }
        const res = await this.docker.exec(instance.layout.webContainer, ['php', consolePath, '--no-ansi', ...args], {
            user: 'www-data', allowFailure: true, timeout: 600_000,
        });
        return { code: res.code, output: (res.stdout + res.stderr).trim() };
    }

    async query(name: string, sql: string, options: { readOnly?: boolean; maxRows?: number; database?: string } = {}): Promise<QueryResult> {
        const instance = await this.get(name, false);
        await this.requireRunning(instance);
        if (options.readOnly && !isReadOnlyStatement(sql)) {
            throw new InstanceError('Only single read-only statements (SELECT, SHOW, DESCRIBE, EXPLAIN, WITH) are allowed', 'invalid');
        }
        const database = options.database ?? instance.db.name;
        if (!isValidIdentifier(database)) {
            throw new InstanceError(`Invalid database name ${database}`, 'invalid');
        }
        const res = await this.docker.exec(instance.layout.webContainer, ['php', '-d', 'display_errors=stderr', '-r', QUERY_SCRIPT], {
            execEnv: {
                RMI_DSN: `mysql:host=${instance.db.host};dbname=${database};charset=utf8mb4`,
                RMI_USER: instance.db.user,
                RMI_PASS: instance.db.password,
                RMI_SQL: sql,
                RMI_RO: options.readOnly ? '1' : '0',
                RMI_MAX: String(options.maxRows ?? 500),
            },
            timeout: 120_000,
        });
        let parsed: { ok: boolean; error?: string } & Partial<QueryResult>;
        try {
            parsed = JSON.parse(res.stdout.trim());
        } catch {
            throw new InstanceError(`Unexpected output: ${(res.stdout + res.stderr).slice(0, 500)}`);
        }
        if (!parsed.ok) {
            throw new InstanceError(parsed.error ?? 'Query failed');
        }
        return { columns: parsed.columns ?? [], rows: parsed.rows ?? [], rowCount: parsed.rowCount ?? 0, truncated: parsed.truncated ?? false };
    }

    private async dbRoot(instance: Instance, sql: string): Promise<string> {
        const res = await this.docker.exec(instance.layout.dbContainer, ['sh', '-c', 'command -v mariadb >/dev/null && exec mariadb -uroot -N -B -e "$RMI_SQL" || exec mysql -uroot -N -B -e "$RMI_SQL"'], {
            execEnv: { MYSQL_PWD: instance.db.rootPassword, RMI_SQL: sql },
            timeout: 120_000,
        });
        return res.stdout;
    }

    async listDatabases(name: string): Promise<string[]> {
        const instance = await this.get(name, false);
        const out = await this.dbRoot(instance, 'SHOW DATABASES');
        return out.split(/\r?\n/).map(s => s.trim()).filter(s => s && !systemDatabases.has(s));
    }

    async createDatabase(name: string, database: string): Promise<void> {
        if (!isValidIdentifier(database)) {
            throw new InstanceError('Use letters, digits and underscores only (max. 64)', 'invalid');
        }
        const instance = await this.get(name, false);
        await this.dbRoot(instance, `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; `
            + `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${instance.db.user}'@'%'; FLUSH PRIVILEGES;`);
        this.log.info(`Database ${database} created in ${name}`);
    }

    // ───────────────────────────────────────────── configuration changes (v2)

    private async requireV2(name: string): Promise<{ instance: Instance; cfg: InstanceConfig }> {
        const instance = await this.get(name, false);
        if (instance.format !== 'v2' || !instance.config) {
            throw new InstanceError(`"${name}" uses the 1.x format – modernize the instance first`, 'legacy');
        }
        return { instance, cfg: structuredClone(instance.config) };
    }

    private async applyConfig(instance: Instance, cfg: InstanceConfig, progress: ProgressReporter, recreate = true): Promise<void> {
        await this.writeInstanceFiles(instance.path, cfg);
        const wasRunning = (await this.get(instance.name)).status !== 'stopped';
        if (recreate && wasRunning) {
            await this.start(instance.name, progress);
        }
    }

    async changePhp(name: string, php: string, progress: ProgressReporter = () => {}): Promise<void> {
        if (!isSupportedPhpVersion(php)) {
            throw new InstanceError(`Unsupported PHP version ${php}`, 'invalid');
        }
        const { instance, cfg } = await this.requireV2(name);
        if (cfg.kind === 'redaxo' && cfg.redaxoVersion && !isPhpCompatibleWithRedaxo(php, cfg.redaxoVersion)) {
            throw new InstanceError(`REDAXO ${cfg.redaxoVersion} requires PHP ${getRedaxoMinPhp(cfg.redaxoVersion)} or newer`, 'invalid');
        }
        cfg.php = php;
        cfg.phpImageTag = await resolvePhpImageTag(php, tag => dockerHubTagExists('php', tag));
        await this.applyConfig(instance, cfg, progress);
        this.log.info(`PHP of ${name} changed to ${php}`);
    }

    async changeMariaDb(name: string, version: string, progress: ProgressReporter = () => {}, allowDowngrade = false): Promise<void> {
        if (!isSupportedMariaDbVersion(version)) {
            throw new InstanceError(`Unsupported MariaDB version ${version}`, 'invalid');
        }
        const instance = await this.get(name, false);
        const current = instance.mariadb;
        if (/^\d/.test(current) && compareVersions(version, current) < 0 && !allowDowngrade) {
            throw new InstanceError(`Downgrading MariaDB (${current} → ${version}) is not supported by MariaDB and may corrupt data`, 'invalid');
        }
        if (instance.format === 'v2' && instance.config) {
            const cfg = structuredClone(instance.config);
            cfg.mariadb = version;
            await this.applyConfig(instance, cfg, progress);
        } else {
            // 1.x instance: keep compatibility by only replacing the image tag
            const composeFile = await findComposeFile(instance.path);
            if (!composeFile) {
                throw new InstanceError('docker-compose.yml not found');
            }
            const compose = await fs.readFile(composeFile, 'utf8');
            await fs.writeFile(composeFile, compose.replace(/image:\s*mariadb:\S+/, `image: mariadb:${version}`), 'utf8');
            const envFile = path.join(instance.path, '.env');
            if (await exists(envFile)) {
                const env = await fs.readFile(envFile, 'utf8');
                await fs.writeFile(envFile, /^MARIADB_VERSION=/m.test(env) ? env.replace(/^MARIADB_VERSION=.*$/m, `MARIADB_VERSION=${version}`) : `${env.trimEnd()}\nMARIADB_VERSION=${version}\n`, 'utf8');
            }
            if (instance.status !== 'stopped') {
                progress(`Starting MariaDB ${version}…`);
                await this.docker.compose(instance.path, ['up', '-d']);
                // older images do not upgrade the system tables automatically
                await this.docker.exec(instance.layout.dbContainer, ['sh', '-c', 'sleep 5; mariadb-upgrade -uroot 2>/dev/null || true'], {
                    execEnv: { MYSQL_PWD: instance.db.rootPassword }, allowFailure: true,
                });
            }
        }
        this.log.info(`MariaDB of ${name} changed to ${version}`);
    }

    async setXdebug(name: string, enabled: boolean, progress: ProgressReporter = () => {}): Promise<void> {
        const { instance, cfg } = await this.requireV2(name);
        cfg.xdebug = enabled;
        await this.applyConfig(instance, cfg, progress);
    }

    async setDomains(name: string, domains: readonly string[]): Promise<void> {
        for (const d of domains) {
            const err = validateDomain(d);
            if (err) {
                throw new InstanceError(`${d}: ${err}`, 'invalid');
            }
        }
        const { instance, cfg } = await this.requireV2(name);
        cfg.domains = [...new Set(domains.map(d => d.trim().toLowerCase()))];
        await this.writeInstanceFiles(instance.path, cfg);
        await this.shared.syncProxy(await this.list({ withStatus: false }));
    }

    // ───────────────────────────────────────────── export / import

    /** Dumps all non-system databases of a running instance into a file. */
    async dumpDatabase(name: string, target: string): Promise<string[]> {
        const instance = await this.get(name, false);
        const databases = await this.listDatabases(name);
        const tmp = `/tmp/redaxo-mi-dump-${Date.now()}.sql`;
        await this.docker.exec(instance.layout.dbContainer, ['sh', '-c',
            'BIN=$(command -v mariadb-dump || command -v mysqldump); '
            + '"$BIN" -uroot --single-transaction --routines --triggers --events --hex-blob --default-character-set=utf8mb4 '
            + `--databases ${databases.map(d => `'${d}'`).join(' ')} > ${tmp}`], {
            execEnv: { MYSQL_PWD: instance.db.rootPassword }, timeout: 3_600_000,
        });
        await this.docker.run(['cp', `${instance.layout.dbContainer}:${tmp}`, target], { onLine: () => {} });
        await this.docker.exec(instance.layout.dbContainer, ['rm', '-f', tmp], { allowFailure: true });
        return databases;
    }

    /** Exports an instance (files + database dump) as .tar.gz. */
    async exportInstance(name: string, targetDir: string, progress: ProgressReporter = () => {}, options: { requireDatabase?: boolean } = {}): Promise<ExportResult> {
        const instance = await this.get(name);
        const exportDir = path.join(instance.path, '.export');
        await fs.rm(exportDir, { recursive: true, force: true });
        await fs.mkdir(exportDir, { recursive: true });
        let databaseIncluded: boolean;
        let databases: string[] = [];
        let startedDb = false;
        try {
            try {
                if (!(await this.docker.isRunning(instance.layout.dbContainer))) {
                    progress('Starting database for the dump…');
                    await this.docker.compose(instance.path, ['up', '-d', '--wait', instance.layout.dbService]);
                    startedDb = true;
                }
                progress('Dumping database…');
                databases = await this.dumpDatabase(name, path.join(exportDir, 'database.sql'));
                databaseIncluded = true;
            } catch (error) {
                if (options.requireDatabase) {
                    throw error;
                }
                this.log.warn(`Database dump failed – exporting files only: ${error instanceof Error ? error.message : String(error)}`);
                databaseIncluded = false;
            }
            await fs.writeFile(path.join(exportDir, EXPORT_MANIFEST), JSON.stringify({
                format: 'redaxo-multi-instances-export',
                version: 2,
                exportedAt: new Date().toISOString(),
                name: instance.name,
                sourceFormat: instance.format,
                kind: instance.kind,
                php: instance.php,
                mariadb: instance.mariadb,
                databases,
                layout: instance.layout,
                db: { name: instance.db.name, user: instance.db.user, password: instance.db.password, rootPassword: instance.db.rootPassword },
                admin: instance.admin,
                domains: instance.domains,
                redaxoVersion: instance.redaxoVersion,
                redaxo6: instance.redaxo6,
            }, null, 2), 'utf8');

            progress('Creating archive…');
            await fs.mkdir(targetDir, { recursive: true });
            const archive = path.join(targetDir, `${name}-${timestamp()}.tar.gz`);
            const excludes = ['./data/mysql', './.legacy/data', './node_modules'];
            await run('tar', ['-czf', archive, ...excludes.flatMap(e => ['--exclude', e]), '-C', instance.path, '.'], { timeout: 3_600_000 });
            const stat = await fs.stat(archive);
            this.log.info(`Exported ${name} to ${archive}`);
            return { archive, sizeBytes: stat.size, databaseIncluded };
        } finally {
            await fs.rm(exportDir, { recursive: true, force: true });
            if (startedDb) {
                await this.docker.compose(instance.path, ['stop', instance.layout.dbService], { allowFailure: true });
            }
        }
    }

    /** Imports a 2.x or 1.x export archive as new v2 instance. */
    async importInstance(archive: string, name: string, progress: ProgressReporter = () => {}, start = true): Promise<Instance> {
        const nameError = validateInstanceName(name);
        if (nameError) {
            throw new InstanceError(`Invalid name "${name}": ${nameError}`, 'invalid');
        }
        const dir = this.instancePath(name);
        if (await exists(dir)) {
            throw new InstanceError(`Instance "${name}" already exists`, 'exists');
        }
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'redaxo-mi-import-'));
        try {
            progress('Extracting archive…');
            await run('tar', ['-xzf', archive, '-C', tmp], { timeout: 3_600_000 });
            const reserved = await this.instancePorts();
            const httpPort = await findFreePort(8080, reserved);
            reserved.add(httpPort);
            const dbPort = await findFreePort(3307, reserved);

            let cfg: InstanceConfig;
            let dump: string | undefined;
            const manifestFile = path.join(tmp, '.export', EXPORT_MANIFEST);
            if (await exists(manifestFile)) {
                cfg = await this.configFromV2Export(tmp, manifestFile, name, httpPort, dbPort);
                dump = path.join(tmp, '.export', 'database.sql');
            } else if (await exists(path.join(tmp, 'manifest.json'))) {
                ({ cfg, dump } = await this.configFromV1Export(tmp, name, httpPort, dbPort));
            } else {
                throw new InstanceError('Unknown archive format (no export manifest found)', 'invalid');
            }

            progress('Copying files…');
            await fs.mkdir(dir, { recursive: true });
            for (const entry of await fs.readdir(tmp)) {
                if (['.export', 'manifest.json', 'db-dump.sql', 'redaxo-files.tar.gz', INSTANCE_CONFIG_FILE, 'docker-compose.yml', '.env', 'docker'].includes(entry)) {
                    continue;
                }
                await fs.cp(path.join(tmp, entry), path.join(dir, entry), { recursive: true, verbatimSymlinks: true });
            }
            await fs.mkdir(path.join(dir, cfg.layout.webroot), { recursive: true });
            await this.writeDockerDir(dir, true);
            // keep customized build files from 2.x archives
            if (await exists(path.join(tmp, 'docker'))) {
                await fs.cp(path.join(tmp, 'docker'), path.join(dir, 'docker'), { recursive: true, force: true });
            }
            if (dump && await exists(dump)) {
                progress('Preparing database import…');
                const target = path.join(dir, 'docker', 'initdb', '10-import.sql');
                await this.copyDump(dump, target, cfg);
            }
            await this.rewriteRedaxoServer(dir, cfg);
            await this.writeInstanceFiles(dir, cfg);
        } catch (error) {
            await fs.rm(dir, { recursive: true, force: true });
            throw error;
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
        if (start) {
            await this.start(name, progress);
        }
        return this.get(name);
    }

    private async configFromV2Export(tmp: string, manifestFile: string, name: string, http: number, db: number): Promise<InstanceConfig> {
        const m = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        const base = await readInstanceConfig(tmp);
        const fresh = defaultLayout(name);
        const layout = {
            ...fresh,
            webService: m.layout?.webService ?? fresh.webService,
            dbService: m.layout?.dbService ?? fresh.dbService,
            webroot: m.layout?.webroot ?? fresh.webroot,
            docroot: m.layout?.docroot ?? fresh.docroot,
            dbAliases: [...new Set([...(m.layout?.dbAliases ?? []), ...(m.db?.host && m.db.host !== (m.layout?.dbService ?? 'db') ? [m.db.host] : []),
                ...(m.sourceFormat === 'legacy-custom' && m.layout?.dbContainer ? [m.layout.dbContainer] : [])])],
        };
        const php = isSupportedPhpVersion(m.php) ? m.php : (base?.php ?? DEFAULT_PHP_VERSION);
        return {
            schema: 2,
            name,
            kind: m.kind === 'custom' ? 'custom' : 'redaxo',
            php,
            phpImageTag: await resolvePhpImageTag(php),
            mariadb: m.mariadb && /^\d/.test(m.mariadb) ? m.mariadb : DEFAULT_MARIADB_VERSION,
            redaxoVersion: m.redaxoVersion,
            redaxo6: m.redaxo6,
            domains: [],
            ports: { http, db },
            db: { name: m.db.name, user: m.db.user, password: m.db.password, rootPassword: m.db.rootPassword },
            admin: m.admin,
            xdebug: false,
            createdAt: new Date().toISOString(),
            layout,
        };
    }

    private async configFromV1Export(tmp: string, name: string, http: number, db: number): Promise<{ cfg: InstanceConfig; dump?: string }> {
        const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'manifest.json'), 'utf8'));
        const env = parseEnv(await fs.readFile(path.join(tmp, '.env'), 'utf8').catch(() => ''));
        const compose = await fs.readFile(path.join(tmp, 'docker-compose.yml'), 'utf8').catch(() => '');
        const isCustom = manifest.instanceType === 'custom' || /build:/.test(compose);
        const oldName: string = manifest.originalName ?? name;

        // unpack web files (redaxo-files.tar.gz contains either redaxo/ (data/redaxo) or project/)
        const filesTar = path.join(tmp, 'redaxo-files.tar.gz');
        const layout = defaultLayout(name);
        if (await exists(filesTar)) {
            const unpack = path.join(tmp, '_files');
            await fs.mkdir(unpack);
            await run('tar', ['-xzf', filesTar, '-C', unpack]);
            const top = (await fs.readdir(unpack))[0];
            if (top === 'project') {
                await fs.cp(path.join(unpack, 'project'), path.join(tmp, 'project'), { recursive: true });
            } else if (top) {
                await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
                await fs.cp(path.join(unpack, top), path.join(tmp, 'data', 'redaxo'), { recursive: true });
                layout.webroot = 'data/redaxo';
                layout.docroot = '/var/www/html';
            }
            await fs.rm(unpack, { recursive: true, force: true });
        }
        if (isCustom) {
            const safe = oldName.replace(/_/g, '');
            layout.dbAliases = [`${safe}db`];
        } else {
            layout.webService = 'redaxo';
            layout.dbService = 'mysql';
        }
        const php = isSupportedPhpVersion(manifest.phpVersion) ? manifest.phpVersion : (isCustom ? DEFAULT_PHP_VERSION : '8.4');
        const cfg: InstanceConfig = {
            schema: 2,
            name,
            kind: isCustom ? 'custom' : 'redaxo',
            php,
            phpImageTag: await resolvePhpImageTag(php),
            mariadb: manifest.mariadbVersion && /^\d/.test(manifest.mariadbVersion) ? manifest.mariadbVersion : DEFAULT_MARIADB_VERSION,
            domains: [],
            ports: { http, db },
            db: isCustom
                ? { name: env.DB_NAME ?? oldName, user: env.DB_USER ?? oldName, password: env.DB_PASSWORD ?? oldName, rootPassword: env.DB_ROOT_PASSWORD ?? 'root' }
                : { name: env.DB_NAME ?? 'redaxo', user: env.DB_USER ?? 'redaxo', password: env.DB_PASSWORD ?? env.MYSQL_PASSWORD ?? generatePassword(), rootPassword: env.DB_ROOT_PASSWORD ?? env.MYSQL_ROOT_PASSWORD ?? generatePassword() },
            admin: isCustom ? undefined : { user: 'admin', password: env.DB_PASSWORD ?? '' },
            xdebug: false,
            createdAt: new Date().toISOString(),
            layout,
        };
        const dump = path.join(tmp, 'db-dump.sql');
        return { cfg, dump: (await exists(dump)) ? dump : undefined };
    }

    /** Copies a dump into docker/initdb, removing system databases and adding grants. */
    private async copyDump(source: string, target: string, cfg: InstanceConfig): Promise<void> {
        const input = readline.createInterface({ input: createReadStream(source, 'utf8'), crlfDelay: Infinity });
        const out = createWriteStream(target, 'utf8');
        const databases = new Set<string>();
        const lines = (async function* () {
            for await (const line of input) {
                yield line;
            }
        })();
        const system = systemDatabases;
        let skipping = false;
        for await (const line of lines) {
            const m = /^-- Current Database: `([^`]+)`/.exec(line);
            if (m) {
                skipping = system.has(m[1]);
                if (!skipping) {
                    databases.add(m[1]);
                }
            }
            if (!skipping && !out.write(line + '\n')) {
                await new Promise<void>(r => out.once('drain', () => r()));
            }
        }
        for (const db of databases) {
            out.write(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${cfg.db.user}'@'%';\n`);
        }
        out.write('FLUSH PRIVILEGES;\n');
        await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }

    /** Points REDAXO's `server` setting to the new URL after import / modernization. */
    private async rewriteRedaxoServer(dir: string, cfg: InstanceConfig): Promise<void> {
        if (cfg.kind !== 'redaxo') {
            return;
        }
        const docroot = path.join(dir, cfg.layout.webroot, path.posix.relative('/var/www/html', cfg.layout.docroot));
        const configYml = path.join(docroot, 'redaxo', 'data', 'core', 'config.yml');
        if (!(await exists(configYml))) {
            return;
        }
        const instance = instanceFromConfig(dir, cfg, await this.shared.ports());
        const content = await fs.readFile(configYml, 'utf8');
        await fs.writeFile(configYml, content.replace(/^server:.*$/m, `server: '${instance.urls.frontend}'`), 'utf8');
        // the config is cached (redaxo/cache/core/config.yml.cache) – clear the cache like `cache:clear` does
        const cacheDir = path.join(docroot, 'redaxo', 'cache');
        for (const entry of await fs.readdir(cacheDir).catch(() => [] as string[])) {
            if (entry !== '.htaccess') {
                await fs.rm(path.join(cacheDir, entry), { recursive: true, force: true });
            }
        }
    }

    // ───────────────────────────────────────────── modernize 1.x instances

    /**
     * Converts a 1.x instance to the v2 format in place. Containers, volumes, service names
     * and credentials are kept; a full backup archive is created first.
     */
    async modernize(name: string, progress: ProgressReporter = () => {}, options: { backup?: boolean; start?: boolean } = {}): Promise<{ backup?: string }> {
        const instance = await this.get(name);
        if (instance.format === 'v2') {
            throw new InstanceError(`"${name}" already uses the current format`, 'invalid');
        }
        let backup: string | undefined;
        if (options.backup !== false) {
            progress('Creating backup…');
            backup = (await this.exportInstance(name, path.join(this.settings.instancesDir, SHARED_DIR, 'backups'), progress, { requireDatabase: true })).archive;
        }

        progress('Stopping 1.x containers…');
        await this.docker.compose(instance.path, ['down', '--remove-orphans'], { allowFailure: true });

        const legacyDir = path.join(instance.path, '.legacy');
        await fs.mkdir(legacyDir, { recursive: true });
        for (const f of ['docker-compose.yml', '.env', 'Dockerfile', 'custom-setup.sh', 'apache-ssl.conf', 'ssl', 'README.md']) {
            const src = path.join(instance.path, f);
            if (await exists(src)) {
                await fs.rename(src, path.join(legacyDir, f));
            }
        }

        const env = parseEnv(await fs.readFile(path.join(legacyDir, '.env'), 'utf8').catch(() => ''));
        const php = instance.format === 'legacy-standard'
            ? (instance.webImage?.includes('edge') ? '8.5' : '8.4')
            : (isSupportedPhpVersion(instance.php) ? instance.php : DEFAULT_PHP_VERSION);
        const layout = { ...instance.layout, composeProject: instance.layout.composeProject || composeProjectFromDir(name) };
        const cfg: InstanceConfig = {
            schema: 2,
            name: instance.name,
            kind: instance.kind,
            php,
            phpImageTag: await resolvePhpImageTag(php),
            mariadb: instance.mariadb,
            domains: [],
            ports: { http: instance.ports.http, db: instance.ports.db ?? (await findFreePort(3307, await this.instancePorts())) },
            db: { name: instance.db.name, user: instance.db.user, password: instance.db.password, rootPassword: instance.db.rootPassword },
            admin: instance.admin,
            xdebug: env.XDEBUG_ENABLED === 'true',
            createdAt: new Date().toISOString(),
            layout,
            migratedFrom: instance.format,
        };
        if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) === false) {
            // names with underscores are no valid host names – keep direct access only
            cfg.domains = [];
        }
        await this.writeDockerDir(instance.path, true);
        // Linux: the 1.x containers created the web files as www-data – hand them to the host user, the new image
        // maps www-data to the host user anyway (database files stay untouched)
        await this.takeOwnership(path.join(instance.path, layout.webroot));
        await this.rewriteRedaxoServer(instance.path, cfg);
        await this.writeInstanceFiles(instance.path, cfg);
        this.log.info(`Instance ${name} modernized (backup: ${backup ?? 'none'})`);
        if (options.start !== false) {
            await this.start(name, progress);
        }
        return { backup };
    }

    // ───────────────────────────────────────────── git

    /** Clones a repository into a temporary folder and detects what it is (REDAXO 5/6 or PHP project). */
    async cloneProject(url: string, branch?: string): Promise<{ dir: string; project: DetectedProject; suggestedName: string }> {
        const tmpRoot = path.join(this.settings.instancesDir, SHARED_DIR, 'tmp');
        await fs.mkdir(tmpRoot, { recursive: true });
        const dir = await fs.mkdtemp(path.join(tmpRoot, 'clone-'));
        await fs.rmdir(dir);
        await gitClone(url, dir, branch);
        const suggestedName = repoName(url).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'projekt';
        return { dir, project: await detectProject(dir), suggestedName };
    }

    /** Clones a repository and creates (and starts) an instance from it. */
    async createFromGit(url: string, options: Omit<CreateOptions, 'kind' | 'redaxo6' | 'sourceDir' | 'docroot'> & { branch?: string }, progress: ProgressReporter = () => {}): Promise<Instance> {
        progress('Cloning repository…');
        const { dir, project } = await this.cloneProject(url, options.branch);
        try {
            this.log.info(`Detected ${project.description}`);
            return await this.create({
                ...options,
                kind: project.kind,
                redaxo6: project.redaxo6,
                docroot: project.docroot,
                sourceDir: dir,
            }, progress);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    }

    /** Puts the web root of an instance under git (init, .gitignore, optional remote, initial commit). */
    async setupGit(name: string, options: { remote?: string; commit?: boolean } = {}): Promise<GitStatus & { dir: string }> {
        const instance = await this.get(name, false);
        const dir = instance.webrootPath;
        const status = await gitInit(dir, {
            kind: instance.kind,
            redaxo6: instance.redaxo6,
            docroot: instance.layout.docroot,
        }, options);
        return { ...status, dir };
    }

    // ───────────────────────────────────────────── snapshots

    private snapshotsDir(instance: Instance): string {
        return path.join(instance.path, '.snapshots');
    }

    /** Cache contents are never part of a snapshot – they are rebuilt anyway. */
    private snapshotExcludes(instance: Instance): string[] {
        const docrootRel = path.posix.relative('/var/www/html', instance.layout.docroot);
        const prefix = docrootRel ? `./${docrootRel}` : '.';
        return [...new Set([
            `${prefix}/redaxo/cache/*`, './var/cache/*', './project/var/cache/*', './node_modules', './.git',
        ])];
    }

    async listSnapshots(name: string): Promise<Snapshot[]> {
        const instance = await this.get(name, false);
        const dir = this.snapshotsDir(instance);
        const out: Snapshot[] = [];
        for (const id of await fs.readdir(dir).catch(() => [] as string[])) {
            try {
                const meta = JSON.parse(await fs.readFile(path.join(dir, id, 'snapshot.json'), 'utf8')) as Omit<Snapshot, 'id' | 'path'>;
                out.push({ ...meta, id, path: path.join(dir, id) });
            } catch {
                // incomplete snapshot
            }
        }
        return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /** Saves the database(s) and the files of the web root (without caches). */
    async createSnapshot(name: string, label = '', progress: ProgressReporter = () => {}): Promise<Snapshot> {
        const instance = await this.get(name, false);
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const id = `${timestamp()}${slug ? `-${slug}` : ''}`;
        const dir = path.join(this.snapshotsDir(instance), id);
        await fs.mkdir(dir, { recursive: true });
        await this.ensureGitignoreEntry(instance.path, '.snapshots/');
        const startedDb = await this.ensureDbRunning(instance, progress);
        try {
            progress('Saving database…');
            const databases = await this.dumpDatabase(name, path.join(dir, 'database.sql'));
            progress('Saving files…');
            await run('tar', ['-czf', path.join(dir, 'files.tar.gz'),
                ...this.snapshotExcludes(instance).flatMap(e => ['--exclude', e]), '-C', instance.webrootPath, '.'], { timeout: 3_600_000 });
            const sizeBytes = (await fs.stat(path.join(dir, 'database.sql'))).size + (await fs.stat(path.join(dir, 'files.tar.gz'))).size;
            const meta = { label, createdAt: new Date().toISOString(), databases, sizeBytes, php: instance.php, mariadb: instance.mariadb };
            await fs.writeFile(path.join(dir, 'snapshot.json'), JSON.stringify(meta, null, 2), 'utf8');
            this.log.info(`Snapshot ${id} of ${name} created`);
            return { ...meta, id, path: dir };
        } catch (error) {
            await fs.rm(dir, { recursive: true, force: true });
            throw error;
        } finally {
            if (startedDb) {
                await this.docker.compose(instance.path, ['stop', instance.layout.dbService], { allowFailure: true });
            }
        }
    }

    /** Restores database(s) and files of a snapshot. Files and tables created afterwards are removed. */
    async restoreSnapshot(name: string, id: string, progress: ProgressReporter = () => {}): Promise<void> {
        const instance = await this.get(name, false);
        const snapshot = (await this.listSnapshots(name)).find(s => s.id === id);
        if (!snapshot) {
            throw new InstanceError(`Snapshot ${id} not found`, 'not-found');
        }
        const startedDb = await this.ensureDbRunning(instance, progress);
        try {
            progress('Restoring database…');
            const drop = snapshot.databases.filter(isValidIdentifier).map(db => `DROP DATABASE IF EXISTS \`${db}\`;`).join(' ');
            if (drop) {
                await this.dbRoot(instance, drop);
            }
            const tmp = `/tmp/redaxo-mi-restore-${Date.now()}.sql`;
            await this.docker.run(['cp', path.join(snapshot.path, 'database.sql'), `${instance.layout.dbContainer}:${tmp}`], { onLine: () => {} });
            await this.docker.exec(instance.layout.dbContainer, ['sh', '-c',
                `BIN=$(command -v mariadb || command -v mysql); "$BIN" -uroot < ${tmp}; rc=$?; rm -f ${tmp}; exit $rc`], {
                execEnv: { MYSQL_PWD: instance.db.rootPassword }, timeout: 3_600_000,
            });
            progress('Restoring files…');
            await this.clearDirectory(instance.webrootPath, ['.git', 'node_modules']);
            await run('tar', ['-xzf', path.join(snapshot.path, 'files.tar.gz'), '-C', instance.webrootPath], { timeout: 3_600_000 });
            this.log.info(`Snapshot ${id} of ${name} restored`);
        } finally {
            if (startedDb) {
                await this.docker.compose(instance.path, ['stop', instance.layout.dbService], { allowFailure: true });
            }
        }
    }

    async deleteSnapshot(name: string, id: string): Promise<void> {
        const snapshot = (await this.listSnapshots(name)).find(s => s.id === id);
        if (snapshot) {
            await fs.rm(snapshot.path, { recursive: true, force: true });
        }
    }

    private async ensureDbRunning(instance: Instance, progress: ProgressReporter): Promise<boolean> {
        if (await this.docker.isRunning(instance.layout.dbContainer)) {
            return false;
        }
        progress('Starting database…');
        await this.docker.ensureNetwork(SHARED_NETWORK);
        await this.docker.compose(instance.path, ['up', '-d', '--wait', instance.layout.dbService]);
        return true;
    }

    private async ensureGitignoreEntry(dir: string, entry: string): Promise<void> {
        const file = path.join(dir, '.gitignore');
        const current = await fs.readFile(file, 'utf8').catch(() => undefined);
        if (current !== undefined && !current.split(/\r?\n/).includes(entry)) {
            await fs.writeFile(file, `${current.trimEnd()}\n${entry}\n`, 'utf8');
        }
    }

    /** Removes everything in a directory except `keep` (falls back to a root container on Linux). */
    private async clearDirectory(dir: string, keep: readonly string[]): Promise<void> {
        for (const entry of await fs.readdir(dir)) {
            if (!keep.includes(entry)) {
                await this.removeDirectory(path.join(dir, entry));
            }
        }
    }

    // ───────────────────────────────────────────── duplicate / resources

    /** Copies an instance (files + database) under a new name – via export and import. */
    async duplicate(name: string, newName: string, progress: ProgressReporter = () => {}): Promise<Instance> {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'redaxo-mi-dup-'));
        try {
            const { archive } = await this.exportInstance(name, tmp, progress, { requireDatabase: true });
            return await this.importInstance(archive, newName, progress);
        } finally {
            await fs.rm(tmp, { recursive: true, force: true });
        }
    }

    /** CPU / memory of the containers (when running) and disk usage of the instance. */
    async resources(name: string): Promise<InstanceResources> {
        const instance = await this.get(name);
        const result: InstanceResources = {};
        if (instance.status !== 'stopped') {
            const res = await this.docker.run(['stats', '--no-stream', '--format', '{{json .}}', instance.layout.webContainer, instance.layout.dbContainer],
                { allowFailure: true, timeout: 20_000, onLine: () => {} });
            let cpu = 0;
            let mem = 0;
            for (const line of res.stdout.split(/\r?\n/).filter(Boolean)) {
                try {
                    const s = JSON.parse(line) as { CPUPerc: string; MemUsage: string };
                    cpu += parseFloat(s.CPUPerc) || 0;
                    mem += parseByteSize(s.MemUsage.split('/')[0]);
                } catch {
                    // ignore
                }
            }
            result.cpuPercent = Math.round(cpu * 10) / 10;
            result.memoryBytes = mem;
        }
        if (process.platform !== 'win32') {
            const du = await run('du', ['-sk', instance.path], { allowFailure: true, timeout: 60_000 });
            const files = parseInt(du.stdout, 10) * 1024 || 0;
            let database = 0;
            if (instance.layout.dbStorage.type === 'volume' && await this.docker.isRunning(instance.layout.dbContainer)) {
                const dbDu = await this.docker.exec(instance.layout.dbContainer, ['du', '-sk', '/var/lib/mysql'], { allowFailure: true, timeout: 60_000 });
                database = parseInt(dbDu.stdout, 10) * 1024 || 0;
            }
            result.diskBytes = files + database;
        }
        return result;
    }

    // ───────────────────────────────────────────── file ownership (Linux)

    /**
     * Runs a short-lived root container on a host directory – for files created by container users
     * (www-data, mysql) that the host user may not change on Linux. Uses the proxy image (already present).
     */
    private async asRoot(dir: string, script: string): Promise<void> {
        await this.docker.run(['run', '--rm', '-v', `${dir}:/target`, '--entrypoint', 'sh', SHARED_IMAGES.proxy, '-c', script], { onLine: () => {} });
    }

    private async takeOwnership(dir: string): Promise<void> {
        const uid = process.getuid?.();
        const gid = process.getgid?.();
        if (process.platform !== 'linux' || uid === undefined || uid === 0 || !(await exists(dir))) {
            return;
        }
        this.log.info(`Handing ${dir} to the host user`);
        await this.asRoot(dir, `chown -R ${uid}:${gid ?? uid} /target`);
    }

    /** Deletes a directory, also when it contains files of container users (Linux). */
    private async removeDirectory(dir: string): Promise<void> {
        try {
            await fs.rm(dir, { recursive: true, force: true });
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EACCES' && code !== 'EPERM' && code !== 'ENOTEMPTY') {
                throw error;
            }
            await this.asRoot(dir, 'rm -rf /target/..?* /target/.[!.]* /target/*');
            await fs.rm(dir, { recursive: true, force: true });
        }
    }

    // ───────────────────────────────────────────── maintenance

    /**
     * Containers/images created by this extension that no longer belong to an instance.
     * Only containers started from a compose file inside the instances folder are considered.
     */
    async findOrphans(): Promise<{ containers: string[]; images: string[] }> {
        const instances = await this.list({ withStatus: false });
        const root = (await canonicalPath(this.settings.instancesDir)) + path.sep;
        const known = new Set(await Promise.all([...instances.map(i => i.path), this.shared.dir].map(canonicalPath)));
        const containers: string[] = [];
        for (const c of await this.docker.containers()) {
            if (!c.workingDir) {
                continue;
            }
            const wd = await canonicalPath(c.workingDir);
            if ((wd + path.sep).startsWith(root) && !known.has(wd) && !(await exists(wd))) {
                containers.push(c.name);
            }
        }

        const used = new Set<string>();
        for (const i of instances) {
            const composeFile = await findComposeFile(i.path);
            const compose = composeFile ? await fs.readFile(composeFile, 'utf8') : '';
            const image = /image:\s*(redaxo-mi-web:\S+)/.exec(compose)?.[1];
            if (image) {
                used.add(image);
            }
        }
        const res = await this.docker.run(['images', 'redaxo-mi-web', '--format', '{{.Repository}}:{{.Tag}}'], { onLine: () => {} });
        const images = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(s => s && !used.has(s) && !s.endsWith(':<none>'));
        return { containers, images };
    }

    async removeOrphans(orphans: { containers: string[]; images: string[] }): Promise<void> {
        if (orphans.containers.length) {
            await this.docker.run(['rm', '-f', ...orphans.containers], { allowFailure: true });
        }
        if (orphans.images.length) {
            await this.docker.run(['rmi', ...orphans.images], { allowFailure: true });
        }
    }

    /** Finds instances sharing host ports and reassigns ports of v2 instances. */
    async fixPortConflicts(): Promise<string[]> {
        const instances = await this.list({ withStatus: false });
        const seen = new Map<number, string>();
        const changes: string[] = [];
        const reserved = await this.instancePorts();
        for (const instance of instances) {
            for (const key of ['http', 'db'] as const) {
                const port = instance.ports[key];
                if (!port) {
                    continue;
                }
                const owner = seen.get(port);
                if (!owner) {
                    seen.set(port, instance.name);
                    continue;
                }
                if (instance.format !== 'v2' || !instance.config) {
                    changes.push(`${instance.name}: port ${port} conflicts with ${owner} (1.x instance – modernize to fix automatically)`);
                    continue;
                }
                const cfg = structuredClone(instance.config);
                const next = await findFreePort(key === 'http' ? 8080 : 3307, reserved);
                reserved.add(next);
                cfg.ports[key] = next;
                await this.writeInstanceFiles(instance.path, cfg);
                instance.config = cfg;
                seen.set(next, instance.name);
                changes.push(`${instance.name}: ${key} port ${port} → ${next} (restart required)`);
            }
        }
        return changes;
    }

    /** Commands to open an interactive shell (used for VS Code terminals). */
    shellCommand(instance: Instance, target: 'web' | 'db' | 'mysql'): { command: string; args: string[]; env?: Record<string, string> } {
        const docker = this.settings.dockerPath || 'docker';
        if (target === 'web') {
            return { command: docker, args: ['exec', '-it', '-w', '/var/www/html', instance.layout.webContainer, 'bash'] };
        }
        if (target === 'db') {
            return { command: docker, args: ['exec', '-it', instance.layout.dbContainer, 'bash'] };
        }
        return {
            command: docker,
            args: ['exec', '-it', '-e', `MYSQL_PWD=${instance.db.password}`, instance.layout.dbContainer, 'sh', '-c',
                `command -v mariadb >/dev/null && exec mariadb -u${instance.db.user} ${instance.db.name} || exec mysql -u${instance.db.user} ${instance.db.name}`],
        };
    }
}
