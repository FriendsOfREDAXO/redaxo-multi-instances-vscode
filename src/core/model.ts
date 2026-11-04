/** Instance kinds: a full REDAXO installation or an empty PHP/Apache project. */
export type InstanceKind = 'redaxo' | 'custom';

/**
 * Storage format of an instance directory.
 *  - v2:              created (or modernized) by version 2 – `redaxo-instance.json`
 *  - legacy-standard: 1.x REDAXO instance (friendsofredaxo/redaxo image, services redaxo + mysql)
 *  - legacy-custom:   1.x "empty"/custom instance (Dockerfile, containers <name>web / <name>db)
 */
export type InstanceFormat = 'v2' | 'legacy-standard' | 'legacy-custom';

export type InstanceStatus = 'running' | 'partial' | 'stopped' | 'unknown';

export type DbStorage =
    | { type: 'volume'; volume: string; external?: string }
    | { type: 'bind'; path: string };

export interface InstanceLayout {
    /** Compose project name (`name:` in the compose file). */
    composeProject: string;
    webService: string;
    dbService: string;
    webContainer: string;
    dbContainer: string;
    /** Web root on the host, relative to the instance directory (mounted to /var/www/html). */
    webroot: string;
    /** Apache document root inside the container. */
    docroot: string;
    dbStorage: DbStorage;
    /** Extra DNS names of the db service (host names used by imported 1.x projects). */
    dbAliases?: string[];
}

export interface DbCredentials {
    name: string;
    user: string;
    password: string;
    rootPassword: string;
}

/** Persisted configuration of a v2 instance (`redaxo-instance.json`). */
export interface InstanceConfig {
    schema: 2;
    name: string;
    kind: InstanceKind;
    php: string;
    /** Tag of the php base image (e.g. `8.6-rc-apache`). */
    phpImageTag: string;
    mariadb: string;
    /** REDAXO release requested at creation (`latest`, e.g. `5.21.6`, or `6.x-dev`). */
    redaxoVersion?: string;
    /**
     * REDAXO 6 (Composer based): `project` = composer create-project redaxo/project,
     * `core` = git clone of redaxo/core for core development.
     */
    redaxo6?: 'project' | 'core';
    /** Additional host names served by the proxy (besides `<name>.localhost` and `*.<name>.localhost`). */
    domains: string[];
    ports: { http: number; db: number };
    db: DbCredentials;
    admin?: { user: string; password: string };
    xdebug: boolean;
    createdAt: string;
    layout: InstanceLayout;
    migratedFrom?: InstanceFormat;
}

export interface InstanceUrls {
    /** Primary frontend URL (HTTPS via proxy when available). */
    frontend: string;
    /** REDAXO backend (undefined for custom instances). */
    backend?: string;
    /** Direct HTTP URL bypassing the proxy (http://localhost:<port>). */
    direct: string;
    /** All proxied HTTPS host names. */
    hosts: string[];
    /** 1.x HTTPS URL (https://<name>.local:<port>) of legacy SSL instances. */
    legacyHttps?: string;
}

export interface Instance {
    name: string;
    /** Absolute path of the instance directory. */
    path: string;
    format: InstanceFormat;
    kind: InstanceKind;
    php: string;
    mariadb: string;
    redaxoVersion?: string;
    redaxo6?: 'project' | 'core';
    /** Docker image used for the web container (legacy-standard instances). */
    webImage?: string;
    status: InstanceStatus;
    ports: { http: number; https?: number; db?: number };
    urls: InstanceUrls;
    db: DbCredentials & { host: string; externalPort?: number };
    admin?: { user: string; password: string };
    xdebug: boolean;
    domains: string[];
    layout: InstanceLayout;
    /** Absolute web root on the host. */
    webrootPath: string;
    /** Absolute document root on the host (where index.php lives). */
    docrootPath: string;
    config?: InstanceConfig;
    createdAt?: string;
}

export const INSTANCE_CONFIG_FILE = 'redaxo-instance.json';
export const SHARED_DIR = '.redaxo-mi';
export const SHARED_NETWORK = 'redaxo-mi';
/** Composer cache shared by all instances. */
export const COMPOSER_CACHE_VOLUME = 'redaxo-mi-composer-cache';
export const CONTAINER_PREFIX = 'redaxo-';

/** Names of new instances double as DNS labels (`<name>.localhost`). */
export const INSTANCE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function validateInstanceName(name: string): string | undefined {
    if (!name) {
        return 'Name is required';
    }
    if (!INSTANCE_NAME_PATTERN.test(name)) {
        return 'Use 1–40 lowercase letters, digits or hyphens (no leading/trailing hyphen)';
    }
    if (['www', 'adminer', 'mail', 'mailpit', 'proxy', 'localhost'].includes(name)) {
        return `"${name}" is reserved`;
    }
    return undefined;
}

const HOSTNAME_PATTERN = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** Validates an additional host name (e.g. `shop.localhost`, `*.kunde.localhost`, `kunde.test`). */
export function validateDomain(domain: string): string | undefined {
    const d = domain.trim().toLowerCase();
    if (!HOSTNAME_PATTERN.test(d)) {
        return 'Invalid host name';
    }
    if (d === '*.localhost' || d === 'localhost') {
        return 'Too broad – use a sub domain such as shop.localhost';
    }
    return undefined;
}

/** Host names a v2 instance is reachable under (proxy routing + certificate). */
export function instanceHosts(name: string, domains: readonly string[]): string[] {
    const hosts = [`${name}.localhost`, `*.${name}.localhost`, ...domains.map(d => d.trim().toLowerCase())];
    return [...new Set(hosts.filter(Boolean))];
}

export function defaultLayout(name: string): InstanceLayout {
    return {
        composeProject: `${CONTAINER_PREFIX}${name}`,
        webService: 'web',
        dbService: 'db',
        webContainer: `${CONTAINER_PREFIX}${name}-web`,
        dbContainer: `${CONTAINER_PREFIX}${name}-db`,
        webroot: 'project',
        docroot: '/var/www/html/public',
        dbStorage: { type: 'volume', volume: 'db-data' },
    };
}
