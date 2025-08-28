import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DockerService } from './docker/dockerService';
import { ResourceMonitor } from './docker/resourceMonitor';
import { InstancesProvider } from './providers/instancesProvider';
import { EmptyInstanceProvider } from './emptyInstance/emptyInstanceProvider';

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

export function activate(context: vscode.ExtensionContext) {
    console.log('REDAXO Multi-Instances Manager is now active!');

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('REDAXO Instances');
    context.subscriptions.push(outputChannel);
    
    // Initialize services
    dockerService = new DockerService(outputChannel);
    instancesProvider = new InstancesProvider(dockerService);
    emptyInstanceProvider = new EmptyInstanceProvider(context.extensionUri, dockerService);

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
                {
                    label: '$(cloud-upload) Import Dump',
                    description: 'Import database dump',
                    command: 'redaxo-instances.importDump'
                },
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
                        `Login Information - ${instanceName}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: true,
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
                .copy-button {
                    margin-left: 8px;
                    padding: 4px 8px;
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .copy-button:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .copy-button:active {
                    background: var(--vscode-button-secondaryBackground);
                    transform: scale(0.95);
                }
                .credential-container {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .copy-feedback {
                    font-size: 12px;
                    color: var(--vscode-charts-green);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                }
                .copy-feedback.show {
                    opacity: 1;
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
                ${loginInfo.instanceType === 'custom' ? `
                <h2>🔧 Custom Instance</h2>
                <p><em>⚠️ This is a Custom Instance. No REDAXO backend credentials available.</em></p>
                <p><em>💡 Install REDAXO manually or use your own application.</em></p>
                ` : `
                <h2>🔑 REDAXO Backend Login</h2>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="admin-username">${loginInfo.adminUser}</strong></span>
                        <button class="copy-button" onclick="copyUsername()">📋 Copy</button>
                        <span class="copy-feedback" id="username-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="admin-password">${loginInfo.adminPassword}</strong></span>
                        <button class="copy-button" onclick="copyPassword()">📋 Copy</button>
                        <span class="copy-feedback" id="password-copy-feedback">Copied!</span>
                    </div>
                </div>
                <p><em>💡 These credentials are automatically generated for each instance.</em></p>
                `}
            </div>
            
            <div class="info-section">
                <h2>🗄️ Database Connection</h2>
                <h3>📦 Container-Internal (from within containers)</h3>
                <div class="info-item">
                    <span class="info-label">Host:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-host">${loginInfo.dbHost}</strong></span>
                        <button class="copy-button" onclick="copyDbHost()">📋 Copy</button>
                        <span class="copy-feedback" id="dbhost-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Port:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong>3306</strong></span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Database:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-name">${loginInfo.dbName}</strong></span>
                        <button class="copy-button" onclick="copyDbName()">📋 Copy</button>
                        <span class="copy-feedback" id="dbname-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-user">${loginInfo.dbUser}</strong></span>
                        <button class="copy-button" onclick="copyDbUser()">📋 Copy</button>
                        <span class="copy-feedback" id="dbuser-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-password">${loginInfo.dbPassword}</strong></span>
                        <button class="copy-button" onclick="copyDbPassword()">📋 Copy</button>
                        <span class="copy-feedback" id="dbpassword-copy-feedback">Copied!</span>
                    </div>
                </div>
                
                <h4>🔑 Root User (Container-Internal)</h4>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-root-user">root</strong></span>
                        <button class="copy-button" onclick="copyDbRootUser()">📋 Copy</button>
                        <span class="copy-feedback" id="dbrootuser-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-root-password">${loginInfo.dbRootPassword}</strong></span>
                        <button class="copy-button" onclick="copyDbRootPassword()">📋 Copy</button>
                        <span class="copy-feedback" id="dbrootpassword-copy-feedback">Copied!</span>
                    </div>
                </div>
                
                <h3>🌐 External Access (from localhost/phpMyAdmin/tools)</h3>
                <div class="info-item">
                    <span class="info-label">Host:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-external-host">${loginInfo.dbExternalHost}</strong></span>
                        <button class="copy-button" onclick="copyDbExternalHost()">📋 Copy</button>
                        <span class="copy-feedback" id="dbexternalhost-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Port:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-external-port">${loginInfo.dbExternalPort}</strong></span>
                        <button class="copy-button" onclick="copyDbExternalPort()">📋 Copy</button>
                        <span class="copy-feedback" id="dbexternalport-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Database:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-name-ext">${loginInfo.dbName}</strong></span>
                        <button class="copy-button" onclick="copyDbNameExt()">📋 Copy</button>
                        <span class="copy-feedback" id="dbname-ext-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-user-ext">${loginInfo.dbUser}</strong></span>
                        <button class="copy-button" onclick="copyDbUserExt()">📋 Copy</button>
                        <span class="copy-feedback" id="dbuser-ext-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-password-ext">${loginInfo.dbPassword}</strong></span>
                        <button class="copy-button" onclick="copyDbPasswordExt()">📋 Copy</button>
                        <span class="copy-feedback" id="dbpassword-ext-copy-feedback">Copied!</span>
                    </div>
                </div>
                
                <h4>🔑 Root User (External Access)</h4>
                <div class="info-item">
                    <span class="info-label">Username:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-root-user-ext">root</strong></span>
                        <button class="copy-button" onclick="copyDbRootUserExt()">📋 Copy</button>
                        <span class="copy-feedback" id="dbrootuser-ext-copy-feedback">Copied!</span>
                    </div>
                </div>
                <div class="info-item">
                    <span class="info-label">Password:</span>
                    <div class="credential-container">
                        <span class="info-value"><strong id="db-root-password-ext">${loginInfo.dbRootPassword}</strong></span>
                        <button class="copy-button" onclick="copyDbRootPasswordExt()">📋 Copy</button>
                        <span class="copy-feedback" id="dbrootpassword-ext-copy-feedback">Copied!</span>
                    </div>
                </div>
                
                ${loginInfo.phpmyadminUrl ? `
                <div class="info-item">
                    <span class="info-label">phpMyAdmin:</span>
                    <span class="info-value"><a href="${loginInfo.phpmyadminUrl}" class="url-link">${loginInfo.phpmyadminUrl}</a></span>
                </div>` : ''}
                <p><em>💡 ${loginInfo.mysqlPort ? 'Use external credentials for tools like phpMyAdmin, MySQL Workbench, etc.' : 'Custom instances expose MySQL port, standard instances use internal networking only.'}</em></p>
            </div>
            
            <div class="info-section">
                <h2>⚙️ System Information</h2>
                <div class="info-item">
                    <span class="info-label">Instance Type:</span>
                    <span class="info-value">${loginInfo.instanceType === 'custom' ? 'Custom Instance' : 'REDAXO Instance'}</span>
                </div>
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
            
            <script>
                function copyUsername() {
                    const usernameElement = document.getElementById('admin-username');
                    const feedbackElement = document.getElementById('username-copy-feedback');
                    
                    if (usernameElement) {
                        const username = usernameElement.textContent;
                        navigator.clipboard.writeText(username).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy username: ', err);
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = username;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        });
                    }
                }

                function copyPassword() {
                    const passwordElement = document.getElementById('admin-password');
                    const feedbackElement = document.getElementById('password-copy-feedback');
                    
                    if (passwordElement) {
                        const password = passwordElement.textContent;
                        navigator.clipboard.writeText(password).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy password: ', err);
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = password;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        });
                    }
                }

                function copyDbHost() {
                    const element = document.getElementById('db-host');
                    const feedbackElement = document.getElementById('dbhost-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db host: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbName() {
                    const element = document.getElementById('db-name');
                    const feedbackElement = document.getElementById('dbname-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db name: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbUser() {
                    const element = document.getElementById('db-user');
                    const feedbackElement = document.getElementById('dbuser-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db user: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbPassword() {
                    const element = document.getElementById('db-password');
                    const feedbackElement = document.getElementById('dbpassword-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db password: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbExternalHost() {
                    const element = document.getElementById('db-external-host');
                    const feedbackElement = document.getElementById('dbexternalhost-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db external host: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbExternalPort() {
                    const element = document.getElementById('db-external-port');
                    const feedbackElement = document.getElementById('dbexternalport-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db external port: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbNameExt() {
                    const element = document.getElementById('db-name-ext');
                    const feedbackElement = document.getElementById('dbname-ext-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db name ext: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbUserExt() {
                    const element = document.getElementById('db-user-ext');
                    const feedbackElement = document.getElementById('dbuser-ext-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db user ext: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbPasswordExt() {
                    const element = document.getElementById('db-password-ext');
                    const feedbackElement = document.getElementById('dbpassword-ext-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db password ext: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbHostExternal() {
                    const element = document.getElementById('db-host-external');
                    const feedbackElement = document.getElementById('dbhostexternal-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy external db host: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbPortExternal() {
                    const element = document.getElementById('db-port-external');
                    const feedbackElement = document.getElementById('dbportexternal-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy external db port: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbRootUser() {
                    const element = document.getElementById('db-root-user');
                    const feedbackElement = document.getElementById('dbrootuser-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db root user: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbRootPassword() {
                    const element = document.getElementById('db-root-password');
                    const feedbackElement = document.getElementById('dbrootpassword-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db root password: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbRootUserExt() {
                    const element = document.getElementById('db-root-user-ext');
                    const feedbackElement = document.getElementById('dbrootuser-ext-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db root user ext: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function copyDbRootPasswordExt() {
                    const element = document.getElementById('db-root-password-ext');
                    const feedbackElement = document.getElementById('dbrootpassword-ext-copy-feedback');
                    
                    if (element) {
                        const value = element.textContent;
                        navigator.clipboard.writeText(value).then(() => {
                            feedbackElement.classList.add('show');
                            setTimeout(() => {
                                feedbackElement.classList.remove('show');
                            }, 2000);
                        }).catch(err => {
                            console.error('Failed to copy db root password ext: ', err);
                            fallbackCopy(value, feedbackElement);
                        });
                    }
                }

                function fallbackCopy(text, feedbackElement) {
                    const textArea = document.createElement('textarea');
                    textArea.value = text;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    feedbackElement.classList.add('show');
                    setTimeout(() => {
                        feedbackElement.classList.remove('show');
                    }, 2000);
                }
            </script>
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

// getDatabaseInfoHtml entfernt

export function deactivate() {
    if (instancesProvider) {
        instancesProvider.dispose();
    }
}