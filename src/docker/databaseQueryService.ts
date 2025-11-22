import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './dockerService';

const execAsync = promisify(exec);

export interface DatabaseQueryResult {
    success: boolean;
    rows: any[];
    fields?: string[];
    rowCount: number;
    error?: string;
    query: string;
}

export interface DatabaseConnection {
    host: string;
    port: number;
    user: string;
    password: string;
    database?: string;
}
    
    // databaseQueryService.ts — simplified: export/import removed; only query-related functions remain

export class DatabaseQueryService {
    private static dockerService: DockerService;

    static initialize(dockerService: DockerService) {
        this.dockerService = dockerService;
    }

    private static async getWebContainerName(instanceName: string): Promise<string | null> {
        if (this.dockerService) return await this.dockerService.getWebContainerName(instanceName);
        return `redaxo-${instanceName}`;
    }

    private static async getDbContainerName(instanceName: string): Promise<string | null> {
        if (this.dockerService) return await this.dockerService.getDbContainerName(instanceName);
        return `redaxo-${instanceName}_db`;
    }

    private static async ensureMysqlClient(containerName: string): Promise<boolean> {
        try {
            try { await execAsync(`docker exec ${containerName} which mariadb`); return true; } catch {}
            try { await execAsync(`docker exec ${containerName} which mysql`); return true; } catch {}

            // Try to install using common package managers (best-effort)
            const installCommands = [
                `docker exec ${containerName} sh -c 'apt-get update && apt-get install -y mariadb-client'`,
                `docker exec ${containerName} sh -c 'apt-get update && apt-get install -y default-mysql-client'`,
                `docker exec ${containerName} sh -c 'apk add --no-cache mariadb-client'`,
                `docker exec ${containerName} sh -c 'apk add --no-cache mysql-client'`,
                `docker exec ${containerName} sh -c 'yum install -y mariadb'`
            ];

            for (const cmd of installCommands) {
                try {
                    await execAsync(cmd, { timeout: 60000 });
                    return true;
                } catch {}
            }

            return false;
        } catch (err) {
            console.error('ensureMysqlClient error', err);
            return false;
        }
    }

    static async query(containerName: string, query: string, dbConnection?: DatabaseConnection): Promise<DatabaseQueryResult> {
        try {
            // Container running?
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return { success: false, rows: [], rowCount: 0, error: `Database container ${containerName} is not running`, query };
            }

            const hasClient = await this.ensureMysqlClient(containerName);
            if (!hasClient) {
                return { success: false, rows: [], rowCount: 0, error: `MySQL/MariaDB client not available in ${containerName}`, query };
            }

            if (!dbConnection) dbConnection = await this.getConnectionInfoFromContainer(containerName);

            const escapedQuery = query.replace(/"/g, '\\"').replace(/'/g, "'\\''");
            const mysqlCommand = `mysql -h localhost -u ${dbConnection.user} -p${dbConnection.password} ${dbConnection.database} -e "${escapedQuery}" --batch --skip-column-names`;
            const fullCommand = `docker exec ${containerName} sh -c '${mysqlCommand}'`;

            const { stdout, stderr } = await execAsync(fullCommand, { timeout: 30000 });
            if (stderr && stderr.includes('ERROR')) {
                return { success: false, rows: [], rowCount: 0, error: stderr.trim(), query };
            }

            const rows = this.parseQueryOutput(stdout);
            return { success: true, rows, rowCount: rows.length, query };
        } catch (error: any) {
            return { success: false, rows: [], rowCount: 0, error: error.stderr?.trim() || error.message, query };
        }
    }

    static async select(instanceName: string, table: string, conditions?: string, limit?: number): Promise<DatabaseQueryResult> {
        let q = `SELECT * FROM ${table}`;
        if (conditions) q += ` WHERE ${conditions}`;
        if (limit) q += ` LIMIT ${limit}`;
        return this.query(instanceName, q);
    }

    static async count(instanceName: string, table: string, conditions?: string): Promise<number> {
        const q = `SELECT COUNT(*) as count FROM ${table}` + (conditions ? ` WHERE ${conditions}` : '');
        const result = await this.query(instanceName, q);
        if (result.success && result.rows.length > 0) return parseInt(result.rows[0].count || '0');
        return 0;
    }

    static async getArticles(instanceName: string, limit: number = 50): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_article', 'status=1', limit);
    }

    static async getUsers(instanceName: string): Promise<DatabaseQueryResult> { return this.select(instanceName, 'rex_user', 'status=1'); }
    static async getTemplates(instanceName: string): Promise<DatabaseQueryResult> { return this.select(instanceName, 'rex_template', 'active=1'); }
    static async getModules(instanceName: string): Promise<DatabaseQueryResult> { return this.select(instanceName, 'rex_module'); }
    static async getPackages(instanceName: string): Promise<DatabaseQueryResult> { return this.select(instanceName, 'rex_config', "`namespace`='package'"); }

    static async execute(instanceName: string, sql: string): Promise<DatabaseQueryResult> { return this.query(instanceName, sql); }

    static async getTables(instanceName: string): Promise<DatabaseQueryResult> { return this.query(instanceName, 'SHOW TABLES'); }
    static async describeTable(instanceName: string, tableName: string): Promise<DatabaseQueryResult> { return this.query(instanceName, `DESCRIBE ${tableName}`); }
    
    /**
     * Parse tab-separated MySQL output to array of objects
     */
    private static parseQueryOutput(output: string): any[] {
        const lines = output.trim().split('\n');
        if (lines.length === 0) {
            return [];
        }
        
        // First line contains column names
        const columns = lines[0].split('\t');
        
        // Parse data rows
        const rows: any[] = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split('\t');
            const row: any = {};
            columns.forEach((col, index) => {
                row[col] = values[index] === 'NULL' ? null : values[index];
            });
            rows.push(row);
        }
        
        return rows;
    }
    
    /**
     * Get database connection info from instance
     */
    private static async getConnectionInfo(instanceName: string): Promise<DatabaseConnection> {
        try {
            // Get actual web container name
            const containerName = await this.getWebContainerName(instanceName);
            if (!containerName) {
                throw new Error(`Web container not found for instance "${instanceName}"`);
            }
            
            // Read environment variables from container
            const envCommand = `docker exec ${containerName} env`;
            const { stdout } = await execAsync(envCommand);
            
            const env = this.parseEnvVars(stdout);
            
            return {
                host: 'localhost',
                port: 3306,
                user: env.REDAXO_DB_LOGIN || env.MYSQL_USER || 'redaxo',
                password: env.REDAXO_DB_PASSWORD || env.MYSQL_PASSWORD || 'redaxo',
                database: env.REDAXO_DB_NAME || env.MYSQL_DATABASE || 'redaxo'
            };
        } catch (error) {
            // Fallback to defaults
            return {
                host: 'localhost',
                port: 3306,
                user: 'redaxo',
                password: 'redaxo',
                database: 'redaxo'
            };
        }
    }
    
    /**
     * Get connection info directly from database container environment
     */
    private static async getConnectionInfoFromContainer(containerName: string): Promise<DatabaseConnection> {
        try {
            // Read environment variables from DB container
            const envCommand = `docker exec ${containerName} env`;
            const { stdout } = await execAsync(envCommand);
            
            const env = this.parseEnvVars(stdout);
            
            return {
                host: 'localhost',
                port: 3306,
                user: env.MYSQL_USER || env.MARIADB_USER || 'root',
                password: env.MYSQL_PASSWORD || env.MARIADB_PASSWORD || env.MYSQL_ROOT_PASSWORD || env.MARIADB_ROOT_PASSWORD || '',
                database: env.MYSQL_DATABASE || env.MARIADB_DATABASE || 'redaxo'
            };
        } catch (error) {
            // Fallback to defaults
            return {
                host: 'localhost',
                port: 3306,
                user: 'root',
                password: '',
                database: 'redaxo'
            };
        }
    }
    
    /**
     * Parse environment variables from container
     */
    private static parseEnvVars(output: string): Record<string, string> {
        const env: Record<string, string> = {};
        output.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                env[key.trim()] = valueParts.join('=').trim();
            }
        });
        return env;
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
