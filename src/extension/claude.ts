import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { run } from '../core/exec';
import { InstanceManager } from '../core/manager';
import { sharedSettingsFile } from '../core/settings';
import type { CommandContext } from './commands';

const l10n = vscode.l10n;
export const MCP_SERVER_NAME = 'redaxo-instances';

export interface McpCommand {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

let cachedCommand: McpCommand | undefined;

/** Stable location of the MCP server (survives extension updates). */
export function mcpServerPath(): string {
    return path.join(path.dirname(sharedSettingsFile()), 'mcp-server.js');
}

/** Copies the bundled MCP server to the stable location (on every activation, if changed). */
export async function installMcpServer(context: vscode.ExtensionContext): Promise<void> {
    const source = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-server.js').fsPath;
    const target = mcpServerPath();
    const [src, dst] = await Promise.all([
        fs.readFile(source).catch(() => undefined),
        fs.readFile(target).catch(() => undefined),
    ]);
    if (src && (!dst || !src.equals(dst))) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, src, { mode: 0o755 });
    }
}

/** Absolute node binary (GUI apps like Claude Desktop have a minimal PATH); falls back to VS Code's runtime. */
export async function mcpCommand(): Promise<McpCommand> {
    if (cachedCommand) {
        return cachedCommand;
    }
    try {
        const res = await run('node', ['-p', 'process.execPath'], { timeout: 10_000 });
        const node = res.stdout.trim();
        if (node) {
            cachedCommand = { command: node, args: [mcpServerPath()] };
            return cachedCommand;
        }
    } catch {
        // no node in PATH
    }
    cachedCommand = { command: process.execPath, args: [mcpServerPath()], env: { ELECTRON_RUN_AS_NODE: '1' } };
    return cachedCommand;
}

function serverJson(cmd: McpCommand): Record<string, unknown> {
    return { type: 'stdio', command: cmd.command, args: cmd.args, ...(cmd.env ? { env: cmd.env } : {}) };
}

async function mergeJson(file: string, update: (data: Record<string, unknown>) => void): Promise<void> {
    let data: Record<string, unknown> = {};
    try {
        data = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(l10n.t('{0} is not valid JSON – please fix it first.', file), { cause: error });
        }
    }
    update(data);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** AGENTS.md / CLAUDE.md (core) plus a project-scoped .mcp.json for Claude Code. */
export async function writeAiFiles(manager: InstanceManager, dir: string): Promise<void> {
    await manager.writeAiFiles(dir);
    const cmd = await mcpCommand();
    await mergeJson(path.join(dir, '.mcp.json'), data => {
        const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
        servers[MCP_SERVER_NAME] = serverJson(cmd);
        data.mcpServers = servers;
    });
}

function claudeDesktopConfig(): string {
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    }
    return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

async function findClaudeCli(): Promise<string | undefined> {
    const candidates = ['claude', path.join(os.homedir(), '.local', 'bin', 'claude'), path.join(os.homedir(), '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
    for (const c of candidates) {
        try {
            await run(c, ['--version'], { timeout: 15_000 });
            return c;
        } catch {
            // next
        }
    }
    return undefined;
}

export async function setupClaude(ctx: CommandContext): Promise<void> {
    const cmd = await mcpCommand();
    type Item = vscode.QuickPickItem & { id: 'code' | 'desktop' | 'copy' };
    const pick = await vscode.window.showQuickPick<Item>([
        { id: 'code', label: '$(terminal) Claude Code', detail: l10n.t('Registers the MCP server for all projects (claude mcp add --scope user). Also used by the Claude Code extension for VS Code.') },
        { id: 'desktop', label: '$(device-desktop) Claude Desktop', detail: claudeDesktopConfig() },
        { id: 'copy', label: '$(copy) ' + l10n.t('Copy configuration (JSON)'), detail: l10n.t('For other MCP clients') },
    ], { title: l10n.t('Connect Claude with your REDAXO instances') });
    if (!pick) {
        return;
    }
    try {
        if (pick.id === 'code') {
            const cli = await findClaudeCli();
            const args = ['mcp', 'add', '--scope', 'user', ...Object.entries(cmd.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]), MCP_SERVER_NAME, '--', cmd.command, ...cmd.args];
            if (!cli) {
                const shell = `claude ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
                await vscode.env.clipboard.writeText(shell);
                void vscode.window.showInformationMessage(l10n.t('Claude Code CLI not found. The command was copied – run it after installing Claude Code.'));
                return;
            }
            await run(cli, ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME], { allowFailure: true, timeout: 30_000 });
            await run(cli, args, { timeout: 30_000 });
            void vscode.window.showInformationMessage(l10n.t('Claude Code can now manage your instances (MCP server "{0}"). Try: "List my REDAXO instances".', MCP_SERVER_NAME));
        } else if (pick.id === 'desktop') {
            const file = claudeDesktopConfig();
            await mergeJson(file, data => {
                const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
                servers[MCP_SERVER_NAME] = { command: cmd.command, args: cmd.args, ...(cmd.env ? { env: cmd.env } : {}) };
                data.mcpServers = servers;
            });
            void vscode.window.showInformationMessage(l10n.t('Claude Desktop is configured – restart Claude Desktop to load the REDAXO tools.'));
        } else {
            await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: serverJson(cmd) } }, null, 2));
            void vscode.window.showInformationMessage(l10n.t('MCP configuration copied.'));
        }
        ctx.log.info(`MCP server: ${cmd.command} ${cmd.args.join(' ')}`);
    } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
}
