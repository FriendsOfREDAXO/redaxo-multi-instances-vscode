#!/bin/bash
# REDAXO Instance Setup Script for test-modern

echo "🚀 Setting up REDAXO instance: test-modern"

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
    \$pdo = new PDO('mysql:host=mysql', 'root', getenv('MYSQL_ROOT_PASSWORD'));
    echo 'Connected';
    exit(0);
} catch(Exception \$e) {
    exit(1);
}
" > /dev/null 2>&1; do
    sleep 2
done
echo "✅ MySQL is ready"

# Download and extract REDAXO if not exists
if [ "${RELEASE_TYPE:-standard}" = "modern" ]; then
    echo "🔄 Setting up REDAXO Modern Structure..."
    
    # Install required packages for Modern Structure
    apt-get update && apt-get install -y curl unzip
    
    # Enable Apache modules
    a2enmod rewrite ssl headers
    
    echo "📥 Downloading REDAXO Modern Structure..."
    cd /tmp
    
    # Download REDAXO Modern Structure from latest release
    echo "📦 Downloading REDAXO Modern Structure (latest release)..."
    
    # Use provided download URL or try to get it from GitHub API
    if [ -n "\$DOWNLOAD_URL" ]; then
        echo "📥 Using provided download URL: \$DOWNLOAD_URL"
    else
        echo "🔍 No download URL provided, trying GitHub API fallback..."
        echo "❌ GitHub API fallback not implemented - please provide download URL"
        exit 1
    fi
    
    # Download to temporary location first
    mkdir -p /tmp/redaxo-download
    cd /tmp/redaxo-download
    
    # Try download with better error handling
    echo "🔽 Attempting download..."
    if ! curl -L -f --connect-timeout 60 --max-time 300 --retry 2 "\$DOWNLOAD_URL" -o redaxo-modern.zip; then
        echo "❌ Download failed"
        exit 1
    fi
    
    # Check if download was successful
    if [ ! -f "redaxo-modern.zip" ] || [ `stat -c%s "redaxo-modern.zip" 2>/dev/null || echo 0` -lt 1024 ]; then
        echo "❌ Download failed or file too small"
        exit 1
    fi
    
    echo "📦 Extracting REDAXO Modern Structure..."
    unzip -q redaxo-modern.zip
    
    # Find extracted content (handle subdirectories like original script)
    EXTRACTED_CONTENT=""
    if [ -d "REDAXO_MODERN_STRUCTURE-"* ]; then
        EXTRACTED_CONTENT=`find . -mindepth 1 -maxdepth 1 -type d -name "REDAXO_MODERN_STRUCTURE-*" | head -1`
    elif [ -d "redaxo-setup-"* ]; then
        EXTRACTED_CONTENT=`find . -mindepth 1 -maxdepth 1 -type d -name "redaxo-setup-*" | head -1`
    else
        echo "Looking for any directory..."
        EXTRACTED_CONTENT=`find . -mindepth 1 -maxdepth 1 -type d | head -1`
    fi
    
    echo "📁 Found extracted content: \$EXTRACTED_CONTENT"
    
    # Copy content to correct Modern Structure layout
    if [ -n "\$EXTRACTED_CONTENT" ] && [ -d "\$EXTRACTED_CONTENT" ]; then
        echo "📋 Setting up Modern Structure layout from: \$EXTRACTED_CONTENT"
        # Kopiere ALLES nach /var/www
        cp -r "\$EXTRACTED_CONTENT"/* /var/www/
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

echo "✅ REDAXO instance setup complete!"
