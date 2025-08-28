/**
 * Command to show the new modern login info webview
 * This allows testing the new design without replacing the old functionality
 */

import * as vscode from 'vscode';
import { LoginInfoProvider } from './loginInfoProvider';
import { DockerService } from '../../docker/dockerService';

export async function showModernLoginInfo(context: vscode.ExtensionContext, instanceName?: string) {
    if (!instanceName) {
        // Get instance name from user input for testing
        const input = await vscode.window.showInputBox({
            prompt: 'Enter instance name to show login info',
            placeHolder: 'e.g., my-redaxo-site',
            value: 'demo-instance'
        });
        
        if (!input) {
            return;
        }
        
        instanceName = input;
    }

    try {
        // Create mock docker service for demo purposes
        const mockDockerService = new MockDockerService();
        
        // Create and show the modern login info provider
        const loginInfoProvider = new LoginInfoProvider(context.extensionUri, mockDockerService as any);
        await loginInfoProvider.showLoginInfo(instanceName);
        
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to show login info: ${error.message}`);
    }
}

/**
 * Mock Docker Service for testing the new webview design
 */
class MockDockerService {
    async getLoginInfo(instanceName: string) {
        return {
            running: true,
            frontendUrl: 'http://localhost:8080',
            backendUrl: 'http://localhost:8080/redaxo',
            frontendUrlHttps: 'https://localhost:8443',
            backendUrlHttps: 'https://localhost:8443/redaxo',
            instanceType: 'redaxo', // or 'custom'
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
    }
}
