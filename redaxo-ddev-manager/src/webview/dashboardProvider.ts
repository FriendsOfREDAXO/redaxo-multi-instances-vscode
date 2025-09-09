import * as vscode from 'vscode';
import * as path from 'path';
import { DDEVService } from '../ddev/ddevService';
import { REDAXOProjectConfig } from '../types/redaxo';

export class DashboardProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private ddevService: DDEVService
    ) {}

    async show(): Promise<void> {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'redaxo-ddev-dashboard',
            'REDAXO DDEV Manager',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
                ]
            }
        );

        this.panel.webview.html = await this.getWebviewContent();
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'createProject':
                        await this.handleCreateProject(message.data);
                        break;
                    case 'getProjects':
                        await this.handleGetProjects();
                        break;
                    case 'getREDAXOVersions':
                        await this.handleGetREDAXOVersions();
                        break;
                    case 'startProject':
                        await this.handleStartProject(message.projectName);
                        break;
                    case 'stopProject':
                        await this.handleStopProject(message.projectName);
                        break;
                    case 'openProject':
                        await this.handleOpenProject(message.projectName);
                        break;
                    case 'deleteProject':
                        await this.handleDeleteProject(message.projectName);
                        break;
                }
            }
        );

        // Load initial data
        await this.handleGetProjects();
        await this.handleGetREDAXOVersions();
    }

    private async handleCreateProject(config: REDAXOProjectConfig): Promise<void> {
        try {
            if (!this.panel) {
            return;
        }

            this.panel.webview.postMessage({
                command: 'projectCreationStarted',
                projectName: config.name
            });

            await this.ddevService.createProject(config);

            this.panel.webview.postMessage({
                command: 'projectCreated',
                projectName: config.name
            });

            // Refresh projects list
            await this.handleGetProjects();

        } catch (error) {
            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'projectCreationFailed',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    private async handleGetProjects(): Promise<void> {
        try {
            const projects = await this.ddevService.listProjects();
            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'projectsLoaded',
                    projects
                });
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    private async handleGetREDAXOVersions(): Promise<void> {
        try {
            const versions = await this.ddevService.getAvailableREDAXOVersions();
            if (this.panel) {
                this.panel.webview.postMessage({
                    command: 'redaxoVersionsLoaded',
                    versions
                });
            }
        } catch (error) {
            console.error('Error loading REDAXO versions:', error);
        }
    }

    private async handleStartProject(projectName: string): Promise<void> {
        try {
            await this.ddevService.startProject(projectName);
            await this.handleGetProjects();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start project: ${error}`);
        }
    }

    private async handleStopProject(projectName: string): Promise<void> {
        try {
            await this.ddevService.stopProject(projectName);
            await this.handleGetProjects();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to stop project: ${error}`);
        }
    }

    private async handleOpenProject(projectName: string): Promise<void> {
        try {
            const url = await this.ddevService.getProjectUrl(projectName);
            vscode.env.openExternal(vscode.Uri.parse(url));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open project: ${error}`);
        }
    }

    private async handleDeleteProject(projectName: string): Promise<void> {
        try {
            await this.ddevService.deleteProject(projectName);
            await this.handleGetProjects();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete project: ${error}`);
        }
    }

    private async getWebviewContent(): Promise<string> {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>REDAXO DDEV Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        .header {
            margin-bottom: 30px;
            text-align: center;
        }

        .header h1 {
            color: var(--vscode-foreground);
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 300;
        }

        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 1.1em;
        }

        .dashboard {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .panel {
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 25px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .panel h2 {
            color: var(--vscode-foreground);
            margin-bottom: 20px;
            font-size: 1.4em;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        .form-group input, 
        .form-group select {
            width: 100%;
            padding: 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 14px;
        }

        .form-group input:focus, 
        .form-group select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px rgba(var(--vscode-focusBorder-rgb), 0.3);
        }

        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-danger {
            background: #f14c4c;
            color: white;
        }

        .btn-danger:hover {
            background: #d73a49;
        }

        .projects-grid {
            display: grid;
            gap: 15px;
        }

        .project-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
            position: relative;
            transition: border-color 0.2s;
        }

        .project-card:hover {
            border-color: var(--vscode-focusBorder);
        }

        .project-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
        }

        .project-name {
            font-size: 1.2em;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .project-status {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-running {
            background: #28a745;
            color: white;
        }

        .status-stopped {
            background: #6c757d;
            color: white;
        }

        .project-info {
            margin-bottom: 15px;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .project-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .project-actions .btn {
            padding: 8px 16px;
            font-size: 12px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-right: 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .notification {
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
            border-left: 4px solid;
        }

        .notification.success {
            background: rgba(40, 167, 69, 0.1);
            border-left-color: #28a745;
            color: #28a745;
        }

        .notification.error {
            background: rgba(220, 53, 69, 0.1);
            border-left-color: #dc3545;
            color: #dc3545;
        }

        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
        }

        @media (max-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
            .form-row {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 REDAXO DDEV Manager</h1>
        <p>Create and manage REDAXO projects with DDEV</p>
    </div>

    <div class="dashboard">
        <!-- Create Project Panel -->
        <div class="panel">
            <h2>
                ➕ Create New Project
            </h2>
            
            <form id="createProjectForm">
                <div class="form-group">
                    <label for="projectName">Project Name</label>
                    <input type="text" id="projectName" name="projectName" required placeholder="my-redaxo-site">
                </div>

                <div class="form-group">
                    <label for="projectLocation">Project Location</label>
                    <input type="text" id="projectLocation" name="projectLocation" required placeholder="/path/to/project">
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="redaxoVersion">REDAXO Version</label>
                        <select id="redaxoVersion" name="redaxoVersion" required>
                            <option value="">Loading...</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="phpVersion">PHP Version</label>
                        <select id="phpVersion" name="phpVersion" required>
                            <option value="8.1">PHP 8.1</option>
                            <option value="8.0">PHP 8.0</option>
                            <option value="8.2">PHP 8.2</option>
                            <option value="8.3">PHP 8.3</option>
                            <option value="7.4">PHP 7.4</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="database">Database</label>
                    <select id="database" name="database" required>
                        <option value="mysql:8.0">MySQL 8.0</option>
                        <option value="mysql:5.7">MySQL 5.7</option>
                        <option value="mariadb:10.6">MariaDB 10.6</option>
                        <option value="mariadb:10.5">MariaDB 10.5</option>
                    </select>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="adminUser">Admin Username</label>
                        <input type="text" id="adminUser" name="adminUser" value="admin" required>
                    </div>

                    <div class="form-group">
                        <label for="adminPassword">Admin Password</label>
                        <input type="password" id="adminPassword" name="adminPassword" required>
                    </div>
                </div>

                <div class="form-group">
                    <label for="adminEmail">Admin Email</label>
                    <input type="email" id="adminEmail" name="adminEmail" required>
                </div>

                <div class="form-group">
                    <label for="siteName">Site Name</label>
                    <input type="text" id="siteName" name="siteName" required placeholder="My REDAXO Site">
                </div>

                <button type="submit" class="btn btn-primary">
                    🚀 Create Project
                </button>
            </form>
        </div>

        <!-- Projects Panel -->
        <div class="panel">
            <h2>
                📋 Your Projects
            </h2>
            
            <div id="projectsList">
                <div class="loading">
                    <span class="spinner">⭕</span>
                    Loading projects...
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let projects = [];
        let redaxoVersions = [];

        // DOM elements
        const createProjectForm = document.getElementById('createProjectForm');
        const projectsList = document.getElementById('projectsList');
        const redaxoVersionSelect = document.getElementById('redaxoVersion');

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            vscode.postMessage({ command: 'getProjects' });
            vscode.postMessage({ command: 'getREDAXOVersions' });
            
            createProjectForm.addEventListener('submit', handleCreateProject);
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'projectsLoaded':
                    projects = message.projects;
                    renderProjects();
                    break;
                case 'redaxoVersionsLoaded':
                    redaxoVersions = message.versions;
                    renderREDAXOVersions();
                    break;
                case 'projectCreationStarted':
                    showNotification('Creating project...', 'info');
                    break;
                case 'projectCreated':
                    showNotification('Project created successfully!', 'success');
                    createProjectForm.reset();
                    break;
                case 'projectCreationFailed':
                    showNotification('Failed to create project: ' + message.error, 'error');
                    break;
            }
        });

        function handleCreateProject(e) {
            e.preventDefault();
            
            const formData = new FormData(createProjectForm);
            const config = {
                name: formData.get('projectName'),
                location: formData.get('projectLocation'),
                redaxoVersion: formData.get('redaxoVersion'),
                phpVersion: formData.get('phpVersion'),
                database: formData.get('database'),
                adminUser: formData.get('adminUser'),
                adminPassword: formData.get('adminPassword'),
                adminEmail: formData.get('adminEmail'),
                siteName: formData.get('siteName'),
                useHttps: true,
                installSampleData: false
            };

            vscode.postMessage({
                command: 'createProject',
                data: config
            });
        }

        function renderProjects() {
            if (projects.length === 0) {
                projectsList.innerHTML = \`
                    <div class="loading">
                        <p>No DDEV projects found</p>
                        <p style="margin-top: 10px; font-size: 14px; color: var(--vscode-descriptionForeground);">
                            Create your first REDAXO project using the form on the left.
                        </p>
                    </div>
                \`;
                return;
            }

            projectsList.innerHTML = \`
                <div class="projects-grid">
                    \${projects.map(project => \`
                        <div class="project-card">
                            <div class="project-header">
                                <div class="project-name">\${project.name}</div>
                                <div class="project-status status-\${project.status}">
                                    \${project.status}
                                </div>
                            </div>
                            
                            <div class="project-info">
                                <div>📂 \${project.location}</div>
                                <div>🐘 PHP \${project.phpVersion}</div>
                                <div>🗄️ \${project.database}</div>
                                \${project.urls.length > 0 ? \`<div>🌐 \${project.urls[0]}</div>\` : ''}
                            </div>
                            
                            <div class="project-actions">
                                \${project.status === 'running' 
                                    ? \`
                                        <button class="btn btn-secondary" onclick="stopProject('\${project.name}')">
                                            ⏸️ Stop
                                        </button>
                                        <button class="btn btn-primary" onclick="openProject('\${project.name}')">
                                            🌐 Open
                                        </button>
                                    \`
                                    : \`
                                        <button class="btn btn-primary" onclick="startProject('\${project.name}')">
                                            ▶️ Start
                                        </button>
                                    \`
                                }
                                <button class="btn btn-danger" onclick="deleteProject('\${project.name}')">
                                    🗑️ Delete
                                </button>
                            </div>
                        </div>
                    \`).join('')}
                </div>
            \`;
        }

        function renderREDAXOVersions() {
            redaxoVersionSelect.innerHTML = redaxoVersions.map(version => 
                \`<option value="\${version.version}">REDAXO \${version.version}\${version.stable ? '' : ' (Beta)'}</option>\`
            ).join('');
        }

        function startProject(projectName) {
            vscode.postMessage({
                command: 'startProject',
                projectName: projectName
            });
        }

        function stopProject(projectName) {
            vscode.postMessage({
                command: 'stopProject',
                projectName: projectName
            });
        }

        function openProject(projectName) {
            vscode.postMessage({
                command: 'openProject',
                projectName: projectName
            });
        }

        function deleteProject(projectName) {
            if (confirm(\`Are you sure you want to delete the project "\${projectName}"?\`)) {
                vscode.postMessage({
                    command: 'deleteProject',
                    projectName: projectName
                });
            }
        }

        function showNotification(message, type) {
            // Remove existing notifications
            const existingNotifications = document.querySelectorAll('.notification');
            existingNotifications.forEach(n => n.remove());

            const notification = document.createElement('div');
            notification.className = \`notification \${type}\`;
            notification.textContent = message;

            document.body.insertBefore(notification, document.querySelector('.header').nextSibling);

            // Auto-remove after 5 seconds
            setTimeout(() => {
                notification.remove();
            }, 5000);
        }
    </script>
</body>
</html>`;
    }
}