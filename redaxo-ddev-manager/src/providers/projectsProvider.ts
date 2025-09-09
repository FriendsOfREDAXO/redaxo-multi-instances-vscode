import * as vscode from 'vscode';
import { DDEVService } from '../ddev/ddevService';
import { DDEVProject } from '../types/redaxo';

export class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectItem | undefined | null | void> = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private ddevService: DDEVService) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProjectItem): Promise<ProjectItem[]> {
        if (!element) {
            // Root level - show projects
            const projects = await this.ddevService.listProjects();
            return projects.map(project => new ProjectItem(project));
        } else {
            // Project level - show project details
            return this.getProjectDetails(element.project);
        }
    }

    private getProjectDetails(project: DDEVProject): ProjectItem[] {
        const details: ProjectItem[] = [];

        // Status
        details.push(new ProjectItem(
            project,
            `Status: ${project.status}`,
            vscode.TreeItemCollapsibleState.None,
            this.getStatusIcon(project.status)
        ));

        // PHP Version
        details.push(new ProjectItem(
            project,
            `PHP: ${project.phpVersion}`,
            vscode.TreeItemCollapsibleState.None,
            '$(versions)'
        ));

        // Database
        details.push(new ProjectItem(
            project,
            `Database: ${project.database}`,
            vscode.TreeItemCollapsibleState.None,
            '$(database)'
        ));

        // URLs
        if (project.urls.length > 0) {
            project.urls.forEach((url, index) => {
                details.push(new ProjectItem(
                    project,
                    url,
                    vscode.TreeItemCollapsibleState.None,
                    '$(globe)',
                    {
                        command: 'vscode.open',
                        title: 'Open URL',
                        arguments: [vscode.Uri.parse(url)]
                    }
                ));
            });
        }

        // Services
        if (project.mailhog) {
            details.push(new ProjectItem(
                project,
                'Mailhog',
                vscode.TreeItemCollapsibleState.None,
                '$(mail)',
                {
                    command: 'vscode.open',
                    title: 'Open Mailhog',
                    arguments: [vscode.Uri.parse(project.mailhog)]
                }
            ));
        }

        if (project.phpmyadmin) {
            details.push(new ProjectItem(
                project,
                'phpMyAdmin',
                vscode.TreeItemCollapsibleState.None,
                '$(database)',
                {
                    command: 'vscode.open',
                    title: 'Open phpMyAdmin',
                    arguments: [vscode.Uri.parse(project.phpmyadmin)]
                }
            ));
        }

        return details;
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'running':
                return '$(play)';
            case 'stopped':
                return '$(stop)';
            case 'paused':
                return '$(debug-pause)';
            case 'unhealthy':
                return '$(warning)';
            default:
                return '$(question)';
        }
    }
}

export class ProjectItem extends vscode.TreeItem {
    constructor(
        public readonly project: DDEVProject,
        public readonly label?: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded,
        public readonly iconString?: string,
        public readonly command?: vscode.Command
    ) {
        super(label || project.name, collapsibleState);

        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.contextValue = this.getContextValue();
        
        if (iconString) {
            this.iconPath = new vscode.ThemeIcon(iconString.replace('$(', '').replace(')', ''));
        } else {
            this.iconPath = new vscode.ThemeIcon(this.getDefaultIcon());
        }
    }

    private getTooltip(): string {
        if (this.label === this.project.name) {
            return `${this.project.name}\nStatus: ${this.project.status}\nLocation: ${this.project.location}`;
        }
        return this.label || '';
    }

    private getDescription(): string {
        if (this.label === this.project.name) {
            return this.project.status;
        }
        return '';
    }

    private getContextValue(): string {
        if (this.label === this.project.name) {
            return `redaxo-project-${this.project.status}`;
        }
        return 'redaxo-project-detail';
    }

    private getDefaultIcon(): string {
        if (this.label === this.project.name) {
            switch (this.project.status) {
                case 'running':
                    return 'play';
                case 'stopped':
                    return 'stop';
                case 'paused':
                    return 'debug-pause';
                case 'unhealthy':
                    return 'warning';
                default:
                    return 'folder';
            }
        }
        return 'info';
    }
}