import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ContainerStats {
    cpu: string;
    memory: string;
    memoryUsage: string;
    memoryLimit: string;
    networkIO: string;
    blockIO: string;
}

export interface InstanceResources {
    web?: ContainerStats;
    db?: ContainerStats;
    total?: {
        cpu: string;
        memory: string;
    };
}

export class ResourceMonitor {
    
    /**
     * Get resource stats for an instance
     */
    static async getInstanceResources(instanceName: string, instanceType: 'redaxo' | 'custom'): Promise<InstanceResources> {
        try {
            const containerPrefix = instanceType === 'custom' ? instanceName : 'redaxo';
            const containerSuffix = instanceType === 'custom' ? '' : `-${instanceName}`;
            
            const webContainerName = instanceType === 'custom' 
                ? `${instanceName}_web` 
                : `${containerPrefix}${containerSuffix}`;
            
            const dbContainerName = instanceType === 'custom'
                ? `${instanceName}_db`
                : `${containerPrefix}${containerSuffix}_db`;

            const resources: InstanceResources = {};

            // Get web container stats
            try {
                resources.web = await this.getContainerStats(webContainerName);
            } catch (error) {
                // Web container might not be running
            }

            // Get DB container stats  
            try {
                resources.db = await this.getContainerStats(dbContainerName);
            } catch (error) {
                // DB container might not be running
            }

            // Calculate total resources if both containers are available
            if (resources.web && resources.db) {
                resources.total = this.calculateTotalResources(resources.web, resources.db);
            } else if (resources.web) {
                resources.total = {
                    cpu: resources.web.cpu,
                    memory: resources.web.memory
                };
            } else if (resources.db) {
                resources.total = {
                    cpu: resources.db.cpu,
                    memory: resources.db.memory
                };
            }

            return resources;
        } catch (error) {
            console.error(`Error getting resources for ${instanceName}:`, error);
            return {};
        }
    }

    /**
     * Get stats for a single container
     */
    private static async getContainerStats(containerName: string): Promise<ContainerStats> {
        const { stdout } = await execAsync(`docker stats ${containerName} --no-stream --format "table {{.CPUPerc}},{{.MemUsage}},{{.MemPerc}},{{.NetIO}},{{.BlockIO}}"`);
        
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) {
            throw new Error(`No stats data for container ${containerName}`);
        }

        const data = lines[1].split(',');
        if (data.length < 5) {
            throw new Error(`Invalid stats format for container ${containerName}`);
        }

        const memUsage = data[1].split(' / ');
        return {
            cpu: data[0].trim(),
            memory: data[2].trim(),
            memoryUsage: memUsage[0]?.trim() || '',
            memoryLimit: memUsage[1]?.trim() || '',
            networkIO: data[3].trim(),
            blockIO: data[4].trim()
        };
    }

    /**
     * Calculate combined resources from web and db containers
     */
    private static calculateTotalResources(web: ContainerStats, db: ContainerStats): { cpu: string; memory: string } {
        // Parse CPU percentages
        const webCpu = parseFloat(web.cpu.replace('%', '')) || 0;
        const dbCpu = parseFloat(db.cpu.replace('%', '')) || 0;
        const totalCpu = webCpu + dbCpu;

        // Parse memory percentages
        const webMem = parseFloat(web.memory.replace('%', '')) || 0;
        const dbMem = parseFloat(db.memory.replace('%', '')) || 0;
        const totalMem = webMem + dbMem;

        return {
            cpu: `${totalCpu.toFixed(1)}%`,
            memory: `${totalMem.toFixed(1)}%`
        };
    }

    /**
     * Check if container exists and is running
     */
    static async isContainerRunning(containerName: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`docker container inspect ${containerName} --format '{{.State.Running}}'`);
            return stdout.trim() === 'true';
        } catch (error) {
            return false;
        }
    }

    /**
     * Get correct container names for an instance
     */
    static getContainerNames(instanceName: string, instanceType: 'redaxo' | 'custom'): { web: string; db: string } {
        if (instanceType === 'custom') {
            return {
                web: `${instanceName}_web`,
                db: `${instanceName}_db`
            };
        } else {
            return {
                web: `redaxo-${instanceName}`,
                db: `redaxo-${instanceName}_db`
            };
        }
    }
}
