import * as path from 'node:path';
import * as vscode from 'vscode';

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
