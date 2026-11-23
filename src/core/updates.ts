/** Available updates of REDAXO add-ons (REDAXO 5: installer of redaxo.org) or Composer packages (REDAXO 6). */
export interface PackageUpdate {
    /** Add-on key (REDAXO 5) or package name (REDAXO 6). */
    key: string;
    name: string;
    installed: string;
    latest: string;
    /** The first version number changes (e.g. 7.8.6 → 8.0.0) – read the changelog first. */
    major: boolean;
    /** The newest version is a pre-release (alpha, beta, RC, dev). */
    prerelease?: boolean;
    source: 'redaxo.org' | 'composer';
    /** Version constraint in the root composer.json (REDAXO 6), e.g. `2.3.2` or `^2.3`. */
    constraint?: string;
    /** The constraint does not allow `latest` – an update keeps the installed version. */
    blocked?: boolean;
}

/** Does a Composer constraint allow the version? Exact pins and simple ranges only; unknown forms count as allowed. */
export function constraintAllows(constraint: string, version: string): boolean {
    const c = constraint.trim().replace(/@\w+$/, '');
    const v = version.replace(/^v/i, '');
    if (/^v?\d+(\.\d+){1,3}$/.test(c)) {
        return c.replace(/^v/i, '') === v; // exact pin
    }
    const caret = /^\^v?(\d+)(?:\.(\d+))?/.exec(c);
    if (caret) {
        const [maj, min] = [Number(caret[1]), Number(caret[2] ?? 0)];
        const [vm, vn] = (v.match(/\d+/g) ?? []).map(Number);
        return maj === 0 ? vm === 0 && vn === min : vm === maj;
    }
    return true;
}

/** Major version step: the first number differs (0.x: the second one). Pre-releases count by their numbers. */
export function isPrerelease(version: string): boolean {
    return /(alpha|beta|rc|dev|preview)/i.test(version);
}

export function isMajorUpdate(installed: string, latest: string): boolean {
    const parts = (v: string) => (v.replace(/^v/i, '').match(/\d+/g) ?? []).map(Number);
    const [a0 = 0, a1 = 0] = parts(installed);
    const [b0 = 0, b1 = 0] = parts(latest);
    return a0 === 0 && b0 === 0 ? a1 !== b1 : a0 !== b0;
}

/** First JSON value in console output (warnings or notices may come before it). */
function jsonIn(output: string, open: '[' | '{'): unknown {
    const start = output.indexOf(open);
    if (start < 0) {
        throw new Error(output.trim().split('\n').slice(-3).join('\n') || 'no output');
    }
    return JSON.parse(output.slice(start));
}

/** `bin/console install:list --updates-only --json` (REDAXO 5). */
export function parseRedaxoUpdates(output: string): PackageUpdate[] {
    if (!output.trim() || /no packages|keine/i.test(output.trim()) && !output.includes('[')) {
        return [];
    }
    const rows = jsonIn(output, '[') as Record<string, string>[];
    return rows.map(r => ({
        key: r.key, name: r.name ?? r.key, installed: r['installed version'] ?? '', latest: r['latest version'] ?? '',
        major: isMajorUpdate(r['installed version'] ?? '', r['latest version'] ?? ''), prerelease: isPrerelease(r['latest version'] ?? ''), source: 'redaxo.org' as const,
    })).filter(u => u.key && u.latest);
}

/** `composer outdated --direct --format=json` (REDAXO 6); path packages (local repositories) are left out. */
export function parseComposerUpdates(output: string): PackageUpdate[] {
    if (!output.trim()) {
        return [];
    }
    const data = jsonIn(output, '{') as { installed?: Record<string, unknown>[] };
    return (data.installed ?? [])
        .filter(p => typeof p.name === 'string' && typeof p.latest === 'string' && p.latest !== p.version && p['latest-status'] !== 'up-to-date')
        .map(p => ({
            key: String(p.name), name: String(p.description ?? p.name).slice(0, 80) || String(p.name), installed: String(p.version), latest: String(p.latest),
            major: p['latest-status'] === 'update-possible' || isMajorUpdate(String(p.version), String(p.latest)), prerelease: isPrerelease(String(p.latest)), source: 'composer' as const,
        }));
}
