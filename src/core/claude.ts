import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { commandExists } from './exec';

/** A Claude Code session that belongs to an instance (started in its folder or in `project/`). */
export interface ClaudeSession {
    id: string;
    /** Working directory the session was started in – `claude --resume` must run there. */
    cwd: string;
    title: string;
    modified: Date;
    sizeBytes: number;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bytes read from the start and the end of a transcript – titles are repeated, transcripts can be hundreds of MB. */
const PEEK = 256 * 1024;

export function isSessionId(id: string): boolean {
    return SESSION_ID.test(id);
}

/** `~/.claude/projects` (or below `CLAUDE_CONFIG_DIR`). */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
    return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** Claude Code names a project folder after the working directory: every character except letters and digits becomes `-`. */
export function claudeProjectKey(dir: string): string {
    return path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
}

let installed: Promise<boolean> | undefined;

/** Is the Claude Code CLI available? (cached – checked once per process) */
export function isClaudeInstalled(): Promise<boolean> {
    installed ??= (async () => {
        if (await commandExists('claude')) {
            return true;
        }
        // native installer without PATH entry
        return fs.access(path.join(os.homedir(), '.claude', 'local', 'claude')).then(() => true, () => false);
    })();
    return installed;
}

/** Sessions started in the instance folder or its web root, newest first. */
export async function listClaudeSessions(instancePath: string, webroot = 'project', limit = 20, projectsDir = claudeProjectsDir()): Promise<ClaudeSession[]> {
    const dirs = [...new Set([instancePath, path.join(instancePath, webroot)])];
    const sessions: ClaudeSession[] = [];
    for (const dir of dirs) {
        const folder = path.join(projectsDir, claudeProjectKey(dir));
        let files: string[];
        try {
            files = (await fs.readdir(folder)).filter(f => f.endsWith('.jsonl') && isSessionId(f.slice(0, -6)));
        } catch {
            continue;
        }
        for (const file of files) {
            const full = path.join(folder, file);
            try {
                const stat = await fs.stat(full);
                const info = await readSessionInfo(full, stat.size);
                if (!info.hasMessages) {
                    continue;
                }
                sessions.push({ id: file.slice(0, -6), cwd: info.cwd ?? dir, title: info.title, modified: stat.mtime, sizeBytes: stat.size });
            } catch {
                // unreadable transcript – skip
            }
        }
    }
    return sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, limit);
}

interface SessionInfo {
    title: string;
    cwd?: string;
    hasMessages: boolean;
}

async function readSessionInfo(file: string, size: number): Promise<SessionInfo> {
    const handle = await fs.open(file, 'r');
    try {
        const read = async (start: number, length: number): Promise<string> => {
            const buf = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buf, 0, length, start);
            return buf.subarray(0, bytesRead).toString('utf8');
        };
        const head = await read(0, Math.min(PEEK, size));
        const tail = size > PEEK ? await read(Math.max(PEEK, size - PEEK), Math.min(PEEK, size - PEEK)) : '';
        return parseSessionInfo(head, tail);
    } finally {
        await handle.close();
    }
}

/** Title (renamed > generated > first prompt), working directory and whether the session has any conversation. */
export function parseSessionInfo(head: string, tail = ''): SessionInfo {
    let custom = '';
    let generated = '';
    let firstPrompt = '';
    let cwd: string | undefined;
    let hasMessages = false;
    for (const line of `${head}\n${tail}`.split('\n')) {
        if (!line.startsWith('{')) {
            continue;
        }
        let o: Record<string, unknown>;
        try {
            o = JSON.parse(line) as Record<string, unknown>;
        } catch {
            continue; // cut at the start or end of a chunk
        }
        if (o.type === 'custom-title' && typeof o.customTitle === 'string') {
            custom = o.customTitle;
        } else if (o.type === 'ai-title' && typeof o.aiTitle === 'string') {
            generated = o.aiTitle;
        } else if (o.type === 'summary' && typeof o.summary === 'string' && !generated) {
            generated = o.summary;
        } else if (o.type === 'user' || o.type === 'assistant') {
            hasMessages = true;
            cwd ??= typeof o.cwd === 'string' ? o.cwd : undefined;
            if (o.type === 'user' && !firstPrompt && !o.isMeta) {
                firstPrompt = promptText(o.message);
            }
        }
    }
    const title = (custom || generated || firstPrompt).replace(/\s+/g, ' ').trim();
    return { title: title.length > 80 ? `${title.slice(0, 79)}…` : title, cwd, hasMessages };
}

function promptText(message: unknown): string {
    const content = (message as { content?: unknown } | undefined)?.content;
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.map(c => (c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' ? String((c as { text?: unknown }).text ?? '') : '')).join(' ') : '';
    // slash commands, hook output and other injected text start with a tag
    return text.trim().startsWith('<') ? '' : text;
}
