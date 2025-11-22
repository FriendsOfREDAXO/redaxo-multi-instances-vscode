import { exec } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './dockerService';

const execAsync = promisify(exec);

export interface ConsoleCommandResult {
    success: boolean;
    output: string;
    error?: string;
    exitCode: number;
}

/**
 * Service for executing REDAXO Console commands via Docker exec
 */
export class RedaxoConsoleService {
    
    private static dockerService: DockerService;
    private static consolePathCache: Map<string, string> = new Map();
    
    /**
     * Initialize the service with DockerService instance
     */
    static initialize(dockerService: DockerService) {
        this.dockerService = dockerService;
    }
    
    /**
     * Get the web container name for an instance
     */
    private static async getContainerName(instanceName: string): Promise<string | null> {
        if (this.dockerService) {
            return await this.dockerService.getWebContainerName(instanceName);
        }
        // Fallback for standard instances
        return `redaxo-${instanceName}`;
    }
    
    /**
     * Detect the correct REDAXO console path in the container
     * Standard instances: /var/www/html/redaxo/bin/console
     * Custom instances: /var/www/html/bin/console
     */
    private static async getConsolePath(containerName: string): Promise<string> {
        // Check cache first
        if (this.consolePathCache.has(containerName)) {
            return this.consolePathCache.get(containerName)!;
        }
        
        try {
            // Try custom path first (more common for new instances)
            const customPath = '/var/www/html/bin/console';
            try {
                const checkCustom = `docker exec ${containerName} test -f "${customPath}" && echo "exists"`;
                const { stdout: customExists } = await execAsync(checkCustom);
                
                if (customExists.trim() === 'exists') {
                    this.consolePathCache.set(containerName, customPath);
                    return customPath;
                }
            } catch (e) {
                // Continue to next check
            }
            
            // Try standard path
            const standardPath = '/var/www/html/redaxo/bin/console';
            try {
                const checkStandard = `docker exec ${containerName} test -f "${standardPath}" && echo "exists"`;
                const { stdout: standardExists } = await execAsync(checkStandard);
                
                if (standardExists.trim() === 'exists') {
                    this.consolePathCache.set(containerName, standardPath);
                    return standardPath;
                }
            } catch (e) {
                // Continue to fallback
            }
            
            // Fallback to standard path
            this.consolePathCache.set(containerName, standardPath);
            return standardPath;
        } catch (error) {
            // If any error occurs, return standard path as fallback
            const fallbackPath = '/var/www/html/redaxo/bin/console';
            this.consolePathCache.set(containerName, fallbackPath);
            return fallbackPath;
        }
    }
    
    /**
     * Execute a REDAXO console command in a container
     * @param instanceName The instance name
     * @param command The console command (e.g., 'cache:clear', 'package:list')
     * @param args Additional arguments for the command
     */
    static async execute(
        instanceName: string,
        command: string,
        args: string[] = []
    ): Promise<ConsoleCommandResult> {
        try {
            // Get actual container name (supports both standard and custom instances)
            const containerName = await this.getContainerName(instanceName);
            
            if (!containerName) {
                return {
                    success: false,
                    output: '',
                    error: `Container not found for instance "${instanceName}"`,
                    exitCode: 1
                };
            }
            
            // Check if container is running
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return {
                    success: false,
                    output: '',
                    error: `Container ${containerName} is not running`,
                    exitCode: 1
                };
            }
            
            // Detect the correct console path for this instance
            const consolePath = await this.getConsolePath(containerName);
            
            // Build console command
            const consoleArgs = args.length > 0 ? ' ' + args.join(' ') : '';
            const fullCommand = `docker exec ${containerName} php ${consolePath} ${command}${consoleArgs}`;
            
            console.log(`🎯 Executing REDAXO console: ${fullCommand}`);
            
            const { stdout, stderr } = await execAsync(fullCommand, {
                timeout: 30000 // 30 seconds timeout
            });
            
            return {
                success: true,
                output: stdout.trim(),
                error: stderr.trim() || undefined,
                exitCode: 0
            };
            
        } catch (error: any) {
            console.error(`❌ Console command failed:`, error);
            return {
                success: false,
                output: error.stdout?.trim() || '',
                error: error.stderr?.trim() || error.message,
                exitCode: error.code || 1
            };
        }
    }
    
    /**
     * Clear REDAXO cache
     */
    static async clearCache(instanceName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'cache:clear');
    }
    
    /**
     * List installed packages/addons
     */
    static async listPackages(instanceName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'package:list');
    }
    
    /**
     * Install a REDAXO addon
     */
    static async installAddon(instanceName: string, addonName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'package:install', [addonName]);
    }
    
    /**
     * Activate a REDAXO addon
     */
    static async activateAddon(instanceName: string, addonName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'package:activate', [addonName]);
    }
    
    /**
     * Deactivate a REDAXO addon
     */
    static async deactivateAddon(instanceName: string, addonName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'package:deactivate', [addonName]);
    }
    
    /**
     * Uninstall a REDAXO addon
     */
    static async uninstallAddon(instanceName: string, addonName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'package:uninstall', [addonName]);
    }
    
    /**
     * List all users
     */
    static async listUsers(instanceName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'user:list');
    }
    
    /**
     * Create database backup
     */
    static async backupDatabase(instanceName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'backup:database');
    }
    
    /**
     * Get system information
     */
    static async getSystemInfo(instanceName: string): Promise<ConsoleCommandResult> {
        return this.execute(instanceName, 'system:report');
    }
    
    /**
     * Check if container is running
     */
    private static async isContainerRunning(containerName: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync(
                `docker container inspect ${containerName} --format '{{.State.Running}}'`
            );
            return stdout.trim() === 'true';
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Get available console commands from container
     */
    static async getAvailableCommands(instanceName: string): Promise<string[]> {
        try {
            const result = await this.execute(instanceName, 'list', ['--raw']);
            if (result.success) {
                return result.output
                    .split('\n')
                    .filter(line => line.trim().length > 0)
                    .map(line => line.trim());
            }
            return [];
        } catch (error) {
            console.error('Failed to get available commands:', error);
            return [];
        }
    }
}
