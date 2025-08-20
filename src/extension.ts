import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './docker/dockerService';
import { InstancesProvider } from './providers/instancesProvider';

const execAsync = promisify(exec);

let dockerService: DockerService;
let instancesProvider: InstancesProvider;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    console.log('REDAXO Multi-Instances Manager is now active!');

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('REDAXO Instances');
    context.subscriptions.push(outputChannel);
    
    // Initialize services
    dockerService = new DockerService(outputChannel);
    instancesProvider = new InstancesProvider(dockerService);

    // Register Tree View
    const treeView = vscode.window.createTreeView('redaxo-instances.instancesView', {
        treeDataProvider: instancesProvider,
        showCollapseAll: true,
        canSelectMany: false
    });
    
    context.subscriptions.push(treeView);

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
            
            // Extract instance name from different input types
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && instanceItem.instance && instanceItem.instance.name) {
                instanceName = instanceItem.instance.name;
            } else if (instanceItem && instanceItem.name) {
                instanceName = instanceItem.name;
            }
            
            if (!instanceName) {
                instanceName = await selectInstance('Select instance to show logs:');
            }
            if (instanceName) {
                const terminal = vscode.window.createTerminal({
                    name: `Logs: REDAXO ${instanceName}`,
                    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                });
                terminal.show();
                terminal.sendText(`docker logs -f redaxo-${instanceName}`);
            }
        }),

        // Database Actions
        vscode.commands.registerCommand('redaxo-instances.getDatabaseInfo', async (instanceName?: string) => {
            if (!instanceName) {
                instanceName = await selectInstance('Select instance for database info:');
            }
            if (instanceName) {
                try {
                    const dbInfo = await dockerService.getDatabaseInfo(instanceName);
                    const panel = vscode.window.createWebviewPanel(
                        'redaxoDbInfo',
                        `Database Info - ${instanceName}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: false,
                            retainContextWhenHidden: true
                        }
                    );

                    panel.webview.html = getDatabaseInfoHtml(instanceName, dbInfo);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to get database info: ${error.message}`);
                }
            }
        }),

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
                        `Login Information - ${instanceName}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: false,
                            retainContextWhenHidden: true
                        }
                    );

                    panel.webview.html = getLoginInfoHtml(instanceName, loginInfo);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to get login info: ${error.message}`);
                }
            }
        }),

        // Dump Management
        vscode.commands.registerCommand('redaxo-instances.importDump', async (instanceItem?: any) => {
            let instanceName: string | undefined;
            
            // Handle both string and RedaxoInstanceItem parameter
            if (typeof instanceItem === 'string') {
                instanceName = instanceItem;
            } else if (instanceItem && typeof instanceItem === 'object' && instanceItem.label) {
                instanceName = instanceItem.label;
            } else {
                instanceName = await selectInstance('Select instance for dump import:');
            }
            
            if (instanceName) {
                const dumpFile = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: 'Select Dump File',
                    filters: {
                        'Archive Files': ['zip', 'tar.gz', 'sql']
                    }
                });

                if (dumpFile && dumpFile[0]) {
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Importing dump to ${instanceName}...`,
                            cancellable: false
                        }, async () => {
                            await dockerService.importDump(instanceName!, dumpFile[0].fsPath);
                        });
                        
                        vscode.window.showInformationMessage(`Dump imported successfully to ${instanceName}!`);
                        instancesProvider.refresh();
                    } catch (error: any) {
                        vscode.window.showErrorMessage(`Failed to import dump: ${error.message}`);
                    }
                }
            }
        }),

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
                const choice = await vscode.window.showInformationMessage(
                    `Add ${instanceName}.local to your hosts file?\n\nThis will open a terminal with the required commands that need administrator privileges.`,
                    { modal: true },
                    'Open Terminal with Commands',
                    'Show Manual Instructions'
                );
                
                if (choice === 'Open Terminal with Commands') {
                    showHostsUpdateInstructions(instanceName);
                    vscode.window.showInformationMessage(
                        `Terminal opened! Run the commands shown to add ${instanceName}.local to your hosts file.`
                    );
                } else if (choice === 'Show Manual Instructions') {
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
                        workspacePath = path.join(instance.path, 'data', 'redaxo');
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
                        workspacePath = path.join(instance.path, 'data', 'redaxo');
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
        { label: 'MariaDB 11.2', value: '11.2' },
        { label: 'MariaDB 11.1', value: '11.1' },
        { label: 'MariaDB 10.11', value: '10.11' },
        { label: 'MariaDB 10.6', value: '10.6' }
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
        { label: 'No, create empty instance', value: false }
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
        importDump: false,
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

function getLoginInfoHtml(instanceName: string, loginInfo: any): string {
    const statusIcon = loginInfo.running ? '🟢' : '🔴';
    const statusText = loginInfo.running ? 'Running' : 'Stopped';
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login Information - ${instanceName}</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                    line-height: 1.6;
                }
                .status-header {
                    background: var(--vscode-widget-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    padding: 20px;
                    margin-bottom: 20px;
                    text-align: center;
                }
                .info-section {
                    background: var(--vscode-widget-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                .info-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--vscode-widget-border);
                }
                .info-item:last-child {
                    border-bottom: none;
                }
                .info-label {
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                    min-width: 140px;
                }
                .info-value {
                    font-family: var(--vscode-editor-font-family);
                    user-select: all;
                    word-break: break-all;
                }
                .login-box {
                    background: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    border-radius: 4px;
                    padding: 15px;
                    margin: 15px 0;
                }
                .url-link {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: underline;
                    cursor: pointer;
                }
                .url-link:hover {
                    color: var(--vscode-textLink-activeForeground);
                }
                h1, h2 { color: var(--vscode-textLink-foreground); }
            </style>
        </head>
        <body>
            <div class="status-header">
                <h1>${statusIcon} ${instanceName}</h1>
                <p><strong>Status:</strong> ${statusText}</p>
            </div>
            
            <div class="info-section">
                <h2>🌐 Access URLs</h2>
                <div class="info-item">
                    <span class="info-label">Frontend (HTTP):</span>
                    <span class="info-value"><a href="${loginInfo.frontendUrl}" class="url-link">${loginInfo.frontendUrl}</a></span>
                </div>
                <div class="info-item">
                    <span class="info-label">Backend (HTTP):</span>
                    <span class="info-value"><a href="${loginInfo.backendUrl}" class="url-link">${loginInfo.backendUrl}</a></span>
                </div>
                ${loginInfo.frontendUrlHttps ? `
                <div class="info-item">
                    <span class="info-label">Frontend (HTTPS):</span>
                    <span class="info-value"><a href="${loginInfo.frontendUrlHttps}" class="url-link">${loginInfo.frontendUrlHttps}</a> 🔒</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Backend (HTTPS):</span>
                    <span class="info-value"><a href="${loginInfo.backendUrlHttps}" class="url-link">${loginInfo.backendUrlHttps}</a> 🔒</span>
                </div>` : ''}
            </div>
            
            <div class="login-box">
                <h2>🔑 REDAXO Backend Login</h2>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <span class="info-value"><strong>${loginInfo.adminUser}</strong></span>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <span class="info-value"><strong>${loginInfo.adminPassword}</strong></span>
                </div>
                <p><em>💡 These credentials are automatically generated for each instance.</em></p>
            </div>
            
            <div class="info-section">
                <h2>🗄️ Database Information</h2>
                <div class="info-item">
                    <span class="info-label">Host:</span>
                    <span class="info-value">${loginInfo.dbHost}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Database:</span>
                    <span class="info-value">${loginInfo.dbName}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <span class="info-value">${loginInfo.dbUser}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <span class="info-value">${loginInfo.dbPassword}</span>
                </div>
            </div>
            
            <div class="info-section">
                <h2>⚙️ System Information</h2>
                <div class="info-item">
                    <span class="info-label">PHP Version:</span>
                    <span class="info-value">${loginInfo.phpVersion}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">MariaDB Version:</span>
                    <span class="info-value">${loginInfo.mariadbVersion}</span>
                </div>
            </div>
            
            <p><em>📋 Click on any value to select and copy it.</em></p>
        </body>
        </html>
    `;
}

function getDatabaseInfoHtml(instanceName: string, dbInfo: any): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Database Info - ${instanceName}</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                }
                .info-card {
                    background: var(--vscode-widget-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                .info-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                    border-bottom: 1px solid var(--vscode-widget-border);
                }
                .info-item:last-child {
                    border-bottom: none;
                }
                .info-label {
                    font-weight: bold;
                    color: var(--vscode-textLink-foreground);
                }
                .info-value {
                    font-family: var(--vscode-editor-font-family);
                    user-select: all;
                }
            </style>
        </head>
        <body>
            <h1>🔑 Database Information - ${instanceName}</h1>
            <div class="info-card">
                <div class="info-item">
                    <span class="info-label">Host:</span>
                    <span class="info-value">${dbInfo.host}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Database:</span>
                    <span class="info-value">${dbInfo.database}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">User:</span>
                    <span class="info-value">${dbInfo.user}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <span class="info-value">${dbInfo.password}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Root Password:</span>
                    <span class="info-value">${dbInfo.rootPassword}</span>
                </div>
            </div>
            <p><em>You can select and copy any of these values.</em></p>
        </body>
        </html>
    `;
}

export function deactivate() {
    if (instancesProvider) {
        instancesProvider.dispose();
    }
}
