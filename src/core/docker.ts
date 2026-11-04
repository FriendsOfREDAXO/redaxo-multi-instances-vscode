import { ExecOptions, ExecResult, run } from './exec';

export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    /** Raw process output (build logs etc.). */
    trace(message: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, trace() {} };

export interface ProgressReporter {
    (message: string): void;
}

export interface DockerInfo {
    available: boolean;
    version?: string;
    composeVersion?: string;
    error?: string;
}

export interface ContainerSummary {
    name: string;
    state: string;
    image: string;
    project?: string;
    /** Directory of the compose file that created the container. */
    workingDir?: string;
}

export class Docker {
    constructor(readonly bin: string, private readonly log: Logger) {}

    run(args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
        this.log.trace(`$ ${this.bin} ${args.join(' ')}`);
        return run(this.bin, args, {
            ...options,
            onLine: options.onLine ?? ((line) => this.log.trace(line)),
        });
    }

    /** Runs `docker compose` in an instance directory. */
    compose(dir: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
        return this.run(['compose', ...args], { ...options, cwd: dir });
    }

    async info(): Promise<DockerInfo> {
        try {
            const server = await run(this.bin, ['version', '--format', '{{.Server.Version}}'], { timeout: 15_000 });
            const compose = await run(this.bin, ['compose', 'version', '--short'], { timeout: 15_000, allowFailure: true });
            return {
                available: true,
                version: server.stdout.trim(),
                composeVersion: compose.code === 0 ? compose.stdout.trim() : undefined,
                error: compose.code === 0 ? undefined : 'Docker Compose v2 plugin is missing',
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                available: false,
                error: /ENOENT/.test(message) ? `Docker executable "${this.bin}" not found` : 'Docker daemon is not running',
            };
        }
    }

    async containers(): Promise<ContainerSummary[]> {
        const res = await run(this.bin, ['ps', '-a', '--format', '{{json .}}'], { timeout: 20_000 });
        const out: ContainerSummary[] = [];
        for (const line of res.stdout.split(/\r?\n/)) {
            if (!line.trim()) {
                continue;
            }
            try {
                const c = JSON.parse(line) as { Names: string; State: string; Image: string; Labels?: string };
                const label = (key: string) => new RegExp(`(?:^|,)${key.replace(/\./g, '\\.')}=([^,]+)`).exec(c.Labels ?? '')?.[1];
                out.push({
                    name: c.Names, state: c.State, image: c.Image,
                    project: label('com.docker.compose.project'),
                    workingDir: label('com.docker.compose.project.working_dir'),
                });
            } catch {
                // ignore malformed lines
            }
        }
        return out;
    }

    async runningContainerNames(): Promise<Set<string>> {
        const list = await this.containers();
        return new Set(list.filter(c => c.state === 'running').map(c => c.name));
    }

    async isRunning(container: string): Promise<boolean> {
        const res = await run(this.bin, ['inspect', '-f', '{{.State.Running}}', container], { allowFailure: true, timeout: 10_000 });
        return res.code === 0 && res.stdout.trim() === 'true';
    }

    async containerExists(container: string): Promise<boolean> {
        const res = await run(this.bin, ['inspect', '-f', '{{.Id}}', container], { allowFailure: true, timeout: 10_000 });
        return res.code === 0;
    }

    async imageExists(image: string): Promise<boolean> {
        const res = await run(this.bin, ['image', 'inspect', '-f', '{{.Id}}', image], { allowFailure: true, timeout: 10_000 });
        return res.code === 0;
    }

    async ensureNetwork(name: string): Promise<void> {
        const res = await run(this.bin, ['network', 'inspect', name], { allowFailure: true, timeout: 10_000 });
        if (res.code !== 0) {
            this.log.info(`Creating Docker network ${name}`);
            await this.run(['network', 'create', name]);
        }
    }

    async ensureVolume(name: string): Promise<void> {
        const res = await run(this.bin, ['volume', 'inspect', name], { allowFailure: true, timeout: 10_000 });
        if (res.code !== 0) {
            await this.run(['volume', 'create', name]);
        }
    }

    /** `docker exec` (non-interactive). Environment variables are passed with `-e`. */
    exec(container: string, command: readonly string[], options: ExecOptions & { user?: string; workdir?: string; execEnv?: Record<string, string> } = {}): Promise<ExecResult> {
        const args = ['exec'];
        if (options.input !== undefined) {
            args.push('-i');
        }
        if (options.user) {
            args.push('-u', options.user);
        }
        if (options.workdir) {
            args.push('-w', options.workdir);
        }
        for (const [k, v] of Object.entries(options.execEnv ?? {})) {
            args.push('-e', `${k}=${v}`);
        }
        args.push(container, ...command);
        // never log secrets passed via -e
        this.log.trace(`$ ${this.bin} exec ${container} ${command.join(' ').slice(0, 200)}`);
        return run(this.bin, args, options);
    }
}
