export interface DDEVProject {
    name: string;
    status: 'running' | 'stopped' | 'paused' | 'unhealthy';
    location: string;
    urls: string[];
    type: string;
    phpVersion: string;
    database: string;
    router: string;
    mailhog?: string;
    phpmyadmin?: string;
}

export interface REDAXOProjectConfig {
    name: string;
    location: string;
    redaxoVersion: string;
    phpVersion: string;
    database: string;
    adminUser: string;
    adminPassword: string;
    adminEmail: string;
    siteName: string;
    useHttps: boolean;
    installSampleData: boolean;
}

export interface REDAXOVersion {
    version: string;
    url: string;
    released: string;
    stable: boolean;
}

export interface DatabaseDump {
    name: string;
    size: number;
    path: string;
    created: Date;
}