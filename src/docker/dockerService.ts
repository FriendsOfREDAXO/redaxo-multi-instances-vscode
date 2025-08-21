import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { RedaxoInstance, CreateInstanceOptions, DatabaseInfo } from '../types/redaxo';
import { DockerComposeGenerator } from './dockerCompose';
import { SSLManager } from './sslManager';
import { PortManager } from './portManager';

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

    public async getInstancesDirectory(): Promise<string> {
        if (this.instancesDir) {
            return this.instancesDir;
        }

        const config = vscode.workspace.getConfiguration('redaxo-instances');
        let instancesPath = config.get<string>('instancesPath');
        
        if (!instancesPath) {
            // Always ask user to select instances directory
            const selectedPath = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Instances Folder',
                title: 'Choose folder for REDAXO instances',
                defaultUri: vscode.Uri.file(require('os').homedir())
            });

            if (!selectedPath || selectedPath.length === 0) {
                throw new Error('No instances folder selected. Please select a folder to store REDAXO instances.');
            }

            instancesPath = selectedPath[0].fsPath;
            
            // Save the path for future use
            await config.update('instancesPath', instancesPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Instances folder set to: ${instancesPath}`);
        }

        await fs.mkdir(instancesPath, { recursive: true });
        this.instancesDir = instancesPath;
        return instancesPath;
    }

    async changeInstancesDirectory(): Promise<string> {
        const selectedPath = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select New Instances Folder',
            title: 'Choose new folder for REDAXO instances',
            defaultUri: vscode.Uri.file(this.instancesDir || require('os').homedir())
        });

        if (!selectedPath || selectedPath.length === 0) {
            throw new Error('No folder selected. Instances path not changed.');
        }

        const newInstancesPath = selectedPath[0].fsPath;
        const config = vscode.workspace.getConfiguration('redaxo-instances');
        await config.update('instancesPath', newInstancesPath, vscode.ConfigurationTarget.Global);
        
        // Clear the cached directory path so it gets refreshed
        this.instancesDir = null;
        
        // Set the new path and create directory if needed
        this.instancesDir = newInstancesPath;
        await fs.mkdir(newInstancesPath, { recursive: true });
        
        vscode.window.showInformationMessage(`Instances folder changed to: ${newInstancesPath}`);
        
        return newInstancesPath;
    }

    async createInstance(options: CreateInstanceOptions): Promise<void> {
        try {
            this.log(`🚀 Creating REDAXO instance: ${options.name}`);
            this.log(`📋 Configuration: ${JSON.stringify(options, null, 2)}`);
            
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, options.name);
            
            // Check if instance already exists
            try {
                await fs.access(instancePath);
                throw new Error(`Instance '${options.name}' already exists`);
            } catch (error: any) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
            
            // Create instance directory
            await fs.mkdir(instancePath, { recursive: true });
            
            // Generate passwords and find available ports
            this.log(`🔍 Prüfe verfügbare Ports...`);
            PortManager.showPortUsage(); // Zeige aktuelle Port-Nutzung
            
            const dbRootPassword = PortManager.generateRandomPassword();
            const dbPassword = PortManager.generateRandomPassword(12);
            const [httpPort, httpsPort] = await PortManager.findAvailablePortRange();
            
            this.log(`🌐 Zugewiesene Ports - HTTP: ${httpPort}, HTTPS: ${httpsPort}`);
            
            // Setup SSL certificates
            this.log(`🔒 Setting up SSL certificates with mkcert...`);
            const sslEnabled = await SSLManager.setupSSLCertificates(options.name, instancePath);
            this.log(`🔒 SSL certificates ${sslEnabled ? 'created successfully' : 'not available (mkcert not found)'}`);
            
            // Create docker-compose.yml
            this.log(`⚙️  Creating Docker Compose configuration...`);
            const dockerComposeContent = DockerComposeGenerator.generate(options, dbPassword, dbRootPassword, httpPort, httpsPort, sslEnabled);
            await fs.writeFile(path.join(instancePath, 'docker-compose.yml'), dockerComposeContent);
            
            // Create .env file
            this.log(`📝 Creating environment configuration...`);
            const envContent = DockerComposeGenerator.generateEnvFile(options, dbPassword, dbRootPassword, httpPort, httpsPort, sslEnabled);
            await fs.writeFile(path.join(instancePath, '.env'), envContent);
            
            // Create data directories
            this.log(`📁 Setting up data directories...`);
            await fs.mkdir(path.join(instancePath, 'data'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'data', 'mysql'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'data', 'redaxo'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'mysql-init'), { recursive: true });
            
            // Create custom setup script for REDAXO auto-installation
            this.log(`🛠️  Creating REDAXO setup script...`);
            const customSetupContent = this.generateSetupScript(options);
            await fs.writeFile(path.join(instancePath, 'custom-setup.sh'), customSetupContent, { mode: 0o755 });
            
            // Pull Docker images first
            this.log(`🐳 Pulling required Docker images (this may take a while)...`);
            await this.runDockerCommand(['compose', 'pull'], { cwd: instancePath });
            
            this.log(`✅ Instance ${options.name} created successfully!`);
            vscode.window.showInformationMessage(`Instance ${options.name} created successfully! You can start it manually when ready.`);
            
            this.log(`🎯 Instance is ready to start. Use 'Start Instance' from the context menu when ready.`);
            this.log(`🎯 Note: The instance needs to be started manually to ensure all files are properly initialized.`);
            
        } catch (error) {
            console.error('DockerService: Error in createInstance:', error);
            this.log(`❌ Error creating instance: ${error}`);
            
            let errorMessage = 'Unknown error occurred';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            
            if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
                errorMessage += ' (Docker or required command not found)';
            }
            
            vscode.window.showErrorMessage(`Instance creation failed: ${errorMessage}`);
            throw new Error(`Instance creation failed: ${errorMessage}`);
        }
    }

    async startInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`🚀 Starting instance: ${instanceName}`);
            await this.runDockerCommand(['compose', 'up', '-d'], { cwd: instancePath });
            this.log(`✅ Instance ${instanceName} started successfully`);
            
            vscode.window.showInformationMessage(`Instance ${instanceName} started successfully!`);
        } catch (error: any) {
            this.log(`❌ Failed to start instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to start instance: ${error.message}`);
            throw error;
        }
    }

    async stopInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`🛑 Stopping instance: ${instanceName}`);
            await this.runDockerCommand(['compose', 'stop'], { cwd: instancePath });
            this.log(`✅ Instance ${instanceName} stopped successfully`);
            
            vscode.window.showInformationMessage(`Instance ${instanceName} stopped successfully!`);
        } catch (error: any) {
            this.log(`❌ Failed to stop instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to stop instance: ${error.message}`);
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

    async getInstance(instanceName: string): Promise<RedaxoInstance | null> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if instance exists
            try {
                await fs.access(instancePath);
            } catch {
                return null;
            }
            
            // Read configuration
            const configPath = path.join(instancePath, '.env');
            let config: any = {};
            
            try {
                const configContent = await fs.readFile(configPath, 'utf8');
                // Parse simple KEY=VALUE format
                configContent.split('\n').forEach(line => {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        config[key.trim()] = value.trim();
                    }
                });
            } catch {
                // Config file doesn't exist or can't be read
            }
            
            return {
                name: instanceName,
                path: instancePath,
                running: (await this.getInstanceStatus(instanceName)) === 'running',
                status: await this.getInstanceStatus(instanceName),
                phpVersion: config.PHP_VERSION || '8.2',
                mariadbVersion: config.MARIADB_VERSION || 'latest',
                port: parseInt(config.HTTP_PORT) || 8080,
                frontendUrl: config.BASE_URL || `http://localhost:${config.HTTP_PORT || 8080}`,
                backendUrl: config.BACKEND_URL || `http://localhost:${config.HTTP_PORT || 8080}/redaxo`,
                frontendUrlHttps: config.SSL_ENABLED === 'true' ? `https://${instanceName}.local:${config.HTTPS_PORT || 8443}` : undefined,
                backendUrlHttps: config.SSL_ENABLED === 'true' ? `https://${instanceName}.local:${config.HTTPS_PORT || 8443}/redaxo` : undefined
            };
        } catch (error) {
            console.error('Error getting instance:', error);
            return null;
        }
    }

    async getInstanceStatus(instanceName: string): Promise<'running' | 'stopped' | 'creating' | 'error' | undefined> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if docker-compose.yml exists first
            const dockerComposePath = path.join(instancePath, 'docker-compose.yml');
            try {
                await fs.access(dockerComposePath);
            } catch {
                // docker-compose.yml doesn't exist, instance not fully created yet
                return 'stopped';
            }
            
            const result = await this.runDockerCommand(['compose', 'ps', '--services', '--filter', 'status=running'], { cwd: instancePath });
            return result.trim().length > 0 ? 'running' : 'stopped';
        } catch (error: any) {
            this.log(`⚠️ Error checking status for ${instanceName}: ${error.message}`);
            return 'error';
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

    async getDatabaseInfo(instanceName: string): Promise<DatabaseInfo | null> {
        try {
            const instance = await this.getInstance(instanceName);
            if (!instance) {
                return null;
            }

            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            const configPath = path.join(instancePath, '.env');
            
            let config: any = {};
            try {
                const configContent = await fs.readFile(configPath, 'utf8');
                configContent.split('\n').forEach(line => {
                    const [key, value] = line.split('=');
                    if (key && value) {
                        config[key.trim()] = value.trim();
                    }
                });
            } catch {
                return null;
            }

            return {
                host: config.DB_HOST || 'mysql',
                database: config.DB_NAME || 'redaxo',
                user: config.DB_USER || 'redaxo',
                password: config.DB_PASSWORD || '',
                rootPassword: config.DB_ROOT_PASSWORD || ''
            };
        } catch (error) {
            console.error('Error getting database info:', error);
            return null;
        }
    }

    async checkDockerInstallation(): Promise<boolean> {
        try {
            await this.runDockerCommand(['--version']);
            return true;
        } catch {
            return false;
        }
    }

    async getLoginInfo(instanceName: string): Promise<any> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Check if instance is running
            const status = await this.getInstanceStatus(instanceName);
            const isRunning = status === 'running';
            
            // Read .env file
            const envPath = path.join(instancePath, '.env');
            const envContent = await fs.readFile(envPath, 'utf8');
            
            // Parse environment variables
            const envVars: any = {};
            envContent.split('\n').forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) {
                    envVars[key.trim()] = value.trim();
                }
            });
            
            // Read docker-compose.yml to get port information
            const composePath = path.join(instancePath, 'docker-compose.yml');
            const composeContent = await fs.readFile(composePath, 'utf8');
            
            // Extract ports from docker-compose
            const httpPortMatch = composeContent.match(/"(\d+):80"/);
            const httpsPortMatch = composeContent.match(/"(\d+):443"/);
            
            const httpPort = httpPortMatch ? httpPortMatch[1] : '80';
            const httpsPort = httpsPortMatch ? httpsPortMatch[1] : '443';
            
            // Build URLs
            const sslEnabled = envVars.SSL_ENABLED === 'true';
            const frontendUrl = `http://localhost:${httpPort}`;
            const backendUrl = `http://localhost:${httpPort}/redaxo`;
            let frontendUrlHttps = null;
            let backendUrlHttps = null;
            
            if (sslEnabled) {
                frontendUrlHttps = `https://${instanceName}.local:${httpsPort}`;
                backendUrlHttps = `https://${instanceName}.local:${httpsPort}/redaxo`;
            }
            
            return {
                running: isRunning,
                instanceName: instanceName,
                
                // URLs
                frontendUrl,
                backendUrl,
                frontendUrlHttps,
                backendUrlHttps,
                
                // Login credentials
                adminUser: 'admin',
                adminPassword: envVars.DB_PASSWORD || envVars.MYSQL_PASSWORD || 'N/A',
                
                // Database info
                dbHost: envVars.DB_HOST || 'mysql',
                dbName: envVars.DB_NAME || 'redaxo',
                dbUser: envVars.DB_USER || 'redaxo',
                dbPassword: envVars.DB_PASSWORD || envVars.MYSQL_PASSWORD || 'N/A',
                
                // System info
                phpVersion: envVars.PHP_VERSION || 'N/A',
                mariadbVersion: envVars.MARIADB_VERSION || 'N/A',
                releaseType: envVars.RELEASE_TYPE || 'standard',
                httpPort,
                httpsPort: sslEnabled ? httpsPort : null,
                sslEnabled
            };
            
        } catch (error: any) {
            this.log(`❌ Failed to get login info: ${error.message}`);
            throw error;
        }
    }

    async importDump(instanceName: string, dumpPath: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`📥 Importing dump for instance: ${instanceName}`);
            
            // Copy dump file to mysql-init directory
            const mysqlInitPath = path.join(instancePath, 'mysql-init');
            const dumpFileName = path.basename(dumpPath);
            const targetDumpPath = path.join(mysqlInitPath, dumpFileName);
            
            await fs.copyFile(dumpPath, targetDumpPath);
            
            this.log(`✅ Dump imported successfully for ${instanceName}`);
            vscode.window.showInformationMessage(`Dump imported successfully! Restart the instance to apply changes.`);
        } catch (error: any) {
            this.log(`❌ Failed to import dump: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to import dump: ${error.message}`);
            throw error;
        }
    }

    async setupInstanceSSL(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Read release type from .env file
            const configPath = path.join(instancePath, '.env');
            let releaseType = 'standard';
            try {
                const configContent = await fs.readFile(configPath, 'utf8');
                const releaseMatch = configContent.match(/RELEASE_TYPE=(.+)/);
                if (releaseMatch) {
                    releaseType = releaseMatch[1].trim();
                }
            } catch {
                // Default to standard if can't read config
            }
            
            this.log(`🔒 Setting up SSL for instance: ${instanceName}`);
            const sslEnabled = await SSLManager.setupSSLCertificates(instanceName, instancePath, releaseType);
            
            if (sslEnabled) {
                this.log(`✅ SSL setup completed for ${instanceName}`);
                vscode.window.showInformationMessage(`SSL certificates created successfully for ${instanceName}!`);
            } else {
                this.log(`❌ SSL setup failed for ${instanceName}`);
                vscode.window.showWarningMessage(`SSL setup failed. Make sure mkcert is installed.`);
            }
        } catch (error: any) {
            this.log(`❌ Failed to setup SSL: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to setup SSL: ${error.message}`);
            throw error;
        }
    }

    async repairInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`🔧 Repairing instance: ${instanceName}`);
            
            // Rebuild containers
            await this.runDockerCommand(['compose', 'build', '--no-cache'], { cwd: instancePath });
            await this.runDockerCommand(['compose', 'up', '-d', '--force-recreate'], { cwd: instancePath });
            
            this.log(`✅ Instance ${instanceName} repaired successfully`);
            vscode.window.showInformationMessage(`Instance ${instanceName} repaired successfully!`);
        } catch (error: any) {
            this.log(`❌ Failed to repair instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to repair instance: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate setup script for a REDAXO instance
     */
    private generateSetupScript(options: CreateInstanceOptions): string {
        return `#!/bin/bash
# REDAXO Instance Setup Script for ${options.name}

# Check if setup already completed
if [ -f "/tmp/setup-complete.flag" ]; then
    echo "✅ Setup already completed - skipping"
    exit 0
fi

echo "🚀 Setting up REDAXO instance: ${options.name}"

# Setup Apache configuration (both HTTP and HTTPS)
echo "🌐 Setting up Apache configuration..."
a2enmod rewrite

# Setup SSL configuration if available
if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
    echo "🔒 Setting up SSL configuration..."
    # Copy SSL config to Apache sites-available
    cp /usr/local/bin/apache-ssl.conf /etc/apache2/sites-available/default-ssl.conf
    # Enable SSL modules and site
    a2enmod ssl
    a2ensite default-ssl
    echo "✅ SSL configuration prepared"
    echo "🌐 Website will be available at: https://${options.name}.local"
else
    echo "🌐 Website will be available at: http://localhost"
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

${options.autoInstall ? `
# Standard REDAXO Setup - using Docker image
echo "✅ Using standard REDAXO from Docker image"

${this.generateAutoInstallScript(options)}` : `
# Empty instance setup - removing pre-installed REDAXO
echo "🗑️ Creating empty instance (removing pre-installed REDAXO)"
rm -rf /var/www/html/*
echo "📁 Creating basic web directory structure"
mkdir -p /var/www/html
echo "<?php phpinfo(); ?>" > /var/www/html/index.php
echo "✅ Empty web instance ready"
`}

# Mark setup as complete
touch /tmp/setup-complete.flag

echo "✅ Instance setup complete!"
`;
    }

    /**
     * Generate auto-install script for REDAXO
     */
    private generateAutoInstallScript(options: CreateInstanceOptions): string {
        return `
# Auto-install REDAXO Standard Structure
if [ ! -f "/var/www/html/redaxo/data/config.yml" ]; then
    echo "⚙️ Auto-installing REDAXO Standard Structure..."
    
    # Create REDAXO configuration for Standard Structure
    php /var/www/html/redaxo/bin/console setup:run \\
        --agree-license \\
        --db-host=mysql \\
        --db-name=redaxo \\
        --db-login=redaxo \\
        --db-password=\${MYSQL_PASSWORD} \\
        --db-setup=normal \\
        --admin-username=admin \\
        --admin-password=\${MYSQL_PASSWORD} \\
        --server-name="\${INSTANCE_NAME}.local" \\
        --error-email="admin@\${INSTANCE_NAME}.local" \\
        --timezone="Europe/Berlin" \\
        --lang=de_de
    
    if [ $? -eq 0 ]; then
        echo "✅ REDAXO Standard Structure auto-installation complete"
        echo ""
        echo "🔑 LOGIN INFORMATIONEN:"
        echo "👤 Benutzername: admin"
        echo "🔒 Passwort: \${MYSQL_PASSWORD}"
        echo ""
        if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
            echo "🌐 Backend URL: https://${options.name}.local/redaxo"
            echo "🌐 Frontend URL: https://${options.name}.local"
        else
            echo "🌐 Backend URL: http://localhost:\${HTTP_PORT}/redaxo"  
            echo "🌐 Frontend URL: http://localhost:\${HTTP_PORT}"
        fi
        echo ""
    else
        echo "❌ REDAXO auto-installation failed"
    fi
else
    echo "✅ REDAXO Standard Structure already configured"
    echo ""
    echo "🔑 LOGIN INFORMATIONEN:"
    echo "👤 Benutzername: admin"  
    echo "🔒 Passwort: \${MYSQL_PASSWORD}"
    echo ""
    if [ -f "/usr/local/bin/apache-ssl.conf" ]; then
        echo "🌐 Backend URL: https://${options.name}.local/redaxo"
        echo "🌐 Frontend URL: https://${options.name}.local"
    else
        echo "🌐 Backend URL: http://localhost:\${HTTP_PORT}/redaxo"
        echo "🌐 Frontend URL: http://localhost:\${HTTP_PORT}"
    fi
    echo ""
fi
`;
    }
}
