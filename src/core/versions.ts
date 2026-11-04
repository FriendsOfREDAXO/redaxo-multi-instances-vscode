/**
 * Central version catalog – the single source of truth for every PHP, MariaDB and
 * REDAXO version offered by the extension, the LM tools and the MCP server.
 */

export type SupportStatus = 'preview' | 'active' | 'security' | 'eol';

export interface PhpVersionInfo {
    version: string;
    /** Tag of the official `php` image. Release candidates use the `-rc-` tags. */
    imageTag: string;
    /** Tag to prefer once the version is generally available (checked at runtime). */
    gaImageTag: string;
    status: SupportStatus;
    /** End of security support (ISO date). */
    eol: string;
}

export interface MariaDbVersionInfo {
    version: string;
    lts: boolean;
    status: SupportStatus;
    eol: string;
}

export const PHP_VERSIONS: readonly PhpVersionInfo[] = [
    { version: '8.6', imageTag: '8.6-rc-apache', gaImageTag: '8.6-apache', status: 'preview', eol: '2030-12-31' },
    { version: '8.5', imageTag: '8.5-apache', gaImageTag: '8.5-apache', status: 'active', eol: '2029-12-31' },
    { version: '8.4', imageTag: '8.4-apache', gaImageTag: '8.4-apache', status: 'active', eol: '2028-12-31' },
    { version: '8.3', imageTag: '8.3-apache', gaImageTag: '8.3-apache', status: 'security', eol: '2027-12-31' },
    { version: '8.2', imageTag: '8.2-apache', gaImageTag: '8.2-apache', status: 'security', eol: '2026-12-31' },
    { version: '8.1', imageTag: '8.1-apache', gaImageTag: '8.1-apache', status: 'eol', eol: '2025-12-31' },
];

export const MARIADB_VERSIONS: readonly MariaDbVersionInfo[] = [
    { version: '13.0', lts: false, status: 'active', eol: '2027-02-01' },
    { version: '12.3', lts: true, status: 'active', eol: '2029-06-12' },
    { version: '11.8', lts: true, status: 'active', eol: '2028-06-04' },
    { version: '11.4', lts: true, status: 'active', eol: '2029-05-29' },
    { version: '10.11', lts: true, status: 'security', eol: '2028-02-16' },
];

/** Images of the shared services (one container each for all instances). */
export const SHARED_IMAGES = {
    proxy: 'caddy:2.11.7-alpine',
    adminer: 'adminer:6.3.0',
    mailpit: 'axllent/mailpit:v1.33.0',
} as const;

export const DEFAULT_PHP_VERSION = '8.5';
export const DEFAULT_MARIADB_VERSION = '12.3';

/** REDAXO 6 is not released yet – instances use the development branch. */
export const REDAXO6_VERSION = '6.x-dev';

/** Latest REDAXO release known at build time – used when GitHub cannot be reached. */
export const FALLBACK_REDAXO_VERSION = '5.21.6';

/** Minimum PHP version per REDAXO minor release line (from `REX_MIN_PHP_VERSION`). */
const REDAXO_MIN_PHP: ReadonlyArray<[string, string]> = [
    ['6.0', '8.5'],
    ['5.21', '8.3'],
    ['5.18', '8.1'],
    ['5.16', '8.1'],
    ['5.15', '7.3'],
];

export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) {
            return diff < 0 ? -1 : 1;
        }
    }
    return 0;
}

export function getPhpVersion(version: string): PhpVersionInfo | undefined {
    return PHP_VERSIONS.find(v => v.version === version);
}

export function getMariaDbVersion(version: string): MariaDbVersionInfo | undefined {
    return MARIADB_VERSIONS.find(v => v.version === version);
}

export function isSupportedPhpVersion(version: string): boolean {
    return getPhpVersion(version) !== undefined;
}

export function isSupportedMariaDbVersion(version: string): boolean {
    return getMariaDbVersion(version) !== undefined;
}

/** Minimum PHP version required by a REDAXO release (`latest` = newest line). */
export function getRedaxoMinPhp(redaxoVersion: string): string {
    const v = redaxoVersion === 'latest' ? FALLBACK_REDAXO_VERSION : redaxoVersion;
    for (const [line, minPhp] of REDAXO_MIN_PHP) {
        if (compareVersions(v, line) >= 0) {
            return minPhp;
        }
    }
    return '7.3';
}

export function isPhpCompatibleWithRedaxo(phpVersion: string, redaxoVersion: string): boolean {
    return compareVersions(phpVersion, getRedaxoMinPhp(redaxoVersion)) >= 0;
}

/**
 * Normalises versions coming from old settings or old instances
 * (e.g. PHP 7.4 or MariaDB 10.6, which are no longer offered).
 */
export function normalizePhpVersion(version: string | undefined): string {
    return version && isSupportedPhpVersion(version) ? version : DEFAULT_PHP_VERSION;
}

export function normalizeMariaDbVersion(version: string | undefined): string {
    return version && isSupportedMariaDbVersion(version) ? version : DEFAULT_MARIADB_VERSION;
}

/**
 * Returns the php image tag for a version. When `tagExists` is given, the GA tag is
 * preferred as soon as it has been published (e.g. `8.6-apache` after the 8.6 release).
 */
export async function resolvePhpImageTag(
    version: string,
    tagExists?: (tag: string) => Promise<boolean>
): Promise<string> {
    const info = getPhpVersion(version);
    if (!info) {
        throw new Error(`Unsupported PHP version: ${version}`);
    }
    if (tagExists && info.gaImageTag !== info.imageTag) {
        try {
            if (await tagExists(info.gaImageTag)) {
                return info.gaImageTag;
            }
        } catch {
            // offline – fall back to the catalog tag
        }
    }
    return info.imageTag;
}

export interface RedaxoRelease {
    version: string;
    publishedAt: string;
    downloadUrl: string;
}

export function redaxoDownloadUrl(version: string): string {
    return `https://github.com/redaxo/core/releases/download/${version}/redaxo_${version}.zip`;
}

/** Fetches the latest stable REDAXO releases from GitHub; falls back to the built-in version. */
export async function fetchRedaxoReleases(fetchImpl: typeof fetch = fetch, limit = 10): Promise<RedaxoRelease[]> {
    try {
        const res = await fetchImpl(`https://api.github.com/repos/redaxo/core/releases?per_page=${limit * 2}`, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'redaxo-multi-instances-vscode' },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json() as Array<{ tag_name: string; prerelease: boolean; draft: boolean; published_at: string }>;
        const releases = data
            .filter(r => !r.prerelease && !r.draft && /^\d+\.\d+\.\d+$/.test(r.tag_name))
            .slice(0, limit)
            .map(r => ({ version: r.tag_name, publishedAt: r.published_at, downloadUrl: redaxoDownloadUrl(r.tag_name) }));
        if (releases.length > 0) {
            return releases;
        }
    } catch {
        // ignore – offline or rate limited
    }
    return [{ version: FALLBACK_REDAXO_VERSION, publishedAt: '', downloadUrl: redaxoDownloadUrl(FALLBACK_REDAXO_VERSION) }];
}

/** Checks whether a tag of an official Docker Hub image exists. */
export async function dockerHubTagExists(repo: string, tag: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    const res = await fetchImpl(`https://hub.docker.com/v2/repositories/library/${repo}/tags/${encodeURIComponent(tag)}`, {
        signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
}
