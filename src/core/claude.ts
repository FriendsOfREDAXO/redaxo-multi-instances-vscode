import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import * as readline from 'node:readline';
import * as os from 'node:os';
import * as path from 'node:path';
import { commandExists } from './exec';

/** A Claude Code session that belongs to an instance (started in its folder or in `project/`). */
export interface ClaudeSession {
    id: string;
    /** Transcript (`<id>.jsonl`). */
    file: string;
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
export async function listClaudeSessions(instancePath: string, webroot = 'project', limit = 20, projectsDir = claudeProjectsDir(), extraDirs: readonly string[] = []): Promise<ClaudeSession[]> {
    const dirs = [...new Set([instancePath, path.join(instancePath, webroot), ...extraDirs])];
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
                sessions.push({ id: file.slice(0, -6), file: full, cwd: info.cwd ?? dir, title: info.title, modified: stat.mtime, sizeBytes: stat.size });
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
            custom = o.customTitle; // the last record wins, '' resets to the generated title
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

/**
 * Renames a session the way Claude Code's `/rename` does: a `custom-title` record appended to the transcript (the last one
 * wins). An empty title removes the custom name again (the generated title is shown).
 */
export async function renameClaudeSession(session: Pick<ClaudeSession, 'id' | 'file'>, title: string): Promise<void> {
    if (!isSessionId(session.id) || path.basename(session.file) !== `${session.id}.jsonl`) {
        throw new Error(`Not a Claude session: ${session.file}`);
    }
    const customTitle = title.replace(/\s+/g, ' ').trim().slice(0, 200);
    await fs.appendFile(session.file, `\n${JSON.stringify({ type: 'custom-title', customTitle, sessionId: session.id })}\n`, 'utf8');
}

/** A Claude Code project folder (all sessions of one working directory). */
export interface ClaudeProject {
    /** Folder below ~/.claude/projects. */
    key: string;
    dir: string;
    /** Working directory recorded in the sessions. */
    cwd?: string;
    cwdExists: boolean;
    sessions: number;
    sizeBytes: number;
    modified?: Date;
    hasMemory: boolean;
}

/** All Claude Code projects with the working directory their sessions were started in (read from the transcripts). */
export async function listClaudeProjects(projectsDir = claudeProjectsDir()): Promise<ClaudeProject[]> {
    const out: ClaudeProject[] = [];
    for (const key of await fs.readdir(projectsDir).catch(() => [] as string[])) {
        const dir = path.join(projectsDir, key);
        const stat = await fs.stat(dir).catch(() => undefined);
        if (!stat?.isDirectory() || key.startsWith('.')) {
            continue;
        }
        const files = (await fs.readdir(dir)).filter(f => f.endsWith('.jsonl') && isSessionId(f.slice(0, -6)));
        let cwd: string | undefined;
        let size = 0;
        let modified: Date | undefined;
        for (const f of files) {
            const s = await fs.stat(path.join(dir, f));
            size += s.size;
            modified = !modified || s.mtime > modified ? s.mtime : modified;
            if (!cwd) {
                const handle = await fs.open(path.join(dir, f), 'r');
                try {
                    const buf = Buffer.alloc(Math.min(PEEK, s.size));
                    await handle.read(buf, 0, buf.length, 0);
                    cwd = parseSessionInfo(buf.toString('utf8')).cwd;
                } finally {
                    await handle.close();
                }
            }
        }
        // the recorded cwd must belong to this folder (sessions started in a subfolder carry their own cwd)
        const owner = cwd && claudeProjectKey(cwd) === key ? cwd : undefined;
        out.push({
            key, dir, cwd: owner, cwdExists: owner ? await fs.stat(owner).then(s => s.isDirectory(), () => false) : false,
            sessions: files.length, sizeBytes: size, modified,
            hasMemory: await fs.access(path.join(dir, 'memory')).then(() => true, () => false),
        });
    }
    return out.sort((a, b) => (b.modified?.getTime() ?? 0) - (a.modified?.getTime() ?? 0));
}

/**
 * Takes the sessions (and memory) of a Claude Code project over to another working directory – e.g. after a project folder
 * moved. Files are copied to the folder of `toDir` with all paths rewritten (`fromCwd` → `toDir`, project keys too);
 * existing sessions there are kept, memory files are merged (MEMORY.md lines appended). The source stays untouched –
 * delete it afterwards (the extension moves it to the trash).
 */
export async function moveClaudeSessions(fromKey: string, fromCwd: string, toDir: string, projectsDir = claudeProjectsDir()): Promise<{ sessions: number; memory: number; target: string }> {
    const source = path.join(projectsDir, fromKey);
    const toKey = claudeProjectKey(toDir);
    const target = path.join(projectsDir, toKey);
    if (fromKey === toKey) {
        throw new Error('Source and target are the same folder');
    }
    if (path.basename(source) !== fromKey || fromKey.includes('..')) {
        throw new Error(`Invalid project: ${fromKey}`);
    }
    const from = path.resolve(fromCwd);
    const to = path.resolve(toDir);
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // whole paths only: "/a/shop" must not touch "/a/shop2"
    const pathRe = new RegExp(`${esc(from)}(?=[/"'\\\\\\s)\\]]|$)`, 'g');
    const keyRe = new RegExp(`${esc(fromKey)}(?![A-Za-z0-9-])`, 'g');
    const rewrite = (text: string) => text.replace(pathRe, to).replace(keyRe, toKey);
    let sessions = 0;
    let memory = 0;

    const copyTree = async (src: string, dst: string, isMemory: boolean): Promise<void> => {
        await fs.mkdir(dst, { recursive: true });
        for (const entry of await fs.readdir(src, { withFileTypes: true })) {
            const s = path.join(src, entry.name);
            const d = path.join(dst, rewrite(entry.name));
            if (entry.isDirectory()) {
                await copyTree(s, d, isMemory || (src === source && entry.name === 'memory'));
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const exists = await fs.access(d).then(() => true, () => false);
            if (isMemory && entry.name === 'MEMORY.md' && exists) {
                // merge the index: append lines the target does not have yet
                const have = new Set((await fs.readFile(d, 'utf8')).split('\n').map(l => l.trim()));
                const add = rewrite(await fs.readFile(s, 'utf8')).split('\n').filter(l => l.trim() && !have.has(l.trim()));
                if (add.length) {
                    await fs.appendFile(d, `${add.join('\n')}\n`);
                }
                memory++;
                continue;
            }
            if (exists) {
                continue; // never overwrite sessions or notes in the target
            }
            if (entry.name.endsWith('.jsonl')) {
                await rewriteLines(s, d, rewrite);
            } else if (/\.(json|md|txt)$/i.test(entry.name)) {
                await fs.writeFile(d, rewrite(await fs.readFile(s, 'utf8')), 'utf8');
            } else {
                await fs.copyFile(s, d);
            }
            await fs.utimes(d, (await fs.stat(s)).atime, (await fs.stat(s)).mtime);
            if (isMemory) {
                memory++;
            } else if (src === source && entry.name.endsWith('.jsonl')) {
                sessions++;
            }
        }
    };
    await copyTree(source, target, false);

    return { sessions, memory, target };
}

/** Copies a JSON-lines transcript line by line (transcripts can be hundreds of MB) and checks every line stays valid JSON. */
async function rewriteLines(src: string, dst: string, rewrite: (s: string) => string): Promise<void> {
    const out = createWriteStream(dst, 'utf8');
    const lines = readline.createInterface({ input: createReadStream(src, 'utf8'), crlfDelay: Infinity });
    let n = 0;
    try {
        for await (const line of lines) {
            n++;
            const next = rewrite(line);
            if (next !== line && next.trim()) {
                try {
                    JSON.parse(next);
                } catch {
                    throw new Error(`Line ${n} of ${path.basename(src)} would become invalid – nothing was moved`);
                }
            }
            if (!out.write(`${next}\n`)) {
                await new Promise<void>(r => out.once('drain', () => r()));
            }
        }
    } catch (error) {
        out.destroy();
        await fs.rm(dst, { force: true });
        throw error;
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
}

/**
 * The parent folder when it is a project of its own (has CLAUDE.md or AGENTS.md) – e.g. a repository whose web root is a
 * subfolder. Its sessions belong to the local server too. Plain parents like ~/projects are not used.
 */
export async function projectParent(dir: string): Promise<string | undefined> {
    const parent = path.dirname(path.resolve(dir));
    if (parent === path.resolve(dir) || parent === os.homedir()) {
        return undefined;
    }
    for (const marker of ['CLAUDE.md', 'AGENTS.md']) {
        if (await fs.access(path.join(parent, marker)).then(() => true, () => false)) {
            return parent;
        }
    }
    return undefined;
}
