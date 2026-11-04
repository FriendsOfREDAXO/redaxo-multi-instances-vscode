import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    INSTANCE_CONFIG_FILE, Instance, InstanceConfig, InstanceFormat, InstanceLayout, InstanceStatus,
    instanceHosts,
} from './model';
import { SharedPorts, proxyUrl } from './settings';

const COMPOSE_FILES = ['docker-compose.yml', 'compose.yml', 'docker-compose.yaml', 'compose.yaml'];

/** Parses KEY=VALUE files (.env). Values may contain `=`; quotes are stripped. */
export function parseEnv(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const idx = line.indexOf('=');
        if (idx <= 0) {
            continue;
        }
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}

/** Replaces or appends KEY=VALUE lines while keeping comments and order. */
export function updateEnv(content: string, values: Record<string, string>): string {
    const lines = content.split(/\r?\n/);
    const seen = new Set<string>();
    const out = lines.map(line => {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m && m[1] in values) {
            seen.add(m[1]);
            return `${m[1]}=${values[m[1]]}`;
        }
        return line;
    });
    while (out.length > 0 && out[out.length - 1] === '') {
        out.pop();
    }
    for (const [key, value] of Object.entries(values)) {
        if (!seen.has(key)) {
            out.push(`${key}=${value}`);
        }
    }
    return out.join('\n') + '\n';
}

/**
 * Canonical path for comparisons with Docker labels: Compose records resolved paths
 * (e.g. /private/var/… on macOS where /var is a symlink).
 */
export async function canonicalPath(p: string): Promise<string> {
    try {
        return await fs.realpath(p);
    } catch {
        return path.resolve(p);
    }
}

/** Docker Compose derives the default project name from the directory name. */
export function composeProjectFromDir(dirName: string): string {
    return dirName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function readOptional(p: string): Promise<string | undefined> {
    try {
        return await fs.readFile(p, 'utf8');
    } catch {
        return undefined;
    }
}

export async function findComposeFile(dir: string): Promise<string | undefined> {
    for (const file of COMPOSE_FILES) {
        if (await exists(path.join(dir, file))) {
            return path.join(dir, file);
        }
    }
    return undefined;
}

function portFromCompose(compose: string, containerPort: number): number | undefined {
    const re = new RegExp(`["']?(?:[\\d.]+:)?(\\d+):${containerPort}(?:/tcp)?["']?\\s*$`, 'm');
    const m = re.exec(compose);
    return m ? parseInt(m[1], 10) : undefined;
}

function num(value: string | undefined): number | undefined {
    const n = value ? parseInt(value, 10) : NaN;
    return Number.isFinite(n) ? n : undefined;
}

export async function readInstanceConfig(dir: string): Promise<InstanceConfig | undefined> {
    const raw = await readOptional(path.join(dir, INSTANCE_CONFIG_FILE));
    if (!raw) {
        return undefined;
    }
    const cfg = JSON.parse(raw) as InstanceConfig;
    if (cfg.schema !== 2) {
        throw new Error(`Unsupported ${INSTANCE_CONFIG_FILE} schema in ${dir}`);
    }
    cfg.domains ??= [];
    return cfg;
}

export async function writeInstanceConfig(dir: string, cfg: InstanceConfig): Promise<void> {
    await fs.writeFile(path.join(dir, INSTANCE_CONFIG_FILE), JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/** Builds the runtime model of a v2 instance. */
export function instanceFromConfig(dir: string, cfg: InstanceConfig, ports: SharedPorts): Instance {
    const hosts = instanceHosts(cfg.name, cfg.domains);
    const primaryHost = hosts[0];
    const direct = `http://localhost:${cfg.ports.http}`;
    const frontend = `${proxyUrl(ports, primaryHost)}/`;
    return {
        name: cfg.name,
        path: dir,
        format: 'v2',
        kind: cfg.kind,
        php: cfg.php,
        mariadb: cfg.mariadb,
        redaxoVersion: cfg.redaxoVersion,
        redaxo6: cfg.redaxo6,
        status: 'unknown',
        ports: { http: cfg.ports.http, db: cfg.ports.db },
        urls: {
            frontend,
            backend: cfg.kind === 'redaxo' ? `${frontend}redaxo/` : undefined,
            direct: `${direct}/`,
            hosts,
        },
        db: { ...cfg.db, host: cfg.layout.dbService, externalPort: cfg.ports.db },
        admin: cfg.admin,
        xdebug: cfg.xdebug,
        domains: cfg.domains,
        layout: cfg.layout,
        webrootPath: path.join(dir, cfg.layout.webroot),
        docrootPath: path.join(dir, cfg.layout.webroot, path.posix.relative('/var/www/html', cfg.layout.docroot)),
        config: cfg,
        createdAt: cfg.createdAt,
    };
}

/** Detects and maps a 1.x instance directory. */
export function instanceFromLegacy(dir: string, compose: string, env: Record<string, string>): Instance | undefined {
    const name = path.basename(dir);
    const safe = name.replace(/_/g, '');
    const isCustom = (compose.includes(`${name}_web`) && compose.includes(`${name}_db`))
        || (compose.includes(`${safe}web`) && compose.includes(`${safe}db`));
    const isStandard = !isCustom && (compose.includes(`redaxo-${name}`) || env.RELEASE_TYPE !== undefined);
    if (!isCustom && !isStandard) {
        return undefined;
    }

    const httpPort = portFromCompose(compose, 80) ?? num(env.HTTP_PORT) ?? 80;
    const httpsPort = portFromCompose(compose, 443) ?? num(env.HTTPS_PORT);
    const dbPort = portFromCompose(compose, 3306) ?? num(env.MYSQL_PORT);
    const direct = `http://localhost:${httpPort}`;
    const format: InstanceFormat = isCustom ? 'legacy-custom' : 'legacy-standard';

    let layout: InstanceLayout;
    let db: Instance['db'];
    if (isCustom) {
        const webContainer = /container_name:\s*(\S+web)\s*$/m.exec(compose)?.[1] ?? `${safe}web`;
        const dbContainer = /container_name:\s*(\S+db)\s*$/m.exec(compose)?.[1] ?? `${safe}db`;
        const volumeKey = /^\s{2}(\S+_data):\s*$/m.exec(compose)?.[1] ?? `${safe}db_data`;
        layout = {
            composeProject: composeProjectFromDir(name),
            webService: 'web',
            dbService: 'db',
            webContainer,
            dbContainer,
            webroot: 'project',
            docroot: '/var/www/html/public',
            dbStorage: { type: 'volume', volume: volumeKey },
        };
        db = {
            host: dbContainer,
            name: env.DB_NAME ?? name,
            user: env.DB_USER ?? name,
            password: env.DB_PASSWORD ?? name,
            rootPassword: env.DB_ROOT_PASSWORD ?? 'root',
            externalPort: dbPort,
        };
    } else {
        layout = {
            composeProject: composeProjectFromDir(name),
            webService: 'redaxo',
            dbService: 'mysql',
            webContainer: `redaxo-${name}`,
            dbContainer: `redaxo-${name}-mysql`,
            webroot: 'data/redaxo',
            docroot: '/var/www/html',
            dbStorage: { type: 'bind', path: './data/mysql' },
        };
        db = {
            host: env.DB_HOST ?? 'mysql',
            name: env.DB_NAME ?? 'redaxo',
            user: env.DB_USER ?? 'redaxo',
            password: env.DB_PASSWORD ?? env.MYSQL_PASSWORD ?? '',
            rootPassword: env.DB_ROOT_PASSWORD ?? env.MYSQL_ROOT_PASSWORD ?? '',
            externalPort: dbPort,
        };
    }

    const sslEnabled = env.SSL_ENABLED === 'true' && httpsPort !== undefined;
    const legacyHttps = sslEnabled ? `https://${name}.local:${httpsPort}/` : undefined;
    const backendPath = isCustom ? '' : 'redaxo/';
    const webImage = /image:\s*(friendsofredaxo\/redaxo:\S+)/.exec(compose)?.[1];

    return {
        name,
        path: dir,
        format,
        kind: isCustom ? 'custom' : 'redaxo',
        php: env.PHP_VERSION ?? (webImage?.includes('edge') ? '8.5' : '8.4'),
        mariadb: env.MARIADB_VERSION ?? /image:\s*mariadb:(\S+)/.exec(compose)?.[1] ?? 'unknown',
        webImage,
        status: 'unknown',
        ports: { http: httpPort, https: httpsPort, db: dbPort },
        urls: {
            frontend: `${direct}/`,
            backend: isCustom ? undefined : `${direct}/${backendPath}`,
            direct: `${direct}/`,
            hosts: [],
            legacyHttps,
        },
        db,
        admin: isCustom ? undefined : { user: 'admin', password: env.REDAXO_ADMIN_PASSWORD ?? env.DB_PASSWORD ?? env.MYSQL_PASSWORD ?? '' },
        xdebug: env.XDEBUG_ENABLED === 'true',
        domains: [],
        layout,
        webrootPath: path.join(dir, layout.webroot),
        docrootPath: path.join(dir, layout.webroot, path.posix.relative('/var/www/html', layout.docroot)),
    };
}

/** Loads one instance directory (v2 or legacy). Returns undefined for unrelated folders. */
export async function loadInstance(dir: string, ports: SharedPorts): Promise<Instance | undefined> {
    const cfg = await readInstanceConfig(dir);
    if (cfg) {
        return instanceFromConfig(dir, cfg, ports);
    }
    const composeFile = await findComposeFile(dir);
    if (!composeFile) {
        return undefined;
    }
    const compose = await fs.readFile(composeFile, 'utf8');
    const env = parseEnv((await readOptional(path.join(dir, '.env'))) ?? '');
    return instanceFromLegacy(dir, compose, env);
}

export async function listInstanceDirs(instancesDir: string): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(instancesDir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => path.join(instancesDir, e.name))
        .sort();
}

/** Combines the container states (from `docker ps -a`) into an instance status. */
export function statusFromContainers(instance: Pick<Instance, 'layout'>, running: ReadonlySet<string>): InstanceStatus {
    const names = [instance.layout.webContainer, instance.layout.dbContainer];
    const up = names.filter(n => running.has(n)).length;
    if (up === names.length) {
        return 'running';
    }
    return up > 0 ? 'partial' : 'stopped';
}
