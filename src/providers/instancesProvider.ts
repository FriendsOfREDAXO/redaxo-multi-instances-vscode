import * as vscode from 'vscode';
import { RedaxoInstance } from '../types/redaxo';
import { DockerService } from '../docker/dockerService';

// Union type for all tree view items
export type TreeViewItem = RedaxoInstanceItem | CategoryItem | InfoItem;

export class InstancesProvider implements vscode.TreeDataProvider<TreeViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewItem | undefined | null | void> = new vscode.EventEmitter<TreeViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private instances: RedaxoInstance[] = [];
    private dockerService: DockerService;
    private statusBarItem: vscode.StatusBarItem;

    constructor(dockerService: DockerService) {
        this.dockerService = dockerService;
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'redaxo-instances.refresh';
        this.statusBarItem.text = '$(refresh) REDAXO';
        this.statusBarItem.tooltip = 'REDAXO Instances - Click to refresh';
        this.statusBarItem.show();
        
        this.refresh();
        
        // Auto-refresh every 30 seconds if enabled
        const autoRefresh = vscode.workspace.getConfiguration('redaxo-instances').get('autoRefresh', true);
        if (autoRefresh) {
            setInterval(() => this.refresh(), 30000);
        }
    }

    refresh(): void {
        this.loadInstances();
        this._onDidChangeTreeData.fire();
        this.updateStatusBar();
    }

    private async loadInstances(): Promise<void> {
        try {
            this.instances = await this.dockerService.listInstances();
        } catch (error) {
            vscode.window.showErrorMessage(`Error loading instances: ${error}`);
            this.instances = [];
        }
    }

    private updateStatusBar(): void {
        const runningCount = this.instances.filter(i => i.running).length;
        const totalCount = this.instances.length;
        
        if (totalCount === 0) {
            this.statusBarItem.text = '$(server) No Instances';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (runningCount === 0) {
            this.statusBarItem.text = `$(server) ${totalCount} Stopped`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else {
            this.statusBarItem.text = `$(server) ${runningCount}/${totalCount} Running`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.activeBackground');
        }
    }

    getTreeItem(element: TreeViewItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeViewItem): Thenable<TreeViewItem[]> {
        if (!element) {
            // Return root instances with categories
            if (this.instances.length === 0) {
                return Promise.resolve([new InfoItem('No instances found', 'Click "Create Instance" to get started', 'info')]);
            }

            const runningInstances = this.instances.filter(i => i.running);
            const stoppedInstances = this.instances.filter(i => !i.running);
            
            const items: TreeViewItem[] = [];
            
            if (runningInstances.length > 0) {
                items.push(new CategoryItem('Running Instances', runningInstances.length));
                runningInstances.forEach(instance => {
                    items.push(new RedaxoInstanceItem(instance, 'running-instance'));
                });
            }
            
            if (stoppedInstances.length > 0) {
                items.push(new CategoryItem('Stopped Instances', stoppedInstances.length));
                stoppedInstances.forEach(instance => {
                    items.push(new RedaxoInstanceItem(instance, 'stopped-instance'));
                });
            }

            return Promise.resolve(items);
        }

        return Promise.resolve([]);
    }

    getParent?(element: TreeViewItem): vscode.ProviderResult<TreeViewItem> {
        return null;
    }

    getInstance(instanceName: string): RedaxoInstance | undefined {
        return this.instances.find(instance => instance.name === instanceName);
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

export class RedaxoInstanceItem extends vscode.TreeItem {
    public readonly instance: RedaxoInstance;

    constructor(instance: RedaxoInstance, contextPrefix?: string) {
        super(instance.name, vscode.TreeItemCollapsibleState.None);
        
        this.instance = instance;
        this.tooltip = this.generateTooltip(instance);
        this.description = this.generateDescription(instance);
        this.contextValue = contextPrefix || (instance.running ? 'instance-running' : 'instance-stopped');
        this.iconPath = this.getIconPath(instance);
        
        // Add command for double-click action
        if (instance.running && instance.frontendUrl) {
            this.command = {
                command: 'redaxo-instances.openInBrowser',
                title: 'Open in Browser',
                arguments: [instance.name]
            };
        }
    }

    private generateTooltip(instance: RedaxoInstance): string {
        const status = instance.running ? 'Running' : 'Stopped';
        let tooltip = `${instance.name}\nStatus: ${status}\nPHP: ${instance.phpVersion}\nMariaDB: ${instance.mariadbVersion}`;
        
        if (instance.port) {
            tooltip += `\nHTTP Port: ${instance.port}`;
        }
        
        if (instance.frontendUrl) {
            tooltip += `\nHTTP: ${instance.frontendUrl}`;
        }
        
        // Add HTTPS information if available
        if (instance.frontendUrlHttps) {
            tooltip += `\nHTTPS: ${instance.frontendUrlHttps}`;
        }
        
        if (instance.backendUrl) {
            tooltip += `\nAdmin: ${instance.backendUrl}`;
        }
        
        // Add HTTPS Admin URL if available
        if (instance.backendUrlHttps) {
            tooltip += `\nAdmin (HTTPS): ${instance.backendUrlHttps}`;
        }
        
        if (instance.running) {
            tooltip += '\n\nDouble-click to open in browser';
        }
        
        return tooltip;
    }

    private generateDescription(instance: RedaxoInstance): string {
        const status = instance.running ? '●' : '○';
        let description = `${status} PHP ${instance.phpVersion} | MariaDB ${instance.mariadbVersion}`;
        
        if (instance.port) {
            description += ` | HTTP:${instance.port}`;
        }
        
        // Add HTTPS port if SSL is configured
        if (instance.frontendUrlHttps) {
            const httpsUrl = new URL(instance.frontendUrlHttps);
            const httpsPort = httpsUrl.port || '443';
            description += ` | HTTPS:${httpsPort}`;
        }
        
        return description;
    }

    private getIconPath(instance: RedaxoInstance): vscode.ThemeIcon {
        if (instance.status === 'creating') {
            return new vscode.ThemeIcon('loading~spin');
        }
        
        if (instance.running) {
            return new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.green'));
        }
        
        if (instance.status === 'error') {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }
        
        return new vscode.ThemeIcon('server-environment', new vscode.ThemeColor('charts.yellow'));
    }
}

export class CategoryItem extends vscode.TreeItem {
    constructor(label: string, count: number) {
        super(`${label} (${count})`, vscode.TreeItemCollapsibleState.None);
        
        this.contextValue = 'category';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = `${count} instances in this category`;
        
        // Make category items non-selectable
        this.command = undefined;
    }
}

export class InfoItem extends vscode.TreeItem {
    constructor(label: string, description: string, type: 'info' | 'warning' | 'error') {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.description = description;
        this.contextValue = 'info';
        this.tooltip = description;
        
        switch (type) {
            case 'warning':
                this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
        }
    }
}
