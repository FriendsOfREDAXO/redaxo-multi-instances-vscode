import { exec } from 'child_process';
import { promisify } from 'util';

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
            const containerName = `redaxo-${instanceName}`;
            
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
            
            // Build console command
            const consoleArgs = args.length > 0 ? ' ' + args.join(' ') : '';
            const fullCommand = `docker exec ${containerName} php /var/www/html/redaxo/bin/console ${command}${consoleArgs}`;
            
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
