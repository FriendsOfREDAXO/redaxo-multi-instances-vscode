import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { InstanceManager } from '../core/manager';
import { Instance } from '../core/model';
import { Problem, parsePhpErrorLine, parseSystemLogLine, systemLogCandidates, toProblem } from '../core/problems';

const MAX_PER_FILE = 50;
const POLL_MS = 2000;

interface LogTail {
    file: string;
    offset: number;
}

interface Watched {
    instance: Instance;
    tails: LogTail[];
    proc?: ChildProcess;
}

/**
 * Shows new PHP / REDAXO errors of running instances in the Problems panel – with file and line,
 * mapped from the container to the host. Only errors that occur after the start are shown.
 */
export class ProblemsWatcher implements vscode.Disposable {
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('redaxo');
    private readonly watched = new Map<string, Watched>();
    private readonly seen = new Set<string>();
    private timer?: NodeJS.Timeout;

    constructor(private readonly manager: InstanceManager) {
        this.timer = setInterval(() => void this.poll(), POLL_MS);
    }

    /** Follows the running instances (called whenever the instance list changes). */
    async update(instances: readonly Instance[]): Promise<void> {
        const running = new Map(instances.filter(i => i.status === 'running' || i.status === 'partial').map(i => [i.name, i]));
        for (const [name, w] of this.watched) {
            if (!running.has(name)) {
                w.proc?.kill();
                this.watched.delete(name);
            }
        }
        for (const [name, instance] of running) {
            if (this.watched.has(name)) {
                continue;
            }
            const tails: LogTail[] = [];
            for (const file of systemLogCandidates(instance)) {
                tails.push({ file, offset: await fs.stat(file).then(s => s.size, () => 0) });
            }
            const proc = this.followContainer(instance);
            this.watched.set(name, { instance, tails, proc });
            // container recreated / stopped: forget it, the next update follows the new container
            proc?.on('exit', () => {
                if (this.watched.get(name)?.proc === proc) {
                    this.watched.delete(name);
                }
            });
        }
    }

    clear(): void {
        this.diagnostics.clear();
        this.seen.clear();
    }

    private followContainer(instance: Instance): ChildProcess | undefined {
        try {
            const proc = spawn(this.manager.settings.dockerPath, ['logs', '-f', '--tail', '0', instance.layout.webContainer], { windowsHide: true });
            let pending = '';
            const onData = (chunk: Buffer) => {
                const lines = (pending + chunk.toString('utf8')).split(/\r?\n/);
                pending = lines.pop() ?? '';
                for (const line of lines) {
                    const raw = parsePhpErrorLine(line);
                    if (raw) {
                        void toProblem(instance, raw).then(p => this.add(instance, p));
                    }
                }
            };
            proc.stdout?.on('data', onData);
            proc.stderr?.on('data', onData);
            proc.on('error', () => undefined);
            return proc;
        } catch {
            return undefined;
        }
    }

    private async poll(): Promise<void> {
        for (const w of this.watched.values()) {
            for (const tail of w.tails) {
                let size: number;
                try {
                    size = (await fs.stat(tail.file)).size;
                } catch {
                    continue;
                }
                if (size < tail.offset) {
                    tail.offset = 0; // rotated
                }
                if (size === tail.offset) {
                    continue;
                }
                const handle = await fs.open(tail.file, 'r');
                try {
                    const length = Math.min(size - tail.offset, 1_000_000);
                    const buffer = Buffer.alloc(length);
                    await handle.read(buffer, 0, length, tail.offset);
                    tail.offset += length;
                    for (const line of buffer.toString('utf8').split(/\r?\n/)) {
                        const raw = parseSystemLogLine(line);
                        if (raw) {
                            this.add(w.instance, await toProblem(w.instance, raw));
                        }
                    }
                } finally {
                    await handle.close();
                }
            }
        }
    }

    private add(instance: Instance, problem: Problem): void {
        if (!problem.file) {
            return;
        }
        const key = `${problem.file}:${problem.line}:${problem.message}`;
        if (this.seen.has(key)) {
            return;
        }
        this.seen.add(key);
        const uri = vscode.Uri.file(problem.file);
        const line = Math.max(0, (problem.line ?? 1) - 1);
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
            problem.url ? `${problem.message}\n${problem.url}` : problem.message,
            problem.severity === 'error' ? vscode.DiagnosticSeverity.Error
                : problem.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
        );
        diagnostic.source = `REDAXO ${instance.name}`;
        diagnostic.code = problem.level;
        const list = [...(this.diagnostics.get(uri) ?? []), diagnostic].slice(-MAX_PER_FILE);
        this.diagnostics.set(uri, list);
    }

    dispose(): void {
        clearInterval(this.timer);
        for (const w of this.watched.values()) {
            w.proc?.kill();
        }
        this.diagnostics.dispose();
    }
}
