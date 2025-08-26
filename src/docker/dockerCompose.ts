import { CreateInstanceOptions } from '../types/redaxo';

export class DockerComposeGenerator {
    
    static generate(options: CreateInstanceOptions, dbPassword: string, dbRootPassword: string, httpPort: number, httpsPort: number, mysqlPort: number, sslEnabled: boolean): string {
        // Always use standard web root mount
        const webRootMount = './data/redaxo:/var/www/html';
        const baseVolumes = [
            `      - ${webRootMount}`,
            '      - ./custom-setup.sh:/usr/local/bin/custom-setup.sh:ro'
        ];
        
        // SSL volumes only if SSL is enabled
        if (sslEnabled) {
            baseVolumes.push('      - ./ssl:/etc/apache2/ssl:ro');
            // Mount apache-ssl.conf as script file that gets copied by setup script
            baseVolumes.push('      - ./apache-ssl.conf:/usr/local/bin/apache-ssl.conf:ro');
        }
        
        const allVolumes = baseVolumes.join('\n');
        
        const ports = sslEnabled 
            ? `      - "${httpPort}:80"
      - "${httpsPort}:443"`
            : `      - "${httpPort}:80"`;

        // Choose image variant: stable (older PHP) or edge (latest PHP/REDAXO)
        const imageTag = options.imageVariant === 'edge' ? '5-edge' : '5-stable';
        
        // Standard REDAXO service definition  
        const serviceDefinition = `  redaxo:
    image: friendsofredaxo/redaxo:${imageTag}
    container_name: redaxo-${options.name}
    command: >
      sh -c "
        /usr/local/bin/custom-setup.sh &&
        apache2-foreground
      "
    ports:
${ports}
    volumes:
${allVolumes}`;

        return `services:
${serviceDefinition}
    environment:
      - REDAXO_SERVER=${sslEnabled ? `https://${options.name}.local:${httpsPort}` : `http://localhost:${httpPort}`}
      - REDAXO_SERVERNAME=${options.name}
      - REDAXO_ERROR_EMAIL=admin@${options.name}.local
      - REDAXO_LANG=de_de
      - REDAXO_TIMEZONE=Europe/Berlin
      - REDAXO_DB_HOST=mysql
      - REDAXO_DB_NAME=redaxo
      - REDAXO_DB_LOGIN=redaxo
      - REDAXO_DB_PASSWORD=${dbPassword}
      - REDAXO_DB_CHARSET=utf8mb4
      - REDAXO_ADMIN_USER=admin
      - REDAXO_ADMIN_PASSWORD=${dbPassword}
      - MYSQL_ROOT_PASSWORD=${dbRootPassword}
      - MYSQL_PASSWORD=${dbPassword}
      - INSTANCE_NAME=${options.name}
      - HTTP_PORT=${httpPort}${sslEnabled ? `
      - HTTPS_PORT=${httpsPort}` : ''}
      - RELEASE_TYPE=${options.releaseType || 'standard'}${options.downloadUrl ? `
      - DOWNLOAD_URL=${options.downloadUrl}` : ''}
    depends_on:
      - mysql
    networks:
      - redaxo-network

  mysql:
    image: mariadb:${options.mariadbVersion}
    container_name: redaxo-${options.name}-mysql
    ports:
      - "${mysqlPort}:3306"
    environment:
      - MYSQL_ROOT_PASSWORD=${dbRootPassword}
      - MYSQL_DATABASE=redaxo
      - MYSQL_USER=redaxo
      - MYSQL_PASSWORD=${dbPassword}
      - MYSQL_CHARSET=utf8mb4
      - MYSQL_COLLATION=utf8mb4_unicode_ci
    volumes:
      - ./data/mysql:/var/lib/mysql
      - ./mysql-init:/docker-entrypoint-initdb.d:ro
    networks:
      - redaxo-network

networks:
  redaxo-network:
    driver: bridge
`;
    }

    static generateEnvFile(options: CreateInstanceOptions, dbPassword: string, dbRootPassword: string, httpPort: number, httpsPort: number, mysqlPort: number, sslEnabled: boolean): string {
        return `# REDAXO Instance: ${options.name}
INSTANCE_NAME=${options.name}
PHP_VERSION=${options.phpVersion}
MARIADB_VERSION=${options.mariadbVersion}
RELEASE_TYPE=standard
HTTP_PORT=${httpPort}
MYSQL_PORT=${mysqlPort}
${sslEnabled ? `HTTPS_PORT=${httpsPort}
SSL_ENABLED=true` : `SSL_ENABLED=false`}

# Database Configuration
DB_HOST=mysql
DB_NAME=redaxo
DB_USER=redaxo
DB_PASSWORD=${dbPassword}
DB_ROOT_PASSWORD=${dbRootPassword}

# URLs
BASE_URL=${sslEnabled ? `https://${options.name}.local:${httpsPort}` : `http://localhost:${httpPort}`}
BACKEND_URL=${sslEnabled ? `https://${options.name}.local:${httpsPort}/redaxo` : `http://localhost:${httpPort}/redaxo`}
`;
    }
}
