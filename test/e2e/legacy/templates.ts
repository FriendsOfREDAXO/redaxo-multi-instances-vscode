// @ts-nocheck – verbatim copy of the 1.21.0 sources (compatibility fixture), do not modify
export class SetupTemplates {
    
    /**
     * Generate custom setup script for REDAXO instances with improved PHP settings and SSL fixes
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

# SSL setup if enabled
${sslEnabled ? `
echo "🔒 Setting up SSL configuration..."
a2enmod ssl
a2enmod socache_shmcb

# Ensure proper SSL module loading
echo "LoadModule ssl_module modules/mod_ssl.so" >> /etc/apache2/apache2.conf

# SSL configuration
if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
    cp /usr/local/bin/apache-ssl.conf /etc/apache2/sites-available/default-ssl.conf
    a2ensite default-ssl
    
    # Disable default HTTP site to prevent SSL_ERROR_RX_RECORD_TOO_LONG
    a2dissite 000-default
    
    echo "✅ SSL configuration enabled"
else
    echo "⚠️ SSL configuration file not found"
fi

# Restart Apache to apply SSL changes
service apache2 reload || true
` : `
# Standard HTTP setup - make sure SSL is disabled
a2dissite default-ssl || true
a2dismod ssl || true
service apache2 reload || true
`}

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
${sslEnabled ? `echo "🔒 SSL enabled - access via https://${instanceName}.local"` : `echo "🌐 HTTP only - access via http://localhost"`}
`;
    }

    /**
     * Generate auto-install script that relies on REDAXO Docker image auto-setup
     */
    static generateAutoInstallScript(instanceName: string, phpVersion: string, sslEnabled: boolean = false): string {
        return `
# Let REDAXO Docker image handle the installation - we just do post-setup
echo "✅ REDAXO installation handled by Docker image"

echo ""
echo "🔑 LOGIN INFORMATIONEN:"
echo "👤 Benutzername: admin"
echo "🔒 Passwort: \${MYSQL_PASSWORD}"
echo "📊 Status: ✅ Auto-installation complete"
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
`;
    }    /**
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
