import * as path from 'node:path';
import * as vscode from 'vscode';
import { ClaudeProject, claudeProjectKey, listClaudeProjects, moveClaudeSessions } from '../core/claude';
import { ClaudeItem, formatBytes } from './tree';

/** Claude Code for VS Code (the chat). */
const CLAUDE_EXTENSION = 'anthropic.claude-code';
const PENDING_KEY = 'redaxo-instances.pendingClaudeChat';
/** A pending request is only honoured shortly after it was made (the new window opens within seconds). */
const PENDING_MAX_AGE = 2 * 60_000;

interface PendingChat {
    folder: string;
    sessionId?: string;
    at: number;
}

export function hasClaudeChat(): boolean {
    return vscode.extensions.getExtension(CLAUDE_EXTENSION) !== undefined;
}

function isOpenFolder(folder: string): boolean {
    const want = path.resolve(folder);
    return (vscode.workspace.workspaceFolders ?? []).some(f => f.uri.scheme === 'file' && path.resolve(f.uri.fsPath) === want);
}

/**
 * Opens a session (or a new conversation) in the Claude Code chat. The chat only knows the sessions of the open workspace
 * folder – when `folder` is not open in this window, it is opened in a new window, which then opens the chat
 * ({@link resumePendingClaudeChat}).
 */
export async function openClaudeChat(context: vscode.ExtensionContext, folder: string, sessionId?: string): Promise<void> {
    if (isOpenFolder(folder)) {
        await vscode.commands.executeCommand('claude-vscode.editor.open', sessionId);
        return;
    }
    const pending: PendingChat = { folder: path.resolve(folder), sessionId, at: Date.now() };
    await context.globalState.update(PENDING_KEY, pending);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true });
}

/** On activation: open the chat a previous window asked for when it opened this folder. */
export async function resumePendingClaudeChat(context: vscode.ExtensionContext): Promise<void> {
    const pending = context.globalState.get<PendingChat>(PENDING_KEY);
    if (!pending || Date.now() - pending.at > PENDING_MAX_AGE) {
        return;
    }
    if (!isOpenFolder(pending.folder)) {
        return;
    }
    await context.globalState.update(PENDING_KEY, undefined);
    if (!hasClaudeChat()) {
        return;
    }
    try {
        await vscode.commands.executeCommand('claude-vscode.editor.open', pending.sessionId);
    } catch {
        // the Claude extension may still be starting – one more try
        setTimeout(() => void vscode.commands.executeCommand('claude-vscode.editor.open', pending.sessionId), 3000);
    }
}

/**
 * "Take over Claude sessions…": sessions of a folder that moved (or any other folder) become sessions of this
 * instance / local server – copied with rewritten paths, the old copy goes to the trash afterwards.
 */
export function registerClaudeMoveCommand(context: vscode.ExtensionContext, refresh: () => void, log: vscode.LogOutputChannel): void {
    const l10n = vscode.l10n;
    const register = (id: string, fn: (item?: ClaudeItem) => Promise<void>) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, async (item?: ClaudeItem) => {
            try {
                await fn(item);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log.error(message);
                void vscode.window.showErrorMessage(message);
            }
        }));

    register('redaxo-instances.takeOverClaudeSessions', async item => {
        const target = item instanceof ClaudeItem ? item.owner.folder : (await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, title: l10n.t('Take Claude sessions over into which folder?'), openLabel: l10n.t('Target folder'),
        }))?.[0]?.fsPath;
        if (!target) {
            return;
        }
        const projects = (await listClaudeProjects()).filter(p => p.cwd && p.key !== claudeProjectKey(target));
        type Item = vscode.QuickPickItem & { project?: ClaudeProject };
        const describe = (p: ClaudeProject): Item => ({
            label: `${p.cwdExists ? '$(folder)' : '$(warning)'} ${p.cwd ?? p.key}`,
            description: `${p.sessions === 1 ? l10n.t('1 session') : l10n.t('{0} sessions', p.sessions)}${p.hasMemory ? ` · ${l10n.t('memory')}` : ''}`,
            detail: `${p.modified ? p.modified.toLocaleString(vscode.env.language, { dateStyle: 'medium', timeStyle: 'short' }) : ''} · ${formatBytes(p.sizeBytes)}`,
            project: p,
        });
        const orphaned = projects.filter(p => !p.cwdExists);
        const others = projects.filter(p => p.cwdExists);
        const items: Item[] = [
            ...(orphaned.length ? [{ label: l10n.t('Folder no longer exists'), kind: vscode.QuickPickItemKind.Separator }, ...orphaned.map(describe)] : []),
            ...(others.length ? [{ label: l10n.t('Other folders'), kind: vscode.QuickPickItemKind.Separator }, ...others.map(describe)] : []),
        ];
        const picked = await vscode.window.showQuickPick(items, {
            title: l10n.t('Take Claude sessions over into {0}', target), placeHolder: l10n.t('Sessions of which folder?'), matchOnDescription: true, matchOnDetail: true,
        });
        const source = picked?.project;
        if (!source?.cwd) {
            return;
        }
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: l10n.t('Taking over Claude sessions…') },
            () => moveClaudeSessions(source.key, source.cwd ?? '', target));
        log.info(`Claude sessions ${source.dir} → ${result.target}: ${result.sessions} sessions, ${result.memory} memory files`);
        refresh();
        const trash = l10n.t('Move old copy to trash');
        const answer = await vscode.window.showInformationMessage(
            l10n.t('{0} sessions and {1} memory files taken over into {2}.', result.sessions, result.memory, path.basename(target)),
            { detail: l10n.t('The old copy is still in {0}.', source.dir) }, trash);
        if (answer === trash) {
            await vscode.workspace.fs.delete(vscode.Uri.file(source.dir), { recursive: true, useTrash: true });
        }
    });
}
