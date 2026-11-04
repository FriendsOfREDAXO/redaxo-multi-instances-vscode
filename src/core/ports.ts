import * as net from 'node:net';
import { randomBytes } from 'node:crypto';

/** True when something accepts connections on the port (also catches firewall redirects, e.g. pf rules of local dev servers). */
function isAnswering(port: number, host: string, timeoutMs = 500): Promise<boolean> {
    return new Promise(resolve => {
        const socket = net.connect({ port, host });
        const done = (answer: boolean) => {
            socket.destroy();
            resolve(answer);
        };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

/**
 * Checks whether a TCP port is free on the loopback interface(s).
 * Busy = something answers on it, or binding fails with EADDRINUSE. EACCES is no conflict: on macOS
 * unprivileged processes may not bind ports < 1024 to 127.0.0.1 – Docker can.
 */
export async function isPortFree(port: number): Promise<boolean> {
    if (await isAnswering(port, '127.0.0.1') || await isAnswering(port, '::1')) {
        return false;
    }
    const tryListen = (host: string) => new Promise<boolean>(resolve => {
        const server = net.createServer();
        server.unref();
        server.once('error', (err: NodeJS.ErrnoException) => {
            resolve(err.code !== 'EADDRINUSE');
        });
        server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
    });
    return (await tryListen('127.0.0.1')) && (await tryListen('0.0.0.0')) && (await tryListen('::1'));
}

/**
 * Finds a free port starting at `start`, skipping ports reserved by other instances
 * (also stopped ones – their ports must stay free).
 */
export async function findFreePort(start: number, reserved: ReadonlySet<number>, max = start + 500): Promise<number> {
    for (let port = start; port <= max; port++) {
        if (reserved.has(port)) {
            continue;
        }
        if (await isPortFree(port)) {
            return port;
        }
    }
    throw new Error(`No free port found between ${start} and ${max}`);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Random password without ambiguous or shell/YAML-sensitive characters. */
export function generatePassword(length = 20): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}
