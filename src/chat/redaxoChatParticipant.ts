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
        const { instanceName, query } = this.parseDatabaseQuery(request.prompt);
        
        if (!instanceName || !query) {
            stream.markdown('Please specify instance and query. For example: `@redaxo /query demo-site SELECT * FROM rex_article LIMIT 5`');
            return { metadata: { command: 'query' } };
        }
        
        stream.progress(`Executing query on ${instanceName}...`);
        
        try {
            const result = await this.dockerService.database.query(instanceName, query);
            
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
        
        return { metadata: { command: 'query', instanceName } };
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
            const result = await this.dockerService.database.getArticles(instanceName, 20);
            
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
            const logs = await this.dockerService.fileSystem.getRecentLogs(instanceName, 20);
            
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
        stream.markdown('- `/logs <name>` - Show recent logs\n\n');
        
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
