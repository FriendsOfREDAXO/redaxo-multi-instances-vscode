import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as https from 'https';
import { RedaxoInstance, CreateInstanceOptions, DDEVProjectInfo, DDEVConfig } from '../types/redaxo';

const execPromise = promisify(exec);

export class DDEVService {
    private ddevPath: string;
    private instancesDir: string | null = null;
    private outputChannel?: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.ddevPath = vscode.workspace.getConfiguration('redaxo-instances').get('ddevPath', 'ddev');
        this.outputChannel = outputChannel;
    }

    private log(message: string): void {
        console.log(message);
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    private async runDDEVCommand(args: string[], options?: { cwd?: string }): Promise<string> {
        const command = `${this.ddevPath} ${args.join(' ')}`;
        this.log(`🐳 Running DDEV command: ${command}`);
        this.log(`📁 Working directory: ${options?.cwd || 'default'}`);
        
        try {
            const { stdout, stderr } = await execPromise(command, options);
            const stderrStr = stderr?.toString() || '';
            const stdoutStr = stdout?.toString() || '';
            
            if (stderrStr && stderrStr.trim()) {
                this.log(`⚠️  DDEV stderr: ${stderrStr}`);
            }
            if (stdoutStr && stdoutStr.trim()) {
                this.log(`✅ DDEV command completed successfully`);
            }
            return stdoutStr;
        } catch (error) {
            this.log(`❌ DDEV command failed: ${command}`);
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

    async checkDDEVAvailability(): Promise<boolean> {
        try {
            await this.runDDEVCommand(['version']);
            return true;
        } catch (error) {
            this.log(`DDEV not available: ${error}`);
            return false;
        }
    }

    private async downloadRedaxoRelease(url: string, targetPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(targetPath);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (error) => {
                reject(error);
            });
        });
    }

    private async extractZip(zipPath: string, extractPath: string): Promise<void> {
        try {
            // Use unzip command (available on most systems)
            await execPromise(`unzip -q "${zipPath}" -d "${extractPath}"`);
        } catch (error) {
            this.log(`Failed to extract with unzip, trying alternative method: ${error}`);
            // Fallback: try with 7zip if available
            try {
                await execPromise(`7z x "${zipPath}" -o"${extractPath}" -y`);
            } catch (altError) {
                throw new Error(`Failed to extract ZIP file: ${altError}`);
            }
        }
    }

    private async getLatestRedaxoVersion(): Promise<string> {
        // This would ideally fetch from GitHub API, but for simplicity, we'll use a hardcoded recent version
        // In a production environment, you'd want to fetch from: https://api.github.com/repos/redaxo/redaxo/releases/latest
        return '5.17.1';
    }

    private async getLatestModernRedaxoVersion(): Promise<string> {
        // Similarly for modern structure
        // In production: https://api.github.com/repos/skerbis/REDAXO_MODERN_STRUCTURE/releases/latest
        return '5.20.0';
    }

    async createInstance(options: CreateInstanceOptions): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, options.name);
            
            this.log(`🚀 Creating DDEV instance: ${options.name}`);
            this.log(`📁 Instance path: ${instancePath}`);

            // Create instance directory
            await fs.mkdir(instancePath, { recursive: true });

            // Download and extract REDAXO
            await this.downloadAndSetupRedaxo(instancePath, options);

            // Generate DDEV configuration
            await this.generateDDEVConfig(instancePath, options);

            // Start DDEV project
            await this.runDDEVCommand(['start'], { cwd: instancePath });

            this.log(`✅ DDEV instance ${options.name} created successfully`);
            vscode.window.showInformationMessage(`DDEV instance ${options.name} created successfully!`);

        } catch (error: any) {
            this.log(`❌ Failed to create DDEV instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to create DDEV instance: ${error.message}`);
            throw error;
        }
    }

    private async downloadAndSetupRedaxo(instancePath: string, options: CreateInstanceOptions): Promise<void> {
        const zipPath = path.join(instancePath, 'redaxo.zip');
        let downloadUrl: string;

        if (options.redaxoStructure === 'modern') {
            // Modern structure with public folder
            const version = await this.getLatestModernRedaxoVersion();
            downloadUrl = `https://github.com/skerbis/REDAXO_MODERN_STRUCTURE/releases/download/redaxo-setup-${version}-202509051009/redaxo-setup-${version}.zip`;
        } else {
            // Classic structure
            const version = await this.getLatestRedaxoVersion();
            downloadUrl = `https://github.com/redaxo/redaxo/releases/download/${version}/redaxo_${version}.zip`;
        }

        this.log(`📥 Downloading REDAXO from: ${downloadUrl}`);
        await this.downloadRedaxoRelease(downloadUrl, zipPath);

        this.log(`📦 Extracting REDAXO...`);
        await this.extractZip(zipPath, instancePath);

        // Clean up zip file
        await fs.unlink(zipPath);

        // For modern structure, we need to move files around appropriately
        if (options.redaxoStructure === 'modern') {
            await this.setupModernStructure(instancePath);
        } else {
            await this.setupClassicStructure(instancePath);
        }
    }

    private async setupModernStructure(instancePath: string): Promise<void> {
        // Modern structure should already have the right layout
        // Just ensure we have the public folder as docroot
        const publicPath = path.join(instancePath, 'public');
        try {
            await fs.access(publicPath);
            this.log(`✅ Modern structure with public folder confirmed`);
        } catch {
            this.log(`⚠️  Public folder not found, creating modern structure...`);
            // If public folder doesn't exist, we might need to restructure
            // This is a simplified approach - in production you'd want more robust handling
        }
    }

    private async setupClassicStructure(instancePath: string): Promise<void> {
        // Classic structure - files are typically in the root
        // Ensure index.php exists in the root
        const indexPath = path.join(instancePath, 'index.php');
        try {
            await fs.access(indexPath);
            this.log(`✅ Classic structure confirmed`);
        } catch {
            this.log(`⚠️  index.php not found in root, checking subdirectories...`);
            // Sometimes the ZIP extracts to a subdirectory, we need to move files up
            const entries = await fs.readdir(instancePath, { withFileTypes: true });
            const subDir = entries.find(entry => entry.isDirectory() && entry.name.startsWith('redaxo'));
            if (subDir) {
                const subDirPath = path.join(instancePath, subDir.name);
                const files = await fs.readdir(subDirPath);
                for (const file of files) {
                    await fs.rename(
                        path.join(subDirPath, file),
                        path.join(instancePath, file)
                    );
                }
                await fs.rmdir(subDirPath);
                this.log(`✅ Files moved from subdirectory ${subDir.name}`);
            }
        }
    }

    private async generateDDEVConfig(instancePath: string, options: CreateInstanceOptions): Promise<void> {
        const localDomain = options.localDomain || `${options.name}.ddev.site`;
        const docroot = options.redaxoStructure === 'modern' ? 'public' : '.';

        const ddevConfig: DDEVConfig = {
            name: options.name,
            type: 'php',
            docroot: docroot,
            php_version: options.phpVersion,
            database: {
                type: 'mariadb',
                version: this.mapMariaDbVersion(options.mariadbVersion)
            },
            use_dns_when_possible: true,
            additional_hostnames: [localDomain]
        };

        const configPath = path.join(instancePath, '.ddev', 'config.yaml');
        await fs.mkdir(path.dirname(configPath), { recursive: true });
        
        const yamlContent = this.generateYAML(ddevConfig);
        await fs.writeFile(configPath, yamlContent, 'utf8');
        
        this.log(`✅ DDEV configuration written to ${configPath}`);
    }

    private mapMariaDbVersion(version: string): string {
        // Map our MariaDB versions to DDEV-compatible versions
        const versionMap: { [key: string]: string } = {
            '10.4': '10.4',
            '10.5': '10.5',
            '10.6': '10.6',
            '10.11': '10.11',
            '11.0': '11.0',
            'latest': '10.11' // Default to a stable version
        };
        return versionMap[version] || '10.11';
    }

    private generateYAML(config: DDEVConfig): string {
        return `name: ${config.name}
type: ${config.type}
docroot: ${config.docroot}
php_version: "${config.php_version}"
webserver_type: apache-fpm
router_http_port: "${config.router_http_port || '80'}"
router_https_port: "${config.router_https_port || '443'}"
xdebug_enabled: false
additional_hostnames: ${JSON.stringify(config.additional_hostnames || [])}
additional_fqdns: []
database:
  type: ${config.database.type}
  version: "${config.database.version}"
use_dns_when_possible: ${config.use_dns_when_possible || true}
composer_version: "2"
web_environment:
- DRUSH_OPTIONS_URI=https://${config.name}.ddev.site
- SIMPLETEST_BASE_URL=https://${config.name}.ddev.site
hooks:
  post-start:
    - exec: composer install
`;
    }

    async startInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`🚀 Starting DDEV instance: ${instanceName}`);
            await this.runDDEVCommand(['start'], { cwd: instancePath });
            this.log(`✅ DDEV instance ${instanceName} started successfully`);
            
            vscode.window.showInformationMessage(`DDEV instance ${instanceName} started successfully!`);
        } catch (error: any) {
            this.log(`❌ Failed to start DDEV instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to start DDEV instance: ${error.message}`);
            throw error;
        }
    }

    async stopInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            this.log(`🛑 Stopping DDEV instance: ${instanceName}`);
            await this.runDDEVCommand(['stop'], { cwd: instancePath });
            this.log(`✅ DDEV instance ${instanceName} stopped successfully`);
            
            vscode.window.showInformationMessage(`DDEV instance ${instanceName} stopped successfully!`);
        } catch (error: any) {
            this.log(`❌ Failed to stop DDEV instance: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to stop DDEV instance: ${error.message}`);
            throw error;
        }
    }

    async deleteInstance(instanceName: string): Promise<void> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            // Stop and remove DDEV project first
            try {
                await this.runDDEVCommand(['delete', '--omit-snapshot', '--yes'], { cwd: instancePath });
            } catch {
                // Continue even if DDEV deletion fails
            }
            
            // Remove instance directory
            await fs.rm(instancePath, { recursive: true, force: true });
            vscode.window.showInformationMessage(`DDEV instance ${instanceName} deleted successfully!`);
            
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to delete DDEV instance: ${error.message}`);
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

            // Check if it's a DDEV project
            const ddevConfigPath = path.join(instancePath, '.ddev', 'config.yaml');
            try {
                await fs.access(ddevConfigPath);
            } catch {
                return null; // Not a DDEV project
            }

            // Get DDEV project info
            const projectInfo = await this.getDDEVProjectInfo(instancePath);
            
            const localDomain = `${instanceName}.ddev.site`;
            const frontendUrl = projectInfo?.primaryUrl || `https://${localDomain}`;
            const backendUrl = `${frontendUrl}/redaxo`;
            
            // Map DDEV status to our expected status
            let instanceStatus: 'running' | 'stopped' | 'creating' | 'error' = 'stopped';
            if (projectInfo) {
                switch (projectInfo.status) {
                    case 'running':
                        instanceStatus = 'running';
                        break;
                    case 'paused':
                    case 'unhealthy':
                    case 'stopped':
                        instanceStatus = 'stopped';
                        break;
                    default:
                        instanceStatus = 'error';
                }
            }

            return {
                name: instanceName,
                path: instancePath,
                running: instanceStatus === 'running',
                status: instanceStatus,
                phpVersion: projectInfo?.phpVersion || '8.3',
                mariadbVersion: projectInfo?.dbVersion || '10.11',
                frontendUrl: frontendUrl,
                backendUrl: backendUrl,
                containerType: 'ddev',
                localDomain: localDomain,
                instanceType: 'standard',
                redaxoStructure: await this.detectRedaxoStructure(instancePath)
            };
        } catch (error) {
            console.error('Error getting DDEV instance:', error);
            return null;
        }
    }

    private async getDDEVProjectInfo(instancePath: string): Promise<DDEVProjectInfo | null> {
        try {
            const result = await this.runDDEVCommand(['describe', '--json'], { cwd: instancePath });
            const projectData = JSON.parse(result);
            
            return {
                name: projectData.name,
                status: projectData.status,
                location: projectData.location,
                urls: projectData.urls || [],
                type: projectData.type,
                phpVersion: projectData.php_version,
                dbType: projectData.database_type,
                dbVersion: projectData.database_version,
                primaryUrl: projectData.primary_url,
                httpsUrl: projectData.https_url
            };
        } catch (error) {
            this.log(`Could not get DDEV project info: ${error}`);
            return null;
        }
    }

    private async detectRedaxoStructure(instancePath: string): Promise<'classic' | 'modern'> {
        try {
            // Check if there's a public folder with index.php
            const publicIndexPath = path.join(instancePath, 'public', 'index.php');
            await fs.access(publicIndexPath);
            return 'modern';
        } catch {
            return 'classic';
        }
    }

    async getInstanceStatus(instanceName: string): Promise<'running' | 'stopped' | 'creating' | 'error' | undefined> {
        try {
            const instancesDir = await this.getInstancesDirectory();
            const instancePath = path.join(instancesDir, instanceName);
            
            const projectInfo = await this.getDDEVProjectInfo(instancePath);
            
            // Map DDEV statuses to our expected statuses
            if (!projectInfo) {
                return 'error';
            }
            
            switch (projectInfo.status) {
                case 'running':
                    return 'running';
                case 'paused':
                case 'unhealthy':
                case 'stopped':
                    return 'stopped';
                default:
                    return 'error';
            }
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
                    if (instance && instance.containerType === 'ddev') {
                        instances.push(instance);
                    }
                }
            }
            
            return instances;
        } catch (error) {
            this.log(`Error listing DDEV instances: ${error}`);
            return [];
        }
    }
}