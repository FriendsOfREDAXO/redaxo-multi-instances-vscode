export interface RedaxoInstance {
    name: string;
    running: boolean;
    created?: string;
    phpVersion: string;
    mariadbVersion: string;
    port?: number; // HTTP Port for backward compatibility
    httpPort?: number;
    httpsPort?: number;
    frontendUrl: string;
    backendUrl: string;
    primaryFrontendUrl?: string;
    primaryBackendUrl?: string;
    frontendUrlHttps?: string;
    backendUrlHttps?: string;
    frontendUrlHttpsLocalhost?: string;  // For direct context menu access
    backendUrlHttpsLocalhost?: string;   // For direct context menu access
    phpmyadminUrl?: string;
    mailpitUrl?: string;
    containerId?: string;
    containerNames?: {
        web: string;
        db: string;
        phpmyadmin?: string;
        mailpit?: string;
    };
    status?: 'running' | 'stopped' | 'creating' | 'error';
    hasSnapshot?: boolean;
    path?: string;
    instanceType?: 'standard' | 'custom';
    // DDEV specific properties
    containerType?: 'docker' | 'ddev';
    localDomain?: string; // for DDEV projects (e.g., instancename.ddev.site)
    redaxoStructure?: 'classic' | 'modern';
}

export interface DatabaseDump {
    name: string;
    path: string;
    size: string;
    basename: string;
    created?: Date;
}

export interface CreateInstanceOptions {
    name: string;
    phpVersion: string;
    mariadbVersion: string;
    autoInstall: boolean;
    importDump: boolean;
    webserverOnly: boolean;
    dumpFile?: string;
    port?: number;
    releaseType?: 'standard';
    downloadUrl?: string;
    sslEnabled?: boolean;
    imageVariant?: 'stable' | 'edge'; // stable = older PHP, edge = latest PHP/REDAXO
    // DDEV specific options
    containerType?: 'docker' | 'ddev';
    redaxoStructure?: 'classic' | 'modern'; // classic = traditional, modern = with public folder
    localDomain?: string; // for DDEV local domain
}

export interface DockerContainer {
    id: string;
    name: string;
    image: string;
    status: string;
    ports: string[];
    created: string;
}

export interface ScreenshotResult {
    success: boolean;
    screenshot?: string;
    timestamp?: number;
    error?: string;
    message?: string;
    url?: string;
}

export interface DatabaseInfo {
    host: string;
    database: string;
    user: string;
    password: string;
    rootPassword: string;
    phpmyadminUrl?: string;
}

export interface InstanceCommand {
    command: string;
    args: string[];
    cwd?: string;
    env?: { [key: string]: string };
}

export interface DDEVConfig {
    name: string;
    type: string;
    docroot: string;
    php_version: string;
    database: {
        type: string;
        version: string;
    };
    router_http_port?: string;
    router_https_port?: string;
    use_dns_when_possible?: boolean;
    additional_hostnames?: string[];
}

export interface DDEVProjectInfo {
    name: string;
    status: 'running' | 'stopped' | 'paused' | 'unhealthy';
    location: string;
    urls: string[];
    type: string;
    phpVersion: string;
    dbType: string;
    dbVersion: string;
    primaryUrl?: string;
    httpsUrl?: string;
}
