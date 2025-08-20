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

    static async setupSSLCertificates(instanceName: string, instancePath: string): Promise<boolean> {
        try {
            // Check if mkcert is available
            await execPromise('mkcert -version');
            this.log(`✅ mkcert is available`);
            
            // Create ssl directory
            const sslDir = path.join(instancePath, 'ssl');
            await fs.mkdir(sslDir, { recursive: true });
            
            // Generate SSL certificates using mkcert
            const certCommand = `mkcert -cert-file "${path.join(sslDir, instanceName)}.pem" -key-file "${path.join(sslDir, instanceName)}-key.pem" "${instanceName}.local" "*.${instanceName}.local"`;
            
            this.log(`🔧 Executing: ${certCommand}`);
            await execPromise(certCommand);
            
            // Generate Apache SSL configuration
            const apacheSslConfig = this.generateApacheSSLConfig(instanceName);
            await fs.writeFile(path.join(instancePath, 'apache-ssl.conf'), apacheSslConfig);
            
            this.log(`✅ SSL certificates created for ${instanceName}.local`);
            
            // Add to hosts file (optional, requires sudo)
            await this.addToHostsFile(instanceName);
            
            return true;
            
        } catch (error: any) {
            this.log(`❌ SSL setup failed: ${error.message}`);
            console.log(`SSL Manager: SSL setup failed for ${instanceName}:`, error);
            return false;
        }
    }

    private static generateApacheSSLConfig(instanceName: string): string {
        return `<VirtualHost *:443>
    ServerName ${instanceName}.local
    DocumentRoot /var/www/public
    
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/${instanceName}.pem
    SSLCertificateKeyFile /etc/ssl/private/${instanceName}-key.pem
    
    # Modern SSL Configuration
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
            // Check if entry already exists
            const checkCommand = `grep -q "${instanceName}.local" /etc/hosts`;
            try {
                await execPromise(checkCommand);
                this.log(`✅ ${instanceName}.local already exists in hosts file`);
                return;
            } catch {
                // Entry doesn't exist, add it
            }
            
            // Add to hosts file (this will prompt for sudo)
            const addCommand = `echo "127.0.0.1 ${instanceName}.local" | sudo tee -a /etc/hosts`;
            await execPromise(addCommand);
            this.log(`✅ Added ${instanceName}.local to hosts file`);
            
        } catch (error: any) {
            this.log(`⚠️  Could not add to hosts file: ${error.message}`);
            this.log(`⚠️  You may need to manually add "127.0.0.1 ${instanceName}.local" to your /etc/hosts file`);
        }
    }
}
