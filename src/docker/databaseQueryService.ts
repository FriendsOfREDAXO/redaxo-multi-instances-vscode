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
    database: string;
}

/**
 * Service for executing MySQL queries in REDAXO database via Docker exec
 */
export class DatabaseQueryService {
    
    private static dockerService: DockerService;
    
    /**
     * Initialize the service with DockerService instance
     */
    static initialize(dockerService: DockerService) {
        this.dockerService = dockerService;
    }
    
    /**
     * Get the web container name for an instance
     */
    private static async getWebContainerName(instanceName: string): Promise<string | null> {
        if (this.dockerService) {
            return await this.dockerService.getWebContainerName(instanceName);
        }
        return `redaxo-${instanceName}`;
    }
    
    /**
     * Get the DB container name for an instance
     */
    private static async getDbContainerName(instanceName: string): Promise<string | null> {
        if (this.dockerService) {
            return await this.dockerService.getDbContainerName(instanceName);
        }
        return `redaxo-${instanceName}_db`;
    }
    
    /**
     * Check if MySQL/MariaDB CLI tools are installed in container, install if missing
     * @param containerName The database container name
     */
    private static async ensureMysqlClient(containerName: string): Promise<boolean> {
        try {
            // Check if mariadb command exists (MariaDB images)
            try {
                await execAsync(`docker exec ${containerName} which mariadb`);
                return true; // MariaDB client already installed
            } catch {}
            
            // Check if mysql command exists (MySQL images)
            try {
                await execAsync(`docker exec ${containerName} which mysql`);
                return true; // MySQL client already installed
            } catch {}
            
            // Neither found, try to install
            console.log(`📦 Database client not found in ${containerName}, attempting to install...`);
            
            // Try different package managers
            const installCommands = [
                // For MariaDB images with apt (Debian/Ubuntu)
                `docker exec ${containerName} sh -c 'apt-get update && apt-get install -y mariadb-client'`,
                // For MySQL images with apt (Debian/Ubuntu)
                `docker exec ${containerName} sh -c 'apt-get update && apt-get install -y default-mysql-client'`,
                // For Alpine based images
                `docker exec ${containerName} sh -c 'apk add --no-cache mariadb-client'`,
                // Alternative for Alpine
                `docker exec ${containerName} sh -c 'apk add --no-cache mysql-client'`,
                // For Red Hat based images
                `docker exec ${containerName} sh -c 'yum install -y mariadb'`
            ];
            
            for (const cmd of installCommands) {
                try {
                    await execAsync(cmd, { timeout: 60000 }); // 60 seconds timeout
                    console.log(`✅ Database client installed successfully`);
                    return true;
                } catch {
                    continue; // Try next package manager
                }
            }
            
            console.error(`❌ Failed to install database client in ${containerName}`);
            return false;
        } catch (error) {
            console.error(`❌ Error checking/installing database client:`, error);
            return false;
        }
    }
    
    /**
     * Execute a SELECT query on the REDAXO database
     * @param containerName The database container name (e.g., 'redaxo-demo_db' or 'wellingdb')
     * @param query The SQL query to execute
     * @param dbConnection Database connection info (optional, will be fetched if not provided)
     */
    static async query(
        containerName: string,
        query: string,
        dbConnection?: DatabaseConnection
    ): Promise<DatabaseQueryResult> {
        try {
            // Check if container is running
            const isRunning = await this.isContainerRunning(containerName);
            if (!isRunning) {
                return {
                    success: false,
                    rows: [],
                    rowCount: 0,
                    error: `Database container ${containerName} is not running`,
                    query
                };
            }
            
            // Ensure MySQL client is installed
            const hasClient = await this.ensureMysqlClient(containerName);
            if (!hasClient) {
                return {
                    success: false,
                    rows: [],
                    rowCount: 0,
                    error: `MySQL client not available in ${containerName}. Please install it manually or use a MariaDB image with built-in tools.`,
                    query
                };
            }
            
            // Get database connection info if not provided
            if (!dbConnection) {
                dbConnection = await this.getConnectionInfoFromContainer(containerName);
            }
            
            // Escape query for shell
            const escapedQuery = query.replace(/"/g, '\\"').replace(/'/g, "'\\''");
            
            // Build MySQL command with JSON output
            const mysqlCommand = `mysql -h localhost -u ${dbConnection.user} -p${dbConnection.password} ${dbConnection.database} -e "${escapedQuery}" --batch --skip-column-names`;
            const fullCommand = `docker exec ${containerName} sh -c '${mysqlCommand}'`;
            
            console.log(`🗄️  Executing database query on ${containerName}`);
            
            const { stdout, stderr } = await execAsync(fullCommand, {
                timeout: 30000 // 30 seconds timeout
            });
            
            if (stderr && stderr.includes('ERROR')) {
                return {
                    success: false,
                    rows: [],
                    rowCount: 0,
                    error: stderr.trim(),
                    query
                };
            }
            
            // Parse tab-separated output
            const rows = this.parseQueryOutput(stdout);
            
            return {
                success: true,
                rows,
                rowCount: rows.length,
                query
            };
            
        } catch (error: any) {
            console.error(`❌ Database query failed:`, error);
            return {
                success: false,
                rows: [],
                rowCount: 0,
                error: error.stderr?.trim() || error.message,
                query
            };
        }
    }
    
    /**
     * Execute a SELECT query and return results as objects
     */
    static async select(
        instanceName: string,
        table: string,
        conditions?: string,
        limit?: number
    ): Promise<DatabaseQueryResult> {
        let query = `SELECT * FROM ${table}`;
        if (conditions) {
            query += ` WHERE ${conditions}`;
        }
        if (limit) {
            query += ` LIMIT ${limit}`;
        }
        return this.query(instanceName, query);
    }
    
    /**
     * Count rows in a table
     */
    static async count(
        instanceName: string,
        table: string,
        conditions?: string
    ): Promise<number> {
        let query = `SELECT COUNT(*) as count FROM ${table}`;
        if (conditions) {
            query += ` WHERE ${conditions}`;
        }
        
        const result = await this.query(instanceName, query);
        if (result.success && result.rows.length > 0) {
            return parseInt(result.rows[0].count || '0');
        }
        return 0;
    }
    
    /**
     * Get REDAXO articles
     */
    static async getArticles(instanceName: string, limit: number = 50): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_article', 'status=1', limit);
    }
    
    /**
     * Get REDAXO users
     */
    static async getUsers(instanceName: string): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_user', 'status=1');
    }
    
    /**
     * Get REDAXO templates
     */
    static async getTemplates(instanceName: string): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_template', 'active=1');
    }
    
    /**
     * Get REDAXO modules
     */
    static async getModules(instanceName: string): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_module');
    }
    
    /**
     * Get installed REDAXO packages
     */
    static async getPackages(instanceName: string): Promise<DatabaseQueryResult> {
        return this.select(instanceName, 'rex_config', "`namespace`='package'");
    }
    
    /**
     * Execute a raw SQL command (INSERT, UPDATE, DELETE)
     * Warning: Use with caution!
     */
    static async execute(
        instanceName: string,
        sql: string
    ): Promise<DatabaseQueryResult> {
        return this.query(instanceName, sql);
    }
    
    /**
     * Get database table information
     */
    static async getTables(instanceName: string): Promise<DatabaseQueryResult> {
        return this.query(instanceName, 'SHOW TABLES');
    }
    
    /**
     * Get table structure
     */
    static async describeTable(instanceName: string, tableName: string): Promise<DatabaseQueryResult> {
        return this.query(instanceName, `DESCRIBE ${tableName}`);
    }
    
    /**
     * Export database to SQL file
     */
    static async exportDatabase(instanceName: string, outputPath: string, options?: { onProgress?: (bytes: number) => void }): Promise<{ success: boolean; error?: string }> {
        try {
            // Get actual DB container name
            const containerName = await this.dockerService.getDbContainerName(instanceName);
            if (!containerName) {
                return {
                    success: false,
                    error: `Database container not found for instance "${instanceName}"`
                };
            }
            
            const dbConnection = await this.getConnectionInfo(instanceName);
            
            const dumpCommand = `mysqldump -h ${dbConnection.host} -P ${dbConnection.port} -u ${dbConnection.user} -p'${dbConnection.password.replace(/'/g, "'\\''")}' ${dbConnection.database}`;

            // Use streaming spawn so we can handle large dumps and optionally compress
            const isGz = outputPath.endsWith('.gz');
            const write = require('fs').createWriteStream(outputPath);

            // Start docker exec mysqldump
            const child = spawn('docker', ['exec', containerName, 'sh', '-c', dumpCommand], { stdio: ['ignore', 'pipe', 'pipe'] });

            // If gzip output requested, pipe through gzip (spawn) on host
            if (isGz) {
                const zlib = require('zlib');
                const gzip = zlib.createGzip({ level: 6 });
                // Report progress from child stdout chunks
                child.stdout.on('data', (chunk: Buffer) => {
                    if (options?.onProgress) options.onProgress(chunk.length);
                });
                child.stdout.pipe(gzip).pipe(write);
            } else {
                child.stdout.on('data', (chunk: Buffer) => {
                    if (options?.onProgress) options.onProgress(chunk.length);
                });
                child.stdout.pipe(write);
            }

            // Log stderr to outputChannel to help diagnose large exports
            child.stderr.on('data', (d: Buffer) => {
                console.error('[mysqldump stderr]', d.toString());
            });

            const exitCode: number = await new Promise((resolve, reject) => {
                child.on('error', err => reject(err));
                child.on('close', code => resolve(code === null ? 1 : code));
            });

            if (exitCode !== 0) {
                return { success: false, error: `mysqldump failed with exit code ${exitCode}` };
            }
            
            return { success: true };
        } catch (error: any) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Import a SQL dump file into the database container
     * Supports plain .sql files and gzip compressed .sql.gz files
     */
    static async importDatabase(instanceName: string, inputPath: string, options: { allowSchemaChanges?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
        try {
            // Resolve DB container
            const containerName = await this.dockerService.getDbContainerName(instanceName);
            if (!containerName) {
                return { success: false, error: `Database container not found for instance "${instanceName}"` };
            }

            // Get DB credentials from DB container env if possible
            const dbConn = await this.getConnectionInfoFromContainer(containerName);


            // Basic safety check - detect potentially destructive statements
            try {
                const fs = require('fs');
                const head = fs.readFileSync(inputPath, { encoding: 'utf8', length: 1024 * 1024 });
                const dangerous = /\b(DROP\s+TABLE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(head);
                if (dangerous && !options.allowSchemaChanges) {
                    return { success: false, error: 'Dump file contains schema-changing statements (DROP/CREATE/ALTER). Use incremental import or confirm pre-import snapshot.' };
                }
            } catch (err) {
                // ignore read errors; continue
            }

            const isGz = inputPath.endsWith('.gz') || inputPath.endsWith('.sql.gz');

            // Build mysql command
            const passwordPart = dbConn.password ? `-p'${dbConn.password.replace(/'/g, "'\\''")}'` : '';
            const mysqlCmd = `docker exec -i ${containerName} sh -c "mysql -h ${dbConn.host} -P ${dbConn.port} -u ${dbConn.user} ${passwordPart} ${dbConn.database}"`;

            // We'll stream the file into docker exec -i mysql
            const fs = require('fs');
            let reader: any = null;
            if (isGz) {
                // Use gzip -dc spawn to decompress and pipe
                const gzip = spawn('gzip', ['-dc', inputPath], { stdio: ['ignore', 'pipe', 'pipe'] });
                const dockerExec = spawn('docker', ['exec', '-i', containerName, 'sh', '-c', `mysql -h ${dbConn.host} -P ${dbConn.port} -u ${dbConn.user} ${passwordPart} ${dbConn.database}`], { stdio: ['pipe', 'pipe', 'pipe'] });
                gzip.stdout.pipe(dockerExec.stdin);

                // capture stderr for diagnostics
                const stderrBuffers: Buffer[] = [];
                dockerExec.stderr.on('data', (b: Buffer) => stderrBuffers.push(b));

                const exitCode: number = await new Promise((res, rej) => {
                    dockerExec.on('error', e => rej(e));
                    dockerExec.on('close', code => res(code === null ? 1 : code));
                });

                if (exitCode !== 0) {
                    const msg = Buffer.concat(stderrBuffers).toString('utf8');
                    return { success: false, error: `mysql import failed: ${msg || 'exit code ' + exitCode}` };
                }

            } else {
                // non-gz
                const readerStream = fs.createReadStream(inputPath);
                const dockerExec = spawn('docker', ['exec', '-i', containerName, 'sh', '-c', `mysql -h ${dbConn.host} -P ${dbConn.port} -u ${dbConn.user} ${passwordPart} ${dbConn.database}`], { stdio: ['pipe', 'pipe', 'pipe'] });
                readerStream.pipe(dockerExec.stdin);

                const stderrBuffers: Buffer[] = [];
                dockerExec.stderr.on('data', (b: Buffer) => stderrBuffers.push(b));

                const exitCode: number = await new Promise((res, rej) => {
                    dockerExec.on('error', e => rej(e));
                    dockerExec.on('close', code => res(code === null ? 1 : code));
                });

                if (exitCode !== 0) {
                    const msg = Buffer.concat(stderrBuffers).toString('utf8');
                    return { success: false, error: `mysql import failed: ${msg || 'exit code ' + exitCode}` };
                }
            }

            return { success: true };
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
