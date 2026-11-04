import * as vscode from 'vscode';
import { CreateOptions, InstanceManager } from '../core/manager';
import { InstanceKind, validateDomain, validateInstanceName } from '../core/model';
import {
    DEFAULT_MARIADB_VERSION, DEFAULT_PHP_VERSION, MARIADB_VERSIONS, PHP_VERSIONS, REDAXO6_VERSION, SupportStatus,
    fetchRedaxoReleases, getRedaxoMinPhp, isPhpCompatibleWithRedaxo, isSupportedMariaDbVersion, isSupportedPhpVersion,
} from '../core/versions';

const l10n = vscode.l10n;
const LAST_VERSIONS = 'lastVersions';

interface Pick<T> extends vscode.QuickPickItem {
    value: T;
}

function statusText(status: SupportStatus): string {
    switch (status) {
        case 'preview': return l10n.t('preview (release candidate)');
        case 'active': return l10n.t('active support');
        case 'security': return l10n.t('security fixes only');
        default: return l10n.t('end of life');
    }
}

export async function pickPhpVersion(current?: string, redaxoVersion?: string, title?: string): Promise<string | undefined> {
    const items: Array<Pick<string>> = PHP_VERSIONS
        .filter(v => !redaxoVersion || isPhpCompatibleWithRedaxo(v.version, redaxoVersion))
        .map(v => ({
            label: `PHP ${v.version}`,
            description: [v.version === DEFAULT_PHP_VERSION ? l10n.t('recommended') : '', v.version === current ? l10n.t('current') : ''].filter(Boolean).join(' · '),
            detail: statusText(v.status),
            value: v.version,
            picked: v.version === current,
        }));
    const pick = await vscode.window.showQuickPick(items, {
        title: title ?? l10n.t('PHP version'),
        placeHolder: redaxoVersion ? l10n.t('REDAXO {0} requires PHP {1} or newer', redaxoVersion, getRedaxoMinPhp(redaxoVersion)) : undefined,
    });
    return pick?.value;
}

export async function pickMariaDbVersion(current?: string, title?: string): Promise<string | undefined> {
    const items: Array<Pick<string>> = MARIADB_VERSIONS.map(v => ({
        label: `MariaDB ${v.version}`,
        description: [v.lts ? 'LTS' : l10n.t('rolling release'), v.version === DEFAULT_MARIADB_VERSION ? l10n.t('recommended') : '', v.version === current ? l10n.t('current') : ''].filter(Boolean).join(' · '),
        detail: l10n.t('supported until {0}', v.eol),
        value: v.version,
    }));
    const pick = await vscode.window.showQuickPick(items, { title: title ?? l10n.t('MariaDB version') });
    return pick?.value;
}

async function pickRedaxoVersion(title: string): Promise<string | undefined> {
    const releases = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: l10n.t('Loading REDAXO releases…') },
        () => fetchRedaxoReleases(fetch, 8),
    );
    const items: Array<Pick<string>> = releases.map((r, idx) => ({
        label: `REDAXO ${r.version}`,
        description: idx === 0 ? l10n.t('latest') : undefined,
        detail: r.publishedAt ? new Date(r.publishedAt).toLocaleDateString(vscode.env.language) : undefined,
        value: r.version,
    }));
    const pick = await vscode.window.showQuickPick(items, { title });
    return pick?.value;
}

/** Asks for a new instance name (validated, unique). */
export async function askInstanceName(manager: InstanceManager, title: string, value?: string): Promise<string | undefined> {
    const existing = new Set((await manager.list({ withStatus: false })).map(i => i.name));
    return vscode.window.showInputBox({
        title,
        value,
        prompt: l10n.t('The name is also the address: https://<name>.localhost'),
        placeHolder: l10n.t('e.g. customer-shop'),
        validateInput: v => {
            const err = validateInstanceName(v.trim());
            if (err) {
                return l10n.t('Use lowercase letters, digits and hyphens (max. 40 characters)');
            }
            return existing.has(v.trim()) ? l10n.t('An instance with this name already exists') : undefined;
        },
    }).then(v => v?.trim());
}

export async function askDomains(current: readonly string[], name: string): Promise<string[] | undefined> {
    const value = await vscode.window.showInputBox({
        title: l10n.t('Additional domains for {0}', name),
        prompt: l10n.t('{0} and *.{0} always work. Separate additional host names with commas – e.g. for YRewrite.', `${name}.localhost`),
        placeHolder: 'shop.localhost, kunde-b.localhost',
        value: current.join(', '),
        validateInput: v => {
            for (const d of v.split(/[\s,]+/).filter(Boolean)) {
                const err = validateDomain(d);
                if (err) {
                    return `${d}: ${err}`;
                }
            }
            return undefined;
        },
    });
    return value === undefined ? undefined : value.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Two steps for the common case (name → "REDAXO"), versions only when asked for.
 */
export async function createInstanceWizard(manager: InstanceManager, state: vscode.Memento): Promise<CreateOptions | { fromGit: true; name: string } | undefined> {
    const title = l10n.t('New instance');
    const name = await askInstanceName(manager, `${title} (1/2)`);
    if (!name) {
        return undefined;
    }

    const last = state.get<{ php?: string; mariadb?: string }>(LAST_VERSIONS) ?? {};
    const php = isSupportedPhpVersion(last.php ?? '') ? last.php! : DEFAULT_PHP_VERSION;
    const mariadb = isSupportedMariaDbVersion(last.mariadb ?? '') ? last.mariadb! : DEFAULT_MARIADB_VERSION;
    const versions = `PHP ${php} · MariaDB ${mariadb}`;

    type Choice = { kind: InstanceKind; custom: boolean; redaxo6?: 'project' | 'core'; git?: boolean };
    const choice = await vscode.window.showQuickPick<Pick<Choice>>([
        { label: '$(rocket) REDAXO', description: l10n.t('latest version, installed automatically'), detail: versions, value: { kind: 'redaxo', custom: false } },
        { label: '$(settings) REDAXO', description: l10n.t('choose versions…'), detail: l10n.t('REDAXO, PHP and MariaDB version'), value: { kind: 'redaxo', custom: true } },
        { label: l10n.t('Other'), kind: vscode.QuickPickItemKind.Separator, value: { kind: 'custom', custom: false } },
        { label: '$(repo) ' + l10n.t('From a Git repository…'), description: l10n.t('clone an existing project'), detail: l10n.t('REDAXO 5, REDAXO 6 or PHP project – detected automatically'), value: { kind: 'custom', custom: false, git: true } },
        { label: '$(file-code) ' + l10n.t('Empty PHP project'), description: l10n.t('for your own REDAXO setup, Composer projects, …'), detail: `${versions} · ${l10n.t('document root: project/public')}`, value: { kind: 'custom', custom: false } },
        { label: '$(settings) ' + l10n.t('Empty PHP project'), description: l10n.t('choose versions…'), value: { kind: 'custom', custom: true } },
        { label: 'REDAXO 6', kind: vscode.QuickPickItemKind.Separator, value: { kind: 'redaxo', custom: false } },
        { label: '$(beaker) REDAXO 6', description: l10n.t('development version (Composer project)'), detail: `redaxo/project:${REDAXO6_VERSION} · PHP 8.5+`, value: { kind: 'redaxo', custom: false, redaxo6: 'project' } },
        { label: '$(git-branch) REDAXO 6 Core', description: l10n.t('clone redaxo/core 6.x to contribute'), detail: l10n.t('git clone + composer install, dev instance in project/'), value: { kind: 'redaxo', custom: false, redaxo6: 'core' } },
    ], { title: `${title} (2/2): ${name}`, placeHolder: l10n.t('What should be installed?') });
    if (!choice) {
        return undefined;
    }
    if (choice.value.git) {
        return { fromGit: true, name };
    }

    const options: CreateOptions = { name, kind: choice.value.kind, php, mariadb, redaxoVersion: 'latest', redaxo6: choice.value.redaxo6, domains: [] };
    if (options.redaxo6) {
        options.redaxoVersion = REDAXO6_VERSION;
        if (!isPhpCompatibleWithRedaxo(options.php, REDAXO6_VERSION)) {
            options.php = DEFAULT_PHP_VERSION;
        }
    }
    if (choice.value.custom) {
        if (options.kind === 'redaxo') {
            const rx = await pickRedaxoVersion(`${title}: REDAXO`);
            if (!rx) {
                return undefined;
            }
            options.redaxoVersion = rx;
        }
        const pickedPhp = await pickPhpVersion(undefined, options.kind === 'redaxo' ? options.redaxoVersion : undefined, `${title}: PHP`);
        if (!pickedPhp) {
            return undefined;
        }
        const pickedDb = await pickMariaDbVersion(undefined, `${title}: MariaDB`);
        if (!pickedDb) {
            return undefined;
        }
        options.php = pickedPhp;
        options.mariadb = pickedDb;
    } else if (options.kind === 'redaxo' && !isPhpCompatibleWithRedaxo(options.php, 'latest')) {
        options.php = DEFAULT_PHP_VERSION;
    }
    await state.update(LAST_VERSIONS, { php: options.php, mariadb: options.mariadb });
    return options;
}
