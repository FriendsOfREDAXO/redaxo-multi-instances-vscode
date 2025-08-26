import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PortManager } from '../docker/portManager';

export interface EmptyInstanceConfig {
    instanceName: string;
    projectPath: string;
    phpVersion: string;
    mariadbVersion: string;
    enableXdebug: boolean;
    httpPort?: number;
    httpsPort?: number;
    createWelcome?: boolean;
}

export class EmptyInstanceService {
    private readonly outputChannel: vscode.OutputChannel;

    constructor() {
    this.outputChannel = vscode.window.createOutputChannel('REDAXO Custom Instances');
    }

    async createEmptyInstance(config: EmptyInstanceConfig): Promise<void> {
        this.outputChannel.show();
    this.outputChannel.appendLine('🚀 Starte Custom Instance Setup...');

        try {
            // 1. Projekt-Verzeichnis erstellen
            await this.createProjectDirectory(config.projectPath);

            // 2. Ports ermitteln
            const httpPort = await PortManager.findAvailablePort(8080);
            const httpsPort = await PortManager.findAvailablePort(8443);
            config.httpPort = httpPort;
            config.httpsPort = httpsPort;

            this.outputChannel.appendLine(`📡 HTTP Port: ${httpPort}, HTTPS Port: ${httpsPort}`);

            // 3. Public-Ordner erstellen
            await this.createProjectFolder(config);

            // 4. Docker Compose mit optimalen Einstellungen erstellen
            await this.createDockerCompose(config);

            // 5. .env Datei für DockerService Kompatibilität
            await this.createEnvFile(config);

            // 6. .gitignore erstellen
            await this.createGitIgnore(config.projectPath);

            // 7. README erstellen
            await this.createReadme(config);

            this.outputChannel.appendLine('✅ Custom Instance erfolgreich erstellt!');
            this.outputChannel.appendLine(`🌐 HTTP: http://localhost:${httpPort}`);
            this.outputChannel.appendLine(`🔒 HTTPS: https://localhost:${httpsPort}`);
            
            vscode.window.showInformationMessage(
                `Custom Instance "${config.instanceName}" wurde erfolgreich erstellt!`,
                'Öffnen'
            ).then(selection => {
                if (selection === 'Öffnen') {
                    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${httpPort}`));
                }
            });

        } catch (error) {
            this.outputChannel.appendLine(`❌ Fehler: ${error}`);
            vscode.window.showErrorMessage(`Fehler beim Erstellen der Custom Instance: ${error}`);
            throw error;
        }
    }

    private async createProjectDirectory(projectPath: string): Promise<void> {
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath, { recursive: true });
        }
    }

    private async createProjectFolder(config: EmptyInstanceConfig): Promise<void> {
        // project/ Ordner erstellen
        const projectDir = path.join(config.projectPath, 'project');
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        // project/public/ Ordner erstellen (DocumentRoot)
        const publicDir = path.join(projectDir, 'public');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }

        // index.php nur anlegen, wenn explizit gewünscht
    this.outputChannel.appendLine(`[DEBUG] createWelcome=${config.createWelcome} -> prüfe Erstellung index.php in ${publicDir}`);
        if (config.createWelcome === true) {
            // Minimalistische REDAXO-styled Welcome index.php
            const welcomePhp = `<?php
/**
 * Welcome to your Custom Instance!
 * Instance: ${config.instanceName}
 * Created: ${new Date().toLocaleString('de-DE')}
 */

$info = [
    'PHP Version' => PHP_VERSION,
    'HTTP Port' => '${config.httpPort}',
    'HTTPS Port' => '${config.httpsPort}',
    'Database' => '${config.instanceName}_db',
    'Xdebug' => extension_loaded('xdebug') ? 'Active' : 'Inactive',
];
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${config.instanceName} - Custom Instance</title>
    <style>
        :root {
            --rex-color-primary: #4b9ad9;
            --rex-color-primary-dark: #3a7fb8;
            --rex-color-bg: #ffffff;
            --rex-color-surface: #f8f9fa;
            --rex-color-border: #dee2e6;
            --rex-color-text: #212529;
            --rex-color-text-muted: #6c757d;
            --rex-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --rex-color-primary: #5ba3e0;
                --rex-color-primary-dark: #4b9ad9;
                --rex-color-bg: #1a1a1a;
                --rex-color-surface: #2d2d2d;
                --rex-color-border: #404040;
                --rex-color-text: #ffffff;
                --rex-color-text-muted: #b0b0b0;
                --rex-shadow: 0 2px 8px rgba(0,0,0,0.3);
            }
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--rex-color-bg);
            color: var(--rex-color-text);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        }

        .container {
            max-width: 600px;
            width: 100%;
            background: var(--rex-color-surface);
            border: 1px solid var(--rex-color-border);
            border-radius: 8px;
            box-shadow: var(--rex-shadow);
            overflow: hidden;
        }

        .header {
            background: var(--rex-color-primary);
            color: white;
            padding: 2rem;
            text-align: center;
        }

        .header h1 {
            font-size: 1.8rem;
            font-weight: 300;
            margin-bottom: 0.5rem;
        }

        .header p {
            opacity: 0.9;
            font-size: 0.95rem;
        }

        .content {
            padding: 2rem;
        }

        .info-grid {
            display: grid;
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .info-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem;
            background: var(--rex-color-bg);
            border: 1px solid var(--rex-color-border);
            border-radius: 4px;
        }

        .info-label {
            font-weight: 500;
            color: var(--rex-color-text);
        }

        .info-value {
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 0.9rem;
            color: var(--rex-color-primary);
            font-weight: 500;
        }

        .instructions {
            background: var(--rex-color-bg);
            border: 1px solid var(--rex-color-border);
            border-radius: 4px;
            padding: 1.5rem;
        }

        .instructions h3 {
            color: var(--rex-color-primary);
            margin-bottom: 1rem;
            font-size: 1.1rem;
            font-weight: 500;
        }

        .instructions ol {
            padding-left: 1.2rem;
            color: var(--rex-color-text);
        }

        .instructions li {
            margin-bottom: 0.5rem;
            font-size: 0.95rem;
        }

        .footer {
            text-align: center;
            padding: 1rem;
            color: var(--rex-color-text-muted);
            font-size: 0.85rem;
            border-top: 1px solid var(--rex-color-border);
        }

        @media (max-width: 640px) {
            .header h1 {
                font-size: 1.5rem;
            }
            .content {
                padding: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 ${config.instanceName}</h1>
            <p>Custom Instance bereit für dein Projekt</p>
        </div>

        <div class="content">
            <div class="info-grid">
                <?php foreach ($info as $label => $value): ?>
                <div class="info-item">
                    <span class="info-label"><?php echo $label; ?>:</span>
                    <span class="info-value"><?php echo $value; ?></span>
                </div>
                <?php endforeach; ?>
            </div>

            <div class="instructions">
                <h3>📦 REDAXO Installation</h3>
                <ol>
                    <li>REDAXO 5.19+ herunterladen</li>
                    <li>Alle Dateien in diesen Ordner entpacken</li>
                    <li>Setup über Browser starten</li>
                    <li>Diese Datei wird automatisch überschrieben</li>
                </ol>
            </div>
        </div>

        <div class="footer">
            REDAXO Multi-Instance Manager
        </div>
    </div>
</body>
</html>`;

            fs.writeFileSync(path.join(publicDir, 'index.php'), welcomePhp);
            this.outputChannel.appendLine(`[DEBUG] index.php erstellt: ${path.join(publicDir, 'index.php')}`);
        } else {
            this.outputChannel.appendLine('[DEBUG] createWelcome ist false/undefined – keine index.php erstellt.');
        }
    }

    private async createDockerCompose(config: EmptyInstanceConfig): Promise<void> {
        const xdebugConfig = config.enableXdebug ? `
      XDEBUG_MODE: debug,develop
      XDEBUG_CONFIG: client_host=host.docker.internal client_port=9003` : '';

        const dbPort = await PortManager.findAvailablePort(3306);

        const dockerCompose = `services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        PHP_VERSION: ${config.phpVersion}
        ENABLE_XDEBUG: ${config.enableXdebug ? 'true' : 'false'}
    container_name: ${config.instanceName}_web
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
    container_name: ${config.instanceName}_db
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
      - ${config.instanceName}_db_data:/var/lib/mysql
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
  ${config.instanceName}_db_data:
    driver: local`;

        fs.writeFileSync(path.join(config.projectPath, 'docker-compose.yml'), dockerCompose);

        // Dockerfile für optimierte PHP-Installation
        const dockerfile = `ARG PHP_VERSION
FROM php:\${PHP_VERSION}-apache

# Arguments
ARG ENABLE_XDEBUG=false

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    wget \\
    curl \\
    unzip \\
    git \\
    libfreetype6-dev \\
    libjpeg62-turbo-dev \\
    libpng-dev \\
    libicu-dev \\
    libxml2-dev \\
    libzip-dev \\
    libmagickwand-dev \\
    ffmpeg \\
    imagemagick \\
    ghostscript \\
    && rm -rf /var/lib/apt/lists/*

# Configure and install PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \\
    && docker-php-ext-configure intl \\
    && docker-php-ext-install -j$(nproc) \\
        gd \\
        intl \\
        pdo_mysql \\
        mysqli \\
        zip \\
        xml \\
        soap \\
        bcmath \\
        calendar \\
        exif \\
        gettext \\
        sockets

# Install ImageMagick extension
RUN pecl install imagick && docker-php-ext-enable imagick

# Install Xdebug if enabled
RUN if [ "$ENABLE_XDEBUG" = "true" ]; then \\
        pecl install xdebug && docker-php-ext-enable xdebug; \\
    fi

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configure PHP
RUN { \\
    echo 'memory_limit = 2048M'; \\
    echo 'upload_max_filesize = 512M'; \\
    echo 'post_max_size = 512M'; \\
    echo 'max_execution_time = 300'; \\
    echo 'max_input_time = 300'; \\
    echo 'max_input_vars = 5000'; \\
    echo 'max_file_uploads = 20'; \\
    echo 'default_charset = "UTF-8"'; \\
    echo 'date.timezone = Europe/Berlin'; \\
    echo 'session.gc_maxlifetime = 3600'; \\
    echo 'session.cookie_lifetime = 0'; \\
    echo 'display_errors = On'; \\
    echo 'display_startup_errors = On'; \\
    echo 'log_errors = On'; \\
    echo 'error_log = /var/log/php_errors.log'; \\
    echo 'opcache.enable = 1'; \\
    echo 'opcache.memory_consumption = 128'; \\
    echo 'opcache.interned_strings_buffer = 8'; \\
    echo 'opcache.max_accelerated_files = 4000'; \\
    echo 'opcache.revalidate_freq = 60'; \\
    echo 'opcache.fast_shutdown = 1'; \\
    echo 'realpath_cache_size = 4096K'; \\
    echo 'realpath_cache_ttl = 600'; \\
} > /usr/local/etc/php/conf.d/99-custom.ini

# Configure Xdebug
RUN if [ "$ENABLE_XDEBUG" = "true" ]; then { \\
    echo 'xdebug.mode=debug,develop'; \\
    echo 'xdebug.client_host=host.docker.internal'; \\
    echo 'xdebug.client_port=9003'; \\
    echo 'xdebug.start_with_request=trigger'; \\
    } > /usr/local/etc/php/conf.d/xdebug.ini; fi

# Enable Apache modules
RUN a2enmod rewrite headers ssl expires deflate

# Configure SSL
RUN mkdir -p /etc/apache2/ssl
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
    -keyout /etc/apache2/ssl/apache-selfsigned.key \\
    -out /etc/apache2/ssl/apache-selfsigned.crt \\
    -subj "/C=DE/ST=State/L=City/O=Organization/CN=${config.instanceName}.local"

# SSL Virtual Host
RUN echo '<VirtualHost *:443>\\n\\
    DocumentRoot /var/www/html/public\\n\\
    SSLEngine on\\n\\
    SSLCertificateFile /etc/apache2/ssl/apache-selfsigned.crt\\n\\
    SSLCertificateKeyFile /etc/apache2/ssl/apache-selfsigned.key\\n\\
    <Directory /var/www/html/public>\\n\\
        Options Indexes FollowSymLinks\\n\\
        AllowOverride All\\n\\
        Require all granted\\n\\
    </Directory>\\n\\
</VirtualHost>' > /etc/apache2/sites-available/default-ssl.conf

RUN a2ensite default-ssl

# Configure default HTTP Virtual Host
RUN echo '<VirtualHost *:80>\\n\\
    DocumentRoot /var/www/html/public\\n\\
    <Directory /var/www/html/public>\\n\\
        Options Indexes FollowSymLinks\\n\\
        AllowOverride All\\n\\
        Require all granted\\n\\
    </Directory>\\n\\
</VirtualHost>' > /etc/apache2/sites-available/000-default.conf

# Set working directory
WORKDIR /var/www/html/public

# Create logs directory
RUN mkdir -p /var/log/apache2 && chown -R www-data:www-data /var/log/apache2

EXPOSE 80 443`;

        fs.writeFileSync(path.join(config.projectPath, 'Dockerfile'), dockerfile);

        // Logs und Database Ordner erstellen
        const logsDir = path.join(config.projectPath, 'logs');
        const dbDir = path.join(config.projectPath, 'database');
        
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // .gitkeep Dateien
        fs.writeFileSync(path.join(logsDir, '.gitkeep'), '');
        fs.writeFileSync(path.join(dbDir, '.gitkeep'), '');
    }

    private async createEnvFile(config: EmptyInstanceConfig): Promise<void> {
    const envFile = `# Custom Instance Environment
PHP_VERSION=${config.phpVersion}
MARIADB_VERSION=${config.mariadbVersion}
HTTP_PORT=${config.httpPort}
HTTPS_PORT=${config.httpsPort}
DB_HOST=${config.instanceName}_db
DB_NAME=${config.instanceName}
DB_USER=${config.instanceName}
DB_PASSWORD=${config.instanceName}
DB_ROOT_PASSWORD=root
BASE_URL=http://localhost:${config.httpPort}
BACKEND_URL=http://localhost:${config.httpPort}
SSL_ENABLED=true
INSTANCE_NAME=${config.instanceName}
XDEBUG_ENABLED=${config.enableXdebug}`;

        fs.writeFileSync(path.join(config.projectPath, '.env'), envFile);
    }

    private async createGitIgnore(projectPath: string): Promise<void> {
    const gitignore = `# Custom Instance
/logs/*
!/logs/.gitkeep
/database/data/*
!/database/.gitkeep

# REDAXO Project Structure
/project/var/cache/*
!/project/var/cache/.gitkeep
/project/var/data/*
!/project/var/data/.gitkeep
/project/public/var/cache/*
!/project/public/var/cache/.gitkeep
/project/public/var/data/*
!/project/public/var/data/.gitkeep

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Composer
/project/vendor/
/project/composer.lock
/project/public/vendor/
/project/public/composer.lock

# Node
node_modules/
npm-debug.log
yarn-error.log

# Environment
.env.local
.env.production`;

        fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore);
    }

    private async createReadme(config: EmptyInstanceConfig): Promise<void> {
    const readme = `# ${config.instanceName} - Custom Instance

Diese Custom Instance ist bereit für dein PHP-Projekt!

## 🚀 REDAXO Installation

**So installierst du REDAXO in diese Custom Instance:**

1. **REDAXO herunterladen**: Lade REDAXO 5.19+ herunter
2. **Entpacken**: Entpacke ALLE REDAXO-Dateien direkt in den \`project/public/\` Ordner
3. **Struktur**: Nach dem Entpacken solltest du haben:
   \`\`\`
   ${config.instanceName}/
   ├── docker-compose.yml  ← Docker Setup
   ├── Dockerfile          ← Docker Setup
   ├── README.md           ← Diese Anleitung
   └── project/            ← Projekt Root
       ├── src/            ← Source Code (optional)
       ├── var/            ← Data/Cache (optional)
       └── public/         ← DocumentRoot (Webroot)
           ├── redaxo/     ← REDAXO Backend
           ├── assets/     ← REDAXO Assets
           ├── media/      ← REDAXO Media
           ├── index.php   ← REDAXO Frontend
           └── .htaccess   ← Smart Routing
   \`\`\`
4. **Setup**: Öffne http://localhost:${config.httpPort} - REDAXO Setup startet automatisch

## 🎯 Andere PHP-Projekte

**Für Symfony, Laravel, WordPress etc.:**

1. **Installiere dein Projekt** in den \`project/\` Ordner
2. **DocumentRoot**: Der \`project/public/\` Ordner ist der Webroot
3. **Struktur**:
   \`\`\`
   ${config.instanceName}/
   └── project/            ← Projekt Root
       ├── src/            ← Source Code
       ├── vendor/         ← Dependencies
       ├── var/            ← Cache/Logs (Symfony)
       ├── config/         ← Configuration
       └── public/         ← DocumentRoot (Webroot)
           ├── index.php   ← Entry Point
           ├── assets/     ← CSS/JS/Images
           └── .htaccess   ← URL Rewriting
   \`\`\`

## 🗄️ Datenbank-Verbindung

- **Host**: \`${config.instanceName}_db\`
- **Datenbank**: \`${config.instanceName}\`
- **Benutzer**: \`${config.instanceName}\`
- **Passwort**: \`${config.instanceName}\`

## 🐳 Docker Commands

\`\`\`bash
# Container starten
docker-compose up -d

# Container stoppen  
docker-compose down

# Container neu bauen
docker-compose up -d --build

# Logs anzeigen
docker-compose logs -f web
\`\`\`

## 🌐 URLs

- **Frontend**: http://localhost:${config.httpPort}
- **HTTPS**: https://localhost:${config.httpsPort}  
- **REDAXO Backend**: http://localhost:${config.httpPort}/redaxo (nach Installation)

## 📁 Ordnerstruktur

- **Docker-Setup**: Alle Docker-Dateien im Root
- **DocumentRoot**: Der \`project/public/\` Ordner ist der Webroot
- **REDAXO**: Direkter Zugriff auf \`project/public/index.php\` und \`project/public/redaxo/\`
- **Other Frameworks**: Nutze \`project/public/\` als Webroot, \`project/\` für Source Code

## 🔧 PHP Extensions

Diese Extensions sind bereits installiert:
- **GD** - Bildbearbeitung
- **Intl** - Internationalisierung  
- **ImageMagick** - Erweiterte Bildbearbeitung
- **FFmpeg** - Video/Audio-Verarbeitung
- **ZIP** - Archive
- **MySQLi/PDO** - Datenbankverbindung${config.enableXdebug ? '\n- **Xdebug** - Debugging' : ''}

Viel Erfolg mit deinem Projekt! 🎯
`;

        fs.writeFileSync(path.join(config.projectPath, 'README.md'), readme);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}
