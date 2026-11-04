import * as net from 'node:net';
import { randomBytes } from 'node:crypto';

/** Checks whether a TCP port can be bound on the loopback interface(s). */
export async function isPortFree(port: number): Promise<boolean> {
    const tryListen = (host: string) => new Promise<boolean>(resolve => {
        const server = net.createServer();
        server.unref();
        server.once('error', (err: NodeJS.ErrnoException) => {
            // EADDRNOTAVAIL: IPv6 disabled – not a conflict
            resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
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
