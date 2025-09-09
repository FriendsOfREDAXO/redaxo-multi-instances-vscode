import * as vscode from 'vscode';
import * as path from 'path';
import { RedaxoInstance } from '../types/redaxo';
import { ResourceMonitor, InstanceResources } from '../docker/resourceMonitor';
import { DockerService } from '../docker/dockerService';
import { DDEVService } from '../ddev/ddevService';

// Union type for all tree view items
export type TreeViewItem = RedaxoInstanceItem | CategoryItem | InfoItem;

export class InstancesProvider implements vscode.TreeDataProvider<TreeViewItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeViewItem | undefined | null | void> = new vscode.EventEmitter<TreeViewItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private instances: RedaxoInstance[] = [];
    private statusBarItem: vscode.StatusBarItem;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(private dockerService: DockerService, private ddevService?: DDEVService) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'redaxo-instances.refresh';
        this.statusBarItem.show();
        
        // Auto-refresh every 30 seconds to update resources
        this.refreshTimer = setInterval(() => {
            this.refresh();
        }, 30000);
    }

    async refresh(): Promise<void> {
        this.instances = await this.loadAllInstances();
        this.updateStatusBar();
        this._onDidChangeTreeData.fire();
    }

    refreshItem(item?: TreeViewItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    private async loadAllInstances(): Promise<RedaxoInstance[]> {
        try {
            const allInstances: RedaxoInstance[] = [];
            
            // Load Docker instances
            const dockerInstances = await this.dockerService.listInstances();
            allInstances.push(...dockerInstances);
            
            // Load DDEV instances if service is available
            if (this.ddevService) {
                try {
                    const ddevInstances = await this.ddevService.listInstances();
                    allInstances.push(...ddevInstances);
                } catch (error) {
                    // DDEV might not be available, continue without error
                    console.log('DDEV not available or no DDEV instances found');
                }
            }
            
            return allInstances;
        } catch (error) {
            vscode.window.showErrorMessage(`Error loading instances: ${error}`);
            return [];
        }
    }

    private async loadInstances(): Promise<void> {
        this.instances = await this.loadAllInstances();
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
                items.push(new CategoryItem('🟢 Running Instances', runningInstances.length));
                runningInstances.forEach(instance => {
                    items.push(new RedaxoInstanceItem(instance, this, 'running-instance'));
                });
            }

            if (stoppedInstances.length > 0) {
                items.push(new CategoryItem('⚫ Stopped Instances', stoppedInstances.length));
                stoppedInstances.forEach(instance => {
                    items.push(new RedaxoInstanceItem(instance, this, 'stopped-instance'));
                });
            }            return Promise.resolve(items);
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
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
    }
}

export class RedaxoInstanceItem extends vscode.TreeItem {
    public readonly instance: RedaxoInstance;
    private resources: InstanceResources | null = null;
    private provider?: InstancesProvider;

    constructor(instance: RedaxoInstance, provider?: InstancesProvider, contextPrefix?: string) {
        super(instance.name, vscode.TreeItemCollapsibleState.None);
        
        this.instance = instance;
        this.provider = provider;
        this.tooltip = this.generateTooltip(instance);
        this.description = this.generateDescription(instance);
        
        // Set context value to include container type
        if (contextPrefix) {
            this.contextValue = contextPrefix;
        } else {
            const containerType = instance.containerType || 'docker';
            const status = instance.running ? 'running' : 'stopped';
            this.contextValue = `instance-${status}-${containerType}`;
        }
        
        this.iconPath = this.getIconPath(instance);
        
        // Add command to show context menu on single click
        this.command = {
            command: 'redaxo-instances.showInstanceContextMenu',
            title: 'Show Instance Actions',
            arguments: [instance.name]
        };

        // Load resources asynchronously if instance is running
        if (instance.running) {
            this.loadResources();
        }
    }

    private async loadResources(): Promise<void> {
        try {
            const instanceType = this.instance.instanceType === 'custom' ? 'custom' : 'redaxo';
            this.resources = await ResourceMonitor.getInstanceResources(this.instance.name, instanceType);
            
            // Update tooltip and description with resource info
            this.tooltip = this.generateTooltip(this.instance);
            this.description = this.generateDescription(this.instance);
            
            // Trigger TreeView refresh
            if (this.provider) {
                this.provider.refreshItem(this);
            }
        } catch (error) {
            console.error(`Error loading resources for ${this.instance.name}:`, error);
        }
    }

    private generateTooltip(instance: RedaxoInstance): string {
        const status = instance.running ? 'Running' : 'Stopped';
        const typeLabel = instance.instanceType === 'custom' ? 'Custom Instance' : 'REDAXO Instance';
        let tooltip = `${instance.name}\nType: ${typeLabel}\nStatus: ${status}\nPHP: ${instance.phpVersion}\nMariaDB: ${instance.mariadbVersion}`;
        
        // Add port information
        if (instance.httpPort) {
            tooltip += `\nHTTP Port: ${instance.httpPort}`;
        }
        
        if (instance.httpsPort) {
            tooltip += `\nHTTPS Port: ${instance.httpsPort}`;
        }
        
        if (instance.frontendUrl) {
            tooltip += `\nHTTP: ${instance.frontendUrl}`;
        }

        if (instance.backendUrl) {
            tooltip += `\nAdmin: ${instance.backendUrl}`;
        }// Add resource information if available
        if (this.resources && instance.running) {
            tooltip += '\n\n📊 Resources:';
            if (this.resources.total) {
                tooltip += `\n  CPU: ${this.resources.total.cpu}`;
                tooltip += `\n  Memory: ${this.resources.total.memory}`;
            }
            if (this.resources.web) {
                tooltip += `\n  Web: ${this.resources.web.memoryUsage}`;
            }
            if (this.resources.db) {
                tooltip += `\n  DB: ${this.resources.db.memoryUsage}`;
            }
        }
        
        if (instance.running) {
            tooltip += '\n\nDouble-click to open in browser';
        }
        
        return tooltip;
    }

    private generateDescription(instance: RedaxoInstance): string {
        const status = instance.running ? '●' : '○';
        const typeLabel = instance.instanceType === 'custom' ? 'Custom' : 'REDAXO';
        const containerType = instance.containerType === 'ddev' ? 'DDEV' : 'Docker';
        
        let description = `${status} ${typeLabel} | ${containerType} | PHP ${instance.phpVersion} | MariaDB ${instance.mariadbVersion}`;
        
        // For DDEV instances, show the local domain
        if (instance.containerType === 'ddev' && instance.localDomain) {
            description += ` | ${instance.localDomain}`;
        } else if (instance.port) {
            // For Docker instances, show the port
            description += ` | HTTP:${instance.port}`;
        }
        
        // Add HTTPS port if SSL is configured (mainly for Docker)
        if (instance.frontendUrlHttps && instance.containerType !== 'ddev') {
            const httpsUrl = new URL(instance.frontendUrlHttps);
            const httpsPort = httpsUrl.port || '443';
            description += ` | HTTPS:${httpsPort}`;
        }

        // Add compact resource info if available and running
        if (this.resources && instance.running && this.resources.total) {
            description += ` | 📊 ${this.resources.total.cpu} CPU, ${this.resources.total.memory} RAM`;
        }
        
        return description;
    }

    private getIconPath(instance: RedaxoInstance): vscode.ThemeIcon {
        if (instance.status === 'creating') {
            return new vscode.ThemeIcon('loading~spin');
        }
        
        // Use different icons for different container types and instance types
        let iconName: string;
        if (instance.containerType === 'ddev') {
            iconName = instance.instanceType === 'custom' ? 'rocket' : 'globe';
        } else {
            iconName = instance.instanceType === 'custom' ? 'package' : 'server-environment';
        }
        
        if (instance.running) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.green'));
        }
        
        if (instance.status === 'error') {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        }
        
        return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('charts.yellow'));
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
