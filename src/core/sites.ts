import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { commandExists, run } from './exec';

/**
 * Multi-site projects served by one local server – e.g. a flat-file CMS with one `config/sites/<key>.php` per website
 * (host names) and one SQLite database per website in `storage/sites/<key>/database/`.
 *
 * The site files may contain secrets: only the `label` and the `hosts` list are read, as text – the PHP code is never
 * executed and nothing else is kept.
 */
export interface SiteInfo {
    key: string;
    label?: string;
    /** Host names without port, e.g. `shop.localhost`. */
    hosts: string[];
    /** SQLite database of the site (absolute), if there is one. */
    database?: string;
}

const SITE_KEY = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

export async function detectSites(projectPath: string): Promise<SiteInfo[] | undefined> {
    const dir = path.join(projectPath, 'config', 'sites');
    const files = await fs.readdir(dir).catch(() => undefined);
    if (!files) {
        return undefined;
    }
    const sites: SiteInfo[] = [];
    for (const file of files.filter(f => f.endsWith('.php')).sort()) {
        const key = file.slice(0, -4);
        if (!SITE_KEY.test(key)) {
            continue;
        }
        const text = await fs.readFile(path.join(dir, file), 'utf8').catch(() => '');
        const info = parseSiteConfig(text);
        const db = path.join(projectPath, 'storage', 'sites', key, 'database', 'site.sqlite');
        sites.push({ key, ...info, database: await fs.access(db).then(() => db, () => undefined) });
    }
    return sites.length ? sites : undefined;
}

/** `label` and `hosts` of a site file (array() or [] syntax); host names lower-case, without port, deduplicated. */
export function parseSiteConfig(php: string): { label?: string; hosts: string[] } {
    const label = /['"]label['"]\s*=>\s*'([^']{1,200})'/.exec(php)?.[1];
    const block = /['"]hosts['"]\s*=>\s*(?:array\s*\(|\[)([\s\S]*?)(?:\)|\])\s*,/.exec(php)?.[1] ?? '';
    const hosts = [...block.matchAll(/'([^']+)'/g)]
        .map(m => m[1].trim().toLowerCase().replace(/:\d+$/, ''))
        .filter(h => /^[a-z0-9.-]+$/.test(h));
    return { label, hosts: [...new Set(hosts)] };
}

/**
 * Consistent copy of a SQLite database while the site may be running (`sqlite3 .backup`; plain copy only if the
 * sqlite3 CLI is missing, then together with -wal/-shm). Returns the backup file.
 */
export async function backupSqlite(database: string, targetDir: string, name: string, now = new Date()): Promise<string> {
    await fs.mkdir(targetDir, { recursive: true });
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.join(targetDir, `${name}-${stamp}.sqlite`);
    if (await commandExists('sqlite3', ['-version'])) {
        const res = await run('sqlite3', [database, `.backup '${target.replace(/'/g, "''")}'`], { allowFailure: true, timeout: 600_000 });
        if (res.code !== 0) {
            throw new Error(`sqlite3: ${(res.stderr || res.stdout).trim() || `exit ${res.code}`}`);
        }
    } else {
        await fs.copyFile(database, target);
        for (const ext of ['-wal', '-shm']) {
            await fs.copyFile(database + ext, target + ext).catch(() => undefined);
        }
    }
    return target;
}
