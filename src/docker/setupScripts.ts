import { CreateInstanceOptions } from '../types/redaxo';

export class SetupScriptGenerator {
    
    static generate(options: CreateInstanceOptions): string {
        return `#!/bin/bash
# REDAXO Instance Setup Script for ${options.name}

echo "🚀 Setting up REDAXO instance: ${options.name}"

# ALWAYS Setup SSL configuration if available - this needs to run even if REDAXO exists
if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
    echo "🔒 Setting up SSL configuration..."
    # Copy SSL config to Apache sites-available
    cp /usr/local/bin/apache-ssl.conf /etc/apache2/sites-available/default-ssl.conf
    # Enable SSL site and modules
    a2enmod ssl
    a2enmod rewrite
    a2ensite default-ssl
    # Restart Apache to ensure SSL is loaded properly
    service apache2 restart
    echo "✅ SSL configuration applied and Apache restarted"
fi

# Wait for MySQL to be ready
echo "⏳ Waiting for MySQL..."
while ! php -r "
try {
    \\$pdo = new PDO('mysql:host=mysql', 'root', getenv('MYSQL_ROOT_PASSWORD'));
    echo 'Connected';
    exit(0);
} catch(Exception \\$e) {
    exit(1);
}
" > /dev/null 2>&1; do
    sleep 2
done
echo "✅ MySQL is ready"

# Download and extract REDAXO if not exists
if [ "\${RELEASE_TYPE:-standard}" = "modern" ]; then
    echo "🔄 Setting up REDAXO Modern Structure..."
    
    # Install required packages for Modern Structure
    apt-get update && apt-get install -y curl unzip
    
    # Enable Apache modules
    a2enmod rewrite ssl headers
    
    echo "📥 Downloading REDAXO Modern Structure..."
    cd /tmp
    
    # Download REDAXO Modern Structure from latest release
    echo "📦 Downloading REDAXO Modern Structure (latest release)..."
    
    # Get the correct download URL from GitHub API (using pattern from original redaxo-downloader.sh)
    DOWNLOAD_URL=\\$(curl -s "https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest" | grep -o '"browser_download_url":"[^"]*redaxo-setup[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -z "\\$DOWNLOAD_URL" ]; then
        echo "❌ Could not find Modern Structure download URL, trying fallback..."
        # Fallback: try any zip file
        DOWNLOAD_URL=\\$(curl -s "https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest" | grep "browser_download_url" | grep ".zip" | head -1 | cut -d '"' -f 4)
    fi
    
    if [ -z "\\$DOWNLOAD_URL" ]; then
        echo "❌ Could not find any download URL"
        exit 1
    fi
    
    echo "📥 Download URL: \\$DOWNLOAD_URL"
    
    # Download to temporary location first (like original script)
    mkdir -p /tmp/redaxo-download
    cd /tmp/redaxo-download
    curl -L "\\$DOWNLOAD_URL" -o redaxo-modern.zip
    
    # Check if download was successful
    if [ ! -f "redaxo-modern.zip" ] || [ \\$(stat -c%s "redaxo-modern.zip" 2>/dev/null || echo 0) -lt 1024 ]; then
        echo "❌ Download failed or file too small"
        exit 1
    fi
    
    echo "📦 Extracting REDAXO Modern Structure..."
    unzip -q redaxo-modern.zip
    
    # Find extracted content (handle subdirectories like original script)
    EXTRACTED_CONTENT=""
    if [ -d "REDAXO_MODERN_STRUCTURE-"* ]; then
        EXTRACTED_CONTENT=\\$(find . -mindepth 1 -maxdepth 1 -type d -name "REDAXO_MODERN_STRUCTURE-*" | head -1)
    elif [ -d "redaxo-setup-"* ]; then
        EXTRACTED_CONTENT=\\$(find . -mindepth 1 -maxdepth 1 -type d -name "redaxo-setup-*" | head -1)
    else
        echo "Looking for any directory..."
        EXTRACTED_CONTENT=\\$(find . -mindepth 1 -maxdepth 1 -type d | head -1)
    fi
    
    echo "📁 Found extracted content: \\$EXTRACTED_CONTENT"
    
    # Copy content to correct Modern Structure layout
    if [ -n "\\$EXTRACTED_CONTENT" ] && [ -d "\\$EXTRACTED_CONTENT" ]; then
        echo "📋 Setting up Modern Structure layout from: \\$EXTRACTED_CONTENT"
        # Kopiere ALLES nach /var/www
        cp -r "\\$EXTRACTED_CONTENT"/* /var/www/
        echo "✅ Modern Structure files copied to /var/www"
    else
        echo "📋 Copying all files directly to /var/www"
        rm -f redaxo-modern.zip
        cp -r * /var/www/ 2>/dev/null || true
    fi
    
    # Clean up temporary files
    rm -rf /tmp/redaxo-download
    
    # Set permissions
    chown -R www-data:www-data /var/www/html
    chmod -R 755 /var/www/html
    
    echo "✅ REDAXO Modern Structure installed successfully"
else
    echo "✅ Using standard REDAXO from Docker image"
fi

${options.autoInstall ? this.generateAutoInstallScript(options) : '# Auto-install disabled'}

echo "✅ REDAXO instance setup complete!"
`;
    }
    
    private static generateAutoInstallScript(options: CreateInstanceOptions): string {
        return `
# Auto-install REDAXO if enabled
if [ "\${RELEASE_TYPE:-standard}" = "modern" ]; then
    # Modern Structure auto-installation
    if [ ! -f "/var/www/var/data/config.yml" ]; then
        echo "⚙️ Auto-installing REDAXO Modern Structure..."
        
        # Create REDAXO configuration for Modern Structure
        php /var/www/bin/console setup:run \\
            --db-host=mysql \\
            --db-name=redaxo \\
            --db-user=redaxo \\
            --db-password=\${MYSQL_PASSWORD} \\
            --admin-username=admin \\
            --admin-password=admin \\
            --server-name="\${INSTANCE_NAME}.local" \\
            --error-email="admin@\${INSTANCE_NAME}.local" \\
            --timezone="Europe/Berlin" \\
            --lang=de_de
            
        echo "✅ REDAXO Modern Structure auto-installation complete"
    else
        echo "✅ REDAXO Modern Structure already configured"
    fi
else
    # Standard Structure auto-installation
    if [ ! -f "/var/www/html/redaxo/data/config.yml" ]; then
        echo "⚙️ Auto-installing REDAXO Standard Structure..."
        
        # Create REDAXO configuration for Standard Structure
        php /var/www/html/redaxo/bin/console setup:run \\
            --db-host=mysql \\
            --db-name=redaxo \\
            --db-user=redaxo \\
            --db-password=\${MYSQL_PASSWORD} \\
            --admin-username=admin \\
            --admin-password=admin \\
            --server-name="\${INSTANCE_NAME}.local" \\
            --error-email="admin@\${INSTANCE_NAME}.local" \\
            --timezone="Europe/Berlin" \\
            --lang=de_de
            
        echo "✅ REDAXO Standard Structure auto-installation complete"
    else
        echo "✅ REDAXO Standard Structure already configured"
    fi
fi
`;
    }
}
