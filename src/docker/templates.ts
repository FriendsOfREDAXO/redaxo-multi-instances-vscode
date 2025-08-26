export class SetupTemplates {
    
    /**
     * Generate custom setup script for REDAXO instances with improved PHP settings
     */
    static generateCustomSetupScript(instanceName: string, phpVersion: string, sslEnabled: boolean = false): string {
        return `#!/bin/bash
# REDAXO Custom Setup Script for ${instanceName}

echo "🚀 Setting up REDAXO instance: ${instanceName}"

# Configure PHP settings for better compatibility (matching custom instances)
echo "⚙️ Configuring PHP ${phpVersion} settings..."
cat > /usr/local/etc/php/conf.d/99-redaxo.ini << EOF
; REDAXO optimized PHP configuration
memory_limit = 2048M
max_execution_time = 300
max_input_time = 300
post_max_size = 512M
upload_max_filesize = 512M
max_file_uploads = 20

; Session settings
session.gc_maxlifetime = 3600
session.cookie_lifetime = 0

; Error reporting
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
EOF

echo "✅ PHP configuration updated"

# Setup Apache modules and configuration
echo "🌐 Setting up Apache configuration..."
a2enmod rewrite
a2enmod headers
a2enmod ssl

# SSL setup if enabled
${sslEnabled ? `
if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
    echo "🔒 Setting up SSL configuration..."
    cp /usr/local/bin/apache-ssl.conf /etc/apache2/sites-available/default-ssl.conf
    a2ensite default-ssl
    echo "✅ SSL configuration enabled"
fi
` : ''}

echo "✅ Apache configuration complete"

# Wait for MySQL to be ready
echo "⏳ Waiting for MySQL connection..."
while ! php -r "
try {
    \\$pdo = new PDO('mysql:host=mysql', 'root', getenv('MYSQL_ROOT_PASSWORD'));
    echo 'MySQL connection successful';
    exit(0);
} catch(Exception \\$e) {
    exit(1);
}
" > /dev/null 2>&1; do
    echo "⏳ MySQL not ready, waiting..."
    sleep 2
done
echo "✅ MySQL is ready"

echo "🎯 REDAXO instance '${instanceName}' setup complete!"
echo "📍 Instance is ready for REDAXO installation"
`;
    }

    /**
     * Generate auto-install script for REDAXO with improved configuration
     */
    static generateAutoInstallScript(instanceName: string, phpVersion: string, sslEnabled: boolean = false): string {
        return `
# Auto-install REDAXO with optimized configuration
if [ ! -f "/var/www/html/redaxo/data/config.yml" ]; then
    echo "⚙️ Auto-installing REDAXO..."
    
    # Create REDAXO configuration
    php /var/www/html/redaxo/bin/console setup:run \\
        --agree-license \\
        --db-host=mysql \\
        --db-name=redaxo \\
        --db-login=redaxo \\
        --db-password=\${MYSQL_PASSWORD} \\
        --db-setup=normal \\
        --admin-username=admin \\
        --admin-password=\${MYSQL_PASSWORD} \\
        --servername="\${INSTANCE_NAME}.local" \\
        --error-email="admin@\${INSTANCE_NAME}.local" \\
        --timezone="Europe/Berlin" \\
        --lang=de_de
    
    if [ $? -eq 0 ]; then
        echo "✅ REDAXO auto-installation complete"
        echo ""
        echo "🔑 LOGIN INFORMATIONEN:"
        echo "👤 Benutzername: admin"
        echo "🔒 Passwort: \${MYSQL_PASSWORD}"
        echo ""
        ${sslEnabled ? `
        if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
            echo "🌐 Backend URL (HTTPS): https://${instanceName}.local/redaxo"
            echo "🌐 Frontend URL (HTTPS): https://${instanceName}.local"
        else
            echo "🌐 Backend URL (HTTP): http://localhost:\${HTTP_PORT}/redaxo"  
            echo "🌐 Frontend URL (HTTP): http://localhost:\${HTTP_PORT}"
        fi
        ` : `
        echo "🌐 Backend URL: http://localhost:\${HTTP_PORT}/redaxo"  
        echo "🌐 Frontend URL: http://localhost:\${HTTP_PORT}"
        `}
        echo ""
    else
        echo "❌ REDAXO auto-installation failed"
        exit 1
    fi
else
    echo "✅ REDAXO already configured"
    echo ""
    echo "🔑 LOGIN INFORMATIONEN:"
    echo "👤 Benutzername: admin"  
    echo "🔒 Passwort: \${MYSQL_PASSWORD}"
    echo ""
    ${sslEnabled ? `
    if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
        echo "🌐 Backend URL (HTTPS): https://${instanceName}.local/redaxo"
        echo "🌐 Frontend URL (HTTPS): https://${instanceName}.local"
    else
        echo "🌐 Backend URL (HTTP): http://localhost:\${HTTP_PORT}/redaxo"
        echo "🌐 Frontend URL (HTTP): http://localhost:\${HTTP_PORT}"
    fi
    ` : `
    echo "🌐 Backend URL: http://localhost:\${HTTP_PORT}/redaxo"
    echo "🌐 Frontend URL: http://localhost:\${HTTP_PORT}"
    `}
    echo ""
fi
`;
    }

    /**
     * Generate empty instance setup script
     */
    static generateEmptyInstanceScript(instanceName: string, phpVersion: string): string {
        return `
# Empty instance setup
echo "🗑️ Creating empty instance (removing pre-installed REDAXO)"
rm -rf /var/www/html/*
echo "📁 Creating basic web directory structure"
mkdir -p /var/www/html
echo "<?php phpinfo(); ?>" > /var/www/html/index.php
echo "✅ Empty web instance ready"
echo ""
echo "🌐 Access URL: http://localhost:\${HTTP_PORT}"
echo "📋 Ready for your custom application or REDAXO installation"
`;
    }
}
