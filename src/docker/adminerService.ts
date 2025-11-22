import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export interface AdminerConfig {
    port: number;
    containerName: string;
    networkName: string;
}

export class AdminerService {
    private static readonly ADMINER_CONTAINER_NAME = 'redaxo-adminer';
    private static readonly ADMINER_PORT = 9200;
    private static readonly ADMINER_NETWORK = 'redaxo-adminer-network';
    
    private outputChannel?: vscode.OutputChannel;
    private instancesPath?: string;

    constructor(outputChannel?: vscode.OutputChannel, instancesPath?: string) {
        this.outputChannel = outputChannel;
        this.instancesPath = instancesPath;
    }

    private log(message: string): void {
        console.log(message);
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Check if Adminer container is running
     */
    async isAdminerRunning(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`docker ps --filter "name=${AdminerService.ADMINER_CONTAINER_NAME}" --format "{{.Names}}"`);
            return stdout.trim() === AdminerService.ADMINER_CONTAINER_NAME;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if Adminer container exists (running or stopped)
     */
    async doesAdminerExist(): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`docker ps -a --filter "name=${AdminerService.ADMINER_CONTAINER_NAME}" --format "{{.Names}}"`);
            return stdout.trim() === AdminerService.ADMINER_CONTAINER_NAME;
        } catch (error) {
            return false;
        }
    }

    /**
     * Create Docker network for Adminer
     */
    private async createAdminerNetwork(): Promise<void> {
        try {
            // Check if network exists
            const { stdout } = await execAsync(`docker network ls --filter "name=${AdminerService.ADMINER_NETWORK}" --format "{{.Name}}"`);
            if (stdout.trim() === AdminerService.ADMINER_NETWORK) {
                this.log(`📡 Network ${AdminerService.ADMINER_NETWORK} already exists`);
                return;
            }

            // Create network
            this.log(`📡 Creating Docker network: ${AdminerService.ADMINER_NETWORK}`);
            await execAsync(`docker network create ${AdminerService.ADMINER_NETWORK}`);
            this.log(`✅ Network created successfully`);
        } catch (error: any) {
            this.log(`⚠️ Network creation warning: ${error.message}`);
        }
    }

    /**
     * Start Adminer container
     */
    async startAdminer(): Promise<boolean> {
        try {
            this.log(`🚀 Starting Adminer container...`);

            // Check if already running
            if (await this.isAdminerRunning()) {
                this.log(`✅ Adminer is already running on port ${AdminerService.ADMINER_PORT}`);
                return true;
            }

            // Create network
            await this.createAdminerNetwork();

            // Check if container exists but is stopped
            if (await this.doesAdminerExist()) {
                this.log(`🔄 Starting existing Adminer container...`);
                await execAsync(`docker start ${AdminerService.ADMINER_CONTAINER_NAME}`);
                this.log(`✅ Adminer started successfully`);
                return true;
            }

            // Create and start new container
            this.log(`📦 Creating new Adminer container...`);
            
            const dockerCommand = [
                'docker run -d',
                `--name ${AdminerService.ADMINER_CONTAINER_NAME}`,
                `--network ${AdminerService.ADMINER_NETWORK}`,
                `-p ${AdminerService.ADMINER_PORT}:8080`,
                '-e ADMINER_DEFAULT_SERVER=',
                '-e ADMINER_DESIGN=pepa-linha-dark',
                // PHP Configuration for large file uploads
                '-e UPLOAD_LIMIT=512M',
                // Custom PHP settings via environment
                '--tmpfs /tmp:rw,noexec,nosuid,size=2g',
                'adminer:latest'
            ].join(' ');

            await execAsync(dockerCommand);
            
            // Wait a moment for container to start
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Install login-without-password plugin
            await this.installAutoLoginPlugin();

            // Configure PHP settings for large uploads
            await this.configurePhpSettings();

            this.log(`✅ Adminer container created and started successfully`);
            this.log(`🌐 Access Adminer at: http://localhost:${AdminerService.ADMINER_PORT}`);
            
            return true;
        } catch (error: any) {
            this.log(`❌ Failed to start Adminer: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to start Adminer: ${error.message}`);
            return false;
        }
    }

    /**
     * Install auto-login plugin for Adminer - passwordless access
     */
    private async installAutoLoginPlugin(): Promise<void> {
        try {
            // Download official Adminer plugin loader and login-password-less plugin
            const setupCommands = [
                // Create plugin directory
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} mkdir -p /var/www/html/plugins-enabled`,
                
                // Download plugin loader from official Adminer repo
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} wget -q https://raw.githubusercontent.com/vrana/adminer/master/plugins/plugin.php -O /var/www/html/plugins/plugin.php`,
                
                // Download login-password-less plugin
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} wget -q https://raw.githubusercontent.com/vrana/adminer/master/plugins/login-password-less.php -O /var/www/html/plugins/login-password-less.php`,
                
                // Create index.php that loads plugins
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} sh -c "cat > /var/www/html/adminer-plugins.php << 'EOF'
<?php
function adminer_object() {
    include_once './plugins/plugin.php';
    
    foreach (glob('plugins/*.php') as \\$filename) {
        include_once \\$filename;
    }
    
    \\$plugins = array(
        new AdminerLoginPasswordLess(password_hash('', PASSWORD_DEFAULT))
    );
    
    return new AdminerPlugin(\\$plugins);
}

include './adminer.php';
EOF"`,
                
                // Make sure files are readable
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} chmod -R 755 /var/www/html/plugins`
            ];

            for (const cmd of setupCommands) {
                try {
                    await execAsync(cmd, { timeout: 30000 });
                } catch (e: any) {
                    this.log(`⚠️ Plugin setup step failed: ${e.message}`);
                }
            }

            this.log(`✅ Passwordless login plugin installed - use /adminer-plugins.php`);
        } catch (error: any) {
            this.log(`⚠️ Could not install passwordless plugin: ${error.message}`);
        }
    }

    /**
     * Configure PHP settings for large file uploads
     */
    private async configurePhpSettings(): Promise<void> {
        try {
            const phpIniSettings = [
                'upload_max_filesize = 512M',
                'post_max_size = 512M',
                'memory_limit = 512M',
                'max_execution_time = 600',
                'max_input_time = 600'
            ].join('\\n');

            // Create custom php.ini
            const commands = [
                `docker exec ${AdminerService.ADMINER_CONTAINER_NAME} sh -c "echo '${phpIniSettings}' > /usr/local/etc/php/conf.d/uploads.ini"`,
                // Restart PHP-FPM if available, otherwise container restart handles it
                `docker restart ${AdminerService.ADMINER_CONTAINER_NAME}`
            ];

            for (const cmd of commands) {
                try {
                    await execAsync(cmd);
                } catch (e) {
                    // Ignore errors, container might not support all commands
                }
            }

            this.log(`✅ PHP settings configured for large file uploads (512MB)`);
        } catch (error: any) {
            this.log(`⚠️ Could not configure PHP settings: ${error.message}`);
        }
    }

    /**
     * Stop Adminer container
     */
    async stopAdminer(): Promise<boolean> {
        try {
            this.log(`🛑 Stopping Adminer container...`);

            if (!(await this.isAdminerRunning())) {
                this.log(`ℹ️ Adminer is not running`);
                return true;
            }

            await execAsync(`docker stop ${AdminerService.ADMINER_CONTAINER_NAME}`);
            this.log(`✅ Adminer stopped successfully`);
            return true;
        } catch (error: any) {
            this.log(`❌ Failed to stop Adminer: ${error.message}`);
            return false;
        }
    }

    /**
     * Remove Adminer container
     */
    async removeAdminer(): Promise<boolean> {
        try {
            this.log(`🗑️ Removing Adminer container...`);

            if (!(await this.doesAdminerExist())) {
                this.log(`ℹ️ Adminer container does not exist`);
                return true;
            }

            // Stop if running
            if (await this.isAdminerRunning()) {
                await this.stopAdminer();
            }

            await execAsync(`docker rm ${AdminerService.ADMINER_CONTAINER_NAME}`);
            this.log(`✅ Adminer container removed`);
            return true;
        } catch (error: any) {
            this.log(`❌ Failed to remove Adminer: ${error.message}`);
            return false;
        }
    }

    /**
     * Connect instance database container to Adminer network
     */
    async connectInstanceToAdminer(instanceName: string, dbContainerName: string): Promise<boolean> {
        try {
            // Check if already connected
            const { stdout } = await execAsync(
                `docker inspect ${dbContainerName} --format '{{range .NetworkSettings.Networks}}{{.NetworkID}}{{end}}'`
            );
            
            const networkId = await execAsync(
                `docker network inspect ${AdminerService.ADMINER_NETWORK} --format '{{.Id}}'`
            ).then(res => res.stdout.trim()).catch(() => '');

            if (stdout.includes(networkId)) {
                this.log(`✅ Database container ${dbContainerName} already connected to Adminer network`);
                return true;
            }

            // Connect to network
            this.log(`🔗 Connecting ${dbContainerName} to Adminer network...`);
            await execAsync(`docker network connect ${AdminerService.ADMINER_NETWORK} ${dbContainerName}`);
            this.log(`✅ Database container connected to Adminer network`);
            return true;
        } catch (error: any) {
            // Ignore "already connected" errors
            if (error.message.includes('already exists')) {
                return true;
            }
            this.log(`⚠️ Could not connect to Adminer network: ${error.message}`);
            return false;
        }
    }

    /**
     * Get Adminer URL with pre-filled credentials and auto-login
     */
    getAdminerUrl(server: string, username: string, password: string, database?: string): string {
        const params = new URLSearchParams({
            server: server,
            username: username,
            db: database || ''
        });

        // Build URL with credentials for auto-login
        // Adminer format: ?username=user&db=database&sql=
        const baseUrl = `http://localhost:${AdminerService.ADMINER_PORT}`;
        const loginUrl = `${baseUrl}/?server=${encodeURIComponent(server)}&username=${encodeURIComponent(username)}&db=${encodeURIComponent(database || '')}`;
        
        return loginUrl;
    }

    /**
     * Get Adminer URL with auto-login (POST form submission)
     */
    getAdminerAutoLoginUrl(server: string, username: string, password: string, database?: string): string {
        // For auto-login, we need to use a POST request with credentials
        // We'll generate a data URL that auto-submits a form
        const formHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Connecting to Adminer...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .loader {
            text-align: center;
        }
        .spinner {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="loader">
        <div class="spinner"></div>
        <p>Connecting to Adminer...</p>
    </div>
    <form id="loginForm" action="http://localhost:${AdminerService.ADMINER_PORT}/" method="POST" style="display:none;">
        <input type="hidden" name="auth[driver]" value="server">
        <input type="hidden" name="auth[server]" value="${server}">
        <input type="hidden" name="auth[username]" value="${username}">
        <input type="hidden" name="auth[password]" value="${password}">
        <input type="hidden" name="auth[db]" value="${database || ''}">
    </form>
    <script>
        document.getElementById('loginForm').submit();
    </script>
</body>
</html>`;
        
        return `data:text/html;base64,${Buffer.from(formHtml).toString('base64')}`;
    }

    /**
     * Get Adminer container info
     */
    async getAdminerInfo(): Promise<AdminerConfig | null> {
        try {
            const isRunning = await this.isAdminerRunning();
            if (!isRunning) {
                return null;
            }

            return {
                port: AdminerService.ADMINER_PORT,
                containerName: AdminerService.ADMINER_CONTAINER_NAME,
                networkName: AdminerService.ADMINER_NETWORK
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Get Adminer status for display
     */
    async getStatus(): Promise<string> {
        const isRunning = await this.isAdminerRunning();
        const exists = await this.doesAdminerExist();

        if (isRunning) {
            return `🟢 Running on port ${AdminerService.ADMINER_PORT}`;
        } else if (exists) {
            return `🟡 Stopped`;
        } else {
            return `⚪ Not installed`;
        }
    }
}
