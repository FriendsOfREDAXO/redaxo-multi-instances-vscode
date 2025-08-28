/**
 * Modern Login Info Webview Provider
 * Replaces the HTML-in-string approach with separate template files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DockerService } from '../../docker/dockerService';

export class LoginInfoProvider {
    private _disposables: vscode.Disposable[] = [];
    private _panel: vscode.WebviewPanel | undefined = undefined;
    private _extensionUri: vscode.Uri;
    private _dockerService: DockerService;

    constructor(extensionUri: vscode.Uri, dockerService: DockerService) {
        this._extensionUri = extensionUri;
        this._dockerService = dockerService;
    }

    /**
     * Show login info for the specified instance
     */
    public async showLoginInfo(instanceName: string): Promise<void> {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (this._panel) {
            this._panel.reveal(columnToShowIn);
            await this.updateContent(instanceName);
            return;
        }

        // Create and show a new webview panel
        this._panel = vscode.window.createWebviewPanel(
            'redaxoLoginInfo',
            `🔑 Login Info - ${instanceName}`,
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'loginInfo')
                ]
            }
        );

        // Set the webview's initial html content
        await this.updateContent(instanceName);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'urlClicked':
                        console.log('URL clicked:', message.url);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Update the webview content for the specified instance
     */
    private async updateContent(instanceName: string): Promise<void> {
        if (!this._panel) {
            return;
        }

        try {
            const loginInfo = await this._dockerService.getLoginInfo(instanceName);
            const htmlContent = await this.getWebviewContent(this._panel.webview, instanceName, loginInfo);
            this._panel.webview.html = htmlContent;
            this._panel.title = `🔑 Login Info - ${instanceName}`;
        } catch (error: any) {
            const errorHtml = this.getErrorContent(error.message);
            this._panel.webview.html = errorHtml;
        }
    }

    /**
     * Generate webview HTML content using template files
     */
    private async getWebviewContent(webview: vscode.Webview, instanceName: string, loginInfo: any): Promise<string> {
        // Get URIs for CSS and JS files
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'loginInfo', 'loginInfo.css')
        );
        const jsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'loginInfo', 'loginInfo.js')
        );

        // Read the HTML template
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'loginInfo', 'loginInfo.html');
        let htmlTemplate = fs.readFileSync(htmlPath, 'utf8');

        // Replace template variables
        htmlTemplate = this.replaceTemplateVariables(htmlTemplate, {
            CSS_URI: cssUri.toString(),
            JS_URI: jsUri.toString(),
            INSTANCE_NAME: instanceName,
            STATUS_CLASS: loginInfo.running ? 'running' : 'stopped',
            STATUS_ICON: loginInfo.running ? '🟢' : '🔴',
            STATUS_TEXT: loginInfo.running ? 'Running' : 'Stopped',
            FRONTEND_URL: loginInfo.frontendUrl,
            BACKEND_URL: loginInfo.backendUrl,
            HTTPS_URLS: this.generateHttpsUrls(loginInfo),
            REDAXO_LOGIN_SECTION: this.generateRedaxoLoginSection(loginInfo),
            DB_HOST: loginInfo.dbHost,
            DB_NAME: loginInfo.dbName,
            DB_USER: loginInfo.dbUser,
            DB_PASSWORD: loginInfo.dbPassword,
            DB_ROOT_PASSWORD: loginInfo.dbRootPassword,
            DB_EXTERNAL_HOST: loginInfo.dbExternalHost,
            DB_EXTERNAL_PORT: loginInfo.dbExternalPort.toString()
        });

        return htmlTemplate;
    }

    /**
     * Replace template variables in HTML string
     */
    private replaceTemplateVariables(template: string, variables: Record<string, string>): string {
        let result = template;
        
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), value);
        }
        
        return result;
    }

    /**
     * Generate HTTPS URLs section if available
     */
    private generateHttpsUrls(loginInfo: any): string {
        if (!loginInfo.frontendUrlHttps) {
            return '';
        }

        return `
        <div class="url-item" data-copy="${loginInfo.frontendUrlHttps}">
            <div class="url-label">Frontend (HTTPS)</div>
            <div class="url-value">
                <a href="${loginInfo.frontendUrlHttps}" class="url-link">${loginInfo.frontendUrlHttps}</a>
                <span class="https-badge">🔒</span>
                <button class="copy-btn micro-btn" data-copy="${loginInfo.frontendUrlHttps}" data-feedback="frontend-https">
                    <span class="copy-icon">📋</span>
                    <span class="copy-text">Copy</span>
                </button>
            </div>
        </div>
        <div class="url-item" data-copy="${loginInfo.backendUrlHttps}">
            <div class="url-label">Backend (HTTPS)</div>
            <div class="url-value">
                <a href="${loginInfo.backendUrlHttps}" class="url-link">${loginInfo.backendUrlHttps}</a>
                <span class="https-badge">🔒</span>
                <button class="copy-btn micro-btn" data-copy="${loginInfo.backendUrlHttps}" data-feedback="backend-https">
                    <span class="copy-icon">📋</span>
                    <span class="copy-text">Copy</span>
                </button>
            </div>
        </div>
        `;
    }

    /**
     * Generate REDAXO login section based on instance type
     */
    private generateRedaxoLoginSection(loginInfo: any): string {
        if (loginInfo.instanceType === 'custom') {
            return `
            <div class="glass-card custom-instance animate-in" style="--delay: 0.2s">
                <div class="card-header">
                    <div class="card-icon">🔧</div>
                    <h2>Custom Instance</h2>
                </div>
                <div class="custom-warning">
                    <div class="custom-warning-icon">⚠️</div>
                    <h3>Custom Instance Detected</h3>
                    <p>This is a custom instance. No REDAXO backend credentials are available.</p>
                    <p>💡 <strong>Tip:</strong> Install REDAXO manually or use your own application.</p>
                </div>
            </div>
            `;
        }

        return `
        <div class="glass-card redaxo-login animate-in" style="--delay: 0.2s">
            <div class="card-header">
                <div class="card-icon">🔑</div>
                <h2>REDAXO Backend Login</h2>
            </div>
            <div class="login-grid">
                <div class="login-item">
                    <div class="login-label">Username</div>
                    <div class="login-value">
                        <span class="login-credential">${loginInfo.adminUser}</span>
                        <button class="copy-btn micro-btn" data-copy="${loginInfo.adminUser}" data-feedback="admin-username">
                            <span class="copy-icon">📋</span>
                            <span class="copy-text">Copy</span>
                        </button>
                    </div>
                </div>
                <div class="login-item">
                    <div class="login-label">Password</div>
                    <div class="login-value">
                        <span class="login-credential password-field">${loginInfo.adminPassword}</span>
                        <button class="copy-btn micro-btn" data-copy="${loginInfo.adminPassword}" data-feedback="admin-password">
                            <span class="copy-icon">📋</span>
                            <span class="copy-text">Copy</span>
                        </button>
                        <button class="toggle-visibility micro-btn" data-target="password-field">
                            <span class="visibility-icon">👁️</span>
                        </button>
                    </div>
                </div>
            </div>
            <div class="login-note">
                <p>💡 <strong>Note:</strong> These credentials are automatically generated for each instance.</p>
            </div>
        </div>
        `;
    }

    /**
     * Generate error content
     */
    private getErrorContent(errorMessage: string): string {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error - Login Information</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-editor-background);
                    padding: 40px;
                    text-align: center;
                }
                .error-container {
                    max-width: 500px;
                    margin: 0 auto;
                    padding: 40px;
                    background: rgba(255, 0, 0, 0.1);
                    border: 1px solid var(--vscode-errorBorder);
                    border-radius: 12px;
                }
                .error-icon {
                    font-size: 4rem;
                    margin-bottom: 20px;
                }
                .error-title {
                    font-size: 1.5rem;
                    margin-bottom: 16px;
                    color: var(--vscode-errorForeground);
                }
                .error-message {
                    font-size: 1rem;
                    line-height: 1.6;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="error-container">
                <div class="error-icon">❌</div>
                <h2 class="error-title">Error loading login information</h2>
                <p class="error-message">${this.escapeHtml(errorMessage)}</p>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Escape HTML entities
     */
    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * Refresh the current instance display
     */
    public async refresh(instanceName: string): Promise<void> {
        if (this._panel) {
            await this.updateContent(instanceName);
        }
    }

    /**
     * Dispose of the webview panel and cleanup
     */
    public dispose(): void {
        if (this._panel) {
            this._panel.dispose();
            this._panel = undefined;
        }

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
