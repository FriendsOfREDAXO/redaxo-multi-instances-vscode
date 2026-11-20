import { spawn } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { run } from './exec';

/**
 * Live server of a project: pull the live state (database dump, media) and deploy code – over SSH and rsync.
 *
 * Rules:
 *  - No passwords are stored. SSH uses the user's `~/.ssh/config` and keys (BatchMode, never a password prompt); the
 *    database credentials are read on the server from REDAXO itself (`bin/console db:connection-options`) for each dump.
 *  - Pulling only reads on the server.
 *  - Deploy only transfers files (never database, media, caches or local configuration), never deletes on the server,
 *    and keeps every file it overwrites in a backup folder on the server. A dry run shows the list first.
 */
export interface RemoteProfile {
    schema: 1;
    /** SSH target: `user@host` or a host alias from ~/.ssh/config. */
    host: string;
    port?: number;
    /** Project folder on the server that corresponds to the local web root (absolute or relative to the SSH home). */
    path: string;
    /** PHP CLI on the server (e.g. /opt/plesk/php/8.5/bin/php). */
    php: string;
    /** REDAXO console relative to `path` (detected: bin/console, redaxo/bin/console, project/bin/console). */
    console?: string;
    /** Media folder relative to `path` (detected: public/media, media). */
    media?: string;
    /** Host names on the live server → local host names, used when a dump is imported (YRewrite, URL add-on …). */
    domainMap: Record<string, string>;
    /** Extra rsync excludes for compare and deploy (besides the built-in ones and `.deployignore`). */
    exclude: string[];
    /** Commands run on the server in `path` after a deploy, e.g. `{php} {console} cache:clear`. */
    afterDeploy: string[];
    /** Skip files ignored by git (`.gitignore` in every folder). Default true; off for built files that git ignores. */
    respectGitignore?: boolean;
}

export const REMOTE_FILE = 'redaxo-remote.json';

/** Never compared or deployed: data, caches, media, local configuration, VCS and build folders. */
export const DEFAULT_EXCLUDES = [
    '.git/', '.svn/', 'node_modules/', '.DS_Store', '._*', 'Thumbs.db', '.idea/', '.vscode/', '.claude/',
    '.env.local', '.env.*.local', '.redaxo-mi*', '.snapshots/', 'redaxo-remote.json', '.deployignore',
    'var/', 'redaxo/data/', 'redaxo/cache/', 'media/', 'public/media/', 'vendor/', '*.log', '*.sql', '*.sql.gz',
];

export interface RemoteInfo {
    home: string;
    path: string;
    console?: string;
    media?: string;
    redaxoVersion?: string;
    phpVersion?: string;
    dumpTool?: string;
}

export type FileChange = 'new' | 'changed' | 'only-remote';

export interface ChangedFile {
    path: string;
    change: FileChange;
}

export interface DeployResult {
    files: ChangedFile[];
    backupDir?: string;
    afterDeploy: { command: string; output: string; ok: boolean }[];
}

/** Single-quotes a value for a POSIX shell (the server runs dash or bash). */
export function sq(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function readRemoteProfile(dir: string): Promise<RemoteProfile | undefined> {
    try {
        const p = JSON.parse(await fs.readFile(path.join(dir, REMOTE_FILE), 'utf8')) as Partial<RemoteProfile>;
        if (!p.host || !p.path) {
            return undefined;
        }
        return { schema: 1, php: 'php', domainMap: {}, exclude: [], afterDeploy: [], ...p } as RemoteProfile;
    } catch {
        return undefined;
    }
}

export async function writeRemoteProfile(dir: string, profile: RemoteProfile): Promise<void> {
    const errors = validateRemoteProfile(profile);
    if (errors.length) {
        throw new Error(errors.join('\n'));
    }
    await fs.writeFile(path.join(dir, REMOTE_FILE), `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
}

export function validateRemoteProfile(p: RemoteProfile): string[] {
    const errors: string[] = [];
    // no options or shell syntax in the SSH target
    if (!/^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$/.test(p.host)) {
        errors.push(`Invalid SSH target: ${p.host}`);
    }
    if (p.port !== undefined && !(Number.isInteger(p.port) && p.port > 0 && p.port < 65536)) {
        errors.push(`Invalid port: ${p.port}`);
    }
    if (!p.path.trim() || /[\n\0]/.test(p.path)) {
        errors.push('Invalid server path');
    }
    for (const [from, to] of Object.entries(p.domainMap)) {
        if (!/^[a-z0-9.*-]+$/i.test(from) || !/^[a-z0-9.*-]+$/i.test(to)) {
            errors.push(`Invalid domain mapping: ${from} → ${to}`);
        }
    }
    return errors;
}

function sshArgs(p: RemoteProfile): string[] {
    return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', ...(p.port ? ['-p', String(p.port)] : []), p.host];
}

function rsyncSsh(p: RemoteProfile): string {
    return `ssh -o BatchMode=yes -o ConnectTimeout=15${p.port ? ` -p ${p.port}` : ''}`;
}

/** Runs a shell script on the server (in the project folder) and returns its output. */
export async function remoteExec(p: RemoteProfile, script: string, timeout = 120_000): Promise<string> {
    const res = await run('ssh', [...sshArgs(p), `cd ${sq(p.path)} && ${script}`], { allowFailure: true, timeout });
    if (res.code !== 0) {
        throw new Error(`ssh ${p.host}: ${(res.stderr || res.stdout).trim() || `exit ${res.code}`}`);
    }
    return res.stdout;
}

/** Tests the connection and finds console, media folder, versions and the dump tool. */
export async function inspectRemote(p: RemoteProfile): Promise<RemoteInfo> {
    const script = [
        'echo "home=$HOME"', 'echo "path=$(pwd)"',
        'for c in bin/console redaxo/bin/console project/bin/console; do [ -f "$c" ] && { echo "console=$c"; break; }; done',
        'for m in public/media media project/public/media; do [ -d "$m" ] && { echo "media=$m"; break; }; done',
        `echo "php=$(${sq(p.php)} -r 'echo PHP_VERSION;' 2>/dev/null)"`,
        'echo "dump=$(command -v mariadb-dump || command -v mysqldump)"',
    ].join('; ');
    const out = await remoteExec(p, script, 30_000);
    const v = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(out)?.[1]?.trim() || undefined;
    const info: RemoteInfo = { home: v('home') ?? '', path: v('path') ?? p.path, console: v('console'), media: v('media'), phpVersion: v('php'), dumpTool: v('dump') };
    const consolePath = p.console ?? info.console;
    if (consolePath && info.phpVersion) {
        const ver = await remoteExec(p, `${sq(p.php)} ${sq(consolePath)} --version 2>/dev/null | head -n 1`, 30_000).catch(() => '');
        info.redaxoVersion = /(\d+\.[\w.-]+)/.exec(ver)?.[1];
    }
    return info;
}

/**
 * Database dump of the live server, gzip-compressed, into `outFile`. The credentials come from REDAXO on the server and
 * never leave it (they are only part of the command line there).
 */
export async function pullDatabase(p: RemoteProfile, outFile: string, onProgress: (bytes: number) => void = () => {}): Promise<number> {
    const consolePath = p.console ?? (await inspectRemote(p)).console;
    if (!consolePath) {
        throw new Error('REDAXO console not found on the server – set "console" in redaxo-remote.json');
    }
    const dump = 'D=$(command -v mariadb-dump || command -v mysqldump) || { echo "no mariadb-dump/mysqldump on the server" >&2; exit 3; }';
    const opts = `O=$(${sq(p.php)} ${sq(consolePath)} db:connection-options | tr '\\n' ' ') || exit 4`;
    const script = `${dump}; ${opts}; eval "\\"$D\\" --single-transaction --no-tablespaces --routines --triggers --hex-blob --default-character-set=utf8mb4 $O" | gzip -c`;
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    return new Promise<number>((resolve, reject) => {
        const child = spawn('ssh', [...sshArgs(p), `cd ${sq(p.path)} && ${script}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out = createWriteStream(outFile);
        let bytes = 0;
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            onProgress(bytes);
        });
        child.stdout.pipe(out);
        child.stderr.on('data', (c: Buffer) => {
            stderr += c.toString();
        });
        child.on('error', reject);
        child.on('close', code => {
            out.close();
            if (code !== 0 || bytes < 100) {
                void fs.rm(outFile, { force: true });
                reject(new Error(`Dump failed (exit ${code}): ${stderr.trim() || 'no data'}`));
            } else {
                resolve(bytes);
            }
        });
    });
}

/** Copies new and changed media from the server (never deletes local files). */
export async function pullMedia(p: RemoteProfile, localMediaDir: string, dryRun = false): Promise<string[]> {
    const media = p.media ?? (await inspectRemote(p)).media;
    if (!media) {
        throw new Error('Media folder not found on the server – set "media" in redaxo-remote.json');
    }
    await fs.mkdir(localMediaDir, { recursive: true });
    const res = await run('rsync', ['-rltz', '--itemize-changes', ...(dryRun ? ['-n'] : []), '-e', rsyncSsh(p), `${p.host}:${remotePath(p, media)}/`, `${localMediaDir}/`],
        { allowFailure: true, timeout: 60 * 60_000 });
    if (res.code !== 0) {
        throw new Error(`rsync: ${res.stderr.trim() || `exit ${res.code}`}`);
    }
    return parseItemized(res.stdout).map(f => f.path);
}

/** Path on the server for rsync (relative paths are relative to the SSH home, like `cd` in remoteExec). */
function remotePath(p: RemoteProfile, rel = ''): string {
    const base = p.path.replace(/\/+$/, '');
    const joined = rel ? `${base}/${rel}` : base;
    // rsync's remote side splits on spaces unless protected
    return joined.replace(/([ '"$`\\])/g, '\\$1');
}

async function excludeArgs(p: RemoteProfile, localRoot: string): Promise<string[]> {
    const own = await fs.readFile(path.join(localRoot, '.deployignore'), 'utf8')
        .then(t => t.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')), () => [] as string[]);
    return [
        ...(p.respectGitignore === false ? [] : ['--filter=:- .gitignore']),
        ...[...new Set([...DEFAULT_EXCLUDES, ...p.exclude, ...own])].flatMap(e => ['--exclude', e]),
    ];
}

/**
 * What differs between the local project and the live server (by checksum): new and changed local files, and files
 * that only exist on the server. Reads only.
 */
export async function compare(p: RemoteProfile, localRoot: string): Promise<ChangedFile[]> {
    const res = await run('rsync', ['-rlcn', '--delete', '--itemize-changes', ...(await excludeArgs(p, localRoot)), '-e', rsyncSsh(p), `${localRoot}/`, `${p.host}:${remotePath(p)}/`],
        { allowFailure: true, timeout: 30 * 60_000 });
    if (res.code !== 0) {
        throw new Error(`rsync: ${res.stderr.trim() || `exit ${res.code}`}`);
    }
    return parseItemized(res.stdout);
}

/** rsync --itemize-changes → files (directories and attribute-only changes are skipped). */
export function parseItemized(out: string): ChangedFile[] {
    const files: ChangedFile[] = [];
    for (const line of out.split('\n')) {
        const del = /^\*deleting\s+(.+)$/.exec(line);
        if (del) {
            if (!del[1].endsWith('/')) {
                files.push({ path: del[1], change: 'only-remote' });
            }
            continue;
        }
        const m = /^([<>ch.*])([fdLDS])(\S{5,})\s+(.+)$/.exec(line); // 7 (openrsync, macOS) or 9 attribute characters
        if (!m || m[2] !== 'f') {
            continue;
        }
        const flags = m[3];
        if (flags.startsWith('+++')) {
            files.push({ path: m[4], change: 'new' });
        } else if (flags[0] === 'c' || flags[1] === 's') {
            files.push({ path: m[4], change: 'changed' });
        }
    }
    return files;
}

/** Content of a file on the server (for a diff view). */
export async function remoteFile(p: RemoteProfile, rel: string): Promise<string> {
    if (rel.split('/').includes('..')) {
        throw new Error(`Invalid path: ${rel}`);
    }
    return remoteExec(p, `cat -- ${sq(rel)}`, 60_000);
}

/**
 * Deploy: transfers new and changed files (optionally only `onlyFiles`) to the server. Overwritten files are kept in
 * `~/backup-deploy-<timestamp>/files` on the server; nothing is deleted there. With `dryRun` only the list is returned.
 */
export async function deploy(p: RemoteProfile, localRoot: string, options: { dryRun?: boolean; onlyFiles?: string[]; now?: Date } = {}): Promise<DeployResult> {
    const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const backupDir = `backup-deploy-${stamp}`;
    const list = options.onlyFiles?.length ? path.join(localRoot, `.redaxo-mi-deploy-${process.pid}.txt`) : undefined;
    if (list) {
        for (const f of options.onlyFiles ?? []) {
            if (f.startsWith('/') || f.split('/').includes('..')) {
                throw new Error(`Invalid path: ${f}`);
            }
        }
        await fs.writeFile(list, `${options.onlyFiles?.join('\n')}\n`, 'utf8');
    }
    try {
        if (!options.dryRun) {
            await remoteExec(p, `mkdir -p "$HOME"/${sq(backupDir)}/files`, 30_000);
        }
        const home = options.dryRun ? '' : (await remoteExec(p, 'printf %s "$HOME"', 30_000)).trim();
        const res = await run('rsync', [
            '-rlptzc', '--itemize-changes', ...(options.dryRun ? ['-n'] : ['--backup', `--backup-dir=${home}/${backupDir}/files`]),
            ...(list ? [`--files-from=${list}`] : []), ...(await excludeArgs(p, localRoot)),
            '-e', rsyncSsh(p), `${localRoot}/`, `${p.host}:${remotePath(p)}/`,
        ], { allowFailure: true, timeout: 60 * 60_000 });
        if (res.code !== 0) {
            throw new Error(`rsync: ${res.stderr.trim() || `exit ${res.code}`}`);
        }
        const files = parseItemized(res.stdout);
        const result: DeployResult = { files, backupDir: options.dryRun ? undefined : `~/${backupDir}`, afterDeploy: [] };
        if (!options.dryRun && files.length) {
            const consolePath = p.console ?? '';
            for (const template of p.afterDeploy) {
                const command = template.replace(/\{php\}/g, sq(p.php)).replace(/\{console\}/g, sq(consolePath));
                try {
                    result.afterDeploy.push({ command, output: (await remoteExec(p, command, 10 * 60_000)).trim(), ok: true });
                } catch (error) {
                    result.afterDeploy.push({ command, output: error instanceof Error ? error.message : String(error), ok: false });
                    break;
                }
            }
        }
        return result;
    } finally {
        if (list) {
            await fs.rm(list, { force: true });
        }
    }
}

/**
 * SQL that rewrites live host names to local ones after an import – only for columns that exist (`table.column` in `columns`): YRewrite domains and
 * aliases, consent_kit, the URL add-on index and values in rex_config. `domainMap` values are validated host names.
 */
export function domainRewrites(domainMap: Record<string, string>, columns: ReadonlySet<string>): string[] {
    const out: string[] = [];
    const lit = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    for (const [from, to] of Object.entries(domainMap)) {
        if (!/^[a-z0-9.-]+$/i.test(from) || !/^[a-z0-9.-]+$/i.test(to)) {
            continue;
        }
        const r = (col: string) => `${col} = REPLACE(${col}, ${lit(from)}, ${lit(to)})`;
        const where = (col: string) => `${col} LIKE ${lit(`%${from}%`)}`;
        const targets: [string, string][] = [
            ['rex_yrewrite_domain', 'domain'], ['rex_yrewrite_alias', 'alias_domain'], ['rex_yrewrite_forward', 'domain'],
            ['rex_consent_kit_domain', 'host'], ['rex_url_generator_url', 'url'], ['rex_config', 'value'],
        ];
        for (const [table, col] of targets) {
            if (columns.has(`${table}.${col}`)) {
                out.push(`UPDATE \`${table}\` SET ${r(col)} WHERE ${where(col)};`);
            }
        }
    }
    return out;
}
