import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DDEVProject, REDAXOProjectConfig, REDAXOVersion } from '../types/redaxo';

const execAsync = promisify(exec);

export class DDEVService {
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('REDAXO DDEV Manager');
    }

    async isDDEVInstalled(): Promise<boolean> {
        try {
            await execAsync('ddev version');
            return true;
        } catch {
            return false;
        }
    }

    async listProjects(): Promise<DDEVProject[]> {
        try {
            const { stdout } = await execAsync('ddev list --json-output');
            const data = JSON.parse(stdout);
            
            return data.raw.map((project: any) => ({
                name: project.name,
                status: project.status,
                location: project.approot,
                urls: project.urls || [],
                type: project.type || 'php',
                phpVersion: project.php_version || '8.1',
                database: project.database || 'mysql:8.0',
                router: project.router_status || 'healthy',
                mailhog: project.mailhog_url,
                phpmyadmin: project.phpmyadmin_url
            }));
        } catch (error) {
            this.outputChannel.appendLine(`Error listing projects: ${error}`);
            return [];
        }
    }

    async createProject(config: REDAXOProjectConfig): Promise<void> {
        const { name, location, phpVersion, database } = config;
        
        try {
            // Create project directory
            if (!fs.existsSync(location)) {
                fs.mkdirSync(location, { recursive: true });
            }

            // Initialize DDEV project
            const configCmd = [
                'ddev config',
                `--project-name="${name}"`,
                `--docroot="web"`,
                `--project-type="php"`,
                `--php-version="${phpVersion}"`,
                `--database="${database}"`,
                '--create-docroot'
            ].join(' ');

            await this.executeCommand(configCmd, location);
            
            // Download and install REDAXO
            await this.downloadREDAXO(config);
            
            // Start the project
            await this.executeCommand('ddev start', location);
            
            // Install REDAXO
            await this.installREDAXO(config);

            this.outputChannel.appendLine(`REDAXO project '${name}' created successfully`);
            
        } catch (error) {
            throw new Error(`Failed to create project: ${error}`);
        }
    }

    private async downloadREDAXO(config: REDAXOProjectConfig): Promise<void> {
        const webDir = path.join(config.location, 'web');
        
        // Ensure web directory exists
        if (!fs.existsSync(webDir)) {
            fs.mkdirSync(webDir, { recursive: true });
        }

        // Download REDAXO
        const downloadCmd = [
            'curl -L',
            `"https://github.com/redaxo/redaxo/releases/download/v${config.redaxoVersion}/redaxo_${config.redaxoVersion}.zip"`,
            '-o redaxo.zip'
        ].join(' ');

        await this.executeCommand(downloadCmd, webDir);
        await this.executeCommand('unzip -q redaxo.zip', webDir);
        await this.executeCommand('rm redaxo.zip', webDir);
    }

    private async installREDAXO(config: REDAXOProjectConfig): Promise<void> {
        const { name, adminUser, adminPassword, adminEmail, siteName } = config;
        
        // Wait for containers to be ready
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Install REDAXO via CLI
        const installCmd = [
            'ddev exec',
            'php redaxo/bin/console setup:run',
            '--agree-license',
            `--db-host="db"`,
            `--db-name="db"`,
            `--db-password="db"`,
            `--db-user="db"`,
            `--admin-username="${adminUser}"`,
            `--admin-password="${adminPassword}"`,
            `--admin-email="${adminEmail}"`,
            `--server-name="${siteName}"`,
            '--lang="de_de"'
        ].join(' ');

        await this.executeCommand(installCmd, config.location);
    }

    async startProject(projectName: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        await this.executeCommand('ddev start', project.location);
    }

    async stopProject(projectName: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        await this.executeCommand('ddev stop', project.location);
    }

    async restartProject(projectName: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        await this.executeCommand('ddev restart', project.location);
    }

    async deleteProject(projectName: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        await this.executeCommand('ddev delete --omit-snapshot --yes', project.location);
    }

    async importDatabase(projectName: string, dumpPath: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        // Copy dump to project directory temporarily
        const tempDumpPath = path.join(project.location, 'temp_dump.sql');
        fs.copyFileSync(dumpPath, tempDumpPath);

        try {
            await this.executeCommand(`ddev import-db --src=temp_dump.sql`, project.location);
        } finally {
            // Clean up temporary file
            if (fs.existsSync(tempDumpPath)) {
                fs.unlinkSync(tempDumpPath);
            }
        }
    }

    async exportDatabase(projectName: string, outputPath: string): Promise<void> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        const tempDumpName = 'export_dump.sql';
        await this.executeCommand(`ddev export-db --file=${tempDumpName}`, project.location);
        
        const tempDumpPath = path.join(project.location, tempDumpName);
        if (fs.existsSync(tempDumpPath)) {
            fs.copyFileSync(tempDumpPath, outputPath);
            fs.unlinkSync(tempDumpPath);
        }
    }

    async getProjectUrl(projectName: string): Promise<string> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        if (project.urls.length === 0) {
            throw new Error(`No URLs available for project '${projectName}'`);
        }

        // Prefer HTTPS URL if available
        const httpsUrl = project.urls.find(url => url.startsWith('https://'));
        return httpsUrl || project.urls[0];
    }

    async getProjectPath(projectName: string): Promise<string> {
        const project = await this.getProject(projectName);
        if (!project) {
            throw new Error(`Project '${projectName}' not found`);
        }

        return project.location;
    }

    async getAvailableREDAXOVersions(): Promise<REDAXOVersion[]> {
        try {
            // This could be enhanced to fetch from GitHub API
            // For now, return common versions
            return [
                { version: '5.17.0', url: '', released: '2024-01-01', stable: true },
                { version: '5.16.1', url: '', released: '2023-12-01', stable: true },
                { version: '5.15.1', url: '', released: '2023-10-01', stable: true },
            ];
        } catch (error) {
            this.outputChannel.appendLine(`Error fetching REDAXO versions: ${error}`);
            return [
                { version: '5.17.0', url: '', released: '2024-01-01', stable: true }
            ];
        }
    }

    private async getProject(projectName: string): Promise<DDEVProject | undefined> {
        const projects = await this.listProjects();
        return projects.find(p => p.name === projectName);
    }

    private async executeCommand(command: string, cwd: string): Promise<string> {
        try {
            this.outputChannel.appendLine(`Executing: ${command} (in ${cwd})`);
            const { stdout, stderr } = await execAsync(command, { cwd });
            
            if (stderr) {
                this.outputChannel.appendLine(`stderr: ${stderr}`);
            }
            
            this.outputChannel.appendLine(`stdout: ${stdout}`);
            return stdout;
        } catch (error: any) {
            this.outputChannel.appendLine(`Command failed: ${error.message}`);
            throw error;
        }
    }
}