#!/bin/bash
# REDAXO Instance Setup Script for test-modern

echo "🚀 Setting up REDAXO instance: test-modern"

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
    
    # Get the correct download URL from GitHub API (using pattern from original redaxo-downloader.sh)
    DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest" | grep -o '"browser_download_url":"[^"]*redaxo-setup[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -z "$DOWNLOAD_URL" ]; then
        echo "❌ Could not find Modern Structure download URL, trying fallback..."
        # Fallback: try any zip file
        DOWNLOAD_URL=$(curl -s "https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest" | grep "browser_download_url" | grep ".zip" | head -1 | cut -d '"' -f 4)
    fi
    
    if [ -z "$DOWNLOAD_URL" ]; then
        echo "❌ Could not find any download URL"
        exit 1
    fi
    
    echo "📥 Download URL: $DOWNLOAD_URL"
    
    # Download to temporary location first (like original script)
    mkdir -p /tmp/redaxo-download
    cd /tmp/redaxo-download
    curl -L "$DOWNLOAD_URL" -o redaxo-modern.zip
    
    # Check if download was successful
    if [ ! -f "redaxo-modern.zip" ] || [ $(stat -c%s "redaxo-modern.zip" 2>/dev/null || echo 0) -lt 1024 ]; then
        echo "❌ Download failed or file too small"
        exit 1
    fi
    
    echo "📦 Extracting REDAXO Modern Structure..."
    unzip -q redaxo-modern.zip
    
    # Find extracted content (handle subdirectories like original script)
    EXTRACTED_CONTENT=""
    if [ -d "REDAXO_MODERN_STRUCTURE-"* ]; then
        EXTRACTED_CONTENT=$(find . -mindepth 1 -maxdepth 1 -type d -name "REDAXO_MODERN_STRUCTURE-*" | head -1)
    elif [ -d "redaxo-setup-"* ]; then
        EXTRACTED_CONTENT=$(find . -mindepth 1 -maxdepth 1 -type d -name "redaxo-setup-*" | head -1)
    else
        echo "Looking for any directory..."
        EXTRACTED_CONTENT=$(find . -mindepth 1 -maxdepth 1 -type d | head -1)
    fi
    
    echo "📁 Found extracted content: $EXTRACTED_CONTENT"
    
    # Copy content to /var/www/html (like original script)
    if [ -n "$EXTRACTED_CONTENT" ] && [ -d "$EXTRACTED_CONTENT" ]; then
        echo "📋 Copying from subdirectory: $EXTRACTED_CONTENT"
        cp -r "$EXTRACTED_CONTENT"/* /var/www/html/
    else
        echo "📋 Copying all files directly"
        # Remove .zip file first to avoid copying it
        rm -f redaxo-modern.zip
        cp -r * /var/www/html/ 2>/dev/null || true
    fi
    
    # Clean up temporary files
    rm -rf /tmp/redaxo-download
    
    # Set permissions
    chown -R www-data:www-data /var/www/html
    chmod -R 755 /var/www/html
    
    echo "✅ REDAXO Modern Structure installed successfully"
    
    # Show what we have
    echo "📁 Directory contents:"
    ls -la /var/www/html/
    
else
    echo "✅ Using standard REDAXO from Docker image"
fi

echo "✅ REDAXO instance setup complete!"
