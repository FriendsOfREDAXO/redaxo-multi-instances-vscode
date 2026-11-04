import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from './exec';
import { InstanceKind } from './model';

/** What an existing project (e.g. a cloned repository) is, and where its document root lives. */
export interface DetectedProject {
    kind: InstanceKind;
    redaxo6?: 'project' | 'core';
    /** Document root inside the container. */
    docroot: string;
    /** Short human readable description (English, shown in logs). */
    description: string;
}

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function readJson(p: string): Promise<Record<string, unknown> | undefined> {
    try {
        return JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

/** Detects REDAXO 6 (project / core clone), REDAXO 5 (classic, with or without public/) or a plain PHP project. */
export async function detectProject(dir: string): Promise<DetectedProject> {
    const composer = await readJson(path.join(dir, 'composer.json'));
    const require = (composer?.require ?? {}) as Record<string, string>;
    if (composer?.name === 'redaxo/core') {
        return { kind: 'redaxo', redaxo6: 'core', docroot: '/var/www/html/project/public', description: 'REDAXO 6 core (redaxo/core)' };
    }
    if (composer?.name === 'redaxo/project' || require['redaxo/core'] !== undefined) {
        return { kind: 'redaxo', redaxo6: 'project', docroot: '/var/www/html/public', description: 'REDAXO 6 project (Composer)' };
    }
    if (await exists(path.join(dir, 'public', 'redaxo', 'src', 'core'))) {
        return { kind: 'redaxo', docroot: '/var/www/html/public', description: 'REDAXO 5 (document root public/)' };
    }
    if (await exists(path.join(dir, 'redaxo', 'src', 'core'))) {
        return { kind: 'redaxo', docroot: '/var/www/html', description: 'REDAXO 5 (document root = repository root)' };
    }
    if (await exists(path.join(dir, 'public'))) {
        return { kind: 'custom', docroot: '/var/www/html/public', description: 'PHP project (document root public/)' };
    }
    return { kind: 'custom', docroot: '/var/www/html', description: 'PHP project' };
}

/**
 * REDAXO 5 repositories sometimes contain redaxo/data/core/config.yml with the database of the original
 * environment. A new instance starts with an empty database, so the setup has to run again.
 */
export async function prepareClonedRedaxo5(docrootPath: string): Promise<boolean> {
    const config = path.join(docrootPath, 'redaxo', 'data', 'core', 'config.yml');
    let content: string;
    try {
        content = await fs.readFile(config, 'utf8');
    } catch {
        return false;
    }
    if (/^setup:\s*true/m.test(content)) {
        return false;
    }
    await fs.writeFile(config, content.replace(/^setup:.*$/m, 'setup: true'), 'utf8');
    return true;
}

/** Repository name of a git URL (`git@host:org/shop.git` → `shop`). */
export function repoName(url: string): string {
    const last = url.replace(/[/\\]+$/, '').split(/[/:\\]/).pop() ?? '';
    return last.replace(/\.git$/, '');
}

export async function gitClone(url: string, target: string, branch?: string): Promise<void> {
    await run('git', ['clone', '--recurse-submodules', ...(branch ? ['--branch', branch] : []), '--', url, target], {
        timeout: 30 * 60_000,
        env: { GIT_TERMINAL_PROMPT: '0' },
    });
}

/** Lines for a project .gitignore: generated, local and secret files stay out of the repository. */
export function gitignoreLines(project: Pick<DetectedProject, 'kind' | 'redaxo6' | 'docroot'>): string[] {
    const base = ['.DS_Store', 'Thumbs.db', 'node_modules/', '.env.local', '.idea/'];
    if (project.kind === 'redaxo' && project.redaxo6) {
        const p = project.redaxo6 === 'core' ? 'project/' : '';
        return [...base, '/vendor/', `/${p}var/`, `/${p}public/media/*`, `!/${p}public/media/.gitkeep`, '/.deploy/'];
    }
    if (project.kind === 'redaxo') {
        const p = project.docroot.endsWith('/public') ? 'public/' : '';
        return [
            ...base,
            `/${p}redaxo/cache/*`,
            `!/${p}redaxo/cache/.htaccess`,
            `/${p}redaxo/data/core/config.yml`,
            `/${p}redaxo/data/log/`,
            '# Medien bei Bedarf versionieren:',
            `/${p}media/*`,
            `!/${p}media/.redaxo`,
        ];
    }
    return [...base, '/vendor/', '.env'];
}

/** Adds missing lines to an existing .gitignore (or creates one). Returns the added lines. */
export async function mergeGitignore(dir: string, lines: readonly string[]): Promise<string[]> {
    const file = path.join(dir, '.gitignore');
    let current = '';
    try {
        current = await fs.readFile(file, 'utf8');
    } catch {
        // new file
    }
    const have = new Set(current.split(/\r?\n/).map(l => l.trim()));
    const add = lines.filter(l => !have.has(l));
    if (add.length > 0) {
        const prefix = current && !current.endsWith('\n') ? '\n' : '';
        const header = current ? '\n# REDAXO Multi-Instances\n' : '# REDAXO Multi-Instances\n';
        await fs.writeFile(file, current + prefix + header + add.join('\n') + '\n', 'utf8');
    }
    return add;
}

export interface GitStatus {
    isRepo: boolean;
    branch?: string;
    remote?: string;
}

export async function gitStatus(dir: string): Promise<GitStatus> {
    const inside = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { allowFailure: true, timeout: 10_000 });
    if (inside.code !== 0 || path.resolve(inside.stdout.trim()) !== path.resolve(await fs.realpath(dir).catch(() => dir))) {
        return { isRepo: false };
    }
    const branch = await run('git', ['-C', dir, 'branch', '--show-current'], { allowFailure: true });
    const remote = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { allowFailure: true });
    return { isRepo: true, branch: branch.stdout.trim() || undefined, remote: remote.code === 0 ? remote.stdout.trim() : undefined };
}

/** git init + .gitignore + optional remote + initial commit. Uses the git identity of the user. */
export async function gitInit(dir: string, project: Pick<DetectedProject, 'kind' | 'redaxo6' | 'docroot'>, options: { remote?: string; commit?: boolean } = {}): Promise<GitStatus> {
    const status = await gitStatus(dir);
    if (!status.isRepo) {
        await run('git', ['-C', dir, 'init', '-b', 'main']);
    }
    await mergeGitignore(dir, gitignoreLines(project));
    if (options.remote && !status.remote) {
        await run('git', ['-C', dir, 'remote', 'add', 'origin', options.remote]);
    }
    if (options.commit !== false) {
        await run('git', ['-C', dir, 'add', '-A']);
        const staged = await run('git', ['-C', dir, 'diff', '--cached', '--quiet'], { allowFailure: true });
        if (staged.code !== 0) {
            // the user's identity when configured, otherwise a neutral fallback (e.g. on CI machines)
            const email = await run('git', ['-C', dir, 'config', 'user.email'], { allowFailure: true });
            const identity = email.stdout.trim() ? [] : ['-c', 'user.name=REDAXO Multi-Instances', '-c', 'user.email=noreply@localhost'];
            await run('git', ['-C', dir, ...identity, 'commit', '-m', status.isRepo ? 'chore: REDAXO Multi-Instances .gitignore' : 'Initial commit']);
        }
    }
    return gitStatus(dir);
}
