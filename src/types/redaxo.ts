export interface RedaxoInstance {
    name: string;
    running: boolean;
    created?: string;
    phpVersion: string;
    mariadbVersion: string;
    port?: number;
    frontendUrl: string;
    backendUrl: string;
    frontendUrlHttps?: string;
    backendUrlHttps?: string;
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
