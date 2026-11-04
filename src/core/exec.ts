import { spawn } from 'node:child_process';

export interface ExecOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** Data written to stdin. */
    input?: string | Buffer;
    /** Milliseconds until the process is killed (default: no timeout). */
    timeout?: number;
    signal?: AbortSignal;
    /** Streams output line by line while the process runs. */
    onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
    /** Do not throw on a non-zero exit code. */
    allowFailure?: boolean;
    /** Return stdout as Buffer (binary data, e.g. dumps). */
    binary?: boolean;
}

export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
    stdoutBuffer?: Buffer;
}

export class ExecError extends Error {
    constructor(
        readonly command: string,
        readonly code: number,
        readonly stdout: string,
        readonly stderr: string,
    ) {
        super(`${command} failed (exit ${code})${stderr.trim() ? `: ${lastLines(stderr, 6)}` : ''}`);
        this.name = 'ExecError';
    }
}

function lastLines(text: string, count: number): string {
    return text.trim().split(/\r?\n/).slice(-count).join('\n');
}

/** Runs a command without a shell. Arguments are passed verbatim (no injection possible). */
export function run(command: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ? { ...process.env, ...options.env } : process.env,
            signal: options.signal,
            windowsHide: true,
        });

        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let pending: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };

        const emitLines = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
            if (!options.onLine) {
                return;
            }
            const text = pending[stream] + chunk.toString('utf8');
            const lines = text.split(/\r?\n/);
            pending[stream] = lines.pop() ?? '';
            for (const line of lines) {
                options.onLine(line, stream);
            }
        };

        child.stdout.on('data', (chunk: Buffer) => {
            out.push(chunk);
            emitLines(chunk, 'stdout');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            err.push(chunk);
            emitLines(chunk, 'stderr');
        });

        let timer: NodeJS.Timeout | undefined;
        if (options.timeout) {
            timer = setTimeout(() => child.kill('SIGKILL'), options.timeout);
        }

        child.on('error', error => {
            if (timer) {
                clearTimeout(timer);
            }
            reject(error);
        });

        child.on('close', code => {
            if (timer) {
                clearTimeout(timer);
            }
            for (const stream of ['stdout', 'stderr'] as const) {
                if (pending[stream] && options.onLine) {
                    options.onLine(pending[stream], stream);
                }
            }
            pending = { stdout: '', stderr: '' };
            const stdoutBuffer = Buffer.concat(out);
            const result: ExecResult = {
                code: code ?? -1,
                stdout: options.binary ? '' : stdoutBuffer.toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
                stdoutBuffer: options.binary ? stdoutBuffer : undefined,
            };
            if (result.code !== 0 && !options.allowFailure) {
                reject(new ExecError([command, ...args].join(' '), result.code, result.stdout, result.stderr));
                return;
            }
            resolve(result);
        });

        if (options.input !== undefined) {
            child.stdin.end(options.input);
        } else {
            child.stdin.end();
        }
    });
}

/** Returns true when the command can be executed (e.g. `mkcert -help`). */
export async function commandExists(command: string, args: readonly string[] = ['--version']): Promise<boolean> {
    try {
        await run(command, args, { timeout: 10_000, allowFailure: true });
        return true;
    } catch {
        return false;
    }
}
