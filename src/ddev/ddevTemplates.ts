export class DDEVTemplates {
    
    /**
     * Generate DDEV config.yaml template for REDAXO instances
     */
    static generateDDEVConfig(
        name: string, 
        phpVersion: string, 
        mariadbVersion: string, 
        docroot: string = '.',
        additionalHostnames: string[] = []
    ): string {
        return `name: ${name}
type: php
docroot: ${docroot}
php_version: "${phpVersion}"
webserver_type: apache-fpm
router_http_port: "80"
router_https_port: "443"
xdebug_enabled: false
additional_hostnames: ${JSON.stringify(additionalHostnames)}
additional_fqdns: []
database:
  type: mariadb
  version: "${mariadbVersion}"
use_dns_when_possible: true
composer_version: "2"
web_environment:
- DRUSH_OPTIONS_URI=https://${name}.ddev.site
- SIMPLETEST_BASE_URL=https://${name}.ddev.site
hooks:
  post-start:
    - exec: composer install --no-dev --optimize-autoloader || true
  post-import-db:
    - exec: echo "Database imported successfully"
nodejs_version: "18"
`;
    }

    /**
     * Generate Apache configuration for REDAXO
     */
    static generateApacheConfig(): string {
        return `<Directory "/var/www/html">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
    DirectoryIndex index.php index.html

    # REDAXO specific settings
    <IfModule mod_rewrite.c>
        RewriteEngine On
        
        # Security: Deny access to internal files
        RewriteRule ^redaxo/(?:cache|data|src)/ - [F,L]
        RewriteRule ^assets/addons/[^/]+/(?:boot\.php|lib|vendor)/ - [F,L]
        
        # REDAXO frontend controller
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^(.*)$ index.php [QSA,L]
    </IfModule>
</Directory>

# Enable compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/plain
    AddOutputFilterByType DEFLATE text/html
    AddOutputFilterByType DEFLATE text/xml
    AddOutputFilterByType DEFLATE text/css
    AddOutputFilterByType DEFLATE application/xml
    AddOutputFilterByType DEFLATE application/xhtml+xml
    AddOutputFilterByType DEFLATE application/rss+xml
    AddOutputFilterByType DEFLATE application/javascript
    AddOutputFilterByType DEFLATE application/x-javascript
</IfModule>

# Set proper MIME types
<IfModule mod_mime.c>
    AddType application/javascript .js
    AddType text/css .css
</IfModule>
`;
    }

    /**
     * Generate PHP configuration optimized for REDAXO
     */
    static generatePHPConfig(): string {
        return `; REDAXO optimized PHP configuration for DDEV
memory_limit = 2048M
max_execution_time = 300
max_input_time = 300
post_max_size = 512M
upload_max_filesize = 512M
max_file_uploads = 20

; Session settings
session.gc_maxlifetime = 3600
session.cookie_lifetime = 0

; Error reporting (adjust for production)
display_errors = On
display_startup_errors = On
log_errors = On
error_log = /var/log/php_errors.log

; OPcache settings
opcache.enable = 1
opcache.memory_consumption = 128
opcache.interned_strings_buffer = 8
opcache.max_accelerated_files = 4000
opcache.revalidate_freq = 60
opcache.fast_shutdown = 1

; Other optimizations
realpath_cache_size = 4096K
realpath_cache_ttl = 600

; Timezone (adjust as needed)
date.timezone = "Europe/Berlin"

; Enable mbstring
extension = mbstring

; Enable intl
extension = intl

; Enable gd
extension = gd

; Enable pdo_mysql
extension = pdo_mysql
`;
    }

    /**
     * Generate docker-compose.yaml override for additional services
     */
    static generateDockerComposeOverride(): string {
        return `version: '3.6'
services:
  web:
    environment:
      # REDAXO specific environment variables
      - PHP_IDE_CONFIG=serverName=\${DDEV_SITENAME}
      - XDEBUG_CONFIG=idekey=VSCODE
    volumes:
      # Mount additional config if needed
      - "./.ddev/apache/redaxo.conf:/etc/apache2/sites-enabled/redaxo.conf"
      - "./.ddev/php/redaxo.ini:/usr/local/etc/php/conf.d/99-redaxo.ini"
  
  # Optional: Add Mailhog for email testing
  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - "8025"
    labels:
      - com.ddev.site-name=\${DDEV_SITENAME}
      - com.ddev.approot=\${DDEV_APPROOT}
    environment:
      - MH_UI_BIND_ADDR=0.0.0.0:8025
      - MH_API_BIND_ADDR=0.0.0.0:8025
`;
    }

    /**
     * Generate REDAXO database configuration template
     */
    static generateDatabaseConfig(
        host: string = 'db', 
        database: string = 'db', 
        username: string = 'db', 
        password: string = 'db'
    ): string {
        return `<?php
// REDAXO Database Configuration for DDEV
return [
    'host' => '${host}',
    'login' => '${username}',
    'password' => '${password}',
    'name' => '${database}',
    'persistent' => false,
    'ssl_key' => '',
    'ssl_cert' => '',
    'ssl_ca' => '',
    'ssl_ca_path' => '',
    'ssl_cipher' => '',
    'ssl_verify_server_cert' => false,
];
`;
    }

    /**
     * Generate setup script for DDEV post-start hooks
     */
    static generateSetupScript(instanceName: string, redaxoStructure: 'classic' | 'modern' = 'classic'): string {
        const docroot = redaxoStructure === 'modern' ? 'public' : '.';
        
        return `#!/bin/bash
# DDEV REDAXO Setup Script for ${instanceName}

echo "🚀 Setting up REDAXO instance: ${instanceName}"

# Set correct permissions
chmod -R 755 /var/www/html
chown -R www-data:www-data /var/www/html

# Ensure REDAXO directories exist and are writable
mkdir -p /var/www/html/${docroot}/media
mkdir -p /var/www/html/redaxo/cache
mkdir -p /var/www/html/redaxo/data/log
mkdir -p /var/www/html/redaxo/data/addons

chmod -R 775 /var/www/html/${docroot}/media
chmod -R 775 /var/www/html/redaxo/cache
chmod -R 775 /var/www/html/redaxo/data

# Set up Apache modules
a2enmod rewrite
a2enmod headers
a2enmod expires
a2enmod deflate

# Restart Apache to apply changes
service apache2 reload

echo "✅ REDAXO setup completed for ${instanceName}"
echo "🌐 Frontend: https://${instanceName}.ddev.site"
echo "⚙️  Backend: https://${instanceName}.ddev.site/redaxo"
echo "📧 Mailhog: https://${instanceName}.ddev.site:8025"
`;
    }

    /**
     * Generate .htaccess file for REDAXO (classic structure)
     */
    static generateHtaccess(): string {
        return `# REDAXO .htaccess
Options -Indexes

# Security headers
<IfModule mod_headers.c>
    Header always set X-Content-Type-Options nosniff
    Header always set X-Frame-Options DENY
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

# URL Rewriting
<IfModule mod_rewrite.c>
    RewriteEngine On
    
    # Security: Deny access to internal files
    RewriteRule ^redaxo/(cache|data|src)/ - [F,L]
    RewriteRule ^assets/addons/[^/]+/(boot\\.php|lib|vendor)/ - [F,L]
    
    # REDAXO frontend controller
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^(.*)$ index.php [QSA,L]
</IfModule>

# Cache control for static assets
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/css "access plus 1 month"
    ExpiresByType application/javascript "access plus 1 month"
    ExpiresByType image/png "access plus 1 month"
    ExpiresByType image/jpg "access plus 1 month"
    ExpiresByType image/jpeg "access plus 1 month"
    ExpiresByType image/gif "access plus 1 month"
    ExpiresByType image/svg+xml "access plus 1 month"
    ExpiresByType font/woff "access plus 1 month"
    ExpiresByType font/woff2 "access plus 1 month"
</IfModule>

# Compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/plain
    AddOutputFilterByType DEFLATE text/html
    AddOutputFilterByType DEFLATE text/xml
    AddOutputFilterByType DEFLATE text/css
    AddOutputFilterByType DEFLATE application/xml
    AddOutputFilterByType DEFLATE application/xhtml+xml
    AddOutputFilterByType DEFLATE application/rss+xml
    AddOutputFilterByType DEFLATE application/javascript
    AddOutputFilterByType DEFLATE application/x-javascript
</IfModule>
`;
    }

    /**
     * Generate README for DDEV REDAXO instance
     */
    static generateInstanceReadme(instanceName: string, phpVersion: string, dbVersion: string): string {
        return `# REDAXO DDEV Instance: ${instanceName}

This is a DDEV-managed REDAXO instance with the following configuration:

## Configuration
- **PHP Version**: ${phpVersion}
- **Database**: MariaDB ${dbVersion}
- **Local Domain**: https://${instanceName}.ddev.site

## URLs
- **Frontend**: https://${instanceName}.ddev.site
- **Backend**: https://${instanceName}.ddev.site/redaxo
- **Mailhog**: https://${instanceName}.ddev.site:8025 (for email testing)
- **Database**: Access via phpMyAdmin at https://${instanceName}.ddev.site:8036

## Commands

### Start the instance
\`\`\`bash
ddev start
\`\`\`

### Stop the instance
\`\`\`bash
ddev stop
\`\`\`

### Access the web container
\`\`\`bash
ddev ssh
\`\`\`

### Import database dump
\`\`\`bash
ddev import-db --src=path/to/dump.sql
\`\`\`

### Export database
\`\`\`bash
ddev export-db --file=backup.sql.gz
\`\`\`

## Development

### Composer
\`\`\`bash
ddev composer install
ddev composer update
\`\`\`

### Logs
\`\`\`bash
ddev logs
\`\`\`

## Troubleshooting

If you encounter issues:

1. Check DDEV status: \`ddev status\`
2. Restart DDEV: \`ddev restart\`
3. Check logs: \`ddev logs\`
4. Rebuild if needed: \`ddev restart --rebuild\`

For more information, see the [DDEV documentation](https://ddev.readthedocs.io/).
`;
    }
}