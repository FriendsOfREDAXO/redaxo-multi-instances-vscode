import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'skerbis.redaxo-multi-instances-manager';

interface Api {
    manager: { list(): Promise<unknown[]>; settings: { instancesDir: string } };
}

describe('extension (VS Code)', () => {
    let api: Api;

    before(async () => {
        const ext = vscode.extensions.getExtension<Api>(EXTENSION_ID);
        assert.ok(ext, 'extension not found');
        api = await ext.activate();
    });

    it('uses the instances folder from REDAXO_INSTANCES_DIR', () => {
        assert.equal(api.manager.settings.instancesDir, process.env.REDAXO_INSTANCES_DIR);
    });

    it('registers every contributed command', async () => {
        const pkg = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON as { contributes: { commands: Array<{ command: string }> } };
        const all = new Set(await vscode.commands.getCommands(true));
        for (const { command } of pkg.contributes.commands) {
            assert.ok(all.has(command), command);
        }
    });

    it('registers the language model tools', () => {
        const names = vscode.lm.tools.map(t => t.name);
        for (const name of ['redaxo_list_instances', 'redaxo_get_instance', 'redaxo_redaxo_console', 'redaxo_query_database', 'redaxo_create_instance']) {
            assert.ok(names.includes(name), name);
        }
    });

    it('invokes a language model tool', async () => {
        const result = await vscode.lm.invokeTool('redaxo_list_instances', { input: {}, toolInvocationToken: undefined });
        const text = result.content.map(p => (p instanceof vscode.LanguageModelTextPart ? p.value : '')).join('');
        assert.match(text, /No instances found/);
    });

    it('lists the instances of the folder', async () => {
        assert.deepEqual(await api.manager.list(), []);
        await vscode.commands.executeCommand('redaxo-instances.refresh');
    });

    it('shares its settings with the MCP server and installs it', async () => {
        const dir = process.env.REDAXO_MI_CONFIG_DIR!;
        let settings: { instancesDir?: string } = {};
        for (let i = 0; i < 50; i++) {
            try {
                settings = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
                await fs.access(path.join(dir, 'mcp-server.js'));
                break;
            } catch {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        assert.equal(settings.instancesDir, process.env.REDAXO_INSTANCES_DIR);
        const server = await fs.readFile(path.join(dir, 'mcp-server.js'), 'utf8');
        assert.match(server, /^#!\/usr\/bin\/env node/);
    });

    it('opens the bundled help', async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID)!;
        for (const file of ['help.md', 'help.de.md']) {
            const content = await fs.readFile(path.join(ext.extensionPath, 'docs', file), 'utf8');
            assert.match(content, /MCP/);
        }
        await vscode.commands.executeCommand('redaxo-instances.showHelp');
    });

    it('shows the views', async () => {
        await vscode.commands.executeCommand('redaxo-instances.instancesView.focus');
        await vscode.commands.executeCommand('redaxo-instances.servicesView.focus');
    });
});
