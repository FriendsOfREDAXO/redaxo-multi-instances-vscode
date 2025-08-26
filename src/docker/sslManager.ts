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
            // Create SSL directory
            const sslDir = path.join(instancePath, 'ssl');
            await fs.mkdir(sslDir, { recursive: true });

            // Generate SSL certificates using mkcert
            const certPath = path.join(sslDir, `${instanceName}.pem`);
            const keyPath = path.join(sslDir, `${instanceName}-key.pem`);

            const result = await exec(`mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${instanceName}.local"`, {
                cwd: sslDir
            });

            console.log('mkcert output:', result.stdout);

            // Generate Apache SSL configuration
            const sslConfig = SSLManager.generateApacheSSLConfig(instanceName, releaseType);
            const sslConfigPath = path.join(instancePath, 'apache-ssl.conf');
            await fs.writeFile(sslConfigPath, sslConfig);

            // Add to hosts file
            await SSLManager.addToHostsFile(instanceName);

            return true;
        } catch (error: any) {
            console.error('SSL setup failed:', error.message);
            return false;
        }
    }

    private static generateApacheSSLConfig(instanceName: string, releaseType: string = 'standard'): string {
        // Always use standard document root
        const documentRoot = '/var/www/html';
        
        return `<VirtualHost *:443>
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
            // Check if entry already exists (check both variations)
            const checkCommand = `grep -E "(^|\s)${instanceName}\.local(\s|$)" /etc/hosts`;
            try {
                const { stdout } = await execPromise(checkCommand);
                if (stdout.trim()) {
                    this.log(`✅ ${instanceName}.local already exists in hosts file`);
                    this.log(`📋 Current entry: ${stdout.trim()}`);
                    return;
                }
            } catch {
                // Entry doesn't exist, continue
            }
            
            // Add to hosts file (this will prompt for sudo if needed)
            this.log(`📝 Adding ${instanceName}.local to hosts file...`);
            const addCommand = `echo "# REDAXO Multi-Instance
127.0.0.1 ${instanceName}.local" | sudo tee -a /etc/hosts`;
            
            const { stdout } = await execPromise(addCommand);
            if (stdout.includes('127.0.0.1')) {
                this.log(`✅ Added ${instanceName}.local to hosts file`);
                this.log(`🔍 Verifying: ${stdout.trim()}`);
            }
            
        } catch (error: any) {
            this.log(`⚠️  Could not add to hosts file automatically: ${error.message}`);
            this.log(`💡 You can manually add "127.0.0.1 ${instanceName}.local" to your /etc/hosts file`);
            this.log(`⚠️  You may need to manually add "127.0.0.1 ${instanceName}.local" to your /etc/hosts file`);
        }
    }
}
