import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { RedaxoInstance, CreateInstanceOptions, DatabaseInfo } from '../types/redaxo';

const execPromise = promisify(exec);

export class DockerService {
    private dockerPath: string;
    private instancesDir: string | null = null;
    private outputChannel?: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.dockerPath = vscode.workspace.getConfiguration('redaxo-instances').get('dockerPath', 'docker');
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        console.log(message);
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    private async runDockerCommand(args: string[], options?: { cwd?: string }): Promise<string> {
        const command = `${this.dockerPath} ${args.join(' ')}`;
        this.log(`🐳 Running Docker command: ${command}`);
        this.log(`📁 Working directory: ${options?.cwd || 'default'}`);
        
        try {
            const { stdout, stderr } = await execPromise(command, options);
            const stderrStr = stderr?.toString() || '';
            const stdoutStr = stdout?.toString() || '';
            
            if (stderrStr && stderrStr.trim()) {
                this.log(`⚠️  Docker command stderr: ${stderrStr}`);
            }
            if (stdoutStr && stdoutStr.trim()) {
                this.log(`✅ Docker command completed successfully`);
            }
            return stdoutStr;
        } catch (error) {
            this.log(`❌ Docker command failed: ${command}`);
            this.log(`💥 Error: ${error}`);
            throw error;
        }
    }

    private async getInstancesDirectory(): Promise<string> {
        console.log('DockerService: getInstancesDirectory called');
        
        if (this.instancesDir) {
            console.log('DockerService: using cached instancesDir:', this.instancesDir);
            return this.instancesDir;
        }

        const config = vscode.workspace.getConfiguration('redaxo-instances');
        const savedPath = config.get<string>('instancesPath');

        console.log('DockerService: savedPath from config:', savedPath);

        if (savedPath && await this.directoryExists(savedPath)) {
            this.instancesDir = savedPath;
            console.log('DockerService: using saved path:', this.instancesDir);
            return this.instancesDir;
        }

        console.log('DockerService: no saved path found, showing directory selection...');
        
        // Beim ersten Mal nach dem Pfad fragen - nur einmal!
        const selectedPath = await this.selectInstancesDirectory();
        if (!selectedPath) {
            console.log('DockerService: no path selected, using fallback');
            // Fallback: Workspace oder Home directory
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            this.instancesDir = workspaceRoot 
                ? path.join(workspaceRoot, 'redaxo-instances')
                : path.join(process.env.HOME || '/tmp', 'redaxo-instances');
        } else {
            this.instancesDir = selectedPath;
        }

        console.log('DockerService: final instancesDir:', this.instancesDir);

        // Pfad speichern
        await config.update('instancesPath', this.instancesDir, vscode.ConfigurationTarget.Global);
        
        // Verzeichnis erstellen
        await this.ensureDirectoryExists(this.instancesDir);
        
        return this.instancesDir;
    }

    private async selectInstancesDirectory(): Promise<string | undefined> {
        // Direkt den Ordner-Dialog anzeigen
        const selectedFolders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Folder for REDAXO Instances',
            title: 'Choose where to store REDAXO instances'
        });

        if (selectedFolders && selectedFolders[0]) {
            return selectedFolders[0].fsPath;
        }

        // Wenn nichts ausgewählt wurde, frage nach Workspace
        const useWorkspace = await vscode.window.showQuickPick(
            ['Yes, use workspace folder', 'No, I\'ll select later'],
            {
                placeHolder: 'No folder selected. Use current workspace?',
                ignoreFocusOut: true
            }
        );

        if (useWorkspace?.startsWith('Yes')) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
                return path.join(workspaceRoot, 'redaxo-instances');
            }
        }

        return undefined;
    }

    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    private async ensureDirectoryExists(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
            vscode.window.showInformationMessage(`Created instances directory: \${dirPath}`);
        } catch (error: any) {
            throw new Error(`Failed to create directory: \${error.message}`);
        }
    }

    async checkDockerInstallation(): Promise<void> {
        try {
            await execPromise('docker --version');
        } catch (error) {
            throw new Error('Docker is not installed or not accessible');
        }
    }

    async listInstances(): Promise<RedaxoInstance[]> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const entries = await fs.readdir(instancesDir, { withFileTypes: true });
            const instances: RedaxoInstance[] = [];
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const instance = await this.getInstance(entry.name);
                    if (instance) {
                        instances.push(instance);
                    }
                }
            }
            
            return instances;
        } catch (error) {
            console.error('Error listing instances:', error);
            return [];
        }
    }

    async createInstance(options: CreateInstanceOptions): Promise<void> {
        console.log('DockerService: createInstance called with', options.name);
        this.log(`🚀 Starting instance creation: ${options.name}`);
        
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, options.name);
            console.log('DockerService: instancePath:', instancePath);
            this.log(`📁 Instance path: ${instancePath}`);
            
            // Create instance directory
            console.log('DockerService: Creating directory:', instancePath);
            this.log(`📂 Creating directory structure...`);
            await fs.mkdir(instancePath, { recursive: true });
            
            // Generate random database credentials
            console.log('DockerService: Generating credentials...');
            this.log(`🔐 Generating database credentials...`);
            const dbPassword = this.generateRandomPassword();
            const dbRootPassword = this.generateRandomPassword();
            const httpPort = await this.findAvailablePort();
            const httpsPort = await this.findAvailablePort(httpPort + 1);
            console.log('DockerService: Ports assigned - HTTP:', httpPort, 'HTTPS:', httpsPort);
            this.log(`🌐 Assigned ports - HTTP: ${httpPort}, HTTPS: ${httpsPort}`);
            
            // Check if mkcert is available and create SSL certificates
            console.log('DockerService: Setting up SSL certificates...');
            this.log(`🔒 Setting up SSL certificates with mkcert...`);
            const sslEnabled = await this.setupSSLCertificates(options.name, instancePath);
            console.log('DockerService: SSL enabled:', sslEnabled);
            this.log(`🔒 SSL certificates ${sslEnabled ? 'created successfully' : 'not available (mkcert not found)'}`);
            
            // Create docker-compose.yml
            console.log('DockerService: Creating docker-compose.yml...');
            this.log(`⚙️  Creating Docker Compose configuration...`);
            const dockerComposeContent = this.generateDockerCompose(options, dbPassword, dbRootPassword, httpPort, httpsPort, sslEnabled);
            await fs.writeFile(path.join(instancePath, 'docker-compose.yml'), dockerComposeContent);
            
            // Create .env file
            this.log(`📝 Creating environment configuration...`);
            const envContent = this.generateEnvFile(options, dbPassword, dbRootPassword, httpPort, httpsPort, sslEnabled);
            await fs.writeFile(path.join(instancePath, '.env'), envContent);
            
            // Create data directories
            this.log(`📁 Setting up data directories...`);
            await fs.mkdir(path.join(instancePath, 'data'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'data', 'mysql'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'data', 'redaxo'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'mysql-init'), { recursive: true });
            
            // Create custom setup script for REDAXO auto-installation
            console.log('DockerService: Creating custom setup script...');
            this.log(`🛠️  Creating REDAXO setup script...`);
            const customSetupContent = this.generateCustomSetupScript(options);
            await fs.writeFile(path.join(instancePath, 'custom-setup.sh'), customSetupContent, { mode: 0o755 });
            
            // Build Docker images first (pull if not exists)
            console.log('DockerService: Pulling Docker images...');
            this.log(`🐳 Pulling required Docker images (this may take a while)...`);
            const pullResult = await this.runDockerCommand(['compose', 'pull'], { cwd: instancePath });
            console.log('DockerService: Docker pull result:', pullResult);
            
            this.log(`✅ Instance ${options.name} created successfully!`);
            vscode.window.showInformationMessage(`Instance ${options.name} created successfully! You can start it manually when ready.`);
            
            // Don't auto-start - let user start manually when ready
            this.log(`� Instance is ready to start. Use 'Start Instance' from the context menu when ready.`);
            this.log(`� Note: The instance needs to be started manually to ensure all files are properly initialized.`);
            
        } catch (error) {
            console.error('DockerService: Error in createInstance:', error);
            this.log(`❌ Error creating instance: ${error}`);
            
            let errorMessage = 'Unknown error occurred';
            if (error instanceof Error) {
                errorMessage = error.message;
                
                // Add specific error context
                if (error.message.includes('ENOENT')) {
                    errorMessage += ' (Docker or required command not found)';
                } else if (error.message.includes('EACCES')) {
                    errorMessage += ' (Permission denied - check file permissions)';
                } else if (error.message.includes('EEXIST')) {
                    errorMessage += ' (Instance already exists)';
                } else if (error.message.includes('docker')) {
                    errorMessage += ' (Docker command failed - is Docker running?)';
                }
            }
            
            vscode.window.showErrorMessage(`Error creating instance: ${errorMessage}`);
            throw new Error(`Instance creation failed: ${errorMessage}`);
        }
    }

    async startInstance(instanceName: string): Promise<void> {
        try {
            console.log(`DockerService: Starting instance ${instanceName}...`);
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if instance exists
            const dockerComposePath = path.join(instancePath, 'docker-compose.yml');
            try {
                await fs.access(dockerComposePath);
                console.log(`DockerService: Found docker-compose.yml for ${instanceName}`);
            } catch {
                throw new Error(`Instance ${instanceName} not found or missing docker-compose.yml`);
            }
            
            // Start with docker-compose using the new method
            console.log(`DockerService: Running docker-compose up for ${instanceName}...`);
            const result = await this.runDockerCommand(['compose', 'up', '-d'], { cwd: instancePath });
            console.log(`DockerService: Instance ${instanceName} started. Output:`, result);
            
            vscode.window.showInformationMessage(`Instance ${instanceName} started successfully!`);
            
        } catch (error: any) {
            console.error(`DockerService: Failed to start instance ${instanceName}:`, error);
            const errorMessage = error.message || 'Unknown error';
            vscode.window.showErrorMessage(`Failed to start instance: ${errorMessage}`);
            throw error;
        }
    }

    async stopInstance(instanceName: string): Promise<void> {
        try {
            console.log(`DockerService: Stopping instance ${instanceName}...`);
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            const result = await this.runDockerCommand(['compose', 'stop'], { cwd: instancePath });
            console.log(`DockerService: Instance ${instanceName} stopped. Output:`, result);
            
            vscode.window.showInformationMessage(`Instance ${instanceName} stopped successfully!`);
            
        } catch (error: any) {
            console.error(`DockerService: Failed to stop instance ${instanceName}:`, error);
            const errorMessage = error.message || 'Unknown error';
            vscode.window.showErrorMessage(`Failed to stop instance: ${errorMessage}`);
            throw error;
        }
    }

    async deleteInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Stop containers first
            try {
                await execPromise('docker-compose down -v', { cwd: instancePath });
            } catch {
                // Continue even if stopping fails
            }
            
            // Remove instance directory
            await fs.rm(instancePath, { recursive: true, force: true });
            vscode.window.showInformationMessage(`Instance ${instanceName} deleted successfully!`);
            
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to delete instance: ${error.message}`);
            throw error;
        }
    }

    private generateRandomPassword(length: number = 16): string {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    private async findAvailablePort(startPort: number = 8080): Promise<number> {
        const net = require('net');
        
        return new Promise((resolve) => {
            const checkPort = (port: number) => {
                const server = net.createServer();
                
                server.listen(port, () => {
                    server.close(() => {
                        resolve(port);
                    });
                });
                
                server.on('error', () => {
                    checkPort(port + 1);
                });
            };
            
            checkPort(startPort);
        });
    }

    private generateDockerCompose(options: CreateInstanceOptions, dbPassword: string, dbRootPassword: string, httpPort: number, httpsPort: number, sslEnabled: boolean): string {
        // Base volumes that are always included
        const baseVolumes = [
            '      - ./data/redaxo:/var/www/html',
            '      - ./custom-setup.sh:/usr/local/bin/custom-setup.sh:ro'
        ];
        
        // SSL volumes only if SSL is enabled
        if (sslEnabled) {
            baseVolumes.push('      - ./ssl:/etc/ssl/certs:ro');
            baseVolumes.push('      - ./ssl:/etc/ssl/private:ro');
            // Mount apache-ssl.conf as script file that gets copied by setup script
            baseVolumes.push('      - ./apache-ssl.conf:/usr/local/bin/apache-ssl.conf:ro');
        }
        
        const allVolumes = baseVolumes.join('\n');
        
        const ports = sslEnabled 
            ? `      - "${httpPort}:80"
      - "${httpsPort}:443"`
            : `      - "${httpPort}:80"`;

        // Use different images for different release types
        const dockerImage = options.releaseType === 'modern' 
            ? 'php:8.3-apache'  // Clean PHP/Apache for Modern Structure
            : 'friendsofredaxo/redaxo:5';  // Pre-built REDAXO for Standard

        return `services:
  redaxo:
    image: ${dockerImage}
    container_name: redaxo-${options.name}${options.releaseType === 'modern' ? `
    command: >
      sh -c "
        /usr/local/bin/custom-setup.sh &&
        apache2-foreground
      "` : ''}
    ports:
${ports}
    volumes:
${allVolumes}
    environment:
      - REDAXO_SERVER=${sslEnabled ? `https://${options.name}.local:${httpsPort}` : `http://localhost:${httpPort}`}
      - REDAXO_SERVERNAME=${options.name}
      - REDAXO_ERROR_EMAIL=admin@${options.name}.local
      - REDAXO_LANG=de_de
      - REDAXO_TIMEZONE=Europe/Berlin
      - REDAXO_DB_HOST=mysql
      - REDAXO_DB_NAME=redaxo
      - REDAXO_DB_LOGIN=redaxo
      - REDAXO_DB_PASSWORD=${dbPassword}
      - REDAXO_DB_CHARSET=utf8mb4
      - REDAXO_ADMIN_USER=admin
      - REDAXO_ADMIN_PASSWORD=${dbPassword}
    depends_on:
      - mysql
    networks:
      - redaxo-network

  mysql:
    image: mariadb:${options.mariadbVersion}
    container_name: redaxo-${options.name}-mysql
    environment:
      - MYSQL_ROOT_PASSWORD=${dbRootPassword}
      - MYSQL_DATABASE=redaxo
      - MYSQL_USER=redaxo
      - MYSQL_PASSWORD=${dbPassword}
      - MYSQL_CHARSET=utf8mb4
      - MYSQL_COLLATION=utf8mb4_unicode_ci
    volumes:
      - ./data/mysql:/var/lib/mysql
      - ./mysql-init:/docker-entrypoint-initdb.d:ro
    networks:
      - redaxo-network

networks:
  redaxo-network:
    driver: bridge
`;
    }

    private generateEnvFile(options: CreateInstanceOptions, dbPassword: string, dbRootPassword: string, httpPort: number, httpsPort: number, sslEnabled: boolean): string {
        return `# REDAXO Instance: ${options.name}
INSTANCE_NAME=${options.name}
PHP_VERSION=${options.phpVersion}
MARIADB_VERSION=${options.mariadbVersion}
RELEASE_TYPE=${options.releaseType || 'standard'}
HTTP_PORT=${httpPort}
${sslEnabled ? `HTTPS_PORT=${httpsPort}
SSL_ENABLED=true` : `SSL_ENABLED=false`}

# Database Configuration
DB_HOST=mysql
DB_NAME=redaxo
DB_USER=redaxo
DB_PASSWORD=${dbPassword}
DB_ROOT_PASSWORD=${dbRootPassword}

# URLs
${sslEnabled ? `FRONTEND_URL=https://${options.name}.local:${httpsPort}
BACKEND_URL=https://${options.name}.local:${httpsPort}/redaxo/
FRONTEND_URL_HTTP=http://localhost:${httpPort}
BACKEND_URL_HTTP=http://localhost:${httpPort}/redaxo/` : `FRONTEND_URL=http://localhost:${httpPort}
BACKEND_URL=http://localhost:${httpPort}/redaxo/`}
`;
    }

    private generatePhpIni(): string {
        return `; PHP Configuration for REDAXO
upload_max_filesize = 64M
post_max_size = 64M
max_execution_time = 300
max_input_vars = 10000
memory_limit = 256M

; Enable required PHP extensions
extension=pdo_mysql
extension=gd
extension=intl
extension=zip
extension=xml
extension=mbstring
extension=curl
extension=json
`;
    }

    private async setupSSLCertificates(instanceName: string, instancePath: string): Promise<boolean> {
        try {
            // Check if mkcert is installed
            await execPromise('mkcert -version');
            
            this.log('🔒 Installing mkcert CA in system trust store...');
            
            // Install mkcert CA in system trust store (critical for browser trust!)
            try {
                await execPromise('mkcert -install');
                this.log('✅ mkcert CA installed successfully in system trust store');
            } catch (installError) {
                this.log('⚠️ mkcert -install failed, certificates may not be trusted by browsers');
                console.warn('mkcert install error:', installError);
                // Continue anyway, certificates will still work but browsers may show warnings
            }
            
            // Get global SSL certificates directory
            const instancesDir = await this.getInstancesDirectory();
            const globalSSLDir = path.join(instancesDir, '.ssl-certificates');
            await fs.mkdir(globalSSLDir, { recursive: true });
            
            // Create local SSL directory for this instance
            const localSslDir = path.join(instancePath, 'ssl');
            await fs.mkdir(localSslDir, { recursive: true });
            
            // Check if global wildcard certificate exists
            const wildcardCertPath = path.join(globalSSLDir, 'wildcard.local.pem');
            const wildcardKeyPath = path.join(globalSSLDir, 'wildcard.local-key.pem');
            
            let useWildcard = false;
            try {
                await fs.access(wildcardCertPath);
                await fs.access(wildcardKeyPath);
                this.log('✅ Found existing wildcard certificate for *.local');
                useWildcard = true;
            } catch {
                // Wildcard certificate doesn't exist, create it
                this.log('🔒 Creating global wildcard certificate for *.local...');
                const domains = ['*.local', 'localhost', '127.0.0.1'];
                const certCommand = `mkcert -cert-file wildcard.local.pem -key-file wildcard.local-key.pem ${domains.join(' ')}`;
                await execPromise(certCommand, { cwd: globalSSLDir });
                this.log('✅ Global wildcard certificate created for *.local');
                useWildcard = true;
            }
            
            if (useWildcard) {
                // Copy global certificates to instance SSL directory
                await fs.copyFile(wildcardCertPath, path.join(localSslDir, `${instanceName}.pem`));
                await fs.copyFile(wildcardKeyPath, path.join(localSslDir, `${instanceName}-key.pem`));
                this.log(`✅ SSL certificates linked for ${instanceName}.local`);
                vscode.window.showInformationMessage(`🔒 SSL certificates ready for ${instanceName}.local (wildcard *.local)`);
            } else {
                // Fallback: create instance-specific certificate
                const domain = `${instanceName}.local`;
                const domains = [domain, `www.${domain}`, 'localhost', '127.0.0.1'];
                
                this.log(`🔒 Creating instance-specific certificate for: ${domains.join(', ')}`);
                const certCommand = `mkcert -cert-file ssl/${instanceName}.pem -key-file ssl/${instanceName}-key.pem ${domains.join(' ')}`;
                await execPromise(certCommand, { cwd: instancePath });
                this.log(`✅ Instance-specific SSL certificate created for ${domain}`);
                vscode.window.showInformationMessage(`🔒 SSL certificates created for ${domain}`);
            }
            
            return true;
            
        } catch (error) {
            console.log('mkcert not available or failed:', error);
            vscode.window.showWarningMessage('mkcert not found - install it for HTTPS support: brew install mkcert');
            return false;
        }
    }

    private generateApacheSSLConfig(instanceName: string, releaseType: string = 'standard'): string {
        const documentRoot = releaseType === 'modern' ? '/var/www/html/public' : '/var/www/html';
        
        return `LoadModule ssl_module modules/mod_ssl.so
LoadModule rewrite_module modules/mod_rewrite.so

<VirtualHost *:443>
    DocumentRoot ${documentRoot}
    ServerName ${instanceName}.local
    ServerAlias www.${instanceName}.local
    
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/${instanceName}.pem
    SSLCertificateKeyFile /etc/ssl/private/${instanceName}-key.pem
    
    # Security headers
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    Header always set X-Frame-Options DENY
    Header always set X-Content-Type-Options nosniff
    
    # REDAXO specific
    <Directory "${documentRoot}">
        AllowOverride All
        Require all granted
    </Directory>
    
    # Redirect HTTP to HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:80>
    ServerName ${instanceName}.local
    ServerAlias www.${instanceName}.local
    RewriteEngine On
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>
`;
    }

    private generateCustomSetupScript(options: CreateInstanceOptions): string {
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
    
    # Get the correct download URL from GitHub API
    DOWNLOAD_URL=\$(curl -s "https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest" | grep "browser_download_url" | grep ".zip" | head -1 | cut -d '"' -f 4)
    
    if [ -z "\$DOWNLOAD_URL" ]; then
        echo "❌ Could not find Modern Structure download URL"
        exit 1
    fi
    
    echo "📥 Download URL: \$DOWNLOAD_URL"
    curl -L "\$DOWNLOAD_URL" -o redaxo.zip
    unzip redaxo.zip -d /var/www/html/
    
    # Set permissions
    chown -R www-data:www-data /var/www/html
    chmod -R 755 /var/www/html
    
    echo "✅ REDAXO Modern Structure installed successfully"
else
    echo "✅ Using standard REDAXO from Docker image"
fi

${options.autoInstall ? `
# Auto-install REDAXO if enabled
if [ "\${RELEASE_TYPE:-standard}" = "modern" ]; then
    # Modern Structure auto-installation
    if [ ! -f "/var/www/html/var/data/config.yml" ]; then
        echo "⚙️ Auto-installing REDAXO Modern Structure..."
        
        # Create REDAXO configuration for Modern Structure
        php /var/www/html/bin/console setup:run \\
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
` : '# Auto-install disabled'}

echo "✅ REDAXO instance setup complete!"
`;
    }

    async getInstance(instanceName: string): Promise<RedaxoInstance | null> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            const envPath = path.join(instancePath, '.env');
            
            // Check if instance exists
            try {
                await fs.access(envPath);
            } catch {
                return null;
            }
            
            // Read env file to get instance details
            const envContent = await fs.readFile(envPath, 'utf-8');
            const envLines = envContent.split('\n');
            const envVars: { [key: string]: string } = {};
            
            envLines.forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key] = value;
                }
            });
            
            // Check if containers are running
            const running = await this.isInstanceRunning(instanceName);
            
            // Determine the correct URLs - use HTTP by default, HTTPS only if explicitly requested
            const httpPort = parseInt(envVars.HTTP_PORT) || 8080;
            const httpsPort = parseInt(envVars.HTTPS_PORT) || 8443;
            
            // Check if SSL is configured
            const sslConfigured = await this.isSSLConfigured(instancePath);
            
            // Always prefer HTTP for better compatibility
            // HTTPS can be accessed manually if needed, but HTTP is the default
            const frontendUrl = `http://localhost:${httpPort}`;
            const backendUrl = `http://localhost:${httpPort}/redaxo/`;
            
            // Build the return object
            const instance: RedaxoInstance = {
                name: instanceName,
                phpVersion: envVars.PHP_VERSION || '8.1',
                mariadbVersion: envVars.MARIADB_VERSION || '10.11',
                port: httpPort,
                running,
                status: running ? 'running' : 'stopped',
                frontendUrl,
                backendUrl
            };
            
            // Add HTTPS URLs if SSL is configured
            if (sslConfigured) {
                instance.frontendUrlHttps = `https://localhost:${httpsPort}`;
                instance.backendUrlHttps = `https://localhost:${httpsPort}/redaxo/`;
            }
            
            return instance;
            
        } catch (error) {
            console.error(`Error getting instance ${instanceName}:`, error);
            return null;
        }
    }

    private async isInstanceRunning(instanceName: string): Promise<boolean> {
        try {
            const result = await execPromise(`docker ps --filter "name=redaxo-${instanceName}" --format "{{.Names}}"`);
            return result.stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async getDatabaseInfo(instanceName: string): Promise<DatabaseInfo> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const envPath = path.join(instancesDir, instanceName, '.env');
            const envContent = await fs.readFile(envPath, 'utf-8');
            
            const envLines = envContent.split('\n');
            const envVars: { [key: string]: string } = {};
            
            envLines.forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key] = value;
                }
            });
            
            return {
                host: envVars.DB_HOST || 'localhost',
                database: envVars.DB_NAME || 'redaxo',
                user: envVars.DB_USER || 'redaxo',
                password: envVars.DB_PASSWORD || '',
                rootPassword: envVars.DB_ROOT_PASSWORD || ''
            };
            
        } catch (error) {
            return {
                host: 'localhost',
                database: 'redaxo',
                user: 'redaxo',
                password: 'unknown',
                rootPassword: 'unknown'
            };
        }
    }

    async importDump(instanceName: string, dumpFilePath: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if instance exists
            const dockerComposePath = path.join(instancePath, 'docker-compose.yml');
            try {
                await fs.access(dockerComposePath);
            } catch {
                throw new Error(`Instance ${instanceName} not found`);
            }

            // Create temp directory for extraction
            const tempDir = path.join(instancePath, 'temp-import');
            await fs.mkdir(tempDir, { recursive: true });

            try {
                // Extract dump file based on extension
                const ext = path.extname(dumpFilePath).toLowerCase();
                
                if (ext === '.zip') {
                    await execPromise(`unzip -o "${dumpFilePath}" -d "${tempDir}"`);
                } else if (ext === '.gz' && dumpFilePath.includes('.tar.gz')) {
                    await execPromise(`tar -xzf "${dumpFilePath}" -C "${tempDir}"`);
                } else if (ext === '.sql') {
                    // Direct SQL file
                    await fs.copyFile(dumpFilePath, path.join(tempDir, 'dump.sql'));
                } else {
                    throw new Error('Unsupported dump file format. Use .zip, .tar.gz, or .sql files.');
                }

                // Look for web files and database dump
                const tempContents = await fs.readdir(tempDir, { withFileTypes: true });
                
                // Import web files if found
                for (const item of tempContents) {
                    if (item.isDirectory() && (item.name.includes('app') || item.name.includes('web'))) {
                        const sourcePath = path.join(tempDir, item.name);
                        const targetPath = path.join(instancePath, 'data', 'redaxo');
                        
                        // Clear existing web files
                        await fs.rm(targetPath, { recursive: true, force: true });
                        await fs.mkdir(targetPath, { recursive: true });
                        
                        // Copy new web files
                        await execPromise(`cp -r "${sourcePath}"/* "${targetPath}"/`);
                        vscode.window.showInformationMessage('✅ Web files imported');
                    }
                }

                // Import database dump if found
                const sqlFiles = tempContents.filter(item => 
                    item.isFile() && item.name.toLowerCase().endsWith('.sql')
                );

                if (sqlFiles.length > 0) {
                    const sqlFile = path.join(tempDir, sqlFiles[0].name);
                    
                    // Import via docker exec
                    const importCmd = `docker exec -i redaxo-${instanceName}-mysql mysql -u root -p\$(cat .env | grep DB_ROOT_PASSWORD | cut -d '=' -f 2) redaxo < "${sqlFile}"`;
                    await execPromise(importCmd, { cwd: instancePath });
                    vscode.window.showInformationMessage('✅ Database imported');
                }

            } finally {
                // Clean up temp directory
                await fs.rm(tempDir, { recursive: true, force: true });
            }

        } catch (error: any) {
            throw new Error(`Failed to import dump: ${error.message}`);
        }
    }

    async setupInstanceSSL(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Setup SSL certificates
            const sslEnabled = await this.setupSSLCertificates(instanceName, instancePath);
            
            if (!sslEnabled) {
                throw new Error('SSL setup failed. Make sure mkcert is installed: brew install mkcert');
            }

            // Update docker-compose.yml to include SSL
            const envPath = path.join(instancePath, '.env');
            const envContent = await fs.readFile(envPath, 'utf-8');
            
            // Parse existing env values
            const envLines = envContent.split('\n');
            const envVars: { [key: string]: string } = {};
            
            envLines.forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key] = value;
                }
            });

            // Generate new configs with SSL
            const httpsPort = await this.findAvailablePort(parseInt(envVars.HTTP_PORT) + 100);
            
            const options: CreateInstanceOptions = {
                name: instanceName,
                phpVersion: envVars.PHP_VERSION || '8.1',
                mariadbVersion: envVars.MARIADB_VERSION || '10.11',
                autoInstall: false,
                importDump: false,
                webserverOnly: false
            };

            // Create Apache SSL config FIRST (before docker-compose to avoid directory creation)
            const apacheSSLConfig = this.generateApacheSSLConfig(instanceName, options.releaseType || 'standard');
            const apacheSslPath = path.join(instancePath, 'apache-ssl.conf');
            
            // Ensure no directory exists at this path
            try {
                const stat = await fs.stat(apacheSslPath);
                if (stat.isDirectory()) {
                    await fs.rm(apacheSslPath, { recursive: true, force: true });
                    this.log(`🔧 Removed existing apache-ssl.conf directory`);
                }
            } catch {
                // File doesn't exist, which is fine
            }
            
            await fs.writeFile(apacheSslPath, apacheSSLConfig);
            this.log(`✅ Created apache-ssl.conf file`);

            // Regenerate docker-compose with SSL
            const dockerComposeContent = this.generateDockerCompose(options, envVars.DB_PASSWORD, envVars.DB_ROOT_PASSWORD, parseInt(envVars.HTTP_PORT), httpsPort, true);
            await fs.writeFile(path.join(instancePath, 'docker-compose.yml'), dockerComposeContent);
            
            // Update .env file
            const newEnvContent = this.generateEnvFile(options, envVars.DB_PASSWORD, envVars.DB_ROOT_PASSWORD, parseInt(envVars.HTTP_PORT), httpsPort, true);
            await fs.writeFile(envPath, newEnvContent);

            // Restart the instance to apply SSL config
            const isRunning = await this.isInstanceRunning(instanceName);
            if (isRunning) {
                await this.stopInstance(instanceName);
                await this.startInstance(instanceName);
            }

        } catch (error: any) {
            throw new Error(`Failed to setup SSL: ${error.message}`);
        }
    }

    async repairInstance(instanceName: string): Promise<void> {
        try {
            this.log(`🔧 Starting repair for instance: ${instanceName}`);
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if instance directory exists
            try {
                await fs.access(instancePath);
                this.log(`✅ Instance directory found: ${instancePath}`);
            } catch {
                throw new Error(`Instance directory not found: ${instancePath}`);
            }
            
            // Read .env file to get RELEASE_TYPE
            let releaseType = 'standard';
            try {
                const envContent = await fs.readFile(path.join(instancePath, '.env'), 'utf-8');
                const releaseTypeMatch = envContent.match(/^RELEASE_TYPE=(.*)$/m);
                if (releaseTypeMatch) {
                    releaseType = releaseTypeMatch[1];
                }
            } catch {
                // Default to standard if can't read .env
            }
            
            // Check and fix apache-ssl.conf
            const apacheSslPath = path.join(instancePath, 'apache-ssl.conf');
            try {
                const stat = await fs.stat(apacheSslPath);
                if (stat.isDirectory()) {
                    this.log(`🚨 Found directory instead of file: apache-ssl.conf - fixing...`);
                    await fs.rm(apacheSslPath, { recursive: true, force: true });
                    
                    // Create proper apache-ssl.conf file with correct releaseType
                    const apacheSSLConfig = this.generateApacheSSLConfig(instanceName, releaseType);
                    await fs.writeFile(apacheSslPath, apacheSSLConfig);
                    this.log(`✅ Created proper apache-ssl.conf file`);
                }
            } catch (error: any) {
                if (error.code === 'ENOENT') {
                    // File doesn't exist - check if SSL should be there
                    const dockerComposePath = path.join(instancePath, 'docker-compose.yml');
                    try {
                        const dockerComposeContent = await fs.readFile(dockerComposePath, 'utf-8');
                        if (dockerComposeContent.includes('apache-ssl.conf')) {
                            this.log(`📝 Creating missing apache-ssl.conf file...`);
                            const apacheSSLConfig = this.generateApacheSSLConfig(instanceName, releaseType);
                            await fs.writeFile(apacheSslPath, apacheSSLConfig);
                            this.log(`✅ Created apache-ssl.conf file`);
                        }
                    } catch {
                        this.log(`⚠️  Could not read docker-compose.yml`);
                    }
                } else {
                    // Any other error - try to force remove and recreate
                    this.log(`⚠️  Apache SSL config issue: ${error.message} - attempting to fix...`);
                    try {
                        await fs.rm(apacheSslPath, { recursive: true, force: true });
                        const apacheSSLConfig = this.generateApacheSSLConfig(instanceName, releaseType);
                        await fs.writeFile(apacheSslPath, apacheSSLConfig);
                        this.log(`✅ Force-recreated apache-ssl.conf file`);
                    } catch (fixError: any) {
                        this.log(`❌ Could not fix apache-ssl.conf: ${fixError.message}`);
                    }
                }
            }
            
            // Check SSL certificates
            const sslDir = path.join(instancePath, 'ssl');
            try {
                await fs.access(sslDir);
                this.log(`✅ SSL directory exists`);
                
                const certFile = path.join(sslDir, `${instanceName}.local.pem`);
                const keyFile = path.join(sslDir, `${instanceName}.local-key.pem`);
                
                try {
                    await fs.access(certFile);
                    await fs.access(keyFile);
                    this.log(`✅ SSL certificates exist`);
                } catch {
                    this.log(`🔒 SSL certificates missing - attempting to recreate...`);
                    try {
                        await this.setupSSLCertificates(instanceName, instancePath);
                        this.log(`✅ SSL certificates recreated`);
                    } catch (sslError) {
                        this.log(`⚠️  Could not recreate SSL certificates: ${sslError}`);
                    }
                }
            } catch {
                this.log(`ℹ️  No SSL directory found - this is OK for non-SSL instances`);
            }
            
            // Check other required files
            const requiredFiles = [
                'docker-compose.yml',
                '.env',
                'custom-setup.sh'
            ];
            
            for (const file of requiredFiles) {
                const filePath = path.join(instancePath, file);
                try {
                    await fs.access(filePath);
                    this.log(`✅ Found required file: ${file}`);
                } catch {
                    this.log(`❌ Missing required file: ${file}`);
                    throw new Error(`Required file missing: ${file}`);
                }
            }
            
            // Check data directories
            const requiredDirs = [
                'data',
                'data/mysql', 
                'data/redaxo',
                'mysql-init'
            ];
            
            for (const dir of requiredDirs) {
                const dirPath = path.join(instancePath, dir);
                try {
                    await fs.access(dirPath);
                    this.log(`✅ Found required directory: ${dir}`);
                } catch {
                    this.log(`📁 Creating missing directory: ${dir}`);
                    await fs.mkdir(dirPath, { recursive: true });
                }
            }
            
            this.log(`🎉 Instance ${instanceName} repair completed successfully`);
            
        } catch (error) {
            this.log(`❌ Failed to repair instance ${instanceName}: ${error}`);
            throw error;
        }
    }

    private async isSSLConfigured(instancePath: string): Promise<boolean> {
        try {
            // Check if SSL directory exists
            const sslDir = path.join(instancePath, 'ssl');
            await fs.access(sslDir);
            
            // Check if docker-compose.yml includes HTTPS port
            const dockerComposePath = path.join(instancePath, 'docker-compose.yml');
            const dockerComposeContent = await fs.readFile(dockerComposePath, 'utf-8');
            
            return dockerComposeContent.includes(':443') && dockerComposeContent.includes('apache-ssl.conf');
        } catch {
            return false;
        }
    }

    private parseEnvFile(content: string): Record<string, string> {
        const envVars: Record<string, string> = {};
        
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
                    envVars[key.trim()] = value.trim();
                }
            }
        }
        
        return envVars;
    }

    async updateHostsFile(instanceName: string): Promise<void> {
        try {
            this.log(`🌐 Opening terminal to add ${instanceName}.local to hosts file...`);
            
            // We can't use sudo directly from Node.js without a terminal
            // So we'll throw an error to trigger the manual instructions
            throw new Error('Terminal required for sudo password');
            
        } catch (error) {
            this.log(`❌ Automatic hosts update requires terminal: ${error}`);
            throw new Error(`Hosts file update requires manual terminal access. Use the "Show Terminal Command" option instead.`);
        }
    }

    async getLoginInfo(instanceName: string): Promise<any> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            const envPath = path.join(instancePath, '.env');
            
            const envContent = await fs.readFile(envPath, 'utf-8');
            const envVars = this.parseEnvFile(envContent);
            
            const instance = await this.getInstance(instanceName);
            if (!instance) {
                throw new Error(`Instance ${instanceName} not found`);
            }
            
            return {
                instanceName,
                frontendUrl: instance.frontendUrl,
                backendUrl: instance.backendUrl,
                frontendUrlHttps: instance.frontendUrlHttps,
                backendUrlHttps: instance.backendUrlHttps,
                adminUser: envVars.REDAXO_ADMIN_USER || 'admin',
                adminPassword: envVars.REDAXO_ADMIN_PASSWORD || envVars.REDAXO_DB_PASSWORD,
                dbHost: envVars.REDAXO_DB_HOST || 'localhost',
                dbName: envVars.REDAXO_DB_NAME || 'redaxo',
                dbUser: envVars.REDAXO_DB_LOGIN || 'redaxo',
                dbPassword: envVars.REDAXO_DB_PASSWORD,
                phpVersion: envVars.PHP_VERSION || '8.1',
                mariadbVersion: envVars.MARIADB_VERSION || '10.11',
                running: instance.running
            };
            
        } catch (error) {
            this.log(`❌ Failed to get login info for ${instanceName}: ${error}`);
            throw error;
        }
    }
}
