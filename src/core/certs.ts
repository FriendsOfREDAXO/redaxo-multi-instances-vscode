import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from './exec';

const CANDIDATES = process.platform === 'win32'
    ? ['mkcert', 'mkcert.exe']
    : ['mkcert', '/opt/homebrew/bin/mkcert', '/usr/local/bin/mkcert', '/usr/bin/mkcert', '/home/linuxbrew/.linuxbrew/bin/mkcert'];

export interface MkcertStatus {
    path?: string;
    caRoot?: string;
    /** Root CA files exist (`mkcert -install` has been run at least once). */
    caInstalled: boolean;
}

let cached: MkcertStatus | undefined;

export async function detectMkcert(force = false): Promise<MkcertStatus> {
    if (cached && !force) {
        return cached;
    }
    for (const candidate of CANDIDATES) {
        try {
            const res = await run(candidate, ['-CAROOT'], { timeout: 10_000 });
            const caRoot = res.stdout.trim();
            let caInstalled = false;
            try {
                await fs.access(path.join(caRoot, 'rootCA.pem'));
                caInstalled = true;
            } catch {
                // CA not created yet
            }
            cached = { path: candidate, caRoot, caInstalled };
            return cached;
        } catch {
            // try next candidate
        }
    }
    cached = { caInstalled: false };
    return cached;
}

/**
 * Creates (or refreshes) a certificate for the given host names in `certsDir`.
 * Returns the file names, or undefined when mkcert is not available.
 */
export async function ensureCertificate(
    certsDir: string,
    id: string,
    hosts: readonly string[],
): Promise<{ cert: string; key: string } | undefined> {
    const mkcert = await detectMkcert();
    if (!mkcert.path || !mkcert.caInstalled) {
        return undefined;
    }
    const files = { cert: `${id}.pem`, key: `${id}-key.pem` };
    const marker = path.join(certsDir, `${id}.hosts`);
    const signature = [...hosts].sort().join('\n');

    let upToDate: boolean;
    try {
        const [current] = await Promise.all([
            fs.readFile(marker, 'utf8'),
            fs.access(path.join(certsDir, files.cert)),
            fs.access(path.join(certsDir, files.key)),
        ]);
        upToDate = current === signature;
    } catch {
        upToDate = false;
    }
    if (!upToDate) {
        await fs.mkdir(certsDir, { recursive: true });
        await run(mkcert.path, [
            '-cert-file', path.join(certsDir, files.cert),
            '-key-file', path.join(certsDir, files.key),
            ...hosts,
        ], { timeout: 30_000 });
        await fs.writeFile(marker, signature, 'utf8');
    }
    return files;
}

export async function removeCertificate(certsDir: string, id: string): Promise<void> {
    for (const f of [`${id}.pem`, `${id}-key.pem`, `${id}.hosts`]) {
        await fs.rm(path.join(certsDir, f), { force: true });
    }
}
