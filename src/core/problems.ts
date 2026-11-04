import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Instance } from './model';

export type ProblemSeverity = 'error' | 'warning' | 'info';

/** One PHP / REDAXO error, mapped to a file on the host. */
export interface Problem {
    severity: ProblemSeverity;
    message: string;
    /** Absolute host path (undefined when the file could not be mapped). */
    file?: string;
    /** 1-based line. */
    line?: number;
    level: string;
    url?: string;
}

/** Raw error as found in a log, before mapping the path to the host. */
export interface RawProblem {
    level: string;
    message: string;
    file?: string;
    line?: number;
    url?: string;
}

export function severityOf(level: string): ProblemSeverity {
    const l = level.toLowerCase();
    if (/deprecated|notice|info|debug/.test(l)) {
        return /deprecated/.test(l) ? 'warning' : 'info';
    }
    if (/warning/.test(l)) {
        return 'warning';
    }
    return 'error';
}

/**
 * REDAXO system.log (5.x and 6.x): `timestamp | level | message | file | line | url`.
 * Multi-line messages are not split by REDAXO, so every non-empty line with at least
 * `timestamp | level | message` is an entry.
 */
export function parseSystemLogLine(line: string): RawProblem | undefined {
    const parts = line.split(' | ');
    if (parts.length < 3 || !/^\d{4}-\d{2}-\d{2}/.test(parts[0].trim())) {
        return undefined;
    }
    const [, level, message, file, lineNo, url] = parts.map(p => p.trim());
    const n = lineNo ? parseInt(lineNo, 10) : NaN;
    return {
        level,
        message: message.replace(/\\n/g, '\n'),
        file: file || undefined,
        line: Number.isFinite(n) && n > 0 ? n : undefined,
        url: url || undefined,
    };
}

const PHP_ERROR = /PHP (Fatal error|Parse error|Warning|Notice|Deprecated|Recoverable fatal error|Error):\s+(.*?)(?: in (\/\S+?)(?: on line |:)(\d+))?(?:\s*$|\s+Stack trace)/;

/** PHP errors as written by `log_errors` (Apache error log / container stderr). */
export function parsePhpErrorLine(line: string): RawProblem | undefined {
    const m = PHP_ERROR.exec(line);
    if (!m) {
        return undefined;
    }
    return {
        level: m[1],
        message: m[2].replace(/\s+$/, ''),
        file: m[3],
        line: m[4] ? parseInt(m[4], 10) : undefined,
    };
}

/** Locations of REDAXO's system.log on the host (5.x classic, 6.x project, 6.x core clone). */
export function systemLogCandidates(instance: Instance): string[] {
    return [...new Set([
        path.join(instance.docrootPath, 'redaxo', 'data', 'log', 'system.log'),
        path.join(instance.webrootPath, 'var', 'log', 'system.log'),
        path.join(instance.webrootPath, 'project', 'var', 'log', 'system.log'),
    ])];
}

async function isFile(p: string): Promise<boolean> {
    try {
        return (await fs.stat(p)).isFile();
    } catch {
        return false;
    }
}

/**
 * Maps a path from a log to the host: absolute container paths (/var/www/html/…) and paths relative
 * to the REDAXO base (docroot for 5.x, project root for 6.x).
 */
export async function resolveProblemFile(instance: Instance, file: string | undefined): Promise<string | undefined> {
    if (!file) {
        return undefined;
    }
    const candidates: string[] = [];
    if (file.startsWith('/var/www/html/') || file === '/var/www/html') {
        candidates.push(path.join(instance.webrootPath, path.posix.relative('/var/www/html', file)));
    } else if (!path.isAbsolute(file)) {
        candidates.push(
            path.join(instance.docrootPath, file),
            path.join(instance.webrootPath, file),
            path.join(instance.webrootPath, 'project', file),
        );
    }
    for (const c of candidates) {
        if (await isFile(c)) {
            return c;
        }
    }
    return undefined;
}

export async function toProblem(instance: Instance, raw: RawProblem): Promise<Problem> {
    return {
        severity: severityOf(raw.level),
        level: raw.level,
        message: raw.message,
        file: await resolveProblemFile(instance, raw.file),
        line: raw.line,
        url: raw.url,
    };
}
