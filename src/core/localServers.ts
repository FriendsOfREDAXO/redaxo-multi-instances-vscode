import { spawn } from 'node:child_process';
import { closeSync, openSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from './exec';
import { SHARED_DIR, validateDomain, validateInstanceName } from './model';
import { findFreePort, isPortFree } from './ports';

/**
 * Local servers: web servers without Docker for projects that stay where they are (e.g. a flat-file PHP CMS with SQLite,
 * plain HTML, a Vite or Hugo dev server). They run as detached processes – they keep running when VS Code closes – with a
 * pid and a log file below `<instances>/.redaxo-mi/local/`. When the shared HTTPS proxy runs, it also serves them as
 * `https://<name>.localhost` (upstream `host.docker.internal:<port>`); without Docker they are reachable as
 * `http://<name>.localhost:<port>`.
 */
export type LocalServerKind = 'static' | 'php' | 'command';

export interface LocalServerConfig {
    name: string;
    kind: LocalServerKind;
    /** Project folder (absolute) – stays where it is. */
    path: string;
    /** Document root relative to `path` (static, php). */
    docroot: string;
    /** Router script relative to `path` (php), e.g. `public/index.php`. */
    router?: string;
    /** PHP binary (php). */
    php?: string;
    /** Shell command (command) – `$PORT` / `{port}` is the port. */
    command?: string;
    /** Reload the browser on file changes (static). */
    liveReload?: boolean;
    port: number;
    /** Extra host names for the HTTPS proxy (besides `<name>.localhost` and `*.<name>.localhost`). */
    domains: string[];
    createdAt: string;
}

export type LocalServerStatus = 'running' | 'stopped';

export interface LocalServer extends LocalServerConfig {
    status: LocalServerStatus;
    pid?: number;
    /** Direct address (always works while the server runs). */
    directUrl: string;
    /** Host names the HTTPS proxy serves. */
    hosts: string[];
    logFile: string;
}

export interface PhpBinary {
    path: string;
    version: string;
}

export interface DetectedServer {
    kind: LocalServerKind;
    docroot: string;
    router?: string;
    command?: string;
    port?: number;
    reason: string;
}

const REGISTRY = 'local-servers.json';

export class LocalServers {
    constructor(private readonly instancesDir: () => string, private readonly staticServerScript: () => string | undefined = () => undefined) {}

    private get dir(): string {
        return path.join(this.instancesDir(), SHARED_DIR, 'local');
    }

    private file(name: string, ext: 'pid' | 'log'): string {
        return path.join(this.dir, `${name}.${ext}`);
    }

    async configs(): Promise<LocalServerConfig[]> {
        try {
            const data = JSON.parse(await fs.readFile(path.join(this.dir, REGISTRY), 'utf8')) as { servers?: LocalServerConfig[] };
            return (data.servers ?? []).map(s => ({ ...s, domains: s.domains ?? [] }));
        } catch {
            return [];
        }
    }

    private async save(servers: LocalServerConfig[]): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true });
        const tmp = path.join(this.dir, `${REGISTRY}.${process.pid}.tmp`);
        await fs.writeFile(tmp, `${JSON.stringify({ schema: 1, servers: [...servers].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2)}\n`, 'utf8');
        await fs.rename(tmp, path.join(this.dir, REGISTRY));
    }

    async list(): Promise<LocalServer[]> {
        return Promise.all((await this.configs()).map(c => this.describe(c)));
    }

    async get(name: string): Promise<LocalServer> {
        const cfg = (await this.configs()).find(s => s.name === name);
        if (!cfg) {
            throw new Error(`Local server "${name}" not found`);
        }
        return this.describe(cfg);
    }

    private async describe(cfg: LocalServerConfig): Promise<LocalServer> {
        const pid = await this.livePid(cfg.name);
        return {
            ...cfg,
            status: pid ? 'running' : 'stopped',
            pid,
            directUrl: `http://${cfg.name}.localhost:${cfg.port}/`,
            hosts: [`${cfg.name}.localhost`, `*.${cfg.name}.localhost`, ...cfg.domains],
            logFile: this.file(cfg.name, 'log'),
        };
    }

    /** Pid of the running server process (stale pid files are removed). */
    private async livePid(name: string): Promise<number | undefined> {
        const pidFile = this.file(name, 'pid');
        const pid = Number.parseInt(await fs.readFile(pidFile, 'utf8').catch(() => ''), 10);
        if (!Number.isInteger(pid) || pid <= 0) {
            return undefined;
        }
        try {
            process.kill(pid, 0);
            return pid;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EPERM') {
                return pid;
            }
            await fs.rm(pidFile, { force: true });
            return undefined;
        }
    }

    async add(input: Omit<LocalServerConfig, 'createdAt' | 'domains' | 'port'> & { port?: number; domains?: string[] }, reservedPorts: Iterable<number> = []): Promise<LocalServer> {
        const nameError = validateInstanceName(input.name);
        if (nameError) {
            throw new Error(`Invalid name "${input.name}": ${nameError}`);
        }
        const all = await this.configs();
        if (all.some(s => s.name === input.name)) {
            throw new Error(`A local server "${input.name}" already exists`);
        }
        for (const d of input.domains ?? []) {
            const err = validateDomain(d);
            if (err) {
                throw new Error(`${d}: ${err}`);
            }
        }
        const stat = await fs.stat(input.path).catch(() => undefined);
        if (!stat?.isDirectory()) {
            throw new Error(`Folder not found: ${input.path}`);
        }
        if (input.kind === 'php' && !input.php) {
            throw new Error('No PHP binary selected');
        }
        if (input.kind === 'command' && !input.command?.trim()) {
            throw new Error('No command given');
        }
        const reserved = new Set([...reservedPorts, ...all.map(s => s.port)]);
        const port = input.port ?? await findFreePort(8100, reserved);
        if (reserved.has(port)) {
            throw new Error(`Port ${port} is already used by another instance or server`);
        }
        const cfg: LocalServerConfig = {
            name: input.name,
            kind: input.kind,
            path: path.resolve(input.path),
            docroot: normalizeRelative(input.docroot),
            router: input.router ? normalizeRelative(input.router) : undefined,
            php: input.php,
            command: input.command?.trim(),
            liveReload: input.kind === 'static' ? input.liveReload ?? true : undefined,
            port,
            domains: [...new Set((input.domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean))],
            createdAt: new Date().toISOString(),
        };
        await this.save([...all, cfg]);
        return this.describe(cfg);
    }

    async update(name: string, change: Partial<Omit<LocalServerConfig, 'name' | 'createdAt'>>): Promise<LocalServer> {
        const all = await this.configs();
        const i = all.findIndex(s => s.name === name);
        if (i < 0) {
            throw new Error(`Local server "${name}" not found`);
        }
        all[i] = { ...all[i], ...change };
        await this.save(all);
        return this.describe(all[i]);
    }

    /** Removes the server from the list (stops it first). The project folder is not touched. */
    async remove(name: string): Promise<void> {
        await this.stop(name).catch(() => undefined);
        await this.save((await this.configs()).filter(s => s.name !== name));
        await fs.rm(this.file(name, 'log'), { force: true });
    }

    async start(name: string): Promise<LocalServer> {
        const server = await this.get(name);
        if (server.status === 'running') {
            return server;
        }
        if (!(await isPortFree(server.port))) {
            throw new Error(`Port ${server.port} is in use by another program – change the port of "${name}" or stop that program.`);
        }
        const { command, args, shell } = this.processFor(server);
        await fs.mkdir(this.dir, { recursive: true });
        const logFile = this.file(name, 'log');
        await fs.writeFile(logFile, `[${new Date().toISOString()}] ${shell ? command : [command, ...args].join(' ')}\n`, { flag: 'a' });
        const fd = openSync(logFile, 'a');
        try {
            const child = spawn(command, args, {
                cwd: server.path,
                detached: true,
                stdio: ['ignore', fd, fd],
                shell,
                env: { ...process.env, PORT: String(server.port), HOST: '127.0.0.1', ELECTRON_RUN_AS_NODE: '1' },
            });
            if (!child.pid) {
                throw new Error(`Could not start ${command}`);
            }
            child.unref();
            await fs.writeFile(this.file(name, 'pid'), `${child.pid}\n`, 'utf8');
        } finally {
            closeSync(fd);
        }
        // wait until the port answers (dev servers may take a few seconds)
        for (let i = 0; i < 60; i++) {
            if (!(await this.livePid(name))) {
                throw new Error(`"${name}" stopped right after the start – see the log:\n${await tail(logFile)}`);
            }
            if (!(await isPortFree(server.port))) {
                break;
            }
            await sleep(250);
        }
        return this.get(name);
    }

    async stop(name: string): Promise<void> {
        const pid = await this.livePid(name);
        if (pid) {
            // the server runs in its own process group (detached) – stop it together with its children
            killGroup(pid, 'SIGTERM');
            for (let i = 0; i < 20 && (await this.livePid(name)); i++) {
                await sleep(100);
            }
            if (await this.livePid(name)) {
                killGroup(pid, 'SIGKILL');
            }
        }
        await fs.rm(this.file(name, 'pid'), { force: true });
    }

    async restart(name: string): Promise<LocalServer> {
        await this.stop(name);
        return this.start(name);
    }

    async log(name: string, lines = 200): Promise<string> {
        return tail(this.file(name, 'log'), lines);
    }

    private processFor(s: LocalServer): { command: string; args: string[]; shell: boolean } {
        const docroot = path.join(s.path, s.docroot);
        switch (s.kind) {
            case 'php':
                return { command: s.php ?? 'php', args: ['-S', `127.0.0.1:${s.port}`, '-t', docroot, ...(s.router ? [path.join(s.path, s.router)] : [])], shell: false };
            case 'static': {
                const script = this.staticServerScript();
                if (!script) {
                    throw new Error('The static server is not available in this context');
                }
                return { command: process.execPath, args: [script, '--root', docroot, '--port', String(s.port), ...(s.liveReload ? ['--live-reload'] : [])], shell: false };
            }
            case 'command':
                // the user's own command, run by the shell like in a terminal
                return { command: (s.command ?? '').replace(/\{port\}/g, String(s.port)), args: [], shell: true };
        }
    }
}

function normalizeRelative(p: string): string {
    const n = path.posix.normalize(p.trim().replace(/\\/g, '/') || '.').replace(/\/+$/, '');
    if (n === '..' || n.startsWith('../') || path.posix.isAbsolute(n) || /^[A-Za-z]:/.test(n)) {
        throw new Error(`Path must stay inside the project: ${p}`);
    }
    return n === '.' ? '' : n.replace(/^\.\//, '');
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(process.platform === 'win32' ? pid : -pid, signal);
    } catch {
        try {
            process.kill(pid, signal);
        } catch {
            // already gone
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

async function tail(file: string, lines = 30): Promise<string> {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    return text.split('\n').slice(-lines - 1).join('\n').trim();
}

/** PHP binaries on this machine (Homebrew, MacPorts, PATH …), newest first – stable paths (not Cellar/<version>). */
export async function findPhpBinaries(): Promise<PhpBinary[]> {
    // order matters: the first path of a binary is kept, so stable symlinks come before PATH lookups
    const candidates: string[] = [];
    for (const dir of ['/opt/homebrew/opt', '/usr/local/opt']) {
        for (const entry of (await fs.readdir(dir).catch(() => [] as string[])).sort()) {
            if (/^php(@\d+\.\d+)?$/.test(entry)) {
                candidates.push(path.join(dir, entry, 'bin', 'php'));
            }
        }
    }
    candidates.push('/opt/homebrew/bin/php', '/usr/local/bin/php', '/opt/local/bin/php', '/usr/bin/php', path.join(os.homedir(), '.config', 'herd-lite', 'bin', 'php'), 'php');
    const found = new Map<string, PhpBinary>();
    for (const bin of candidates) {
        const res = await run(bin, ['-r', 'echo PHP_VERSION, "|", PHP_BINARY;'], { allowFailure: true, timeout: 10_000 }).catch(() => undefined);
        const m = res?.code === 0 ? /^(\d+\.\d+\.\d+)[^|]*\|(.+)$/.exec(res.stdout.trim()) : null;
        if (!m) {
            continue;
        }
        const real = await fs.realpath(m[2]).catch(() => m[2]);
        if (!found.has(real)) {
            found.set(real, { path: bin === 'php' ? m[2] : bin, version: m[1] });
        }
    }
    return [...found.values()].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/** Suggests how to serve a folder: dev script, PHP (with router), static HTML. */
export async function detectServer(dir: string): Promise<DetectedServer> {
    const has = (p: string) => fs.access(path.join(dir, p)).then(() => true, () => false);
    const pkg = await fs.readFile(path.join(dir, 'package.json'), 'utf8').then(t => JSON.parse(t) as { scripts?: Record<string, string> }, () => undefined);
    const scripts = pkg?.scripts ?? {};
    const php = async (root: string): Promise<DetectedServer | undefined> => {
        const prefix = root ? `${root}/` : '';
        if (await has(`${prefix}index.php`)) {
            // front controller: every request that is no file goes to index.php
            return { kind: 'php', docroot: root, router: `${prefix}index.php`, reason: `${prefix}index.php` };
        }
        return undefined;
    };
    for (const root of ['public', 'httpdocs/public', 'web', 'htdocs', '']) {
        const hit = await php(root);
        if (hit) {
            return hit;
        }
    }
    for (const script of ['dev', 'start', 'serve']) {
        if (scripts[script]) {
            return { kind: 'command', docroot: '', command: devCommand(script, scripts[script]), reason: `package.json → scripts.${script}` };
        }
    }
    if (await has('hugo.toml') || await has('config.toml')) {
        return { kind: 'command', docroot: '', command: 'hugo server --port $PORT --bind 127.0.0.1', reason: 'Hugo' };
    }
    for (const root of ['public', 'dist', 'build', 'site', 'docs', '']) {
        if (await has(root ? `${root}/index.html` : 'index.html')) {
            return { kind: 'static', docroot: root, reason: `${root ? `${root}/` : ''}index.html` };
        }
    }
    return { kind: 'static', docroot: '', reason: 'folder' };
}

/**
 * `npm run <script>` with port and address for well-known dev servers. They must listen on 127.0.0.1 (IPv4): many bind
 * to `localhost` = ::1 only, which the HTTPS proxy (host.docker.internal) cannot reach.
 */
export function devCommand(script: string, body: string): string {
    if (/\bnext\b/.test(body)) {
        return `npm run ${script} -- -p $PORT -H 127.0.0.1`;
    }
    if (/\b(vite|astro|nuxt|nuxi|svelte-kit|remix|eleventy)\b/.test(body)) {
        return `npm run ${script} -- --port $PORT --host 127.0.0.1`;
    }
    return `npm run ${script} -- --port $PORT`;
}
