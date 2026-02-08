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
     * Create a new database in the instance's MySQL/MariaDB container
     */
    static async createDatabase(instanceName: string, databaseName: string, charset: string = 'utf8mb4', collation: string = 'utf8mb4_unicode_ci'): Promise<{ success: boolean; error?: string }> {
        try {
            // Validate database name (alphanumeric and underscores only)
            if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
                return { success: false, error: 'Database name must contain only letters, numbers, and underscores' };
            }

            // Get database container name
            const dbContainerName = await this.getDbContainerName(instanceName);
            if (!dbContainerName) {
                return { success: false, error: `Database container not found for instance "${instanceName}"` };
            }

            // Check if container is running
            const isRunning = await this.isContainerRunning(dbContainerName);
            if (!isRunning) {
                return { success: false, error: `Database container ${dbContainerName} is not running` };
            }

            // Ensure MySQL client is available
            const hasClient = await this.ensureMysqlClient(dbContainerName);
            if (!hasClient) {
                return { success: false, error: `MySQL/MariaDB client not available in ${dbContainerName}` };
            }

            // Get connection info (root credentials)
            const dbConnection = await this.getConnectionInfoFromContainer(dbContainerName);
            
            // Try to use root password if available
            let password = dbConnection.password;
            try {
                const { stdout } = await execAsync(`docker exec ${dbContainerName} env | grep -E 'MYSQL_ROOT_PASSWORD|MARIADB_ROOT_PASSWORD'`);
                const rootPassMatch = stdout.match(/MYSQL_ROOT_PASSWORD=(.+)|MARIADB_ROOT_PASSWORD=(.+)/);
                if (rootPassMatch) {
                    password = rootPassMatch[1] || rootPassMatch[2] || password;
                }
            } catch {}

            // Create database - detect mariadb or mysql client
            let clientCmd = 'mysql';
            try {
                await execAsync(`docker exec ${dbContainerName} which mariadb`);
                clientCmd = 'mariadb';
            } catch {
                try {
                    await execAsync(`docker exec ${dbContainerName} which mysql`);
                    clientCmd = 'mysql';
                } catch {
                    return { success: false, error: 'Neither mariadb nor mysql client found in container' };
                }
            }

            // Execute SQL commands separately for reliability
            // 1. Create database
            try {
                const createCmd = `docker exec ${dbContainerName} ${clientCmd} -h localhost -u root -p'${password}' -e "CREATE DATABASE IF NOT EXISTS \\\`${databaseName}\\\` CHARACTER SET ${charset} COLLATE ${collation}"`;
                const { stderr: createErr } = await execAsync(createCmd, { timeout: 15000 });
                if (createErr && createErr.includes('ERROR')) {
                    return { success: false, error: createErr.trim() };
                }
            } catch (error: any) {
                return { success: false, error: error.stderr?.trim() || error.message };
            }

            // 2. Grant privileges
            try {
                const grantCmd = `docker exec ${dbContainerName} ${clientCmd} -h localhost -u root -p'${password}' -e "GRANT ALL PRIVILEGES ON \\\`${databaseName}\\\`.* TO '${dbConnection.user}'@'%'"`;
                await execAsync(grantCmd, { timeout: 10000 });
            } catch (grantError) {
                console.warn('Could not grant privileges (non-critical):', grantError);
            }

            // 3. Flush privileges
            try {
                const flushCmd = `docker exec ${dbContainerName} ${clientCmd} -h localhost -u root -p'${password}' -e "FLUSH PRIVILEGES"`;
                await execAsync(flushCmd, { timeout: 10000 });
            } catch (flushError) {
                console.warn('Could not flush privileges (non-critical):', flushError);
            }

            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.stderr?.trim() || error.message };
        }
    }

    /**
     * List all databases in the instance's MySQL/MariaDB container
     */
    static async listDatabases(instanceName: string): Promise<{ success: boolean; databases?: string[]; error?: string }> {
        try {
            const dbContainerName = await this.getDbContainerName(instanceName);
            if (!dbContainerName) {
                return { success: false, error: `Database container not found for instance "${instanceName}"` };
            }

            const result = await this.query(dbContainerName, 'SHOW DATABASES');
            if (!result.success) {
                return { success: false, error: result.error };
            }

            // Extract database names from result
            const databases = result.rows.map(row => Object.values(row)[0] as string);
            return { success: true, databases };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
    
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
