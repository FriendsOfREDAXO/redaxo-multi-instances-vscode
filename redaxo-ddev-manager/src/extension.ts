import * as vscode from 'vscode';
import { DDEVService } from './ddev/ddevService';
import { ProjectsProvider } from './providers/projectsProvider';
import { DashboardProvider } from './webview/dashboardProvider';

let ddevService: DDEVService;
let projectsProvider: ProjectsProvider;
let dashboardProvider: DashboardProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('REDAXO DDEV Manager extension is now active');

    // Initialize services
    ddevService = new DDEVService();
    projectsProvider = new ProjectsProvider(ddevService);
    dashboardProvider = new DashboardProvider(context, ddevService);

    // Register tree data provider
    vscode.window.createTreeView('redaxo-ddev-projects', {
        treeDataProvider: projectsProvider,
        canSelectMany: false
    });

    // Register commands
    const commands = [
        vscode.commands.registerCommand('redaxo-ddev.openDashboard', () => {
            dashboardProvider.show();
        }),

        vscode.commands.registerCommand('redaxo-ddev.createProject', async () => {
            await dashboardProvider.show();
            // Dashboard will handle project creation
        }),

        vscode.commands.registerCommand('redaxo-ddev.startProject', async (project) => {
            const projectName = project?.label || await selectProject('Select project to start');
            if (projectName) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Starting DDEV project: ${projectName}`,
                    cancellable: false
                }, async () => {
                    try {
                        await ddevService.startProject(projectName);
                        vscode.window.showInformationMessage(`Project ${projectName} started successfully`);
                        projectsProvider.refresh();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to start project: ${error}`);
                    }
                });
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.stopProject', async (project) => {
            const projectName = project?.label || await selectProject('Select project to stop');
            if (projectName) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Stopping DDEV project: ${projectName}`,
                    cancellable: false
                }, async () => {
                    try {
                        await ddevService.stopProject(projectName);
                        vscode.window.showInformationMessage(`Project ${projectName} stopped successfully`);
                        projectsProvider.refresh();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to stop project: ${error}`);
                    }
                });
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.restartProject', async (project) => {
            const projectName = project?.label || await selectProject('Select project to restart');
            if (projectName) {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Restarting DDEV project: ${projectName}`,
                    cancellable: false
                }, async () => {
                    try {
                        await ddevService.restartProject(projectName);
                        vscode.window.showInformationMessage(`Project ${projectName} restarted successfully`);
                        projectsProvider.refresh();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to restart project: ${error}`);
                    }
                });
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.deleteProject', async (project) => {
            const projectName = project?.label || await selectProject('Select project to delete');
            if (projectName) {
                const confirmation = await vscode.window.showWarningMessage(
                    `Are you sure you want to delete the DDEV project "${projectName}"? This will remove the DDEV configuration but keep your files.`,
                    'Yes, Delete',
                    'Cancel'
                );

                if (confirmation === 'Yes, Delete') {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Deleting DDEV project: ${projectName}`,
                        cancellable: false
                    }, async () => {
                        try {
                            await ddevService.deleteProject(projectName);
                            vscode.window.showInformationMessage(`Project ${projectName} deleted successfully`);
                            projectsProvider.refresh();
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to delete project: ${error}`);
                        }
                    });
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.importDatabase', async (project) => {
            const projectName = project?.label || await selectProject('Select project for database import');
            if (projectName) {
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    filters: {
                        'SQL Files': ['sql', 'sql.gz']
                    },
                    openLabel: 'Import Database'
                });

                if (files && files[0]) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Importing database to ${projectName}`,
                        cancellable: false
                    }, async () => {
                        try {
                            await ddevService.importDatabase(projectName, files[0].fsPath);
                            vscode.window.showInformationMessage(`Database imported successfully to ${projectName}`);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to import database: ${error}`);
                        }
                    });
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.exportDatabase', async (project) => {
            const projectName = project?.label || await selectProject('Select project for database export');
            if (projectName) {
                const file = await vscode.window.showSaveDialog({
                    filters: {
                        'SQL Files': ['sql']
                    },
                    defaultUri: vscode.Uri.file(`${projectName}_backup.sql`)
                });

                if (file) {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Exporting database from ${projectName}`,
                        cancellable: false
                    }, async () => {
                        try {
                            await ddevService.exportDatabase(projectName, file.fsPath);
                            vscode.window.showInformationMessage(`Database exported successfully from ${projectName}`);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to export database: ${error}`);
                        }
                    });
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.openUrl', async (project) => {
            const projectName = project?.label || await selectProject('Select project to open in browser');
            if (projectName) {
                try {
                    const url = await ddevService.getProjectUrl(projectName);
                    vscode.env.openExternal(vscode.Uri.parse(url));
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to get project URL: ${error}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.openTerminal', async (project) => {
            const projectName = project?.label || await selectProject('Select project for terminal');
            if (projectName) {
                try {
                    const terminal = vscode.window.createTerminal({
                        name: `DDEV: ${projectName}`,
                        cwd: await ddevService.getProjectPath(projectName)
                    });
                    
                    terminal.sendText(`ddev ssh -s ${projectName}`);
                    terminal.show();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to open terminal: ${error}`);
                }
            }
        }),

        vscode.commands.registerCommand('redaxo-ddev.refreshProjects', () => {
            projectsProvider.refresh();
        })
    ];

    context.subscriptions.push(...commands);

    // Initial projects refresh
    projectsProvider.refresh();
}

async function selectProject(placeHolder: string): Promise<string | undefined> {
    const projects = await ddevService.listProjects();
    
    if (projects.length === 0) {
        vscode.window.showWarningMessage('No DDEV projects found');
        return undefined;
    }

    return vscode.window.showQuickPick(
        projects.map(p => p.name),
        { placeHolder }
    );
}

export function deactivate() {
    // Cleanup if needed
}