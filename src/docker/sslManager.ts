import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export class SSLManager {
    private static logChannel = vscode.window.createOutputChannel("REDAXO Multi-Instances - SSL");

    static log(message: string): void {
        const timestamp = new Date().toISOString();
        this.logChannel.appendLine(`[${timestamp}] ${message}`);
        console.log(`SSL Manager: ${message}`);
    }

    static async setupSSLCertificates(instanceName: string, instancePath: string, releaseType: string = 'standard'): Promise<boolean> {
        try {
            this.log(`🔒 Starting SSL setup for ${instanceName}`);
            
            // Create SSL directory
            const sslDir = path.join(instancePath, 'ssl');
            await fs.mkdir(sslDir, { recursive: true });

            // Generate SSL certificates using mkcert
            const certPath = path.join(sslDir, `${instanceName}.pem`);
            const keyPath = path.join(sslDir, `${instanceName}-key.pem`);

            this.log(`📜 Generating SSL certificates for ${instanceName}.local`);
            
            // Use full path to mkcert to avoid PATH issues
            const mkcertPath = await SSLManager.findMkcert();
            const mkcertCommand = `"${mkcertPath}" -cert-file "${certPath}" -key-file "${keyPath}" "${instanceName}.local"`;
            
            this.log(`🔧 Running: ${mkcertCommand}`);
            const result = await execPromise(mkcertCommand, {
                cwd: sslDir
            });

            this.log(`✅ mkcert output: ${result.stdout}`);

            // Add to hosts file
            await SSLManager.addToHostsFile(instanceName);

            // Configure Apache SSL in the running container
            await SSLManager.configureContainerSSL(instanceName);

            this.log(`🎉 SSL setup completed for ${instanceName}`);
            return true;
        } catch (error: any) {
            this.log(`❌ SSL setup failed: ${error.message}`);
            this.log(`❌ Error stack: ${error.stack}`);
            
            // Additional debugging info
            if (error.message.includes('mkcert')) {
                this.log('🔍 Debugging mkcert issue...');
                try {
                    const { stdout: whichOutput } = await execPromise('which mkcert');
                    this.log(`✓ mkcert found at: ${whichOutput.trim()}`);
                    
                    const { stdout: versionOutput } = await execPromise('mkcert --version');
                    this.log(`✓ mkcert version: ${versionOutput.trim()}`);
                } catch (debugError: any) {
                    this.log(`❌ mkcert debug failed: ${debugError.message}`);
                }
            }
            
            return false;
        }
    }

    private static generateApacheSSLConfig(instanceName: string, releaseType: string = 'standard'): string {
        // Always use standard document root
        const documentRoot = '/var/www/html';
        
        return `# HTTP to HTTPS Redirect
<VirtualHost *:80>
    ServerName ${instanceName}.local
    
    # Redirect all HTTP traffic to HTTPS
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</VirtualHost>

# HTTPS Virtual Host
<VirtualHost *:443>
    ServerName ${instanceName}.local
    DocumentRoot ${documentRoot}
    
    SSLEngine on
    SSLCertificateFile /etc/apache2/ssl/${instanceName}.pem
    SSLCertificateKeyFile /etc/apache2/ssl/${instanceName}-key.pem
    
    # SSL Configuration for REDAXO
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    SSLHonorCipherOrder off
    SSLSessionTickets off
    
    # Security Headers
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    Header always set X-Frame-Options DENY
    Header always set X-Content-Type-Options nosniff
    
    # Enable Apache modules
    LoadModule rewrite_module modules/mod_rewrite.so
    LoadModule ssl_module modules/mod_ssl.so
    LoadModule headers_module modules/mod_headers.so
    
    # Standard Apache configuration for REDAXO
    <Directory /var/www/public>
        AllowOverride All
        Require all granted
        
        # REDAXO specific rewrites
        RewriteEngine On
        RewriteBase /
        
        # Exclude certain directories from rewriting
        RewriteRule ^(redaxo|assets|media)/ - [L]
        
        # Standard REDAXO frontend rewrite
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^(.*)$ index.php [QSA,L]
    </Directory>
    
    # Logging
    ErrorLog /var/log/apache2/${instanceName}_ssl_error.log
    CustomLog /var/log/apache2/${instanceName}_ssl_access.log combined
</VirtualHost>

# Redirect HTTP to HTTPS
<VirtualHost *:80>
    ServerName ${instanceName}.local
    Redirect permanent / https://${instanceName}.local/
</VirtualHost>
`;
    }

    private static async addToHostsFile(instanceName: string): Promise<void> {
        try {
            // First, clean up any duplicate entries for this instance
            await SSLManager.cleanupHostsFile(instanceName);
            
            // Check if entry already exists with exact match
            const checkCommand = `grep -c "^127\\.0\\.0\\.1[[:space:]]\\+${instanceName}\\.local[[:space:]]*$" /etc/hosts || true`;
            const { stdout } = await execPromise(checkCommand);
            const entryCount = parseInt(stdout.trim());
            
            if (entryCount > 0) {
                this.log(`✅ ${instanceName}.local already exists in hosts file (${entryCount} entries)`);
                return;
            }
            
            // Add to hosts file (this will prompt for sudo if needed)
            this.log(`📝 Adding ${instanceName}.local to hosts file...`);
            const addCommand = `echo "127.0.0.1 ${instanceName}.local" | sudo tee -a /etc/hosts`;
            
            const { stdout: addOutput } = await execPromise(addCommand);
            if (addOutput.includes('127.0.0.1')) {
                this.log(`✅ Added ${instanceName}.local to hosts file`);
                this.log(`🔍 Verifying: ${addOutput.trim()}`);
            }
            
        } catch (error: any) {
            this.log(`⚠️  Could not add to hosts file automatically: ${error.message}`);
            this.log(`💡 You can manually add "127.0.0.1 ${instanceName}.local" to your /etc/hosts file`);
        }
    }

    /**
     * Find mkcert executable path
     */
    private static async findMkcert(): Promise<string> {
        try {
            const { stdout } = await execPromise('which mkcert');
            const mkcertPath = stdout.trim();
            this.log(`🔍 Found mkcert at: ${mkcertPath}`);
            return mkcertPath;
        } catch (error) {
            this.log('❌ mkcert not found in PATH, trying common locations...');
            
            // Try common installation paths
            const commonPaths = [
                '/opt/homebrew/bin/mkcert',
                '/usr/local/bin/mkcert',
                '/usr/bin/mkcert'
            ];
            
            for (const path of commonPaths) {
                try {
                    await execPromise(`"${path}" --version`);
                    this.log(`✅ Found mkcert at: ${path}`);
                    return path;
                } catch {
                    // Continue to next path
                }
            }
            
            throw new Error('mkcert not found. Please install mkcert: brew install mkcert');
        }
    }

    /**
     * Configure SSL in the running Docker container
     */
    static async configureContainerSSL(instanceName: string): Promise<void> {
        try {
            const containerName = `redaxo-${instanceName}`;
            
            // Check if container is running
            const { stdout: containerStatus } = await execPromise(`docker ps -q -f name=${containerName}`);
            if (!containerStatus.trim()) {
                this.log(`⚠️  Container ${containerName} is not running, SSL config will be applied on next start`);
                return;
            }

            this.log(`🔧 Configuring SSL in container ${containerName}`);

            // Enable SSL modules
            await execPromise(`docker exec ${containerName} a2enmod ssl`);
            await execPromise(`docker exec ${containerName} a2enmod headers`);
            await execPromise(`docker exec ${containerName} a2enmod rewrite`);

            // Create SSL VirtualHost configuration
            const sslConfig = this.generateContainerSSLConfig(instanceName);
            const configCommand = `docker exec ${containerName} bash -c 'cat > /etc/apache2/sites-available/001-ssl.conf << EOF\n${sslConfig}\nEOF'`;
            await execPromise(configCommand);

            // Enable SSL site
            await execPromise(`docker exec ${containerName} a2ensite 001-ssl`);

            // Test Apache configuration
            await execPromise(`docker exec ${containerName} apache2ctl configtest`);

            // Restart Apache
            await execPromise(`docker exec ${containerName} service apache2 restart`);

            this.log(`✅ SSL configuration applied to container ${containerName}`);
        } catch (error: any) {
            this.log(`❌ Failed to configure container SSL: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate SSL configuration for container
     */
    private static generateContainerSSLConfig(instanceName: string): string {
        return `<VirtualHost *:443>
    ServerName ${instanceName}.local
    DocumentRoot /var/www/html
    
    SSLEngine on
    SSLCertificateFile /etc/apache2/ssl/${instanceName}.pem
    SSLCertificateKeyFile /etc/apache2/ssl/${instanceName}-key.pem
    
    # SSL Configuration
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    SSLHonorCipherOrder off
    
    # Security Headers
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains"
    Header always set X-Frame-Options DENY
    Header always set X-Content-Type-Options nosniff
    
    <Directory /var/www/html>
        AllowOverride All
        Require all granted
        
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteCond %{REQUEST_FILENAME} !-d
        RewriteRule ^(.*)$ index.php [QSA,L]
    </Directory>
    
    ErrorLog /var/log/apache2/ssl_error.log
    CustomLog /var/log/apache2/ssl_access.log combined
</VirtualHost>`;
    }

    /**
     * Clean up duplicate entries for an instance in hosts file
     */
    private static async cleanupHostsFile(instanceName: string): Promise<void> {
        try {
            const cleanupCommand = `
                # Remove duplicate entries for ${instanceName}.local
                sudo sed -i.bak "/^127\\.0\\.0\\.1[[:space:]]\\+${instanceName}\\.local[[:space:]]*$/d" /etc/hosts
            `;
            await execPromise(cleanupCommand);
            this.log(`🧹 Cleaned up any existing entries for ${instanceName}.local`);
        } catch (error: any) {
            // Ignore cleanup errors, not critical
            this.log(`ℹ️  Cleanup note: ${error.message}`);
        }
    }
}
