import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface FileReadResult {
    success: boolean;
    content: string;
    error?: string;
    path: string;
}

export interface FileWriteResult {
    success: boolean;
    error?: string;
    path: string;
}

export interface FileListResult {
    success: boolean;
    files: string[];
    error?: string;
    path: string;
}

export interface FileInfo {
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
    permissions: string;
    modified: string;
}

/**
 * Service for reading/writing files in REDAXO containers via Docker exec
 */
export class FileSystemService {
    
    /**
     * Read a file from the container
     * @param instanceName The instance name
     * @param filePath Path relative to /var/www/html/ (e.g., 'redaxo/data/config.yml')
     */
    static async readFile(instanceName: string, filePath: string): Promise<FileReadResult> {
        try {
            const containerName = `redaxo-${instanceName}`;
            
            // Check if container is running
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return {
                    success: false,
                    content: '',
                    error: `Container ${containerName} is not running`,
                    path: filePath
                };
            }
            
            // Build full path
            const fullPath = `/var/www/html/${filePath}`;
            const command = `docker exec ${containerName} cat "${fullPath}"`;
            
            console.log(`📄 Reading file: ${filePath}`);
            
            const { stdout, stderr } = await execAsync(command, {
                maxBuffer: 10 * 1024 * 1024 // 10MB max
            });
            
            if (stderr && stderr.includes('No such file')) {
                return {
                    success: false,
                    content: '',
                    error: 'File not found',
                    path: filePath
                };
            }
            
            return {
                success: true,
                content: stdout,
                path: filePath
            };
            
        } catch (error: any) {
            console.error(`❌ Failed to read file:`, error);
            return {
                success: false,
                content: '',
                error: error.message,
                path: filePath
            };
        }
    }
    
    /**
     * Write content to a file in the container
     * @param instanceName The instance name
     * @param filePath Path relative to /var/www/html/
     * @param content Content to write
     */
    static async writeFile(instanceName: string, filePath: string, content: string): Promise<FileWriteResult> {
        try {
            const containerName = `redaxo-${instanceName}`;
            
            // Check if container is running
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return {
                    success: false,
                    error: `Container ${containerName} is not running`,
                    path: filePath
                };
            }
            
            // Escape content for shell (handle quotes and special characters)
            const escapedContent = content
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\$/g, '\\$')
                .replace(/`/g, '\\`');
            
            // Build full path
            const fullPath = `/var/www/html/${filePath}`;
            const command = `docker exec ${containerName} sh -c 'echo "${escapedContent}" > "${fullPath}"'`;
            
            console.log(`✏️  Writing file: ${filePath}`);
            
            await execAsync(command);
            
            return {
                success: true,
                path: filePath
            };
            
        } catch (error: any) {
            console.error(`❌ Failed to write file:`, error);
            return {
                success: false,
                error: error.message,
                path: filePath
            };
        }
    }
    
    /**
     * List files in a directory
     * @param instanceName The instance name
     * @param dirPath Directory path relative to /var/www/html/
     */
    static async listFiles(instanceName: string, dirPath: string = ''): Promise<FileListResult> {
        try {
            const containerName = `redaxo-${instanceName}`;
            
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return {
                    success: false,
                    files: [],
                    error: `Container ${containerName} is not running`,
                    path: dirPath
                };
            }
            
            const fullPath = `/var/www/html/${dirPath}`;
            const command = `docker exec ${containerName} ls -1 "${fullPath}"`;
            
            const { stdout } = await execAsync(command);
            
            const files = stdout
                .split('\n')
                .filter(f => f.trim().length > 0)
                .map(f => f.trim());
            
            return {
                success: true,
                files,
                path: dirPath
            };
            
        } catch (error: any) {
            return {
                success: false,
                files: [],
                error: error.message,
                path: dirPath
            };
        }
    }
    
    /**
     * Get detailed file information
     * @param instanceName The instance name
     * @param dirPath Directory path relative to /var/www/html/
     */
    static async listFilesDetailed(instanceName: string, dirPath: string = ''): Promise<FileInfo[]> {
        try {
            const containerName = `redaxo-${instanceName}`;
            const fullPath = `/var/www/html/${dirPath}`;
            const command = `docker exec ${containerName} ls -lh "${fullPath}"`;
            
            const { stdout } = await execAsync(command);
            
            const lines = stdout.split('\n').slice(1); // Skip "total" line
            const files: FileInfo[] = [];
            
            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }
                
                const parts = line.split(/\s+/);
                if (parts.length < 9) {
                    continue;
                }
                
                const permissions = parts[0];
                const size = parseInt(parts[4]) || 0;
                const modified = `${parts[5]} ${parts[6]} ${parts[7]}`;
                const name = parts.slice(8).join(' ');
                
                files.push({
                    name,
                    path: path.join(dirPath, name),
                    size,
                    isDirectory: permissions.startsWith('d'),
                    permissions,
                    modified
                });
            }
            
            return files;
            
        } catch (error) {
            console.error('Failed to list files:', error);
            return [];
        }
    }
    
    /**
     * Check if file exists
     */
    static async fileExists(instanceName: string, filePath: string): Promise<boolean> {
        try {
            const containerName = `redaxo-${instanceName}`;
            const fullPath = `/var/www/html/${filePath}`;
            const command = `docker exec ${containerName} test -f "${fullPath}" && echo "exists" || echo "not found"`;
            
            const { stdout } = await execAsync(command);
            return stdout.trim() === 'exists';
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Delete a file
     */
    static async deleteFile(instanceName: string, filePath: string): Promise<FileWriteResult> {
        try {
            const containerName = `redaxo-${instanceName}`;
            const fullPath = `/var/www/html/${filePath}`;
            const command = `docker exec ${containerName} rm "${fullPath}"`;
            
            await execAsync(command);
            
            return {
                success: true,
                path: filePath
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                path: filePath
            };
        }
    }
    
    /**
     * Copy file within container
     */
    static async copyFile(instanceName: string, sourcePath: string, destPath: string): Promise<FileWriteResult> {
        try {
            const containerName = `redaxo-${instanceName}`;
            const fullSource = `/var/www/html/${sourcePath}`;
            const fullDest = `/var/www/html/${destPath}`;
            const command = `docker exec ${containerName} cp "${fullSource}" "${fullDest}"`;
            
            await execAsync(command);
            
            return {
                success: true,
                path: destPath
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                path: destPath
            };
        }
    }
    
    /**
     * Read REDAXO config.yml
     */
    static async readConfig(instanceName: string): Promise<FileReadResult> {
        return this.readFile(instanceName, 'redaxo/data/core/config.yml');
    }
    
    /**
     * Read REDAXO master.inc.php (if exists)
     */
    static async readMasterConfig(instanceName: string): Promise<FileReadResult> {
        return this.readFile(instanceName, 'redaxo/data/core/master.inc.php');
    }
    
    /**
     * List REDAXO addons
     */
    static async listAddons(instanceName: string): Promise<FileListResult> {
        return this.listFiles(instanceName, 'redaxo/src/addons');
    }
    
    /**
     * List REDAXO plugins for an addon
     */
    static async listPlugins(instanceName: string, addonName: string): Promise<FileListResult> {
        return this.listFiles(instanceName, `redaxo/src/addons/${addonName}/plugins`);
    }
    
    /**
     * Read addon package.yml
     */
    static async readAddonConfig(instanceName: string, addonName: string): Promise<FileReadResult> {
        return this.readFile(instanceName, `redaxo/src/addons/${addonName}/package.yml`);
    }
    
    /**
     * Read template file
     */
    static async readTemplate(instanceName: string, templateId: string): Promise<FileReadResult> {
        return this.readFile(instanceName, `redaxo/data/core/template.${templateId}.php`);
    }
    
    /**
     * Read module input file
     */
    static async readModuleInput(instanceName: string, moduleId: string): Promise<FileReadResult> {
        return this.readFile(instanceName, `redaxo/data/core/modules/${moduleId}.input.php`);
    }
    
    /**
     * Read module output file
     */
    static async readModuleOutput(instanceName: string, moduleId: string): Promise<FileReadResult> {
        return this.readFile(instanceName, `redaxo/data/core/modules/${moduleId}.output.php`);
    }
    
    /**
     * Read log file
     */
    static async readLog(instanceName: string, logFile: string = 'redaxo.log'): Promise<FileReadResult> {
        return this.readFile(instanceName, `redaxo/data/log/${logFile}`);
    }
    
    /**
     * Get recent log entries (last n lines)
     */
    static async getRecentLogs(instanceName: string, lines: number = 50): Promise<string[]> {
        try {
            const containerName = `redaxo-${instanceName}`;
            const logPath = '/var/www/html/redaxo/data/log/redaxo.log';
            const command = `docker exec ${containerName} tail -n ${lines} "${logPath}"`;
            
            const { stdout } = await execAsync(command);
            return stdout.split('\n').filter(l => l.trim().length > 0);
        } catch (error) {
            return [];
        }
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
}
