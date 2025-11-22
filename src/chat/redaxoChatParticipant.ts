import * as vscode from 'vscode';
import { DockerService } from '../docker/dockerService';

interface RedaxoChatResult extends vscode.ChatResult {
    metadata: {
        command?: string;
        instanceName?: string;
    };
}

/**
 * Chat Participant for REDAXO Multi-Instances
 * Allows users to interact with REDAXO instances via Copilot Chat
 */
export class RedaxoChatParticipant {
    private participant: vscode.ChatParticipant;
    
    constructor(
        private context: vscode.ExtensionContext,
        private dockerService: DockerService
    ) {
        // Create the chat participant
        this.participant = vscode.chat.createChatParticipant(
            'redaxo-instances.chat',
            this.handleChatRequest.bind(this)
        );
        
        // Set icon
        this.participant.iconPath = vscode.Uri.joinPath(
            context.extensionUri,
            'resources',
            'icon.png'
        );
        
        // Register follow-up provider
        this.participant.followupProvider = {
            provideFollowups: this.provideFollowups.bind(this)
        };
        
        context.subscriptions.push(this.participant);
    }
    
    /**
     * Main request handler for chat participant
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        
        // Determine command
        const command = request.command || 'general';
        const prompt = request.prompt.trim();
        
        try {
            switch (command) {
                case 'create':
                    return await this.handleCreate(request, stream, token);
                
                case 'start':
                    return await this.handleStart(request, stream, token);
                
                case 'stop':
                    return await this.handleStop(request, stream, token);
                
                case 'console':
                    return await this.handleConsole(request, stream, token);
                
                case 'query':
                    return await this.handleQuery(request, stream, token);
                
                case 'articles':
                    return await this.handleArticles(request, stream, token);
                
                case 'addons':
                    return await this.handleAddons(request, stream, token);
                
                case 'config':
                    return await this.handleConfig(request, stream, token);
                
                case 'logs':
                    return await this.handleLogs(request, stream, token);
                
                case 'install-tools':
                    return await this.handleInstallTools(request, stream, token);

                // 'dump' command removed — use Adminer for DB exports/imports
                
                default:
                    return await this.handleGeneral(request, stream, token);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
            return {
                metadata: { command, instanceName: undefined }
            };
        }
    }
    
    /**
     * Handle /create command
     */
    private async handleCreate(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        stream.progress('Creating REDAXO instance...');
        stream.markdown('To create a new instance, use the command palette:\n\n');
        
        const createCommand = 'redaxo-instances.createInstance';
        stream.button({
            command: createCommand,
            title: '➕ Create New Instance'
        });
        
        return { metadata: { command: 'create' } };
    }
    
    /**
     * Handle /start command
     */
    private async handleStart(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /start demo-site`');
            return { metadata: { command: 'start' } };
        }
        
        stream.progress(`Starting ${instanceName}...`);
        
        try {
            await this.dockerService.startInstance(instanceName);
            stream.markdown(`✅ Instance **${instanceName}** started successfully!`);
            
            // Add button to open in browser
            stream.button({
                command: 'redaxo-instances.openInBrowser',
                title: '🌐 Open in Browser',
                arguments: [instanceName]
            });
        } catch (error: any) {
            stream.markdown(`❌ Failed to start instance: ${error.message}`);
        }
        
        return { metadata: { command: 'start', instanceName } };
    }
    
    /**
     * Handle /stop command
     */
    private async handleStop(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /stop demo-site`');
            return { metadata: { command: 'stop' } };
        }
        
        stream.progress(`Stopping ${instanceName}...`);
        
        try {
            await this.dockerService.stopInstance(instanceName);
            stream.markdown(`✅ Instance **${instanceName}** stopped successfully!`);
        } catch (error: any) {
            stream.markdown(`❌ Failed to stop instance: ${error.message}`);
        }
        
        return { metadata: { command: 'stop', instanceName } };
    }
    
    /**
     * Handle /console command
     */
    private async handleConsole(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const { instanceName, command } = this.parseConsoleCommand(request.prompt);
        
        if (!instanceName || !command) {
            stream.markdown('Please specify instance and command. For example: `@redaxo /console demo-site cache:clear`');
            return { metadata: { command: 'console' } };
        }
        
        stream.progress(`Executing ${command} on ${instanceName}...`);
        
        try {
            const result = await this.dockerService.console.execute(instanceName, command);
            
            if (result.success) {
                stream.markdown(`✅ **Command executed successfully**\n\n`);
                if (result.output) {
                    stream.markdown('```\n' + result.output + '\n```');
                }
            } else {
                stream.markdown(`❌ **Command failed**\n\n${result.error}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'console', instanceName } };
    }
    
    /**
     * Handle /query command
     */
    private async handleQuery(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const parsed = this.parseDatabaseQuery(request.prompt);
        
        if (!parsed.instanceName || !parsed.query) {
            stream.markdown('Please specify instance and query. For example: `@redaxo /query demo-site SELECT * FROM rex_article LIMIT 5`');
            return { metadata: { command: 'query' } };
        }
        
        stream.progress(`Executing query on ${parsed.instanceName}...`);
        
        try {
            // Get actual DB container name
            const dbContainerName = await this.dockerService.getDbContainerName(parsed.instanceName);
            if (!dbContainerName) {
                stream.markdown(`❌ Database container not found for instance "${parsed.instanceName}". Instance may not exist.`);
                return { metadata: { command: 'query', instanceName: parsed.instanceName } };
            }
            
            const result = await this.dockerService.database.query(dbContainerName, parsed.query);
            
            if (result.success) {
                stream.markdown(`✅ **Query executed successfully** (${result.rowCount} rows)\n\n`);
                
                if (result.rows.length > 0) {
                    // Show results as table
                    stream.markdown('```json\n' + JSON.stringify(result.rows, null, 2) + '\n```');
                }
            } else {
                stream.markdown(`❌ **Query failed**\n\n${result.error}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'query', instanceName: parsed.instanceName } };
    }
    
    /**
     * Handle /articles command
     */
    private async handleArticles(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /articles demo-site`');
            return { metadata: { command: 'articles' } };
        }
        
        stream.progress(`Loading articles from ${instanceName}...`);
        
        try {
            // Get actual DB container name
            const dbContainerName = await this.dockerService.getDbContainerName(instanceName);
            if (!dbContainerName) {
                stream.markdown(`❌ Database container not found for instance "${instanceName}". Instance may not exist.`);
                return { metadata: { command: 'articles', instanceName } };
            }
            
            const result = await this.dockerService.database.getArticles(dbContainerName, 20);
            
            if (result.success && result.rows.length > 0) {
                stream.markdown(`## 📄 Articles in ${instanceName} (${result.rowCount} total)\n\n`);
                
                result.rows.forEach((article: any) => {
                    stream.markdown(`- **${article.name || article.id}** (ID: ${article.id})\n`);
                });
            } else {
                stream.markdown(`No articles found in ${instanceName}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'articles', instanceName } };
    }
    
    /**
     * Handle /addons command
     */
    private async handleAddons(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /addons demo-site`');
            return { metadata: { command: 'addons' } };
        }
        
        stream.progress(`Loading addons from ${instanceName}...`);
        
        try {
            const result = await this.dockerService.console.listPackages(instanceName);
            
            if (result.success) {
                stream.markdown(`## 📦 AddOns in ${instanceName}\n\n`);
                stream.markdown('```\n' + result.output + '\n```');
            } else {
                stream.markdown(`❌ Failed to list addons: ${result.error}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'addons', instanceName } };
    }
    
    /**
     * Handle /config command
     */
    private async handleConfig(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /config demo-site`');
            return { metadata: { command: 'config' } };
        }
        
        stream.progress(`Reading config from ${instanceName}...`);
        
        try {
            const result = await this.dockerService.fileSystem.readConfig(instanceName);
            
            if (result.success) {
                stream.markdown(`## ⚙️ Configuration for ${instanceName}\n\n`);
                stream.markdown('```yaml\n' + result.content + '\n```');
            } else {
                stream.markdown(`❌ Failed to read config: ${result.error}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'config', instanceName } };
    }
    
    /**
     * Handle /logs command
     */
    private async handleLogs(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /logs demo-site`');
            return { metadata: { command: 'logs' } };
        }
        
        stream.progress(`Reading logs from ${instanceName}...`);
        
        try {
            // Get actual container name
            const containerName = await this.dockerService.getWebContainerName(instanceName);
            if (!containerName) {
                stream.markdown(`❌ Container not found for instance "${instanceName}". Instance may not exist.`);
                return { metadata: { command: 'logs', instanceName } };
            }
            
            const logs = await this.dockerService.fileSystem.getRecentLogs(containerName, 20);
            
            if (logs.length > 0) {
                stream.markdown(`## 📊 Recent logs for ${instanceName}\n\n`);
                stream.markdown('```\n' + logs.join('\n') + '\n```');
            } else {
                stream.markdown(`No logs found for ${instanceName}`);
            }
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'logs', instanceName } };
    }
    
    /**
     * Handle /install-tools command
     */
    private async handleInstallTools(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        const instanceName = this.extractInstanceName(request.prompt);
        
        if (!instanceName) {
            stream.markdown('Please specify an instance name. For example: `@redaxo /install-tools demo-site`');
            return { metadata: { command: 'install-tools' } };
        }
        
        stream.progress(`Installing CLI tools for ${instanceName}...`);
        
        try {
            // Get both container names
            const webContainer = await this.dockerService.getWebContainerName(instanceName);
            const dbContainer = await this.dockerService.getDbContainerName(instanceName);
            
            if (!webContainer && !dbContainer) {
                stream.markdown(`❌ No containers found for instance "${instanceName}"`);
                return { metadata: { command: 'install-tools', instanceName } };
            }
            
            stream.markdown(`## 🔧 Installing CLI Tools for ${instanceName}\n\n`);
            
            // Install tools in web container
            if (webContainer) {
                stream.markdown(`### Web Container: ${webContainer}\n`);
                stream.progress(`Installing tools in ${webContainer}...`);
                
                const webTools = await this.installWebContainerTools(webContainer, stream);
                stream.markdown(`✅ Installed ${webTools.installed.length} tools\n`);
                if (webTools.installed.length > 0) {
                    stream.markdown(`- ${webTools.installed.join(', ')}\n`);
                }
                if (webTools.failed.length > 0) {
                    stream.markdown(`⚠️ Failed: ${webTools.failed.join(', ')}\n`);
                }
                stream.markdown('\n');
            }
            
            // Install tools in database container
            if (dbContainer) {
                stream.markdown(`### Database Container: ${dbContainer}\n`);
                stream.progress(`Installing tools in ${dbContainer}...`);
                
                const dbTools = await this.installDbContainerTools(dbContainer, stream);
                stream.markdown(`✅ Installed ${dbTools.installed.length} tools\n`);
                if (dbTools.installed.length > 0) {
                    stream.markdown(`- ${dbTools.installed.join(', ')}\n`);
                }
                if (dbTools.failed.length > 0) {
                    stream.markdown(`⚠️ Failed: ${dbTools.failed.join(', ')}\n`);
                }
            }
            
            stream.markdown(`\n🎉 Tool installation complete!`);
            
        } catch (error: any) {
            stream.markdown(`❌ Error: ${error.message}`);
        }
        
        return { metadata: { command: 'install-tools', instanceName } };
    }

    // Dump handlers removed — use Adminer for DB export/import workflows
    
    /**
     * Install tools in web container
     */
    private async installWebContainerTools(containerName: string, stream: vscode.ChatResponseStream): Promise<{installed: string[], failed: string[]}> {
        const tools = ['vim', 'nano', 'curl', 'wget', 'unzip', 'git'];
        const installed: string[] = [];
        const failed: string[] = [];
        
        for (const tool of tools) {
            try {
                // Check if already installed
                const checkCmd = `docker exec ${containerName} which ${tool}`;
                try {
                    await this.execCommand(checkCmd);
                    installed.push(tool);
                    continue;
                } catch {
                    // Not installed, try to install
                }
                
                // Try apt-get first (Debian/Ubuntu)
                try {
                    await this.execCommand(`docker exec ${containerName} sh -c 'apt-get update && apt-get install -y ${tool}'`, 60000);
                    installed.push(tool);
                    continue;
                } catch {}
                
                // Try apk (Alpine)
                try {
                    await this.execCommand(`docker exec ${containerName} apk add --no-cache ${tool}`, 60000);
                    installed.push(tool);
                    continue;
                } catch {}
                
                failed.push(tool);
            } catch {
                failed.push(tool);
            }
        }
        
        return { installed, failed };
    }
    
    /**
     * Install tools in database container
     */
    private async installDbContainerTools(containerName: string, stream: vscode.ChatResponseStream): Promise<{installed: string[], failed: string[]}> {
        const tools = ['vim', 'nano'];
        const installed: string[] = [];
        const failed: string[] = [];
        
        // Check which database tools are available (MySQL vs MariaDB)
        let dbClientTool = '';
        let dbDumpTool = '';
        
        // Try mariadb first (MariaDB images)
        try {
            await this.execCommand(`docker exec ${containerName} which mariadb`);
            dbClientTool = 'mariadb';
            installed.push('mariadb');
        } catch {
            // Try mysql (MySQL images)
            try {
                await this.execCommand(`docker exec ${containerName} which mysql`);
                dbClientTool = 'mysql';
                installed.push('mysql');
            } catch {
                // Neither installed, try to install
                try {
                    // Try apt-get first (Debian/Ubuntu)
                    await this.execCommand(`docker exec ${containerName} sh -c 'apt-get update && apt-get install -y default-mysql-client'`, 60000);
                    dbClientTool = 'mysql';
                    installed.push('mysql');
                } catch {
                    // Try apk (Alpine)
                    try {
                        await this.execCommand(`docker exec ${containerName} apk add --no-cache mariadb-client`, 60000);
                        dbClientTool = 'mariadb';
                        installed.push('mariadb');
                    } catch {
                        failed.push('mysql/mariadb');
                    }
                }
            }
        }
        
        // Check dump tool
        try {
            await this.execCommand(`docker exec ${containerName} which mariadb-dump`);
            dbDumpTool = 'mariadb-dump';
            installed.push('mariadb-dump');
        } catch {
            try {
                await this.execCommand(`docker exec ${containerName} which mysqldump`);
                dbDumpTool = 'mysqldump';
                installed.push('mysqldump');
            } catch {
                // Usually comes with client package
                if (dbClientTool === 'mariadb') {
                    dbDumpTool = 'mariadb-dump';
                    // Check again after client installation
                    try {
                        await this.execCommand(`docker exec ${containerName} which mariadb-dump`);
                        installed.push('mariadb-dump');
                    } catch {}
                } else if (dbClientTool === 'mysql') {
                    dbDumpTool = 'mysqldump';
                    try {
                        await this.execCommand(`docker exec ${containerName} which mysqldump`);
                        installed.push('mysqldump');
                    } catch {}
                }
            }
        }
        
        // Install other tools
        for (const tool of tools) {
            try {
                // Check if already installed
                try {
                    await this.execCommand(`docker exec ${containerName} which ${tool}`);
                    installed.push(tool);
                    continue;
                } catch {
                    // Not installed, try to install
                }
                
                // Try apt-get first
                try {
                    await this.execCommand(`docker exec ${containerName} sh -c 'apt-get update && apt-get install -y ${tool}'`, 60000);
                    installed.push(tool);
                    continue;
                } catch {}
                
                // Try apk (Alpine)
                try {
                    await this.execCommand(`docker exec ${containerName} apk add --no-cache ${tool}`, 60000);
                    installed.push(tool);
                    continue;
                } catch {}
                
                failed.push(tool);
            } catch {
                failed.push(tool);
            }
        }
        
        return { installed, failed };
    }
    
    /**
     * Execute command with promisified exec
     */
    private async execCommand(command: string, timeout: number = 30000): Promise<string> {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const { stdout } = await execAsync(command, { timeout });
        return stdout.trim();
    }
    
    /**
     * Handle general queries (no slash command)
     */
    private async handleGeneral(
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<RedaxoChatResult> {
        
        // Show available commands
        stream.markdown('## 🎯 REDAXO Multi-Instances Manager\n\n');
        stream.markdown('I can help you manage your REDAXO instances. Here are the available commands:\n\n');
        stream.markdown('- `/create` - Create a new instance\n');
        stream.markdown('- `/start <name>` - Start an instance\n');
        stream.markdown('- `/stop <name>` - Stop an instance\n');
        stream.markdown('- `/console <name> <command>` - Execute console command\n');
        stream.markdown('- `/query <name> <sql>` - Execute database query\n');
        stream.markdown('- `/articles <name>` - Show articles\n');
        stream.markdown('- `/addons <name>` - List addons\n');
        stream.markdown('- `/config <name>` - Show configuration\n');
        stream.markdown('- `/logs <name>` - Show recent logs\n');
        stream.markdown('- `/install-tools <name>` - Install CLI tools (vim, nano, curl, mysql, etc.)\n\n');
        
        // Try to list instances
        try {
            const instances = await this.dockerService.listInstances();
            if (instances.length > 0) {
                stream.markdown('**Your instances:**\n\n');
                instances.forEach(instance => {
                    const status = instance.running ? '🟢 Running' : '⚫ Stopped';
                    stream.markdown(`- ${status} **${instance.name}** (PHP ${instance.phpVersion})\n`);
                });
            }
        } catch (error) {
            // Ignore
        }
        
        return { metadata: { command: 'general' } };
    }
    
    /**
     * Provide follow-up suggestions
     */
    private provideFollowups(
        result: RedaxoChatResult,
        context: vscode.ChatContext,
        token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
        
        const followups: vscode.ChatFollowup[] = [];
        
        if (result.metadata.command === 'start' && result.metadata.instanceName) {
            followups.push({
                prompt: `Show login info for ${result.metadata.instanceName}`,
                label: '🔑 Show login credentials'
            });
            followups.push({
                prompt: `@redaxo /articles ${result.metadata.instanceName}`,
                label: '📄 Show articles'
            });
        }
        
        if (result.metadata.command === 'articles') {
            followups.push({
                prompt: `@redaxo /addons ${result.metadata.instanceName}`,
                label: '📦 Show addons'
            });
        }
        
        if (result.metadata.command === 'console') {
            followups.push({
                prompt: `@redaxo /logs ${result.metadata.instanceName}`,
                label: '📊 Show logs'
            });
        }
        
        return followups;
    }
    
    // ========================================
    // Helper methods
    // ========================================
    
    private extractInstanceName(prompt: string): string | null {
        // Extract first word as instance name
        const match = prompt.match(/^\s*(\S+)/);
        return match ? match[1] : null;
    }
    
    private parseConsoleCommand(prompt: string): { instanceName: string | null; command: string | null } {
        // Format: "instance-name command args..."
        const parts = prompt.trim().split(/\s+/);
        if (parts.length < 2) {
            return { instanceName: null, command: null };
        }
        
        return {
            instanceName: parts[0],
            command: parts.slice(1).join(' ')
        };
    }
    
    private parseDatabaseQuery(prompt: string): { instanceName: string | null; query: string | null } {
        // Format: "instance-name SELECT ..."
        const match = prompt.match(/^\s*(\S+)\s+(SELECT|INSERT|UPDATE|DELETE|SHOW|DESCRIBE)(.*)$/i);
        if (!match) {
            return { instanceName: null, query: null };
        }
        
        return {
            instanceName: match[1],
            query: (match[2] + match[3]).trim()
        };
    }
    
    /**
     * Dispose the chat participant
     */
    dispose(): void {
        // Participant is already disposed via context.subscriptions
    }
}
