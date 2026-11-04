import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from './exec';

/** Who occupies a host port – used to explain why the HTTPS proxy runs on an alternative port. */
export interface PortOccupant {
    port: number;
    /** Process listening on the port (only processes of the current user are visible without root). */
    process?: string;
    /** `Server` header of an HTTP answer (e.g. yerd, nginx, Apache). */
    server?: string;
    /** macOS firewall (pf) redirect, e.g. of local dev tools: anchor name and target port. */
    redirect?: { anchor: string; file: string; toPort: number };
}

/** Parses `rdr … port <port> -> 127.0.0.1 port <target>` rules of a pf anchor file. */
export function parsePfRedirect(content: string, port: number): number | undefined {
    for (const line of content.split(/\r?\n/)) {
        const m = /^\s*rdr\b.*\bport\s+(\d+)\s+->\s+\S+\s+port\s+(\d+)/.exec(line);
        if (m && parseInt(m[1], 10) === port) {
            return parseInt(m[2], 10);
        }
    }
    return undefined;
}

async function pfRedirect(port: number): Promise<PortOccupant['redirect']> {
    if (process.platform !== 'darwin') {
        return undefined;
    }
    const dir = '/etc/pf.anchors';
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
        const file = path.join(dir, name);
        const content = await fs.readFile(file, 'utf8').catch(() => '');
        const toPort = parsePfRedirect(content, port);
        if (toPort !== undefined) {
            return { anchor: name, file, toPort };
        }
    }
    return undefined;
}

async function listeningProcess(port: number): Promise<string | undefined> {
    if (process.platform === 'win32') {
        return undefined;
    }
    const res = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { allowFailure: true, timeout: 10_000 }).catch(() => undefined);
    const line = res?.stdout.split(/\r?\n/)[1];
    return line ? line.split(/\s+/)[0] : undefined;
}

async function httpServer(port: number): Promise<string | undefined> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
        return res.headers.get('server') ?? undefined;
    } catch {
        return undefined;
    }
}

export async function diagnosePort(port: number): Promise<PortOccupant> {
    const [proc, redirect, server] = await Promise.all([
        listeningProcess(port),
        pfRedirect(port),
        port === 443 ? Promise.resolve(undefined) : httpServer(port),
    ]);
    return { port, process: proc, redirect, server };
}

/** One line for logs and notifications, e.g. `80: firewall redirect "dev.yerd" → 8080 (server: yerd)`. */
export function describeOccupant(o: PortOccupant): string {
    const parts: string[] = [];
    if (o.redirect) {
        parts.push(`firewall redirect "${o.redirect.anchor}" → ${o.redirect.toPort}`);
    }
    if (o.process) {
        parts.push(`process ${o.process}`);
    }
    if (o.server) {
        parts.push(`server: ${o.server}`);
    }
    return `${o.port}: ${parts.length ? parts.join(', ') : 'unknown program'}`;
}

/** Suggested fix for a pf redirect (macOS). */
export function pfFlushCommand(o: PortOccupant): string | undefined {
    return o.redirect ? `sudo pfctl -a ${o.redirect.anchor} -F nat` : undefined;
}
