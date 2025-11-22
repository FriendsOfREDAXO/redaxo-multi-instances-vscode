import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './docker/dockerService';
import { ResourceMonitor } from './docker/resourceMonitor';
import { InstancesProvider } from './providers/instancesProvider';
import { EmptyInstanceProvider } from './emptyInstance/emptyInstanceProvider';
import { RedaxoChatParticipant } from './chat/redaxoChatParticipant';
import { AdminerService } from './docker/adminerService';
import { RedaxoConsoleService } from './docker/redaxoConsoleService';
import { DatabaseQueryService } from './docker/databaseQueryService';
import { FileSystemService } from './docker/fileSystemService';

const execAsync = promisify(exec);

async function dirExists(p: string): Promise<boolean> {
    try {
        const stat = await fs.stat(p);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

let dockerService: DockerService;
let instancesProvider: InstancesProvider;
let emptyInstanceProvider: EmptyInstanceProvider;
let outputChannel: vscode.OutputChannel;
let chatParticipant: RedaxoChatParticipant;
let adminerService: AdminerService;

export function activate(context: vscode.ExtensionContext) {
    console.log('REDAXO Multi-Instances Manager is now active!');

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('REDAXO Instances');
    context.subscriptions.push(outputChannel);
    
    // Initialize services
    dockerService = new DockerService(outputChannel);
    instancesProvider = new InstancesProvider(dockerService);
    emptyInstanceProvider = new EmptyInstanceProvider(context.extensionUri, dockerService);
    adminerService = new AdminerService(outputChannel);
    
    // Initialize services with DockerService
    RedaxoConsoleService.initialize(dockerService);
    DatabaseQueryService.initialize(dockerService);
    FileSystemService.initialize(dockerService);
    
    // Initialize Chat Participant
    chatParticipant = new RedaxoChatParticipant(context, dockerService);

    // Register Tree Views
    const treeView = vscode.window.createTreeView('redaxo-instances.instancesView', {
        treeDataProvider: instancesProvider,
        showCollapseAll: true,
        canSelectMany: false
    });
    
    const emptyInstanceView = vscode.window.registerWebviewViewProvider(
        EmptyInstanceProvider.viewType,
        emptyInstanceProvider,
        {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }
    );
    
    context.subscriptions.push(treeView, emptyInstanceView);

    // Register Commands
    registerCommands(context);

    // Initialize and start monitoring
    initialize();
}

function registerCommands(context: vscode.ExtensionContext) {
    const commands = [
        // Instance Management
        vscode.commands.registerCommand('redaxo-instances.refresh', () => {
            instancesProvider.refresh();
        }),

        vscode.commands.registerCommand('redaxo-instances.showInstanceContextMenu', async (instanceName: string) => {
            const instance = instancesProvider.getInstance(instanceName);
            if (!instance) {
                return;
            }

            // Create QuickPick with all available actions for the instance
            const quickPick = vscode.window.createQuickPick();
            quickPick.title = `Instance Actions: ${instanceName}`;
            quickPick.placeholder = 'Select an action to perform';

            const items = [];

            // Control actions
            if (instance.running) {
                items.push({
                    label: '$(stop) Stop Instance',
                    description: 'Stop the running instance',
                    command: 'redaxo-instances.stopInstance'
                });
            } else {
                items.push({
                    label: '$(play) Start Instance',
                    description: 'Start the stopped instance',
                    command: 'redaxo-instances.startInstance'
                });
            }

            // Browser actions (only for running instances)
            if (instance.running) {
                items.push({
                    label: '$(link-external) Open Frontend',
                    description: 'Open frontend in browser',
                    command: 'redaxo-instances.openInBrowser'
                });
                items.push({
                    label: '$(gear) Open Backend',
                    description: 'Open REDAXO backend in browser',
                    command: 'redaxo-instances.openBackend'
                });
            }

            // Always available actions
            items.push(
                {
                    label: '$(terminal) Open Container Terminal',
                    description: 'Open terminal inside container',
                    command: 'redaxo-instances.openTerminal'
                },
                {
                    label: '$(output) Show Container Logs',
                    description: 'View container logs',
                    command: 'redaxo-instances.showLogs'
                },
                {
                    label: '$(key) Login Information',
                    description: 'Show login credentials and database info',
                    command: 'redaxo-instances.getLoginInfo'
                },
                // Export/Import handled through Adminer → removed
                {
                    label: '$(shield) Setup HTTPS/SSL',
                    description: 'Configure SSL certificate',
                    command: 'redaxo-instances.setupSSL'
                },
                {
                    label: '$(tools) Repair Instance',
                    description: 'Repair instance configuration',
                    command: 'redaxo-instances.repairInstance'
                },
                {
                    label: '$(globe) Add to Hosts File',
                    description: 'Add domain to hosts file',
                    command: 'redaxo-instances.updateHosts'
                },
                {
                    label: '$(folder) Open Workspace in VS Code',
                    description: 'Open instance folder as workspace',
                    command: 'redaxo-instances.openWorkspace'
                },
                {
                    label: '$(folder-opened) Open in Finder',
                    description: 'Open instance folder in Finder',
                    command: 'redaxo-instances.openInFinder'
                },
                {
                    label: '$(trash) Delete Instance',
                    description: 'Delete instance permanently',
                    command: 'redaxo-instances.deleteInstance'
                }
            );

            quickPick.items = items;

            quickPick.onDidChangeSelection(selection => {
                if (selection[0]) {
                    const selectedItem = selection[0] as any;
                    quickPick.hide();
                    vscode.commands.executeCommand(selectedItem.command, instanceName);
                }
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        }),

        vscode.commands.registerCommand('redaxo-instances.showHelp', async () => {
            const panel = vscode.window.createWebviewPanel(
                'redaxoHelp',
                'REDAXO Multi-Instances - Help & Documentation',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                message => {
                    if (message.command === 'executeCommand') {
                        vscode.commands.executeCommand(message.value);
                    }
                }
            );

            panel.webview.html = getHelpHtml();
        }),

        vscode.commands.registerCommand('redaxo-instances.openReadme', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const readmePath = vscode.Uri.joinPath(workspaceFolder.uri, 'README.md');
                try {
                    await vscode.commands.executeCommand('markdown.showPreview', readmePath);
                } catch (error) {
                    // Fallback: open as text file
                    await vscode.window.showTextDocument(readmePath);
                }
            } else {
                vscode.window.showInformationMessage('README ist nur in einem Workspace verfügbar.');
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.changeInstancesPath', async () => {
            try {
                const newPath = await dockerService.changeInstancesDirectory();
                vscode.window.showInformationMessage(`Instances folder changed to: ${newPath}`);
                instancesProvider.refresh();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to change instances folder: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.createInstance', async () => {
            const options = await getInstanceCreationOptions();
            if (options) {
                try {
                    // Show the output channel from the start
                    outputChannel.clear();
                    outputChannel.appendLine(`🚀 Creating REDAXO instance: ${options.name}`);
                    outputChannel.appendLine(`🕐 Started at: ${new Date().toLocaleString()}`);
                    outputChannel.appendLine(`📝 Options: ${JSON.stringify(options, null, 2)}`);
                    outputChannel.show(true);

                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Creating instance ${options.name}...`,
                        cancellable: false
                    }, async (progress, token) => {
                        progress.report({ increment: 10, message: 'Setting up directories...' });
                        outputChannel.appendLine(`📁 Setting up directories...`);
                        
                        progress.report({ increment: 30, message: 'Creating configuration files...' });
                        outputChannel.appendLine(`⚙️  Creating configuration files...`);
                        
                        progress.report({ increment: 50, message: 'Pulling Docker images...' });
                        outputChannel.appendLine(`🐳 Pulling Docker images...`);
                        
                        await dockerService.createInstance(options);
                        
                        progress.report({ increment: 90, message: 'Finalizing setup...' });
                        outputChannel.appendLine(`✅ Finalizing setup...`);
                    });
                    
                    instancesProvider.refresh();
                    outputChannel.appendLine(`🎉 Instance "${options.name}" created successfully!`);
                    outputChannel.appendLine(`💡 Instance is ready but not started yet.`);
                    outputChannel.appendLine(`🚀 To start: Right-click the instance → "Start Instance"`);
                    outputChannel.appendLine(`🌐 This ensures all configuration files are properly initialized before startup.`);
                    vscode.window.showInformationMessage(`Instance "${options.name}" created successfully! Start it manually when ready.`, 'Start Now').then(selection => {
                        if (selection === 'Start Now') {
                            vscode.commands.executeCommand('redaxo-instances.startInstance', options.name);
                        }
                    });
                    
                } catch (error: any) {
                    console.error('Failed to create instance:', error);
                    
                    // Show detailed error in the main output channel
                    outputChannel.appendLine(`❌ FAILED to create instance: ${options.name}`);
                    outputChannel.appendLine(`🕐 Failed at: ${new Date().toLocaleString()}`);
                    outputChannel.appendLine(`� Error Message: ${error.message || error.toString()}`);
                    
                    if (error.stack) {
                        outputChannel.appendLine(`\n� Full Stack Trace:`);
                        outputChannel.appendLine(error.stack);
                    }
                    
                    if (error.stderr) {
                        outputChannel.appendLine(`\n� Docker Command Output:`);
                        outputChannel.appendLine(error.stderr);
                    }
                    
                    if (error.stdout) {
                        outputChannel.appendLine(`\n� Docker Command Standard Output:`);
                        outputChannel.appendLine(error.stdout);
                    }
                    
                    outputChannel.show(true);
                    vscode.window.showErrorMessage(`Failed to create instance: ${error.message}`, 'Show Error Log').then(selection => {
                        if (selection === 'Show Error Log') {
                            outputChannel.show(true);
                        }
                    });
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.startInstance', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to start:');
            }
            
            if (instanceName) {
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Starting instance ${instanceName}...`,
                        cancellable: false
                    }, async () => {
                        await dockerService.startInstance(instanceName!);
                    });
                    instancesProvider.refresh();
                    vscode.window.showInformationMessage(`Instance "${instanceName}" started successfully!`);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to start instance: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.stopInstance', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to stop:');
            }
            
            if (instanceName) {
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Stopping instance ${instanceName}...`,
                        cancellable: false
                    }, async () => {
                        await dockerService.stopInstance(instanceName!);
                    });
                    instancesProvider.refresh();
                    vscode.window.showInformationMessage(`Instance "${instanceName}" stopped successfully!`);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to stop instance: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.deleteInstance', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to delete:');
            }
            
            if (instanceName) {
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete instance "${instanceName}"? This action cannot be undone.`,
                    { modal: true },
                    'Delete'
                );
                if (confirm === 'Delete') {
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Deleting instance ${instanceName}...`,
                            cancellable: false
                        }, async () => {
                            await dockerService.deleteInstance(instanceName!);
                        });
                        instancesProvider.refresh();
                        vscode.window.showInformationMessage(`Instance "${instanceName}" deleted successfully!`);
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to delete instance: ${error.message}`);
                    }
                }
            }
        }),

        // Browser Actions
        vscode.commands.registerCommand('redaxo-instances.openInBrowser', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to open frontend:');
            }
            
            if (instanceName) {
                const instance = await dockerService.getInstance(instanceName);
                if (instance && instance.running) {
                    vscode.env.openExternal(vscode.Uri.parse(instance.frontendUrl));
                } else {
                    vscode.window.showWarningMessage(`Instance "${instanceName}" is not running`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.openBackend', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to open backend:');
            }
            
            if (instanceName) {
                const instance = await dockerService.getInstance(instanceName);
                if (instance && instance.running) {
                    vscode.env.openExternal(vscode.Uri.parse(instance.backendUrl));
                } else {
                    vscode.window.showWarningMessage(`Instance "${instanceName}" is not running`);
                }
            }
        }),

        // Terminal Actions
        vscode.commands.registerCommand('redaxo-instances.openTerminal', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance for terminal:');
            }
            
            if (instanceName) {
                const terminal = vscode.window.createTerminal({
                    name: `REDAXO ${instanceName}`,
                    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                });
                terminal.show();
                terminal.sendText(`docker exec -it redaxo-${instanceName} bash`);
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.showLogs', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            let instanceType: 'redaxo' | 'custom' = 'redaxo';
            
            // Extract instance name and type from different input types
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
                instanceType = instanceItem.instance.instanceType === 'custom' ? 'custom' : 'redaxo';
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance to show logs:');
                if (instanceName) {
                    // Try to get instance type from provider
                    const instances = await dockerService.listInstances();
                    const foundInstance = instances.find(i => i.name === instanceName);
                    if (foundInstance) {
                        instanceType = foundInstance.instanceType === 'custom' ? 'custom' : 'redaxo';
                    }
                }
            }
            
            if (instanceName) {
                const containerNames = ResourceMonitor.getContainerNames(instanceName, instanceType);
                
                // Ask user which container logs to show
                const containerChoice = await vscode.window.showQuickPick([
                    { label: '🌐 Web Container', description: containerNames.web, value: containerNames.web },
                    { label: '🗄️ Database Container', description: containerNames.db, value: containerNames.db }
                ], {
                    placeHolder: `Select container for ${instanceName} logs`
                });
                
                if (containerChoice) {
                    const terminal = vscode.window.createTerminal({
                        name: `Logs: ${instanceName} (${containerChoice.label.replace(/[🌐🗄️]\s/, '')})`,
                        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                    });
                    terminal.show();
                    terminal.sendText(`docker logs -f ${containerChoice.value}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.showRedaxoLogs', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            let instanceType: 'redaxo' | 'custom' = 'redaxo';
            
            // Extract instance name and type from different input types
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
                instanceType = instanceItem.instance.instanceType === 'custom' ? 'custom' : 'redaxo';
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance to show REDAXO logs:');
                if (instanceName) {
                    // Try to get instance type from provider
                    const instances = await dockerService.listInstances();
                    const foundInstance = instances.find(i => i.name === instanceName);
                    if (foundInstance) {
                        instanceType = foundInstance.instanceType === 'custom' ? 'custom' : 'redaxo';
                    }
                }
            }
            
            if (instanceName) {
                try {
                    // Get web container name dynamically
                    const webContainerName = await dockerService.getWebContainerName(instanceName);
                    
                    if (!webContainerName) {
                        vscode.window.showErrorMessage(`❌ Could not find web container for ${instanceName}`);
                        return;
                    }
                    
                    // Check if container is running
                    const { stdout: psOutput } = await execAsync(`docker ps --filter "name=${webContainerName}" --format "{{.Names}}"`);
                    if (!psOutput.trim()) {
                        vscode.window.showWarningMessage(`⚠️ Container ${webContainerName} is not running. Please start the instance first.`);
                        return;
                    }
                    
                    // Import FileSystemService to read logs
                    const { FileSystemService } = await import('./docker/fileSystemService');
                    const logs = await FileSystemService.getRecentLogs(webContainerName, 100);
                    
                    if (!logs || logs.length === 0) {
                        vscode.window.showInformationMessage(`ℹ️ No REDAXO logs found for ${instanceName}`);
                        return;
                    }
                    
                    // Create output channel and show logs
                    const logsChannel = vscode.window.createOutputChannel(`REDAXO Logs: ${instanceName}`);
                    logsChannel.clear();
                    logsChannel.appendLine(`📋 REDAXO Logs for ${instanceName} (${webContainerName})`);
                    logsChannel.appendLine(`${'='.repeat(80)}\n`);
                    logs.forEach(log => logsChannel.appendLine(log));
                    logsChannel.show();
                    
                } catch (error: any) {
                    vscode.window.showErrorMessage(`❌ Failed to read REDAXO logs: ${error.message}`);
                    outputChannel.appendLine(`Error reading REDAXO logs: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.installCLITools', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            let instanceType: 'redaxo' | 'custom' = 'redaxo';
            
            // Extract instance name and type from different input types
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
                instanceType = instanceItem.instance.instanceType === 'custom' ? 'custom' : 'redaxo';
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance to install CLI tools:');
                if (instanceName) {
                    // Try to get instance type from provider
                    const instances = await dockerService.listInstances();
                    const foundInstance = instances.find(i => i.name === instanceName);
                    if (foundInstance) {
                        instanceType = foundInstance.instanceType === 'custom' ? 'custom' : 'redaxo';
                    }
                }
            }
            
            if (instanceName) {
                try {
                    // Get container names dynamically
                    const webContainerName = await dockerService.getWebContainerName(instanceName);
                    const dbContainerName = await dockerService.getDbContainerName(instanceName);
                    
                    if (!webContainerName || !dbContainerName) {
                        vscode.window.showErrorMessage(`❌ Could not find containers for ${instanceName}`);
                        return;
                    }
                    
                    // Show progress
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Installing CLI tools for ${instanceName}`,
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ increment: 0, message: 'Installing web container tools...' });
                        
                        const webTools = ['vim', 'nano', 'curl', 'wget', 'unzip', 'git'];
                        const webInstalled: string[] = [];
                        const webFailed: string[] = [];
                        
                        for (const tool of webTools) {
                            try {
                                // Check if tool already exists
                                await execAsync(`docker exec ${webContainerName} which ${tool}`);
                                webInstalled.push(tool);
                            } catch {
                                // Try to install
                                try {
                                    const installCommands = [
                                        `docker exec ${webContainerName} sh -c 'apt-get update && apt-get install -y ${tool}'`,
                                        `docker exec ${webContainerName} sh -c 'apk add --no-cache ${tool}'`,
                                        `docker exec ${webContainerName} sh -c 'yum install -y ${tool}'`
                                    ];
                                    
                                    let installed = false;
                                    for (const cmd of installCommands) {
                                        try {
                                            await execAsync(cmd, { timeout: 60000 });
                                            webInstalled.push(tool);
                                            installed = true;
                                            break;
                                        } catch {
                                            continue;
                                        }
                                    }
                                    
                                    if (!installed) {
                                        webFailed.push(tool);
                                    }
                                } catch {
                                    webFailed.push(tool);
                                }
                            }
                        }
                        
                        progress.report({ increment: 50, message: 'Installing database container tools...' });
                        
                        const dbInstalled: string[] = [];
                        const dbFailed: string[] = [];
                        
                        // Check for MariaDB client first, then MySQL
                        let dbClientTool = 'mysql';
                        let dumpTool = 'mysqldump';
                        
                        try {
                            await execAsync(`docker exec ${dbContainerName} which mariadb`);
                            dbClientTool = 'mariadb';
                            dumpTool = 'mariadb-dump';
                            dbInstalled.push('mariadb', 'mariadb-dump');
                        } catch {
                            try {
                                await execAsync(`docker exec ${dbContainerName} which mysql`);
                                dbInstalled.push('mysql', 'mysqldump');
                            } catch {
                                // Try to install
                                const installCommands = [
                                    `docker exec ${dbContainerName} sh -c 'apt-get update && apt-get install -y mariadb-client'`,
                                    `docker exec ${dbContainerName} sh -c 'apt-get update && apt-get install -y default-mysql-client'`,
                                    `docker exec ${dbContainerName} sh -c 'apk add --no-cache mariadb-client'`,
                                    `docker exec ${dbContainerName} sh -c 'yum install -y mariadb'`
                                ];
                                
                                let installed = false;
                                for (const cmd of installCommands) {
                                    try {
                                        await execAsync(cmd, { timeout: 60000 });
                                        // Check which tool was installed
                                        try {
                                            await execAsync(`docker exec ${dbContainerName} which mariadb`);
                                            dbInstalled.push('mariadb', 'mariadb-dump');
                                        } catch {
                                            dbInstalled.push('mysql', 'mysqldump');
                                        }
                                        installed = true;
                                        break;
                                    } catch {
                                        continue;
                                    }
                                }
                                
                                if (!installed) {
                                    dbFailed.push('mysql/mariadb', 'mysqldump/mariadb-dump');
                                }
                            }
                        }
                        
                        // Install vim and nano in DB container
                        for (const tool of ['vim', 'nano']) {
                            try {
                                await execAsync(`docker exec ${dbContainerName} which ${tool}`);
                                dbInstalled.push(tool);
                            } catch {
                                try {
                                    const installCommands = [
                                        `docker exec ${dbContainerName} sh -c 'apt-get update && apt-get install -y ${tool}'`,
                                        `docker exec ${dbContainerName} sh -c 'apk add --no-cache ${tool}'`,
                                        `docker exec ${dbContainerName} sh -c 'yum install -y ${tool}'`
                                    ];
                                    
                                    let installed = false;
                                    for (const cmd of installCommands) {
                                        try {
                                            await execAsync(cmd, { timeout: 60000 });
                                            dbInstalled.push(tool);
                                            installed = true;
                                            break;
                                        } catch {
                                            continue;
                                        }
                                    }
                                    
                                    if (!installed) {
                                        dbFailed.push(tool);
                                    }
                                } catch {
                                    dbFailed.push(tool);
                                }
                            }
                        }
                        
                        progress.report({ increment: 50, message: 'Done!' });
                        
                        // Show results
                        const message = [
                            `✅ CLI Tools Installation Complete for ${instanceName}`,
                            ``,
                            `📦 Web Container (${webContainerName}):`,
                            `  ✓ Installed: ${webInstalled.join(', ')}`,
                            webFailed.length > 0 ? `  ✗ Failed: ${webFailed.join(', ')}` : '',
                            ``,
                            `🗄️ Database Container (${dbContainerName}):`,
                            `  ✓ Installed: ${dbInstalled.join(', ')}`,
                            dbFailed.length > 0 ? `  ✗ Failed: ${dbFailed.join(', ')}` : ''
                        ].filter(Boolean).join('\n');
                        
                        vscode.window.showInformationMessage(message);
                        outputChannel.appendLine(message);
                    });
                    
                } catch (error: any) {
                    vscode.window.showErrorMessage(`❌ Failed to install CLI tools: ${error.message}`);
                    outputChannel.appendLine(`Error installing CLI tools: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.openInAdminer', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            let instanceType: 'redaxo' | 'custom' = 'redaxo';
            
            // Extract instance name and type
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
                instanceType = instanceItem.instance.instanceType === 'custom' ? 'custom' : 'redaxo';
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance to open in Adminer:');
                if (instanceName) {
                    const instances = await dockerService.listInstances();
                    const foundInstance = instances.find(i => i.name === instanceName);
                    if (foundInstance) {
                        instanceType = foundInstance.instanceType === 'custom' ? 'custom' : 'redaxo';
                    }
                }
            }
            
            if (instanceName) {
                try {
                    // Ensure Adminer is running
                    const isRunning = await adminerService.isAdminerRunning();
                    if (!isRunning) {
                        const startIt = await vscode.window.showInformationMessage(
                            '🔧 Adminer is not running. Start it now?',
                            'Yes', 'No'
                        );
                        
                        if (startIt === 'Yes') {
                            const started = await adminerService.startAdminer();
                            if (!started) {
                                return;
                            }
                        } else {
                            return;
                        }
                    }
                    
                    // Get DB container name
                    const dbContainerName = await dockerService.getDbContainerName(instanceName);
                    if (!dbContainerName) {
                        vscode.window.showErrorMessage(`❌ Could not find database container for ${instanceName}`);
                        return;
                    }
                    
                    // Connect DB container to Adminer network
                    await adminerService.connectInstanceToAdminer(instanceName, dbContainerName);
                    
                    // Get login info
                    const loginInfo = await dockerService.getLoginInfo(instanceName);
                    
                    // Build Adminer URL with credentials
                    // For custom instances, use the DNS-compliant hostname (remove underscores)
                    const server = instanceType === 'custom' 
                        ? `${instanceName.replace(/_/g, '')}db`  // Custom: wellingdb
                        : dbContainerName; // Standard: redaxo-{name}-mysql
                    const username = instanceType === 'custom' ? instanceName : 'redaxo';
                    const database = instanceType === 'custom' ? instanceName : 'redaxo';
                    const password = loginInfo.dbPassword;
                    
                    // Copy password to clipboard FIRST
                    await vscode.env.clipboard.writeText(password);
                    
                    // Create Adminer URL with pre-filled server and database
                    const adminerUrl = `http://localhost:9200/?username=${encodeURIComponent(username)}&db=${encodeURIComponent(database)}&server=${encodeURIComponent(server)}`;
                    
                    // Open in external browser
                    await vscode.env.openExternal(vscode.Uri.parse(adminerUrl));
                    
                    // Show notification
                    vscode.window.showInformationMessage(
                        `🗄️ Adminer opened for ${instanceName}\n✅ Password copied to clipboard - paste with Cmd+V`
                    );
                    
                } catch (error: any) {
                    vscode.window.showErrorMessage(`❌ Failed to open Adminer: ${error.message}`);
                    outputChannel.appendLine(`Error opening Adminer: ${error.message}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.startAdminer', async () => {
            try {
                const started = await adminerService.startAdminer();
                if (started) {
                    const status = await adminerService.getStatus();
                    vscode.window.showInformationMessage(`✅ Adminer started successfully!\n${status}`);
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`❌ Failed to start Adminer: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.stopAdminer', async () => {
            try {
                const stopped = await adminerService.stopAdminer();
                if (stopped) {
                    vscode.window.showInformationMessage('✅ Adminer stopped successfully');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`❌ Failed to stop Adminer: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('redaxo-instances.copyCopilotInstructions', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Extract instance name
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance for Copilot instructions:');
            }
            
            if (instanceName) {
                try {
                    // Get instance info
                    const loginInfo = await dockerService.getLoginInfo(instanceName);
                    const instances = await dockerService.listInstances();
                    const instance = instances.find(i => i.name === instanceName);
                    
                    if (!instance) {
                        vscode.window.showErrorMessage(`❌ Instance ${instanceName} not found`);
                        return;
                    }
                    
                    const isCustom = instance.instanceType === 'custom';
                    
                    // Get container names
                    const webContainerName = await dockerService.getWebContainerName(instanceName);
                    const dbContainerName = await dockerService.getDbContainerName(instanceName);
                    
                    // Build comprehensive instructions
                    const instructions = `# Context: REDAXO Instance "${instanceName}"

I'm working with a ${isCustom ? 'Custom REDAXO' : 'Standard REDAXO'} instance in a Docker environment. Here are all the technical details you need to help me:

## Instance Overview
- **Name**: \`${instanceName}\`
- **Type**: ${isCustom ? '📦 Custom Instance (manually configured)' : '🔷 Standard REDAXO Instance (pre-configured)'}
- **Status**: ${loginInfo.running ? '🟢 Running' : '🔴 Stopped'}
- **PHP Version**: ${instance.phpVersion || 'N/A'}
- **Database**: MariaDB 11.3

## Docker Environment
**Containers:**
- Web: \`${webContainerName || 'N/A'}\`
- Database: \`${dbContainerName || 'N/A'}\`

**Quick Shell Access:**
\`\`\`bash
# Web container (PHP/REDAXO)
docker exec -it ${webContainerName} bash

# Database container (MariaDB)
docker exec -it ${dbContainerName} bash

# View logs
docker logs ${webContainerName}
docker logs ${dbContainerName}
\`\`\`

## Web Access
**URLs:**
- Frontend: ${loginInfo.frontendUrl}
- Backend: ${loginInfo.backendUrl}
${loginInfo.frontendUrlHttps ? `- Frontend HTTPS: ${loginInfo.frontendUrlHttps}\n- Backend HTTPS: ${loginInfo.backendUrlHttps}` : ''}

**REDAXO Admin:**
${isCustom ? '⚠️ Custom instance - REDAXO may need to be installed via Setup' : `- Username: \`${loginInfo.adminUser}\`\n- Password: \`${loginInfo.adminPassword}\``}

## Database Configuration
**Internal (Container-to-Container):**
\`\`\`
Host: ${loginInfo.dbHost}
Database: ${loginInfo.dbName}
User: ${loginInfo.dbUser}
Password: ${loginInfo.dbPassword}
Root Password: ${loginInfo.dbRootPassword}
\`\`\`

**External (Host Access):**
\`\`\`bash
# MySQL CLI Connection
mysql -h ${loginInfo.dbExternalHost} -P ${loginInfo.dbExternalPort} -u ${loginInfo.dbUser} -p${loginInfo.dbPassword} ${loginInfo.dbName}

# Or via Adminer: http://localhost:9200
# Server: ${isCustom ? `${instanceName.replace(/_/g, '')}db` : dbContainerName}
# Username: ${isCustom ? instanceName : 'redaxo'}
# Password: ${loginInfo.dbPassword}
# Database: ${isCustom ? instanceName : 'redaxo'}
\`\`\`

## REDAXO Console Commands
\`\`\`bash
# Via Docker exec
docker exec ${webContainerName} php redaxo/bin/console <command>

# Common commands:
docker exec ${webContainerName} php redaxo/bin/console cache:clear
docker exec ${webContainerName} php redaxo/bin/console package:list
docker exec ${webContainerName} php redaxo/bin/console package:install <addon>
docker exec ${webContainerName} php redaxo/bin/console user:list

# Via @redaxo Chat (easier):
@redaxo /console ${instanceName} cache:clear
@redaxo /console ${instanceName} package:list
\`\`\`

## File System Access
**Project Structure:**
\`\`\`
${isCustom ? `./                              # Workspace Root
├── docker-compose.yml          # Docker configuration
├── Dockerfile                  # Custom PHP image
├── .env                        # Environment variables
├── database/                   # MariaDB data directory
├── logs/                       # Application logs
└── project/                    # Application root
    ├── composer.json
    ├── src/                    # Custom PHP code
    ├── var/                    # Runtime data (cache, logs)
    ├── vendor/                 # Composer dependencies
    └── public/                 # Web root (Document Root)
        ├── index.php
        ├── assets/             # Public assets
        ├── media/              # Media files
        └── redaxo/             # REDAXO installation (if installed)
            ├── index.php
            ├── src/
            │   ├── core/
            │   └── addons/
            └── bin/console     # REDAXO CLI` : `./                              # Workspace Root
├── docker-compose.yml          # Docker configuration
├── .env                        # Environment variables
├── data/                       # Data directory
│   ├── mysql/                  # MariaDB data
│   └── redaxo/                 # REDAXO installation (Web root = Document Root)
│       ├── index.php
│       ├── assets/
│       ├── media/              # Media uploads
│       ├── redaxo/
│       │   ├── bin/console     # REDAXO CLI
│       │   ├── data/
│       │   │   ├── addons/
│       │   │   ├── cache/
│       │   │   └── core/
│       │   │       ├── config.yml
│       │   │       ├── redaxo.log
│       │   │       └── system.log
│       │   └── src/
│       │       ├── core/
│       │       └── addons/
│       ├── apache-ssl.conf/    # SSL configuration
│       ├── mysql-init/         # Database init scripts
│       └── ssl/                # SSL certificates`}
\`\`\`

**Important Paths (relative to workspace):**
- Docker Config: \`./docker-compose.yml\`
- Environment: \`./env\`
${isCustom ? `- Web Root: \`./project/public/\`
- REDAXO Root: \`./project/public/redaxo/\` (if installed)
- REDAXO Console: \`./project/public/redaxo/bin/console\`
- REDAXO Config: \`./project/public/redaxo/redaxo/data/core/config.yml\`
- REDAXO Logs: \`./project/public/redaxo/redaxo/data/core/\`
- Application Code: \`./project/src/\`
- Composer Vendor: \`./project/vendor/\`
- Runtime Cache: \`./project/var/cache/\`
- Application Logs: \`./logs/\`
- Database Data: \`./database/\`` : `- Web Root: \`./data/redaxo/\`
- REDAXO Root: \`./data/redaxo/\`
- REDAXO Console: \`./data/redaxo/redaxo/bin/console\`
- REDAXO Config: \`./data/redaxo/redaxo/data/core/config.yml\`
- REDAXO Logs: \`./data/redaxo/redaxo/data/core/\`
- Media Files: \`./data/redaxo/media/\`
- Database Data: \`./data/mysql/\`
- SSL Certificates: \`./ssl/\``}

## Quick Actions via VS Code Extension
**Use @redaxo in GitHub Copilot Chat:**
\`\`\`
@redaxo /start ${instanceName}              # Start instance
@redaxo /stop ${instanceName}               # Stop instance
@redaxo /console ${instanceName} <cmd>      # Run REDAXO console command
@redaxo /query ${instanceName} <SQL>        # Execute SQL query
@redaxo /articles ${instanceName}           # List articles
@redaxo /addons ${instanceName}             # List addons
@redaxo /logs ${instanceName}               # View container logs
@redaxo /install-tools ${instanceName}      # Install CLI tools (vim, nano, git, etc.)
\`\`\`

## Common Tasks & Solutions
${isCustom ? `
**Custom Instance - REDAXO Installation:**
1. Download REDAXO: https://redaxo.org/download/core/
2. Extract to: \`./project/public/\`
3. Open browser: ${loginInfo.frontendUrl}
4. Follow REDAXO setup wizard
5. Use database credentials above

**Custom Instance - Manual Setup:**
- PHP available via: \`docker exec ${webContainerName} php <file>\`
- Composer: \`docker exec ${webContainerName} composer <command>\`
- NPM/Node: Install via \`@redaxo /install-tools ${instanceName}\`
` : `
**Standard REDAXO Instance:**
- Pre-installed and configured
- Admin access ready to use
- AddOns installable via Backend or Console
`}
**Database Management:**
- Quick access via context menu: Right-click → "Open in Adminer"
- Password auto-copied to clipboard
- Or use MySQL CLI with credentials above

**Debugging:**
- REDAXO Logs: Right-click instance → "Show REDAXO Logs"
- Container Logs: \`docker logs ${webContainerName}\`
- PHP Errors: Check \`${isCustom ? './project/public' : './data'}/redaxo/redaxo/data/core/redaxo.log\`
- System Logs: Check \`${isCustom ? './project/public' : './data'}/redaxo/redaxo/data/core/system.log\`

**Performance:**
- Clear cache: \`@redaxo /console ${instanceName} cache:clear\`
- Check MySQL: \`@redaxo /query ${instanceName} SHOW PROCESSLIST\`
- Container stats: \`docker stats ${webContainerName} ${dbContainerName}\`

---

## 📚 REDAXO Development Guidelines

**Important File Paths:**
\`\`\`
${isCustom ? `./project/public/redaxo/        # REDAXO installation (if installed)
├── index.php
├── assets/                    # Frontend assets
├── media/                     # Media files
└── redaxo/                    # Backend & Core
    ├── index.php              # Backend entry
    ├── bin/console            # REDAXO CLI
    ├── data/
    │   ├── core/
    │   │   ├── config.yml     # Main configuration
    │   │   ├── redaxo.log
    │   │   └── system.log
    │   ├── addons/            # AddOn data
    │   └── cache/             # Cache files
    └── src/
        ├── core/              # REDAXO Core
        └── addons/            # System AddOns
            └── <addon>/
                ├── boot.php
                ├── install.php
                ├── uninstall.php
                ├── package.yml
                ├── lib/       # PHP Classes
                ├── pages/     # Backend pages
                ├── fragments/ # UI fragments
                ├── lang/      # Translations
                ├── assets/    # CSS/JS/Images
                └── vendor/    # Composer deps` : `./data/redaxo/                # REDAXO installation (Web Root)
├── index.php
├── assets/                    # Frontend assets
├── media/                     # Media files
└── redaxo/                    # Backend & Core
    ├── index.php              # Backend entry
    ├── bin/console            # REDAXO CLI
    ├── data/
    │   ├── core/
    │   │   ├── config.yml     # Main configuration
    │   │   ├── redaxo.log
    │   │   └── system.log
    │   ├── addons/            # AddOn data
    │   └── cache/             # Cache files
    └── src/
        ├── core/              # REDAXO Core
        └── addons/            # System AddOns
            └── <addon>/
                ├── boot.php
                ├── install.php
                ├── uninstall.php
                ├── package.yml
                ├── lib/       # PHP Classes
                ├── pages/     # Backend pages
                ├── fragments/ # UI fragments
                ├── lang/      # Translations
                ├── assets/    # CSS/JS/Images
                └── vendor/    # Composer deps`}
\`\`\`

**REDAXO Best Practices - MANDATORY:**

1. **Use REDAXO APIs First** ⚠️
   - Always check if REDAXO provides native methods before implementing custom solutions
   - Study existing AddOns and Core code for patterns
   - Reference: https://redaxo.org/doku/main/

2. **Common REDAXO Classes & Methods:**
   \`\`\`php
   // Articles & Categories
   rex_article::get($id)
   rex_article::getAll()
   rex_category::get($id)
   
   // Database (rex_sql)
   $sql = rex_sql::factory();
   $sql->setQuery("SELECT * FROM rex_article");
   
   // Config & Settings
   rex_config::get('addon', 'key')
   rex_config::set('addon', 'key', 'value')
   
   // Media Manager
   rex_media::get($filename)
   rex_media_manager::getUrl($type, $file)
   
   // Extensions (Hooks)
   rex_extension::register('EP_NAME', callback);
   rex_extension::registerPoint('EP_NAME', $subject);
   
   // Fragments (UI)
   $fragment = new rex_fragment();
   $fragment->setVar('items', $items);
   echo $fragment->parse('core/navigations/pagination.php');
   
   // Translation
   rex_i18n::msg('addon_key')
   rex_i18n::translate('addon_key', false)
   
   // User & Permissions
   rex::getUser()
   rex::requireUser()
   rex_complex_perm::register('addon', 'class');
   \`\`\`

3. **Code Quality - MANDATORY:**
   - **PHPStan**: Static analysis required (Level 6+ recommended)
     \`\`\`bash
     docker exec ${webContainerName} ./vendor/bin/phpstan analyse ${isCustom ? './project/public/redaxo' : './data/redaxo'}/src/addons/<addon>
     \`\`\`
   
   - **Psalm**: Type checking required
     \`\`\`bash
     docker exec ${webContainerName} ./vendor/bin/psalm
     \`\`\`
   
   - **PHP-CS-Fixer**: Code style enforcement (PSR-12)
     \`\`\`bash
     docker exec ${webContainerName} ./vendor/bin/php-cs-fixer fix ${isCustom ? './project/public/redaxo' : './data/redaxo'}/src/addons/<addon>
     \`\`\`

4. **REDAXO Coding Standards:**
   - PSR-12 for PHP code style
   - Use type hints (PHP 7.4+ / 8.x)
   - Document all public methods with PHPDoc
   - Follow REDAXO's naming conventions:
     - Classes: \`rex_<addon>_<class>\`
     - Database tables: \`rex_<addon>_<table>\`
     - Config keys: lowercase, underscore-separated

5. **AddOn Development:**
   - Always provide \`package.yml\` with version, author, supportpage
   - Use \`boot.php\` for initialization only
   - Register permissions in \`boot.php\`: \`rex_perm::register('addon[]')\`
   - Use REDAXO's backend layout system (fragments)
   - Provide German + English translations

6. **AddOn Backend Pages (index.php Pattern):**
   \`\`\`php
   <?php
   // MANDATORY structure for pages/index.php
   $addon = rex_addon::get('addonkey');
   echo rex_view::title($addon->i18n('page_title'));
   rex_be_controller::includeCurrentPageSubPath();
   \`\`\`
   - ⚠️ **ALWAYS use this pattern** for main page index.php
   - Sub-pages in same directory will be included automatically
   - Use fragments for consistent UI components

7. **AddOn Assets Management:**
   - ⚠️ **Store assets in AddOn directory during development**: \`./src/addons/<addon>/assets/\`
   - **NOT** in main assets folder (\`./assets/addons/<addon>/\`)
   - Assets are automatically copied on install/reinstall
   - Reference in templates: \`rex_url::addonAssets('addon', 'file.css')\`
   - CSS/JS will be available at: \`/assets/addons/<addon>/file.css\`

8. **Autoloading:**
   - ⚠️ **No manual autoloader registration needed**
   - Classes in \`lib/\` are auto-loaded by REDAXO
   - Composer \`vendor/\` also auto-loaded
   - Naming: \`lib/MyClass.php\` → class \`rex_addonkey_MyClass\`

9. **Composer in AddOns:**
   - Install vendor packages **inside AddOn**: \`./src/addons/<addon>/vendor/\`
   - Use \`composer.json\` in AddOn root
   - ⚠️ **Avoid conflicts with REDAXO Core libraries**
   - Check existing Core dependencies: Symfony, Guzzle, PSR-x
   - Prefer REDAXO's built-in libraries when possible

10. **Frontend Framework:**
    - ⚠️ **REDAXO Backend uses Bootstrap 3.4**
    - Use Bootstrap 3.4 classes for backend pages
    - Don't include custom Bootstrap versions (conflicts!)
    - Use REDAXO fragments for consistent styling
    - Frontend is independent (use any framework)

11. **Security:**
   - Use \`rex_sql\` with prepared statements (never direct SQL)
   - Sanitize user input: \`rex_request::get('param', 'string')\`
   - Check permissions: \`rex::requireUser() / rex::getUser()->hasPerm()\`
   - Use CSRF tokens in forms: \`rex_csrf_token\`

12. **Performance:**
   - Use REDAXO's caching: \`rex_file::getCache()\`, \`rex_file::putCache()\`
   - Register cache dependencies in \`package.yml\`
   - Avoid queries in loops - use rex_sql batch operations

---

## 💡 Instructions for AI Assistant
When helping with this instance:
- **ALWAYS suggest REDAXO built-in methods before custom implementations**
- Use the container names for docker commands
- Reference correct file paths based on instance type
- Consider this is a ${isCustom ? 'custom setup - user may need basic PHP/Docker help' : 'standard REDAXO setup - focus on REDAXO-specific solutions'}
- Suggest @redaxo chat commands for common tasks
- Remember database credentials for query suggestions
- **Enforce code quality**: Remind about PHPStan, Psalm, PHP-CS-Fixer before finalizing code
- **Check REDAXO docs**: https://redaxo.org/doku/main/ and https://github.com/redaxo/redaxo
${!loginInfo.running ? '\n⚠️ **Note**: Instance is currently STOPPED - suggest starting it first for most operations' : ''}
`;

                    // Copy to clipboard
                    await vscode.env.clipboard.writeText(instructions);
                    
                    // Show notification with preview
                    const action = await vscode.window.showInformationMessage(
                        `📋 Copilot Instructions copied for ${instanceName}!\n✨ Ready to paste into Copilot Chat for context-aware help.`,
                        'Show Preview',
                        'Save to .github/'
                    );
                    
                    if (action === 'Show Preview') {
                        // Show in new document
                        const doc = await vscode.workspace.openTextDocument({
                            content: instructions,
                            language: 'markdown'
                        });
                        await vscode.window.showTextDocument(doc, { preview: true });
                    } else if (action === 'Save to .github/') {
                        // Save to .github/copilot-instructions.md in instance workspace
                        const instancePath = instance.path;
                        if (!instancePath) {
                            vscode.window.showErrorMessage('❌ Instance path not found');
                            return;
                        }
                        
                        const githubDir = path.join(instancePath, '.github');
                        const instructionsFile = path.join(githubDir, 'copilot-instructions.md');
                        
                        try {
                            // Create .github directory if it doesn't exist
                            if (!fsSync.existsSync(githubDir)) {
                                fsSync.mkdirSync(githubDir, { recursive: true });
                            }
                            
                            // Write instructions file
                            fsSync.writeFileSync(instructionsFile, instructions, 'utf8');
                            
                            // Show success and offer to open
                            const openAction = await vscode.window.showInformationMessage(
                                `✅ Copilot Instructions saved to .github/copilot-instructions.md`,
                                'Open File',
                                'Open in Workspace'
                            );
                            
                            if (openAction === 'Open File') {
                                const doc = await vscode.workspace.openTextDocument(instructionsFile);
                                await vscode.window.showTextDocument(doc);
                            } else if (openAction === 'Open in Workspace') {
                                // Open instance folder as workspace
                                const uri = vscode.Uri.file(instancePath);
                                await vscode.commands.executeCommand('vscode.openFolder', uri, false);
                            }
                        } catch (error: any) {
                            vscode.window.showErrorMessage(`❌ Failed to save instructions: ${error.message}`);
                        }
                    }
                    
                } catch (error: any) {
                    vscode.window.showErrorMessage(`❌ Failed to generate instructions: ${error.message}`);
                    outputChannel.appendLine(`Error generating Copilot instructions: ${error.message}`);
                }
            }
        }),

    // Database Info Command entfernt

        vscode.commands.registerCommand('redaxo-instances.getLoginInfo', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance for login info:');
            }
            
            if (instanceName) {
                try {
                    const loginInfo = await dockerService.getLoginInfo(instanceName);
                    const panel = vscode.window.createWebviewPanel(
                        'redaxoLoginInfo',
                        `🔑 Login Info - ${instanceName}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: true,
                            retainContextWhenHidden: true,
                            localResourceRoots: [
                                vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'loginInfo')
                            ]
                        }
                    );

                    panel.webview.html = await getModernLoginInfoHtml(panel.webview, context, instanceName, loginInfo);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to get login info: ${error.message}`);
                }
            }
        }),

        // Modern Login Info Command (Preview) - Simple test version
        vscode.commands.registerCommand('redaxo-instances.showModernLoginInfo', async (instanceItem?: any) => {
            let instanceName: string = 'demo-instance';
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter instance name for modern login info preview',
                    placeHolder: 'e.g., my-redaxo-site',
                    value: 'demo-instance'
                });
                if (input) {
                    instanceName = input;
                }
            }

            // Create modern login info webview directly
            const panel = vscode.window.createWebviewPanel(
                'redaxoModernLoginInfo',
                `🎨 Modern Login Info - ${instanceName}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'loginInfo')
                    ]
                }
            );

            try {
                // Get mock login info for demo
                const mockLoginInfo = {
                    running: true,
                    frontendUrl: 'http://localhost:8080',
                    backendUrl: 'http://localhost:8080/redaxo',
                    instanceType: 'redaxo',
                    adminUser: 'admin',
                    adminPassword: 'redaxo123',
                    dbHost: `db_${instanceName}`,
                    dbName: 'redaxo',
                    dbUser: 'redaxo',
                    dbPassword: 'redaxo123',
                    dbRootPassword: 'rootpassword123',
                    dbExternalHost: 'localhost',
                    dbExternalPort: 3306
                };

                panel.webview.html = await getModernLoginInfoHtml(panel.webview, context, instanceName, mockLoginInfo);
            } catch (error: any) {
                panel.webview.html = `
                    <html><body style="color: #ff6b6b; padding: 20px; font-family: monospace;">
                        <h2>Error loading modern login info</h2>
                        <p>${error.message}</p>
                    </body></html>
                `;
            }
        }),

        // Export/Import handled through Adminer — removed direct export command

        // Import via mysql-init folder (dockerService.importDump) removed — use Adminer instead

        // Import directly into running DB container
        // Direct import command removed — use Adminer for DB import/export

        // SSL Management
        vscode.commands.registerCommand('redaxo-instances.setupSSL', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance for SSL setup:');
            }
            
            if (instanceName) {
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Setting up SSL for ${instanceName}...`,
                        cancellable: false
                    }, async () => {
                        await dockerService.setupInstanceSSL(instanceName!);
                    });
                    
                    vscode.window.showInformationMessage(`SSL configured for ${instanceName}! 🔒`);
                    instancesProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to setup SSL: ${error.message}`);
                }
            }
        }),

        // Repair Instance
        vscode.commands.registerCommand('redaxo-instances.repairInstance', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to repair:');
            }
            
            if (instanceName) {
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Repairing instance ${instanceName}...`,
                        cancellable: false
                    }, async () => {
                        await dockerService.repairInstance(instanceName!);
                    });
                    
                    vscode.window.showInformationMessage(`Instance ${instanceName} repaired successfully! 🔧`);
                    instancesProvider.refresh();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to repair instance: ${error.message}`);
                }
            }
        }),

        // Update hosts file for local domains
        vscode.commands.registerCommand('redaxo-instances.updateHosts', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance to add to hosts file:');
            }
            
            if (instanceName) {
                // Check if entry already exists
                const hostEntry = `127.0.0.1 ${instanceName}.local`;
                let entryExists = false;
                
                try {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execPromise = promisify(exec);
                    await execPromise(`grep -q "${instanceName}.local" /etc/hosts`);
                    entryExists = true;
                } catch {
                    // Entry doesn't exist
                }

                if (entryExists) {
                    vscode.window.showInformationMessage(
                        `${instanceName}.local is already in your hosts file! ✅`,
                        'Show Hosts File',
                        'OK'
                    ).then(choice => {
                        if (choice === 'Show Hosts File') {
                            const terminal = vscode.window.createTerminal({
                                name: `Hosts File - ${instanceName}`,
                            });
                            terminal.show();
                            terminal.sendText('cat /etc/hosts | grep -E "(local|127\\.0\\.0\\.1)"');
                        }
                    });
                    return;
                }

                const choice = await vscode.window.showInformationMessage(
                    `Add ${instanceName}.local to your hosts file?`,
                    { modal: true },
                    'Auto Add (Terminal)',
                    'Show Instructions',
                    'Cancel'
                );
                
                if (choice === 'Auto Add (Terminal)') {
                    showHostsUpdateInstructions(instanceName);
                    vscode.window.showInformationMessage(
                        `Terminal opened! Run the command shown to add ${instanceName}.local to your hosts file.`,
                        'Got it'
                    );
                } else if (choice === 'Show Instructions') {
                    showHostsManualInstructions(instanceName);
                }
            }
        }),

        // Open Workspace in VS Code
        vscode.commands.registerCommand('redaxo-instances.openWorkspace', async (instanceItem?: any) => {
            let instanceName: string;
            
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                const instances = await dockerService.listInstances();
                const quickPick = vscode.window.createQuickPick();
                quickPick.items = instances.map((instance: any) => ({ label: instance.name }));
                quickPick.placeholder = 'Select instance to open workspace';
                
                return new Promise<void>((resolve) => {
                    quickPick.onDidChangeSelection(async items => {
                        if (items[0]) {
                            instanceName = items[0].label;
                            quickPick.hide();
                            await openWorkspace(instanceName);
                            resolve();
                        }
                    });
                    
                    quickPick.onDidHide(() => resolve());
                    quickPick.show();
                });
            }

            await openWorkspace(instanceName);

            async function openWorkspace(name: string) {
                try {
                    const instance = await dockerService.getInstance(name);
                    if (!instance) {
                        vscode.window.showErrorMessage(`Instance ${name} not found`);
                        return;
                    }

                    let workspacePath: string;
                    if (instance.path) {
                        // Prüfe verschiedene mögliche Strukturen
                        const candidateProject = path.join(instance.path, 'project');
                        const candidateProjectPublic = path.join(candidateProject, 'public');
                        const candidateDataRedaxo = path.join(instance.path, 'data', 'redaxo');

                        if (await dirExists(candidateProjectPublic)) {
                            workspacePath = candidateProject; // Wurzel des Custom Projekts
                        } else if (await dirExists(candidateProject)) {
                            workspacePath = candidateProject;
                        } else if (await dirExists(candidateDataRedaxo)) {
                            workspacePath = candidateDataRedaxo; // Legacy REDAXO
                        } else {
                            workspacePath = instance.path; // Fallback
                        }
                    } else {
                        vscode.window.showErrorMessage(`Instance path not found for ${name}`);
                        return;
                    }

                    // Check if workspace exists
                    try {
                        await fs.access(workspacePath);
                    } catch {
                        vscode.window.showErrorMessage(`Workspace directory not found: ${workspacePath}`);
                        return;
                    }

                    // Open folder in VS Code
                    const uri = vscode.Uri.file(workspacePath);
                    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });

                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to open workspace: ${error.message}`);
                }
            }
        }),

        // Open Workspace in Finder (macOS)
        vscode.commands.registerCommand('redaxo-instances.openInFinder', async (instanceItem?: any) => {
            let instanceName: string;
            
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                const instances = await dockerService.listInstances();
                const quickPick = vscode.window.createQuickPick();
                quickPick.items = instances.map((instance: any) => ({ label: instance.name }));
                quickPick.placeholder = 'Select instance to open in Finder';
                
                return new Promise<void>((resolve) => {
                    quickPick.onDidChangeSelection(async items => {
                        if (items[0]) {
                            instanceName = items[0].label;
                            quickPick.hide();
                            await openInFinder(instanceName);
                            resolve();
                        }
                    });
                    
                    quickPick.onDidHide(() => resolve());
                    quickPick.show();
                });
            }

            await openInFinder(instanceName);

            async function openInFinder(name: string) {
                try {
                    const instance = await dockerService.getInstance(name);
                    if (!instance) {
                        vscode.window.showErrorMessage(`Instance ${name} not found`);
                        return;
                    }

                    let workspacePath: string;
                    if (instance.path) {
                        const candidateProject = path.join(instance.path, 'project');
                        const candidateProjectPublic = path.join(candidateProject, 'public');
                        const candidateDataRedaxo = path.join(instance.path, 'data', 'redaxo');

                        if (await dirExists(candidateProjectPublic)) {
                            workspacePath = candidateProject;
                        } else if (await dirExists(candidateProject)) {
                            workspacePath = candidateProject;
                        } else if (await dirExists(candidateDataRedaxo)) {
                            workspacePath = candidateDataRedaxo;
                        } else {
                            workspacePath = instance.path;
                        }
                    } else {
                        vscode.window.showErrorMessage(`Instance path not found for ${name}`);
                        return;
                    }

                    // Check if workspace exists
                    try {
                        await fs.access(workspacePath);
                    } catch {
                        vscode.window.showErrorMessage(`Workspace directory not found: ${workspacePath}`);
                        return;
                    }

                    // Open in Finder (macOS) or File Explorer (Windows/Linux)
                    if (process.platform === 'darwin') {
                        await execAsync(`open "${workspacePath}"`);
                    } else if (process.platform === 'win32') {
                        await execAsync(`explorer "${workspacePath.replace(/\//g, '\\')}"`);
                    } else {
                        // Linux
                        await execAsync(`xdg-open "${workspacePath}"`);
                    }

                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to open in file explorer: ${error.message}`);
                }
            }
        })
    ];

    commands.forEach(command => context.subscriptions.push(command));
}

async function initialize() {
    // Check Docker availability
    try {
        await dockerService.checkDockerInstallation();
    } catch (error: any) {
        vscode.window.showErrorMessage(
            'Docker is not available. Please install Docker to use REDAXO Multi-Instances.',
            'Install Docker'
        ).then(selection => {
            if (selection === 'Install Docker') {
                vscode.env.openExternal(vscode.Uri.parse('https://docs.docker.com/get-docker/'));
            }
        });
        return;
    }

    // Initial load
    instancesProvider.refresh();
}

async function getInstanceCreationOptions(): Promise<any> {
    const name = await vscode.window.showInputBox({
        prompt: 'Enter instance name',
        placeHolder: 'my-redaxo-instance',
        validateInput: (value) => {
            if (!value || !value.trim()) {
                return 'Instance name is required';
            }
            if (!/^[a-zA-Z0-9\-_]+$/.test(value)) {
                return 'Instance name can only contain letters, numbers, hyphens and underscores';
            }
            return null;
        }
    });

    if (!name) {
        return null;
    }

    const phpVersion = await vscode.window.showQuickPick([
        { label: 'PHP 8.5', value: '8.5' },
        { label: 'PHP 8.4', value: '8.4' },
        { label: 'PHP 8.3', value: '8.3' },
        { label: 'PHP 8.2', value: '8.2' },
        { label: 'PHP 8.1', value: '8.1' },
        { label: 'PHP 7.4', value: '7.4' }
    ], {
        placeHolder: 'Select PHP version'
    });

    if (!phpVersion) {
        return null;
    }

    const mariadbVersion = await vscode.window.showQuickPick([
        { label: 'MariaDB 11.8 (LTS - Neueste)', value: '11.8' },
        { label: 'MariaDB 11.4 (LTS)', value: '11.4' },
        { label: 'MariaDB 11.6', value: '11.6' },
        { label: 'MariaDB 11.5', value: '11.5' },
        { label: 'MariaDB 11.3', value: '11.3' },
        { label: 'MariaDB 11.2', value: '11.2' },
        { label: 'MariaDB 10.11 (LTS - Legacy)', value: '10.11' }
    ], {
        placeHolder: 'Select MariaDB version'
    });

    if (!mariadbVersion) {
        return null;
    }

    const imageVariant = await vscode.window.showQuickPick([
        { 
            label: 'Stable (Recommended)', 
            value: 'stable',
            description: 'Latest stable REDAXO with older but stable PHP version'
        },
        { 
            label: 'Edge (Latest)', 
            value: 'edge',
            description: 'Latest REDAXO with newest PHP, including beta versions'
        }
    ], {
        placeHolder: 'Select REDAXO image variant'
    });

    if (!imageVariant) {
        return null;
    }

    const autoInstall = await vscode.window.showQuickPick([
        { label: 'Yes, install REDAXO automatically', value: true },
        { label: 'No, create custom instance', value: false }
    ], {
        placeHolder: 'Auto-install REDAXO?'
    });

    if (autoInstall === undefined) {
        return null;
    }

    let releaseType = 'standard';
    if (autoInstall && autoInstall.value) {
        // Only standard REDAXO release is supported
        releaseType = 'standard';
    }

    return {
        name: name.trim(),
        phpVersion: phpVersion.value,
        mariadbVersion: mariadbVersion.value,
        imageVariant: imageVariant.value, // stable or edge
        autoInstall: autoInstall ? autoInstall.value : false,
        releaseType: releaseType,
        webserverOnly: false
    };
}

async function selectInstance(prompt: string): Promise<string | undefined> {
    const instances = await dockerService.listInstances();
    if (instances.length === 0) {
        vscode.window.showInformationMessage('No REDAXO instances found');
        return undefined;
    }

    const selected = await vscode.window.showQuickPick(
        instances.map(instance => ({
            label: instance.name,
            description: instance.running ? '● Running' : '○ Stopped'
        })),
        { placeHolder: prompt }
    );

    return selected?.label;
}

function showHostsUpdateInstructions(instanceName: string) {
    const terminal = vscode.window.createTerminal({
        name: `Update Hosts - ${instanceName}`,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    });
    
    terminal.show();
    terminal.sendText(`# To add ${instanceName}.local to your hosts file, run these commands:`);
    terminal.sendText(`echo ""`);
    terminal.sendText(`echo "# Adding ${instanceName}.local for REDAXO development"`);
    terminal.sendText(`echo "127.0.0.1 ${instanceName}.local" | sudo tee -a /etc/hosts`);
    terminal.sendText(`echo ""`);
    terminal.sendText(`echo "# Added! You can now use https://${instanceName}.local:PORT"`);
    terminal.sendText(`# Press Enter and type your password when prompted`);
}

function showHostsManualInstructions(instanceName: string) {
    const panel = vscode.window.createWebviewPanel(
        'hostsInstructions',
        `Hosts File Setup - ${instanceName}`,
        vscode.ViewColumn.One,
        {
            enableScripts: false,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getHostsInstructionsHtml(instanceName);
}

function getHostsInstructionsHtml(instanceName: string): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Hosts File Setup - ${instanceName}</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                    line-height: 1.6;
                }
                .code-block {
                    background: var(--vscode-textCodeBlock-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    padding: 15px;
                    font-family: var(--vscode-editor-font-family);
                    margin: 15px 0;
                    user-select: all;
                }
                .warning {
                    background: var(--vscode-inputValidation-warningBackground);
                    border: 1px solid var(--vscode-inputValidation-warningBorder);
                    padding: 15px;
                    border-radius: 4px;
                    margin: 15px 0;
                }
                h1, h2 { color: var(--vscode-textLink-foreground); }
            </style>
        </head>
        <body>
            <h1>🌐 Add ${instanceName}.local to Hosts File</h1>
            
            <div class="warning">
                <strong>⚠️ Administrator privileges required</strong><br>
                This modification requires sudo access to edit the system hosts file.
            </div>
            
            <h2>Method 1: Terminal Command</h2>
            <p>Copy and run this command in your terminal:</p>
            <div class="code-block">echo "127.0.0.1 ${instanceName}.local" | sudo tee -a /etc/hosts</div>
            
            <h2>Method 2: Manual Edit</h2>
            <p>1. Open Terminal and run:</p>
            <div class="code-block">sudo nano /etc/hosts</div>
            
            <p>2. Add this line at the end:</p>
            <div class="code-block">127.0.0.1 ${instanceName}.local</div>
            
            <p>3. Save with <kbd>Ctrl+X</kbd>, then <kbd>Y</kbd>, then <kbd>Enter</kbd></p>
            
            <h2>Verification</h2>
            <p>After adding the entry, you can verify it works:</p>
            <div class="code-block">ping ${instanceName}.local</div>
            
            <p><strong>✅ Once added, you can access your REDAXO instance at:</strong></p>
            <div class="code-block">https://${instanceName}.local:PORT</div>
            
            <p><em>Replace PORT with the actual HTTPS port shown in your instance.</em></p>
        </body>
        </html>
    `;
}

function getHelpHtml(): string {
    return `
        <!DOCTYPE html>
        <html lang="de">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>REDAXO Multi-Instances Help</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                    line-height: 1.6;
                    margin: 0;
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                
                .header {
                    text-align: center;
                    margin-bottom: 2rem;
                    padding: 2rem;
                    background: var(--vscode-editor-selectionBackground);
                    border-radius: 8px;
                }
                
                .header h1 {
                    margin: 0 0 0.5rem 0;
                    font-size: 2.5rem;
                    color: var(--vscode-textPreformat-foreground);
                }
                
                .header p {
                    margin: 0;
                    font-size: 1.1rem;
                    opacity: 0.8;
                }
                
                .section {
                    margin: 2rem 0;
                    padding: 1.5rem;
                    background: var(--vscode-input-background);
                    border-left: 4px solid var(--vscode-textLink-foreground);
                    border-radius: 4px;
                }
                
                .section h2 {
                    margin: 0 0 1rem 0;
                    color: var(--vscode-textLink-foreground);
                    font-size: 1.4rem;
                }
                
                .feature-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 1rem;
                    margin: 1rem 0;
                }
                
                .feature-item {
                    padding: 1rem;
                    background: var(--vscode-editor-selectionBackground);
                    border-radius: 4px;
                    border: 1px solid var(--vscode-input-border);
                }
                
                .feature-item h3 {
                    margin: 0 0 0.5rem 0;
                    color: var(--vscode-textPreformat-foreground);
                    font-size: 1.1rem;
                }
                
                .feature-item p {
                    margin: 0;
                    font-size: 0.9rem;
                    opacity: 0.8;
                }
                
                .comparison-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1rem 0;
                }
                
                .comparison-table th,
                .comparison-table td {
                    padding: 0.8rem;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-input-border);
                }
                
                .comparison-table th {
                    background: var(--vscode-editor-selectionBackground);
                    color: var(--vscode-textLink-foreground);
                    font-weight: 600;
                }
                
                .comparison-table tr:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .status-indicator {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    margin-right: 8px;
                }
                
                .status-running { background-color: #22c55e; }
                .status-stopped { background-color: #ef4444; }
                .status-ssl { background-color: #f59e0b; }
                
                .command-list {
                    list-style: none;
                    padding: 0;
                }
                
                .command-list li {
                    background: var(--vscode-editor-selectionBackground);
                    margin: 0.5rem 0;
                    padding: 0.8rem;
                    border-radius: 4px;
                    border-left: 3px solid var(--vscode-textLink-foreground);
                }
                
                .command-list code {
                    background: var(--vscode-textCodeBlock-background);
                    padding: 0.2rem 0.4rem;
                    border-radius: 3px;
                    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
                }
                
                .highlight {
                    background: var(--vscode-editor-findMatchHighlightBackground);
                    padding: 0.2rem 0.4rem;
                    border-radius: 3px;
                    font-weight: 600;
                }
                
                .quick-actions {
                    display: flex;
                    gap: 1rem;
                    flex-wrap: wrap;
                    margin: 1rem 0;
                }
                
                .quick-action {
                    padding: 0.5rem 1rem;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                
                .quick-action:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                
                @media (max-width: 600px) {
                    .feature-grid {
                        grid-template-columns: 1fr;
                    }
                    
                    .quick-actions {
                        flex-direction: column;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🚀 REDAXO Multi-Instances</h1>
                    <p>Vollständige Anleitung und Hilfe für die VS Code Extension</p>
                </div>

                <div class="section">
                    <h2>Schnellzugriff</h2>
                    <div class="quick-actions">
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.createInstance')">
                            Neue Instanz
                        </button>
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.refresh')">
                            Aktualisieren
                        </button>
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.changeInstancesPath')">
                            Instanzen-Ordner ändern
                        </button>
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.openReadme')">
                            README anzeigen
                        </button>
                    </div>
                </div>

                <div class="section">
                    <h2>🤖 GitHub Copilot Chat Integration</h2>
                    <p>Verwalte deine REDAXO-Instanzen direkt aus GitHub Copilot Chat heraus mit dem <strong>@redaxo</strong> Chat Participant!</p>
                    
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>💬 Chat Participant</h3>
                            <p>Öffne Copilot Chat und nutze <code>@redaxo</code> um mit deinen Instanzen zu interagieren</p>
                        </div>
                        <div class="feature-item">
                            <h3>⚡ Slash Commands</h3>
                            <p>9 verschiedene Commands für Instance Management, Console, Datenbank-Queries und mehr</p>
                        </div>
                        <div class="feature-item">
                            <h3>🔍 Direkte Kommunikation</h3>
                            <p>Führe Console Commands aus, lies Logs, query die Datenbank - alles aus dem Chat heraus</p>
                        </div>
                    </div>

                    <h3 style="margin-top: 1.5rem;">Verfügbare Commands</h3>
                    <ul class="command-list">
                        <li><code>@redaxo /start demo-site</code> - Instanz starten</li>
                        <li><code>@redaxo /stop demo-site</code> - Instanz stoppen</li>
                        <li><code>@redaxo /console demo-site cache:clear</code> - Console Command ausführen</li>
                        <li><code>@redaxo /query demo-site SELECT * FROM rex_article</code> - SQL Query ausführen</li>
                        <li><code>@redaxo /articles demo-site</code> - Artikel auflisten</li>
                        <li><code>@redaxo /addons demo-site</code> - AddOns verwalten</li>
                        <li><code>@redaxo /config demo-site server</code> - Config-Werte lesen</li>
                        <li><code>@redaxo /logs demo-site</code> - Container-Logs anzeigen</li>
                    </ul>

                    <h3 style="margin-top: 1.5rem;">Praktische Beispiele</h3>
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>🔄 Cache Management</h3>
                            <p><code>@redaxo /console demo-site cache:clear</code><br>
                            <code>@redaxo /console demo-site cache:warmup</code></p>
                        </div>
                        <div class="feature-item">
                            <h3>📦 AddOns installieren</h3>
                            <p><code>@redaxo /console demo-site package:install yform</code><br>
                            <code>@redaxo /console demo-site package:activate yform</code></p>
                        </div>
                        <div class="feature-item">
                            <h3>🔍 Debugging</h3>
                            <p><code>@redaxo /logs demo-site</code><br>
                            <code>@redaxo /query demo-site SELECT * FROM rex_system_log</code></p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>🎯 Unterschied: Custom Instance vs. + Button</h2>
                    <table class="comparison-table">
                        <thead>
                            <tr>
                                <th>Funktion</th>
                                <th>🆕 + Button (Create Instance)</th>
                                <th>🛠️ Custom Instance (Empty Instance)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Zweck</strong></td>
                                <td>Vollständige REDAXO-Installation</td>
                                <td>Leere Entwicklungsumgebung</td>
                            </tr>
                            <tr>
                                <td><strong>REDAXO vorinstalliert</strong></td>
                                <td>✅ Ja, automatisch installiert</td>
                                <td>❌ Nein, nur PHP + MariaDB</td>
                            </tr>
                            <tr>
                                <td><strong>Sofort nutzbar</strong></td>
                                <td>✅ Ja, nach Installation</td>
                                <td>❌ Nein, manueller Setup nötig</td>
                            </tr>
                            <tr>
                                <td><strong>Ideal für</strong></td>
                                <td>REDAXO-Projekte, Demos, Tests</td>
                                <td>Custom PHP Apps, Experimente</td>
                            </tr>
                            <tr>
                                <td><strong>Konfiguration</strong></td>
                                <td>Automatisch (DB, Config)</td>
                                <td>Komplett manuell</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="section">
                    <h2>📊 TreeView Symbole</h2>
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>🖥️ REDAXO Instanzen</h3>
                            <p><strong>Grünes Server-Symbol:</strong> REDAXO-Instanz läuft<br>
                            <strong>Gelbes Server-Symbol:</strong> REDAXO-Instanz gestoppt<br>
                            <strong>Rotes Error-Symbol:</strong> REDAXO-Instanz hat Fehler</p>
                        </div>
                        <div class="feature-item">
                            <h3>📦 Custom Instanzen</h3>
                            <p><strong>Grünes Paket-Symbol:</strong> Custom-Instanz läuft<br>
                            <strong>Gelbes Paket-Symbol:</strong> Custom-Instanz gestoppt<br>
                            <strong>Rotes Error-Symbol:</strong> Custom-Instanz hat Fehler</p>
                        </div>
                        <div class="feature-item">
                            <h3>⚡ Status in Beschreibung</h3>
                            <p><strong>● (ausgefüllter Kreis):</strong> Instanz läuft<br>
                            <strong>○ (leerer Kreis):</strong> Instanz gestoppt<br>
                            Plus PHP Version, MariaDB und Ports</p>
                        </div>
                        <div class="feature-item">
                            <h3>� Sonderzustände</h3>
                            <p><strong>Loading-Symbol (drehend):</strong> Instanz wird erstellt<br>
                            <strong>📁 Ordner-Symbol:</strong> Kategorien (Running/Stopped)</p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>⌨️ Bedienung</h2>
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>🖱️ Einfacher Klick</h3>
                            <p>Öffnet Aktionsmenü mit allen verfügbaren Optionen</p>
                        </div>
                        <div class="feature-item">
                            <h3>🖱️ Rechtsklick</h3>
                            <p>Zeigt klassisches Kontextmenü (wie gehabt)</p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>🔧 Wichtige VS Code Kommandos</h2>
                    <ul class="command-list">
                        <li><code>REDAXO: Create New Instance</code> - Neue REDAXO-Instanz erstellen</li>
                        <li><code>REDAXO: Show Dashboard</code> - Dashboard öffnen</li>
                        <li><code>REDAXO: Show Login Info</code> - Login-Daten anzeigen</li>
                        <li><code>REDAXO: Setup HTTPS/SSL</code> - SSL für Instanz einrichten</li>
                        <li><code>REDAXO: Start/Stop Instance</code> - Instanzen verwalten</li>
                    </ul>
                </div>

                <div class="section">
                    <h2>📥 REDAXO Loader für Custom Instances</h2>
                    <p>Für Custom Instances, die Sie später mit REDAXO ausstatten möchten:</p>
                    
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>🚀 REDAXO Loader</h3>
                            <p>Der REDAXO Loader lädt automatisch die neueste REDAXO Version von GitHub herunter und installiert sie.</p>
                            <p><strong>Download:</strong> <a href="https://redaxo.org/loader" target="_blank">redaxo_loader.php</a></p>
                        </div>
                        <div class="feature-item">
                            <h3>📁 Installation</h3>
                            <p><strong>1.</strong> REDAXO Loader herunterladen<br>
                            <strong>2.</strong> In den <code>project/public/</code> Ordner der Custom Instance kopieren<br>
                            <strong>3.</strong> Instance im Browser öffnen<br>
                            <strong>4.</strong> REDAXO Version auswählen und installieren</p>
                        </div>
                        <div class="feature-item">
                            <h3>⚡ Vorteile</h3>
                            <p>• Automatischer Download von GitHub<br>
                            • Immer die neueste Version<br>
                            • Keine manuellen Downloads<br>
                            • Professionelle Installation</p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>🔒 SSL/HTTPS Setup (Optional)</h2>
                    <p>Für lokale HTTPS-Entwicklung mit vertrauenswürdigen Zertifikaten:</p>
                    
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>macOS Installation</h3>
                            <p><code>brew install mkcert nss</code><br><code>mkcert -install</code></p>
                        </div>
                        <div class="feature-item">
                            <h3>Linux Installation</h3>
                            <p><code>sudo apt install libnss3-tools</code><br>Dann mkcert binary herunterladen</p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>� Troubleshooting</h2>
                    <div class="quick-actions">
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.createInstance')">
                            ➕ Neue Instanz
                        </button>
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.refresh')">
                            🔄 Aktualisieren
                        </button>
                        <button class="quick-action" onclick="executeCommand('redaxo-instances.changeInstancesPath')">
                            � Instanzen-Ordner ändern
                        </button>
                    </div>
                </div>

                <div class="section">
                    <h2>🔧 Troubleshooting</h2>
                    <div class="feature-grid">
                        <div class="feature-item">
                            <h3>Container startet nicht</h3>
                            <p>Logs prüfen: Rechtsklick auf Instanz → "Show Container Logs"</p>
                        </div>
                        <div class="feature-item">
                            <h3>Port bereits belegt</h3>
                            <p>Docker-Container stoppen oder andere Ports in der Konfiguration wählen</p>
                        </div>
                        <div class="feature-item">
                            <h3>SSL funktioniert nicht</h3>
                            <p>mkcert neu installieren oder Repair Instance nutzen</p>
                        </div>
                        <div class="feature-item">
                            <h3>Domain nicht erreichbar</h3>
                            <p>Hosts-Datei prüfen oder automatisch hinzufügen lassen</p>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h2>💡 Tipps & Tricks</h2>
                    <ul>
                        <li><span class="highlight">Automatische Ports</span>: Die Extension findet automatisch freie Ports</li>
                        <li><span class="highlight">Login-Info</span>: Alle Zugangsdaten werden automatisch angezeigt</li>
                        <li><span class="highlight">Workspace Integration</span>: Instanz-Ordner direkt in VS Code öffnen</li>
                        <li><span class="highlight">Terminal Zugriff</span>: Container-Shell direkt aus VS Code</li>
                        <li><span class="highlight">Database Dumps</span>: Einfacher Import über die Extension</li>
                    </ul>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function executeCommand(command) {
                    vscode.postMessage({
                        command: 'executeCommand',
                        value: command
                    });
                }
            </script>
        </body>
        </html>
    `;
}

/**
 * Generate Adminer Webview HTML with embedded iframe
 */
function getAdminerWebviewHtml(adminerUrl: string, instanceName: string, credentials: {
    server: string;
    username: string;
    password: string;
    database: string;
}): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adminer - ${instanceName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            overflow: hidden;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header {
            background: var(--vscode-titleBar-activeBackground);
            padding: 12px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .header-title {
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .credentials {
            display: flex;
            gap: 16px;
            font-size: 12px;
            opacity: 0.8;
        }
        
        .credential-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .credential-label {
            opacity: 0.6;
        }
        
        .credential-value {
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            background: var(--vscode-input-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s;
        }
        
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .iframe-container {
            flex: 1;
            position: relative;
            overflow: hidden;
        }
        
        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: white;
        }
        
        .info-banner {
            background: var(--vscode-inputValidation-infoBackground);
            color: var(--vscode-inputValidation-infoForeground);
            padding: 8px 20px;
            font-size: 12px;
            border-bottom: 1px solid var(--vscode-inputValidation-infoBorder);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .copy-notification {
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s;
            z-index: 1000;
            pointer-events: none;
        }
        
        .copy-notification.show {
            opacity: 1;
            transform: translateY(0);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="header-title">
                <span>🗄️</span>
                <span>Adminer - ${instanceName}</span>
            </div>
            <div class="credentials">
                <div class="credential-item">
                    <span class="credential-label">Server:</span>
                    <span class="credential-value" id="server">${credentials.server}</span>
                </div>
                <div class="credential-item">
                    <span class="credential-label">User:</span>
                    <span class="credential-value" id="username">${credentials.username}</span>
                </div>
                <div class="credential-item">
                    <span class="credential-label">DB:</span>
                    <span class="credential-value" id="database">${credentials.database}</span>
                </div>
            </div>
        </div>
        <div class="header-actions">
            <button class="btn btn-secondary" onclick="copyPassword()">
                📋 Copy Password
            </button>
            <button class="btn" onclick="openInBrowser()">
                🌐 Open in Browser
            </button>
        </div>
    </div>
    
    <div class="info-banner">
        ℹ️ Upload limit: 512MB | Execution time: 600s | Use credentials above to login
    </div>
    
    <div class="iframe-container">
        <iframe src="${adminerUrl}" sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"></iframe>
    </div>
    
    <div class="copy-notification" id="notification"></div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const password = '${credentials.password}';
        
        function copyPassword() {
            navigator.clipboard.writeText(password).then(() => {
                showNotification('✅ Password copied to clipboard');
            }).catch(err => {
                console.error('Failed to copy password:', err);
                showNotification('❌ Failed to copy password');
            });
        }
        
        function openInBrowser() {
            vscode.postMessage({
                command: 'openExternal',
                url: '${adminerUrl}'
            });
        }
        
        function showNotification(message) {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'showNotification':
                    showNotification(message.text);
                    break;
            }
        });
    </script>
</body>
</html>`;
}

/**
 * Generate modern login info HTML with glass morphism design
 */
/**
 * Generate modern login info HTML with glass morphism design using template system
 */
async function getModernLoginInfoHtml(webview: vscode.Webview, context: vscode.ExtensionContext, instanceName: string, loginInfo: any): Promise<string> {
    // Import synchronous fs for template reading
    const fsSync = require('fs');
    
    // Get URIs for CSS and JS files
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'loginInfo', 'loginInfo.css')
    );
    const jsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'loginInfo', 'loginInfo.js')
    );
    
    // Read the HTML template
    const templatePath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'loginInfo', 'loginInfo.html').fsPath;
    let htmlTemplate = fsSync.readFileSync(templatePath, 'utf8');
    
    // Prepare template variables
    const status = loginInfo.running ? 'running' : 'stopped';
    const statusIcon = loginInfo.running ? '🟢' : '🔴';
    const statusText = loginInfo.running ? 'Running' : 'Stopped';
    
    // Handle HTTPS URLs
    const httpsUrls = loginInfo.frontendUrlHttps ? 
        `<div class="url-item">
            <div class="url-label">Frontend (HTTPS)</div>
            <div class="url-value">
                <a href="${loginInfo.frontendUrlHttps}" class="url-link">${loginInfo.frontendUrlHttps}</a>
                <span class="https-badge">🔒</span>
                <button class="copy-btn micro-btn" data-copy="${loginInfo.frontendUrlHttps}">
                    <span class="copy-icon">📋</span>
                </button>
            </div>
        </div>
        <div class="url-item">
            <div class="url-label">Backend (HTTPS)</div>
            <div class="url-value">
                <a href="${loginInfo.backendUrlHttps}" class="url-link">${loginInfo.backendUrlHttps}</a>
                <span class="https-badge">🔒</span>
                <button class="copy-btn micro-btn" data-copy="${loginInfo.backendUrlHttps}">
                    <span class="copy-icon">📋</span>
                </button>
            </div>
        </div>` : '';
    
    // Replace template variables
    htmlTemplate = htmlTemplate
        .replace(/{{INSTANCE_NAME}}/g, instanceName)
        .replace(/{{CSS_URI}}/g, cssUri.toString())
        .replace(/{{JS_URI}}/g, jsUri.toString())
        .replace(/{{STATUS}}/g, status)
        .replace(/{{STATUS_ICON}}/g, statusIcon)
        .replace(/{{STATUS_TEXT}}/g, statusText)
        .replace(/{{FRONTEND_URL}}/g, loginInfo.frontendUrl || 'http://localhost:' + (loginInfo.httpPort || '80'))
        .replace(/{{BACKEND_URL}}/g, loginInfo.backendUrl || 'http://localhost:' + (loginInfo.httpPort || '80') + '/redaxo/index.php')
        .replace(/{{FRONTEND_HTTPS_URL}}/g, loginInfo.httpsPort ? `https://${instanceName}.local:${loginInfo.httpsPort}` : `https://localhost:${loginInfo.httpsPort || '8443'}`)
        .replace(/{{BACKEND_HTTPS_URL}}/g, loginInfo.httpsPort ? `https://${instanceName}.local:${loginInfo.httpsPort}/redaxo` : `https://localhost:${loginInfo.httpsPort || '8443'}/redaxo`)
        .replace(/{{HTTPS_URLS}}/g, httpsUrls)
        .replace(/{{CONTAINER_NAME}}/g, loginInfo.containerName || instanceName)
        .replace(/{{HTTP_PORT}}/g, loginInfo.httpPort || 'Not set')
        .replace(/{{HTTPS_PORT}}/g, loginInfo.httpsPort || '')
        .replace(/{{INSTANCE_TYPE}}/g, loginInfo.instanceType || 'Standard')
        .replace(/{{CUSTOM_INSTANCE}}/g, loginInfo.instanceType === 'custom' ? 'custom' : 'redaxo')
        // REDAXO Admin Credentials
        .replace(/{{ADMIN_USER}}/g, loginInfo.adminUser || 'admin')
        .replace(/{{ADMIN_PASSWORD}}/g, loginInfo.adminPassword || 'redaxo123')
        // Database Credentials
        .replace(/{{DB_HOST_INTERNAL}}/g, loginInfo.dbHost || 'mysql')
        .replace(/{{DB_HOST_EXTERNAL}}/g, loginInfo.dbExternalHost || 'localhost')
        .replace(/{{DB_NAME}}/g, loginInfo.dbName || instanceName || 'redaxo')
        .replace(/{{DB_USER}}/g, loginInfo.dbUser || 'redaxo')
        .replace(/{{DB_PASSWORD}}/g, loginInfo.dbPassword || 'redaxo')
        .replace(/{{DB_ROOT_PASSWORD}}/g, loginInfo.dbRootPassword || 'root')
        .replace(/{{DB_PORT}}/g, '3306') // Internal port is always 3306
        .replace(/{{DB_PORT_EXTERNAL}}/g, loginInfo.dbExternalPort || loginInfo.dbPort || '3306');
    
    return htmlTemplate;
}

// getDatabaseInfoHtml entfernt

export function deactivate() {
    if (instancesProvider) {
        instancesProvider.dispose();
    }
}