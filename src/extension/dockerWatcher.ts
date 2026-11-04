import { ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { Docker } from '../core/docker';

/**
 * Keeps the UI in sync with Docker without polling instance status:
 *  - `docker events` triggers a refresh whenever a container starts/stops
 *  - while Docker is unavailable, availability is re-checked periodically
 */
export class DockerWatcher implements vscode.Disposable {
    private proc?: ChildProcess;
    private debounce?: NodeJS.Timeout;
    private retry?: NodeJS.Timeout;
    private disposed = false;
    private available: boolean | undefined;
    private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
    private readonly onDidChangeAvailabilityEmitter = new vscode.EventEmitter<boolean>();

    /** Container state changed. */
    readonly onDidChange = this.onDidChangeEmitter.event;
    /** Docker became available / unavailable. */
    readonly onDidChangeAvailability = this.onDidChangeAvailabilityEmitter.event;

    constructor(private readonly docker: () => Docker) {}

    get isAvailable(): boolean | undefined {
        return this.available;
    }

    async start(): Promise<void> {
        const info = await this.docker().info();
        this.setAvailable(info.available);
        if (info.available) {
            this.listen();
        } else {
            this.scheduleRetry();
        }
    }

    private setAvailable(value: boolean): void {
        if (this.available !== value) {
            this.available = value;
            void vscode.commands.executeCommand('setContext', 'redaxo-instances.dockerAvailable', value);
            this.onDidChangeAvailabilityEmitter.fire(value);
        }
    }

    private scheduleRetry(delay = 15_000): void {
        if (this.disposed) {
            return;
        }
        clearTimeout(this.retry);
        this.retry = setTimeout(() => void this.start(), delay);
    }

    private listen(): void {
        this.proc?.kill();
        const proc = spawn(this.docker().bin, ['events', '--filter', 'type=container', '--format', '{{.Action}} {{.Actor.Attributes.name}}'], { windowsHide: true });
        this.proc = proc;
        proc.stdout?.on('data', (chunk: Buffer) => {
            const relevant = chunk.toString('utf8').split(/\r?\n/).some(line => /^(start|stop|die|destroy|create|pause|unpause|health_status)/.test(line));
            if (relevant) {
                clearTimeout(this.debounce);
                this.debounce = setTimeout(() => this.onDidChangeEmitter.fire(), 400);
            }
        });
        proc.on('error', () => undefined);
        proc.on('exit', () => {
            if (this.proc !== proc || this.disposed) {
                return;
            }
            // Docker stopped or restarted
            this.proc = undefined;
            this.setAvailable(false);
            this.onDidChangeEmitter.fire();
            this.scheduleRetry(5_000);
        });
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.debounce);
        clearTimeout(this.retry);
        this.proc?.kill();
        this.onDidChangeEmitter.dispose();
        this.onDidChangeAvailabilityEmitter.dispose();
    }
}
