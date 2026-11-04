// Verbatim templates of the 1.21.0 EmptyInstanceService (custom instances) – compatibility test fixtures.
export interface EmptyInstanceConfig {
    instanceName: string;
    phpVersion: string;
    mariadbVersion: string;
    enableXdebug: boolean;
    httpPort?: number;
    httpsPort?: number;
}

function getContainerName(instanceName: string, suffix: string): string {
    return `${instanceName.replace(/_/g, '')}${suffix}`;
}

export function legacyCustomCompose(config: EmptyInstanceConfig, dbPort: number): string {
    const self = { getContainerName, getDbHostName: (n: string) => getContainerName(n, 'db') };
    const xdebugConfig = config.enableXdebug ? `
      XDEBUG_MODE: debug,develop
      XDEBUG_CONFIG: client_host=host.docker.internal client_port=9003` : '';
    return `services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        PHP_VERSION: ${config.phpVersion}
        ENABLE_XDEBUG: ${config.enableXdebug ? 'true' : 'false'}
    container_name: ${self.getContainerName(config.instanceName, 'web')}
    ports:
      - "${config.httpPort}:80"
      - "${config.httpsPort}:443"
    volumes:
      - ./project:/var/www/html
      - ./logs:/var/log/apache2
    environment:
      APACHE_DOCUMENT_ROOT: /var/www/html/public${xdebugConfig}
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: mariadb:${config.mariadbVersion}
    container_name: ${self.getDbHostName(config.instanceName)}
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: ${config.instanceName}
      MYSQL_USER: ${config.instanceName}
      MYSQL_PASSWORD: ${config.instanceName}
      MYSQL_CHARACTER_SET_SERVER: utf8mb4
      MYSQL_COLLATION_SERVER: utf8mb4_unicode_ci
    ports:
      - "${dbPort}:3306"
    volumes:
      - ${self.getDbHostName(config.instanceName)}_data:/var/lib/mysql
      - ./database:/docker-entrypoint-initdb.d
    command: >
      --max_connections=500
      --innodb_buffer_pool_size=1G
      --innodb_log_file_size=256M
      --query_cache_size=128M
      --query_cache_type=1
      --slow_query_log=1
      --slow_query_log_file=/var/log/mysql/slow.log
      --long_query_time=2
    restart: unless-stopped

volumes:
  ${self.getDbHostName(config.instanceName)}_data:
    driver: local`;
}

export function legacyCustomEnv(config: EmptyInstanceConfig): string {
    const self = { getDbHostName: (n: string) => getContainerName(n, 'db') };
    return `# Custom Instance Environment
PHP_VERSION=${config.phpVersion}
MARIADB_VERSION=${config.mariadbVersion}
HTTP_PORT=${config.httpPort}
HTTPS_PORT=${config.httpsPort}
DB_HOST=${self.getDbHostName(config.instanceName)}
DB_NAME=${config.instanceName}
DB_USER=${config.instanceName}
DB_PASSWORD=${config.instanceName}
DB_ROOT_PASSWORD=root
BASE_URL=http://localhost:${config.httpPort}
BACKEND_URL=http://localhost:${config.httpPort}
SSL_ENABLED=true
INSTANCE_NAME=${config.instanceName}
XDEBUG_ENABLED=${config.enableXdebug}`;
}
