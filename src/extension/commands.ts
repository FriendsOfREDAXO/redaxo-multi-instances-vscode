import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { detectMkcert } from '../core/certs';
import { InstanceManager } from '../core/manager';
import { Instance } from '../core/model';
import { SharedService } from '../core/shared';
import { splitArgs } from '../core/tools';
import { describeOccupant, pfFlushCommand } from '../core/diagnose';
import { commandExists } from '../core/exec';
import { gitStatus } from '../core/git';
import { renderDevcontainer, xdebugLaunchConfig } from '../core/templates';
import { DEFAULT_MARIADB_VERSION, compareVersions, isPhpCompatibleWithRedaxo } from '../core/versions';
import type { ProblemsWatcher } from './problems';
import { setupClaude, writeAiFiles } from './claude';
import { setInstancesPath } from './config';
import { DetailItem, InstanceItem, InstancesTreeProvider, ServiceItem, ServicesTreeProvider } from './tree';
import { askDomains, askInstanceName, createInstanceWizard, pickMariaDbVersion, pickPhpVersion } from './wizard';
import { formatBytes } from './tree';

const l10n = vscode.l10n;

export interface CommandContext {
    context: vscode.ExtensionContext;
    manager: InstanceManager;
    tree: InstancesTreeProvider;
    services: ServicesTreeProvider;
    log: vscode.LogOutputChannel;
    problems: ProblemsWatcher;
    setTrusted(value: boolean): void;
    refresh(): void;
}

/** Quotes an argument for the user's shell (POSIX shells, PowerShell and cmd). */
export function shellQuote(arg: string): string {
    if (/^[A-Za-z0-9_\-.,:/=@%+]+$/.test(arg)) {
        return arg;
    }
    return process.platform === 'win32' ? `"${arg.replace(/"/g, '\\"')}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}

type InstanceArg = string | InstanceItem | DetailItem | { name?: string; label?: string; instance?: { name: string } } | undefined;

function nameFromArg(arg: InstanceArg): string | undefined {
    if (!arg) {
        return undefined;
    }
    if (typeof arg === 'string') {
        return arg;
    }
    if (arg instanceof InstanceItem || arg instanceof DetailItem) {
        return arg.instance.name;
    }
    return arg.instance?.name ?? arg.name ?? (typeof arg.label === 'string' ? arg.label : undefined);
}

export function registerCommands(ctx: CommandContext): void {
    const { context, manager, tree, log } = ctx;

    const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

    async function showError(error: unknown): Promise<void> {
        log.error(errorMessage(error));
        const action = await vscode.window.showErrorMessage(errorMessage(error), l10n.t('Show log'));
        if (action) {
            log.show(true);
        }
    }

    async function showWarnings(warnings: readonly string[]): Promise<void> {
        for (const w of warnings) {
            if (/mkcert/.test(w)) {
                const trust = l10n.t('Set up trusted HTTPS');
                if (await vscode.window.showWarningMessage(l10n.t('HTTPS works, but the browser will warn: the certificates are not trusted yet.'), trust) === trust) {
                    await vscode.commands.executeCommand('redaxo-instances.trustCertificates');
                }
            } else {
                void vscode.window.showWarningMessage(w);
            }
        }
    }

    /** Runs a long operation with a progress notification; refreshes the views afterwards. */
    async function withProgress<T>(title: string, task: (report: (message: string) => void) => Promise<T>): Promise<T | undefined> {
        try {
            return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async progress => {
                return task(message => {
                    log.info(message);
                    progress.report({ message });
                });
            });
        } catch (error) {
            await showError(error);
            return undefined;
        } finally {
            ctx.refresh();
        }
    }

    async function pickInstance(placeHolder: string, filter?: (i: Instance) => boolean): Promise<Instance | undefined> {
        const list = (await manager.list()).filter(filter ?? (() => true));
        if (list.length === 0) {
            void vscode.window.showInformationMessage(l10n.t('No matching instance found.'));
            return undefined;
        }
        if (list.length === 1) {
            return list[0];
        }
        const pick = await vscode.window.showQuickPick(list.map(i => ({
            label: i.name,
            description: `${i.status === 'running' ? '$(pass-filled)' : '$(circle-large-outline)'} PHP ${i.php} · MariaDB ${i.mariadb}`,
            instance: i,
        })), { placeHolder });
        return pick?.instance;
    }

    async function resolve(arg: InstanceArg, placeHolder: string, filter?: (i: Instance) => boolean): Promise<Instance | undefined> {
        const name = nameFromArg(arg);
        if (name) {
            try {
                return await manager.get(name);
            } catch (error) {
                await showError(error);
                return undefined;
            }
        }
        return pickInstance(placeHolder, filter);
    }

    const isRunning = (i: Instance) => i.status === 'running' || i.status === 'partial';

    function openUrl(url: string): void {
        void vscode.env.openExternal(vscode.Uri.parse(url));
    }

    async function offerModernize(i: Instance): Promise<void> {
        const modernize = l10n.t('Modernize…');
        const answer = await vscode.window.showInformationMessage(
            l10n.t('"{0}" was created with version 1.x. This function needs the current format.', i.name), modernize);
        if (answer === modernize) {
            await vscode.commands.executeCommand('redaxo-instances.modernizeInstance', i.name);
        }
    }

    async function afterStart(i: Instance, warnings: readonly string[]): Promise<void> {
        await showWarnings(warnings);
        const fresh = await manager.get(i.name);
        const open = l10n.t('Open backend');
        const frontend = l10n.t('Open frontend');
        const copy = l10n.t('Copy password');
        const buttons = fresh.urls.backend ? [open, ...(fresh.admin ? [copy] : [])] : [frontend];
        const answer = await vscode.window.showInformationMessage(l10n.t('{0} is running: {1}', fresh.name, fresh.urls.frontend), ...buttons);
        if (answer === open && fresh.urls.backend) {
            openUrl(fresh.urls.backend);
        } else if (answer === frontend) {
            openUrl(fresh.urls.frontend);
        } else if (answer === copy && fresh.admin) {
            await vscode.env.clipboard.writeText(fresh.admin.password);
            void vscode.window.showInformationMessage(l10n.t('Password of "{0}" copied.', fresh.admin.user));
        }
    }

    function terminal(i: Instance, kind: 'web' | 'db' | 'mysql'): void {
        const cmd = manager.shellCommand(i, kind);
        const name = kind === 'web' ? `${i.name}` : kind === 'db' ? `${i.name} (db)` : `${i.name} (SQL)`;
        const t = vscode.window.createTerminal({
            name,
            shellPath: cmd.command,
            shellArgs: cmd.args,
            iconPath: new vscode.ThemeIcon(kind === 'web' ? 'terminal' : 'database'),
        });
        t.show();
    }

    async function ensureShared(service: SharedService): Promise<boolean> {
        try {
            await manager.shared.ensureUp([service]);
            if (service !== 'proxy') {
                await manager.shared.syncProxy(await manager.list({ withStatus: false }));
            }
            ctx.services.refresh();
            return true;
        } catch (error) {
            await showError(error);
            return false;
        }
    }

    /** .vscode/launch.json in the instance folder (kept when it exists but is not plain JSON, e.g. with comments). */
    async function writeLaunchJson(i: Instance): Promise<void> {
        const file = path.join(i.path, '.vscode', 'launch.json');
        const config = xdebugLaunchConfig(i, `\${workspaceFolder}/${i.layout.webroot}`);
        let data: { version?: string; configurations?: Array<Record<string, unknown>> } = { version: '0.2.0', configurations: [] };
        try {
            data = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                return;
            }
        }
        data.configurations = [...(data.configurations ?? []).filter(c => c.name !== config.name), config];
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    }

    const commands: Record<string, (...args: never[]) => unknown> = {
        // ───────────────────────── general
        'redaxo-instances.refresh': () => ctx.refresh(),
        'redaxo-instances.showOutput': () => log.show(),
        'redaxo-instances.showHelp': () => {
            const file = vscode.env.language.toLowerCase().startsWith('de') ? 'help.de.md' : 'help.md';
            return vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'docs', file));
        },
        'redaxo-instances.openWalkthrough': () => vscode.commands.executeCommand('workbench.action.openWalkthrough',
            `${context.extension.id}#redaxo-instances.gettingStarted`, false),
        'redaxo-instances.openReadme': () => vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(context.extensionUri, 'README.md')),
        'redaxo-instances.openUrl': (url: string) => openUrl(url),
        'redaxo-instances.copyValue': async (value: string | DetailItem, what?: string) => {
            const text = value instanceof DetailItem ? value.value ?? '' : value;
            await vscode.env.clipboard.writeText(text);
            void vscode.window.setStatusBarMessage(l10n.t('{0} copied', what ?? l10n.t('Value')), 3000);
        },

        'redaxo-instances.changeInstancesPath': async () => {
            const picked = await vscode.window.showOpenDialog({
                canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                defaultUri: vscode.Uri.file(manager.settings.instancesDir),
                openLabel: l10n.t('Use as instances folder'),
            });
            if (picked?.[0]) {
                await setInstancesPath(picked[0].fsPath);
            }
        },

        // ───────────────────────── create / import
        'redaxo-instances.createInstance': async () => {
            const options = await createInstanceWizard(manager, context.globalState);
            if (!options) {
                return;
            }
            if ('fromGit' in options) {
                await vscode.commands.executeCommand('redaxo-instances.createInstanceFromGit', options.name);
                return;
            }
            const created = await withProgress(l10n.t('Creating {0}', options.name), async report => {
                const instance = await manager.create({ ...options, start: false }, report);
                await writeAiFiles(manager, instance.path);
                tree.refresh();
                return { instance, result: await manager.start(instance.name, report) };
            });
            if (created) {
                await afterStart(created.instance, created.result.warnings);
            }
        },

        'redaxo-instances.importInstance': async () => {
            const file = await vscode.window.showOpenDialog({
                canSelectFiles: true, canSelectMany: false,
                filters: { [l10n.t('Instance export')]: ['gz', 'tgz'] },
                openLabel: l10n.t('Import'),
            });
            if (!file?.[0]) {
                return;
            }
            const suggestion = path.basename(file[0].fsPath).replace(/(-export)?-\d{4}-\d{2}-\d{2}.*$/, '').replace(/\.tar\.gz$|\.tgz$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const name = await askInstanceName(manager, l10n.t('Name of the imported instance'), suggestion);
            if (!name) {
                return;
            }
            const instance = await withProgress(l10n.t('Importing {0}', name), report => manager.importInstance(file[0].fsPath, name, report));
            if (instance) {
                await writeAiFiles(manager, instance.path);
                await afterStart(instance, []);
            }
        },

        // ───────────────────────── lifecycle
        'redaxo-instances.startInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Start which instance?'), x => !isRunning(x));
            if (!i) {
                return;
            }
            const res = await withProgress(l10n.t('Starting {0}', i.name), report => manager.start(i.name, report));
            if (res) {
                await afterStart(i, res.warnings);
            }
        },
        'redaxo-instances.stopInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Stop which instance?'), isRunning);
            if (i) {
                await withProgress(l10n.t('Stopping {0}', i.name), () => manager.stop(i.name));
            }
        },
        'redaxo-instances.restartInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Restart which instance?'));
            if (i) {
                const res = await withProgress(l10n.t('Restarting {0}', i.name), report => manager.restart(i.name, report));
                if (res) {
                    await showWarnings(res.warnings);
                }
            }
        },
        'redaxo-instances.stopAllInstances': async () => {
            const running = (await manager.list()).filter(isRunning);
            await withProgress(l10n.t('Stopping all instances'), async report => {
                for (const i of running) {
                    report(i.name);
                    await manager.stop(i.name);
                }
            });
        },
        'redaxo-instances.deleteInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Delete which instance?'));
            if (!i) {
                return;
            }
            const del = l10n.t('Delete');
            const exportFirst = l10n.t('Export first');
            const answer = await vscode.window.showWarningMessage(
                l10n.t('Delete "{0}"?', i.name),
                { modal: true, detail: l10n.t('Containers, database and all files in {0} are removed permanently.', i.path) },
                del, exportFirst);
            if (answer === exportFirst) {
                await vscode.commands.executeCommand('redaxo-instances.exportInstance', i.name);
                return;
            }
            if (answer === del) {
                await withProgress(l10n.t('Deleting {0}', i.name), () => manager.remove(i.name));
            }
        },
        'redaxo-instances.repairInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Repair which instance?'));
            if (!i) {
                return;
            }
            const ok = l10n.t('Rebuild');
            const answer = await vscode.window.showInformationMessage(l10n.t('Recreate the containers of "{0}"?', i.name),
                { modal: true, detail: l10n.t('Files and database are kept. The Docker image is rebuilt with the latest updates.') }, ok);
            if (answer === ok) {
                const res = await withProgress(l10n.t('Repairing {0}', i.name), report => manager.repair(i.name, report));
                if (res) {
                    await showWarnings(res.warnings);
                }
            }
        },
        'redaxo-instances.modernizeInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Modernize which instance?'), x => x.format !== 'v2');
            if (!i) {
                return;
            }
            if (i.format === 'v2') {
                void vscode.window.showInformationMessage(l10n.t('"{0}" already uses the current format.', i.name));
                return;
            }
            const ok = l10n.t('Modernize');
            const answer = await vscode.window.showInformationMessage(l10n.t('Modernize "{0}"?', i.name), {
                modal: true,
                detail: l10n.t('A full backup is created first. Files, database, ports and container names are kept; the old configuration is moved to .legacy/.\n\nAfterwards: HTTPS on https://{0}.localhost, extra domains, PHP switching, Xdebug, Mailpit and current PHP/Apache.', i.name),
            }, ok);
            if (answer !== ok) {
                return;
            }
            const res = await withProgress(l10n.t('Modernizing {0}', i.name), report => manager.modernize(i.name, report));
            if (res) {
                await writeAiFiles(manager, i.path);
                await afterStart(i, []);
                if (res.backup) {
                    log.info(`Backup: ${res.backup}`);
                }
            }
        },

        // ───────────────────────── open
        'redaxo-instances.openInBrowser': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open which instance?'));
            if (i) {
                openUrl(i.urls.frontend);
            }
        },
        'redaxo-instances.openBackend': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open the backend of which instance?'), x => x.urls.backend !== undefined);
            if (i?.urls.backend) {
                openUrl(i.urls.backend);
            }
        },
        'redaxo-instances.openTerminal': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open a shell in which instance?'), isRunning);
            if (i) {
                terminal(i, 'web');
            }
        },
        'redaxo-instances.openDbShell': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open the SQL console of which instance?'), isRunning);
            if (i) {
                terminal(i, 'mysql');
            }
        },
        'redaxo-instances.showLogs': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Show the logs of which instance?'));
            if (!i) {
                return;
            }
            const t = vscode.window.createTerminal({
                name: `${i.name} (logs)`,
                shellPath: manager.settings.dockerPath,
                shellArgs: ['compose', '--project-directory', i.path, 'logs', '-f', '--tail', '200'],
                iconPath: new vscode.ThemeIcon('output'),
            });
            t.show();
        },
        'redaxo-instances.showRedaxoLogs': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Show the REDAXO system log of which instance?'), x => x.kind === 'redaxo');
            if (!i) {
                return;
            }
            const candidates = [
                path.join(i.docrootPath, 'redaxo', 'data', 'log', 'system.log'),
                path.join(i.webrootPath, 'var', 'log', 'system.log'),
                path.join(i.webrootPath, 'project', 'var', 'log', 'system.log'),
                path.join(i.webrootPath, 'var', 'data', 'core', 'system.log'),
            ];
            for (const file of candidates) {
                try {
                    await fs.access(file);
                    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
                    return;
                } catch {
                    // try next
                }
            }
            void vscode.window.showInformationMessage(l10n.t('The REDAXO system log is empty.'));
        },
        'redaxo-instances.openWorkspace': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open which instance in VS Code?'));
            if (!i) {
                return;
            }
            const uri = vscode.Uri.file(i.path);
            const newWindow = l10n.t('Open in new window');
            const add = l10n.t('Add to workspace');
            const reveal = process.platform === 'darwin' ? l10n.t('Reveal in Finder') : l10n.t('Reveal in file manager');
            const pick = await vscode.window.showQuickPick([newWindow, add, reveal], { placeHolder: i.path });
            if (pick === newWindow) {
                await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
            } else if (pick === add) {
                vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri, name: i.name });
            } else if (pick === reveal) {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            }
        },
        'redaxo-instances.openInFinder': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Reveal which instance?'));
            if (i) {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(i.path));
            }
        },

        // ───────────────────────── REDAXO
        'redaxo-instances.clearCache': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Clear the cache of which instance?'), x => isRunning(x) && x.kind === 'redaxo');
            if (!i) {
                return;
            }
            const res = await withProgress(l10n.t('Clearing cache of {0}', i.name), () => manager.console(i.name, ['cache:clear']));
            if (res) {
                if (res.code === 0) {
                    void vscode.window.setStatusBarMessage(l10n.t('Cache of {0} cleared', i.name), 4000);
                } else {
                    await showError(new Error(res.output));
                }
            }
        },
        'redaxo-instances.runConsoleCommand': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Run the REDAXO console in which instance?'), x => isRunning(x));
            if (!i) {
                return;
            }
            const consolePath = await manager.findConsole(i).catch(() => undefined);
            if (!consolePath) {
                void vscode.window.showWarningMessage(l10n.t('No REDAXO console found in "{0}".', i.name));
                return;
            }
            const common = i.redaxo6
                ? ['cache:clear', 'migrate', 'migrate:status', 'user:create', 'list']
                : ['cache:clear', 'package:list', 'package:install', 'package:activate', 'install:download', 'user:create', 'user:set-password', 'list'];
            const qp = vscode.window.createQuickPick();
            qp.title = l10n.t('REDAXO console – {0}', i.name);
            qp.placeholder = l10n.t('Command and arguments, e.g. package:install yform');
            const base = common.map(c => ({ label: c }));
            qp.items = base;
            qp.onDidChangeValue(v => {
                qp.items = v && !common.includes(v) ? [{ label: v, description: l10n.t('run') }, ...base] : base;
            });
            const command = await new Promise<string | undefined>(done => {
                qp.onDidAccept(() => {
                    done(qp.selectedItems[0]?.label ?? qp.value);
                    qp.hide();
                });
                qp.onDidHide(() => done(undefined));
                qp.show();
            });
            qp.dispose();
            if (!command) {
                return;
            }
            let args: string[];
            try {
                args = splitArgs(command);
            } catch (error) {
                await showError(error);
                return;
            }
            // run in a normal shell: the output stays visible (also on errors) and ↑ repeats the command
            const name = `${i.name} (console)`;
            const t = vscode.window.terminals.find(x => x.name === name && x.exitStatus === undefined)
                ?? vscode.window.createTerminal({ name, iconPath: new vscode.ThemeIcon('terminal-cmd'), isTransient: true });
            t.show();
            t.sendText([manager.settings.dockerPath, 'exec', '-it', '-u', 'www-data', i.layout.webContainer, 'php', consolePath, ...args].map(shellQuote).join(' '));
        },
        'redaxo-instances.createDatabase': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Create a database in which instance?'), isRunning);
            if (!i) {
                return;
            }
            const db = await vscode.window.showInputBox({
                title: l10n.t('Additional database for {0}', i.name),
                placeHolder: 'shop_import',
                validateInput: v => (/^[A-Za-z0-9_]{1,64}$/.test(v) ? undefined : l10n.t('Letters, digits and underscores only')),
            });
            if (db) {
                const done = await withProgress(l10n.t('Creating database {0}', db), () => manager.createDatabase(i.name, db).then(() => true));
                if (done) {
                    void vscode.window.showInformationMessage(l10n.t('Database "{0}" created – user "{1}" has full access.', db, i.db.user));
                }
            }
        },
        'redaxo-instances.getLoginInfo': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Show access data of which instance?'));
            if (!i) {
                return;
            }
            type Item = vscode.QuickPickItem & { value?: string; open?: boolean };
            const items: Item[] = [
                { label: 'Frontend', description: i.urls.frontend, value: i.urls.frontend, open: true },
                ...(i.urls.backend ? [{ label: 'Backend', description: i.urls.backend, value: i.urls.backend, open: true }] : []),
                ...(i.admin ? [
                    { label: l10n.t('Login'), kind: vscode.QuickPickItemKind.Separator },
                    { label: l10n.t('User'), description: i.admin.user, value: i.admin.user },
                    { label: l10n.t('Password'), description: '••••••••', value: i.admin.password },
                ] : []),
                { label: l10n.t('Database'), kind: vscode.QuickPickItemKind.Separator },
                { label: l10n.t('Host (inside Docker)'), description: `${i.db.host}:3306`, value: i.db.host },
                { label: l10n.t('Host (from your computer)'), description: `127.0.0.1:${i.db.externalPort ?? '-'}`, value: `127.0.0.1:${i.db.externalPort ?? ''}` },
                { label: l10n.t('Database'), description: i.db.name, value: i.db.name },
                { label: l10n.t('User'), description: i.db.user, value: i.db.user },
                { label: l10n.t('Password'), description: '••••••••', value: i.db.password },
                { label: l10n.t('Root password'), description: '••••••••', value: i.db.rootPassword },
            ];
            const pick = await vscode.window.showQuickPick(items, { title: l10n.t('{0} – access data (select to copy)', i.name), matchOnDescription: true });
            if (pick?.value) {
                await vscode.env.clipboard.writeText(pick.value);
                void vscode.window.setStatusBarMessage(l10n.t('{0} copied', pick.label), 3000);
                if (pick.open) {
                    openUrl(pick.value);
                }
            }
        },
        'redaxo-instances.showModernLoginInfo': (arg: InstanceArg) => vscode.commands.executeCommand('redaxo-instances.getLoginInfo', arg),

        // ───────────────────────── configuration
        'redaxo-instances.changePhpVersion': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Change PHP of which instance?'));
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            const php = await pickPhpVersion(i.php, i.kind === 'redaxo' ? i.redaxoVersion : undefined, l10n.t('PHP version for {0}', i.name));
            if (php && php !== i.php) {
                await withProgress(l10n.t('Switching {0} to PHP {1}', i.name, php), report => manager.changePhp(i.name, php, report));
            }
        },
        'redaxo-instances.changeMariaDbVersion': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Change MariaDB of which instance?'));
            if (!i) {
                return;
            }
            const version = await pickMariaDbVersion(i.mariadb, l10n.t('MariaDB version for {0}', i.name));
            if (!version || version === i.mariadb) {
                return;
            }
            if (/^\d/.test(i.mariadb) && compareVersions(version, i.mariadb) < 0) {
                void vscode.window.showWarningMessage(l10n.t('MariaDB cannot be downgraded ({0} → {1}). Export the instance and import it into a new one instead.', i.mariadb, version));
                return;
            }
            const ok = l10n.t('Upgrade');
            const answer = await vscode.window.showInformationMessage(l10n.t('Upgrade MariaDB of "{0}" to {1}?', i.name, version),
                { modal: true, detail: l10n.t('The data is upgraded automatically. A downgrade is not possible afterwards – export the instance first if unsure.') }, ok);
            if (answer === ok) {
                await withProgress(l10n.t('Switching {0} to MariaDB {1}', i.name, version), report => manager.changeMariaDb(i.name, version, report));
            }
        },
        'redaxo-instances.toggleXdebug': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Toggle Xdebug for which instance?'));
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            const enable = !i.xdebug;
            const done = await withProgress(enable ? l10n.t('Enabling Xdebug') : l10n.t('Disabling Xdebug'), report => manager.setXdebug(i.name, enable, report).then(() => true));
            if (done && enable) {
                const start = l10n.t('Start debugging');
                if (await vscode.window.showInformationMessage(l10n.t('Xdebug is on (port 9003, trigger mode: XDEBUG_TRIGGER / browser extension). Path mapping: /var/www/html → {0}', i.webrootPath), start) === start) {
                    await vscode.commands.executeCommand('redaxo-instances.startDebugging', i.name);
                }
            }
        },
        'redaxo-instances.manageDomains': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Manage the domains of which instance?'));
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            const domains = await askDomains(i.domains, i.name);
            if (domains !== undefined) {
                await withProgress(l10n.t('Updating domains of {0}', i.name), () => manager.setDomains(i.name, domains));
            }
        },
        'redaxo-instances.setupSSL': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('HTTPS for which instance?'));
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            const trust = l10n.t('Trust HTTPS certificates (mkcert)');
            const domains = l10n.t('Manage domains…');
            const pick = await vscode.window.showQuickPick([trust, domains], {
                placeHolder: l10n.t('HTTPS is always on: {0}', i.urls.frontend),
            });
            if (pick === trust) {
                await vscode.commands.executeCommand('redaxo-instances.trustCertificates');
            } else if (pick === domains) {
                await vscode.commands.executeCommand('redaxo-instances.manageDomains', i.name);
            }
        },
        'redaxo-instances.updateHosts': () => vscode.window.showInformationMessage(
            l10n.t('Not needed anymore: *.localhost domains resolve to your computer automatically – no hosts file entries required.')),
        'redaxo-instances.installCLITools': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Install CLI tools in which instance?'), isRunning);
            if (!i) {
                return;
            }
            if (i.format === 'v2') {
                void vscode.window.showInformationMessage(l10n.t('Already included: Composer, git, nano, vim, curl, mariadb client, ImageMagick, libvips, Poppler, Ghostscript and ffmpeg.'));
                return;
            }
            await withProgress(l10n.t('Installing CLI tools in {0}', i.name), () => manager.docker.exec(i.layout.webContainer, ['sh', '-c',
                'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nano vim-tiny curl unzip git mariadb-client'], { timeout: 600_000 }));
        },
        'redaxo-instances.trustCertificates': async () => {
            const mk = await detectMkcert(true);
            if (!mk.path) {
                const docs = l10n.t('Installation guide');
                const hint = process.platform === 'darwin' ? 'brew install mkcert nss'
                    : process.platform === 'win32' ? 'winget install FiloSottile.mkcert' : 'sudo apt install mkcert libnss3-tools';
                const answer = await vscode.window.showInformationMessage(
                    l10n.t('Trusted HTTPS needs mkcert. Install it ({0}) and run this command again.', hint), docs);
                if (answer === docs) {
                    openUrl('https://github.com/FiloSottile/mkcert#installation');
                }
                return;
            }
            const t = vscode.window.createTerminal({ name: 'mkcert -install', iconPath: new vscode.ThemeIcon('lock') });
            t.show();
            t.sendText(`"${mk.path}" -install`);
            const done = vscode.window.onDidCloseTerminal(async closed => {
                if (closed !== t) {
                    return;
                }
                done.dispose();
                const after = await detectMkcert(true);
                if (after.caInstalled) {
                    await withProgress(l10n.t('Creating trusted certificates'), async () => {
                        const { trusted } = await manager.shared.syncProxy(await manager.list({ withStatus: false }));
                        ctx.setTrusted(trusted);
                    });
                }
            });
            void vscode.window.showInformationMessage(l10n.t('Enter your password in the terminal if asked, then close the terminal.'));
        },

        // ───────────────────────── export
        'redaxo-instances.exportInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Export which instance?'));
            if (!i) {
                return;
            }
            const target = await vscode.window.showOpenDialog({
                canSelectFolders: true, canSelectFiles: false,
                defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads')),
                openLabel: l10n.t('Export here'),
            });
            if (!target?.[0]) {
                return;
            }
            const res = await withProgress(l10n.t('Exporting {0}', i.name), report => manager.exportInstance(i.name, target[0].fsPath, report));
            if (res) {
                const reveal = l10n.t('Reveal');
                const mb = (res.sizeBytes / 1024 / 1024).toFixed(1);
                if (await vscode.window.showInformationMessage(l10n.t('Exported to {0} ({1} MB)', path.basename(res.archive), mb), reveal) === reveal) {
                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(res.archive));
                }
            }
        },

        // ───────────────────────── shared services
        'redaxo-instances.openInAdminer': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open the database of which instance?'), isRunning);
            if (!i || !(await ensureShared('adminer'))) {
                return;
            }
            const base = await manager.shared.url('adminer');
            const url = `${base}?server=${encodeURIComponent(i.layout.dbContainer)}&username=${encodeURIComponent(i.db.user)}&db=${encodeURIComponent(i.db.name)}`;
            await vscode.env.clipboard.writeText(i.db.password);
            openUrl(url);
            void vscode.window.showInformationMessage(l10n.t('Adminer opened – the database password is in the clipboard.'));
        },
        'redaxo-instances.startAdminer': async () => {
            if (await ensureShared('adminer')) {
                openUrl(await manager.shared.url('adminer'));
            }
        },
        'redaxo-instances.stopAdminer': async () => {
            await withProgress(l10n.t('Stopping Adminer'), () => manager.shared.stop(['adminer']));
        },
        'redaxo-instances.openMailpit': async () => {
            if (await ensureShared('mailpit')) {
                openUrl(await manager.shared.url('mailpit'));
            }
        },
        'redaxo-instances.startService': async (item: ServiceItem) => {
            await withProgress(l10n.t('Starting {0}', item.label as string), async () => {
                await manager.shared.ensureUp([item.service]);
                const { trusted } = await manager.shared.syncProxy(await manager.list({ withStatus: false }));
                ctx.setTrusted(trusted);
            });
        },
        'redaxo-instances.stopService': async (item: ServiceItem) => {
            await withProgress(l10n.t('Stopping {0}', item.label as string), () => manager.shared.stop([item.service]));
        },

        // ───────────────────────── AI
        'redaxo-instances.setupClaude': () => setupClaude(ctx),
        'redaxo-instances.copyCopilotInstructions': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Generate AI instructions for which instance?'));
            if (!i) {
                return;
            }
            await writeAiFiles(manager, i.path);
            await vscode.window.showTextDocument(vscode.Uri.file(path.join(i.path, 'AGENTS.md')));
            void vscode.window.showInformationMessage(l10n.t('AGENTS.md, CLAUDE.md and .mcp.json are up to date – Copilot and Claude Code read them automatically when the folder is opened.'));
        },

        // ───────────────────────── snapshots
        'redaxo-instances.createSnapshot': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Create a snapshot of which instance?'));
            if (!i) {
                return;
            }
            const label = await vscode.window.showInputBox({
                title: l10n.t('Snapshot of {0}', i.name),
                prompt: l10n.t('Optional description, e.g. "before YForm update"'),
            });
            if (label === undefined) {
                return;
            }
            const snap = await withProgress(l10n.t('Creating snapshot of {0}', i.name), report => manager.createSnapshot(i.name, label, report));
            if (snap) {
                void vscode.window.showInformationMessage(l10n.t('Snapshot created ({0}). Restore it via "Snapshots…".', formatBytes(snap.sizeBytes)));
            }
        },
        'redaxo-instances.manageSnapshots': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Snapshots of which instance?'));
            if (!i) {
                return;
            }
            const restoreBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('history'), tooltip: l10n.t('Restore') };
            const deleteBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: l10n.t('Delete') };
            type Item = vscode.QuickPickItem & { id?: string; create?: boolean };
            const qp = vscode.window.createQuickPick<Item>();
            qp.title = l10n.t('Snapshots of {0}', i.name);
            const load = async () => {
                const list = await manager.listSnapshots(i.name);
                qp.items = [
                    { label: '$(add) ' + l10n.t('Create snapshot…'), create: true },
                    ...list.map(sn => ({
                        id: sn.id,
                        label: sn.label || l10n.t('Snapshot'),
                        description: new Date(sn.createdAt).toLocaleString(vscode.env.language),
                        detail: `${formatBytes(sn.sizeBytes)} · PHP ${sn.php} · MariaDB ${sn.mariadb}`,
                        buttons: [restoreBtn, deleteBtn],
                    })),
                ];
            };
            await load();
            const restore = async (id: string) => {
                qp.hide();
                const ok = l10n.t('Restore');
                const answer = await vscode.window.showWarningMessage(l10n.t('Restore this snapshot of "{0}"?', i.name), {
                    modal: true,
                    detail: l10n.t('Database and files are reset to the state of the snapshot. Changes made since then are lost – create a new snapshot first if unsure.'),
                }, ok);
                if (answer === ok) {
                    const done = await withProgress(l10n.t('Restoring snapshot of {0}', i.name), report => manager.restoreSnapshot(i.name, id, report).then(() => true));
                    if (done) {
                        void vscode.window.showInformationMessage(l10n.t('Snapshot restored.'));
                    }
                }
            };
            qp.onDidTriggerItemButton(async e => {
                if (!e.item.id) {
                    return;
                }
                if (e.button === deleteBtn) {
                    await manager.deleteSnapshot(i.name, e.item.id);
                    await load();
                } else {
                    await restore(e.item.id);
                }
            });
            qp.onDidAccept(async () => {
                const item = qp.selectedItems[0];
                if (item?.create) {
                    qp.hide();
                    await vscode.commands.executeCommand('redaxo-instances.createSnapshot', i.name);
                } else if (item?.id) {
                    await restore(item.id);
                }
            });
            qp.onDidHide(() => qp.dispose());
            qp.show();
        },

        // ───────────────────────── duplicate / git
        'redaxo-instances.duplicateInstance': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Duplicate which instance?'));
            if (!i) {
                return;
            }
            const name = await askInstanceName(manager, l10n.t('Name of the copy of {0}', i.name), `${i.name}-copy`.slice(0, 40));
            if (!name) {
                return;
            }
            const copy = await withProgress(l10n.t('Duplicating {0}', i.name), report => manager.duplicate(i.name, name, report));
            if (copy) {
                await writeAiFiles(manager, copy.path);
                await afterStart(copy, []);
            }
        },
        'redaxo-instances.createInstanceFromGit': async (presetName?: string) => {
            if (!(await commandExists('git'))) {
                void vscode.window.showErrorMessage(l10n.t('git is not installed.'));
                return;
            }
            const url = await vscode.window.showInputBox({
                title: l10n.t('New instance from a Git repository'),
                prompt: l10n.t('Repository URL (your SSH key / Git credentials are used)'),
                placeHolder: 'git@github.com:kunde/shop.git',
                ignoreFocusOut: true,
            });
            if (!url?.trim()) {
                return;
            }
            const cloned = await withProgress(l10n.t('Cloning {0}', url), () => manager.cloneProject(url.trim()));
            if (!cloned) {
                return;
            }
            let keep = false;
            try {
                const name = typeof presetName === 'string' && presetName ? presetName
                    : await askInstanceName(manager, l10n.t('Name of the instance ({0})', cloned.project.description), cloned.suggestedName);
                if (!name) {
                    return;
                }
                const minRedaxo = cloned.project.kind === 'redaxo' ? (cloned.project.redaxo6 ? '6.x-dev' : undefined) : undefined;
                const php = await pickPhpVersion(undefined, minRedaxo, l10n.t('PHP version for {0}', name));
                if (!php || (minRedaxo && !isPhpCompatibleWithRedaxo(php, minRedaxo))) {
                    return;
                }
                keep = true;
                const created = await withProgress(l10n.t('Creating {0}', name), async report => {
                    const instance = await manager.create({
                        name, php, mariadb: DEFAULT_MARIADB_VERSION, kind: cloned.project.kind, redaxo6: cloned.project.redaxo6,
                        docroot: cloned.project.docroot, sourceDir: cloned.dir, start: false,
                    }, report);
                    await writeAiFiles(manager, instance.path);
                    tree.refresh();
                    return { instance, result: await manager.start(instance.name, report) };
                });
                if (created) {
                    await afterStart(created.instance, created.result.warnings);
                }
            } finally {
                if (!keep) {
                    await fs.rm(cloned.dir, { recursive: true, force: true });
                }
            }
        },
        'redaxo-instances.setupGit': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Set up Git for which instance?'));
            if (!i) {
                return;
            }
            if (!(await commandExists('git'))) {
                void vscode.window.showErrorMessage(l10n.t('git is not installed.'));
                return;
            }
            const status = await gitStatus(i.webrootPath);
            let remote: string | undefined;
            if (!status.remote) {
                remote = await vscode.window.showInputBox({
                    title: l10n.t('Git for {0}', i.name),
                    prompt: l10n.t('Remote repository (optional, leave empty for a local repository)'),
                    placeHolder: 'git@github.com:kunde/shop.git',
                    ignoreFocusOut: true,
                });
                if (remote === undefined) {
                    return;
                }
            }
            const result = await withProgress(l10n.t('Setting up Git for {0}', i.name), () => manager.setupGit(i.name, { remote: remote?.trim() || undefined }));
            if (!result) {
                return;
            }
            const open = l10n.t('Open in VS Code…');
            const answer = await vscode.window.showInformationMessage(
                l10n.t('Git repository ready in {0} (branch {1}{2}).', result.dir.replace(os.homedir(), '~'), result.branch ?? 'main', result.remote ? `, origin ${result.remote}` : ''),
                open);
            if (answer === open) {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(result.dir), { forceNewWindow: true });
            }
        },

        // ───────────────────────── debugging / dev container / problems
        'redaxo-instances.startDebugging': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Debug which instance?'), isRunning);
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            if (!vscode.extensions.getExtension('xdebug.php-debug')) {
                const install = l10n.t('Install PHP Debug');
                if (await vscode.window.showInformationMessage(l10n.t('Debugging needs the "PHP Debug" extension.'), install) !== install) {
                    return;
                }
                await vscode.commands.executeCommand('workbench.extensions.installExtension', 'xdebug.php-debug');
            }
            if (!i.xdebug) {
                const ok = await withProgress(l10n.t('Enabling Xdebug'), report => manager.setXdebug(i.name, true, report).then(() => true));
                if (!ok) {
                    return;
                }
            }
            await writeLaunchJson(i);
            const started = await vscode.debug.startDebugging(undefined, xdebugLaunchConfig(i, i.webrootPath) as vscode.DebugConfiguration);
            if (started) {
                const openTrigger = l10n.t('Open page with trigger');
                if (await vscode.window.showInformationMessage(l10n.t('Xdebug is listening. Set a breakpoint and open a page with ?XDEBUG_TRIGGER=1 (or the Xdebug browser extension).'), openTrigger) === openTrigger) {
                    openUrl(`${i.urls.frontend}?XDEBUG_TRIGGER=1`);
                }
            }
        },
        'redaxo-instances.openInDevContainer': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Open which instance in a Dev Container?'));
            if (!i) {
                return;
            }
            if (i.format !== 'v2') {
                await offerModernize(i);
                return;
            }
            if (!vscode.extensions.getExtension('ms-vscode-remote.remote-containers')) {
                const install = l10n.t('Install Dev Containers');
                if (await vscode.window.showInformationMessage(l10n.t('This needs the "Dev Containers" extension by Microsoft.'), install) !== install) {
                    return;
                }
                await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-containers');
            }
            // the container must run the current image (www-data needs a writable home for the VS Code server)
            const ready = await withProgress(l10n.t('Preparing {0}', i.name), report => manager.start(i.name, report).then(() => true));
            if (!ready) {
                return;
            }
            await fs.mkdir(path.join(i.path, '.devcontainer'), { recursive: true });
            await fs.writeFile(path.join(i.path, '.devcontainer', 'devcontainer.json'), renderDevcontainer(i), 'utf8');
            await vscode.commands.executeCommand('remote-containers.openFolder', vscode.Uri.file(i.path));
        },
        'redaxo-instances.clearProblems': () => ctx.problems.clear(),
        'redaxo-instances.showPortDiagnosis': async () => {
            const occupants = await manager.shared.standardPortOccupants();
            const ports = await manager.shared.ports();
            if (occupants.length === 0) {
                void vscode.window.showInformationMessage(ports.proxyHttps === 443
                    ? l10n.t('The HTTPS proxy uses the standard ports 80/443 – addresses need no port.')
                    : l10n.t('Ports 80/443 are free – the proxy moves there when the next instance starts.'));
                return;
            }
            const fix = occupants.map(pfFlushCommand).find(Boolean);
            const copy = l10n.t('Copy command');
            const answer = await vscode.window.showWarningMessage(
                l10n.t('Addresses need port {0} because 80/443 are in use.', String(ports.proxyHttps)),
                {
                    modal: true,
                    detail: occupants.map(describeOccupant).join('\n') + '\n\n' + (fix
                        ? l10n.t('A firewall redirect of another local dev tool is active. Stop that tool and remove its redirect in a terminal:\n{0}', fix)
                        : l10n.t('Stop the program (or move it to other ports) – the proxy moves to 80/443 automatically on the next instance start.')),
                },
                ...(fix ? [copy] : []));
            if (answer === copy && fix) {
                await vscode.env.clipboard.writeText(fix);
            }
        },

        // ───────────────────────── maintenance
        'redaxo-instances.maintenanceMenu': async () => {
            type Item = vscode.QuickPickItem & { id: string };
            const pick = await vscode.window.showQuickPick<Item>([
                { id: 'ports', label: '$(ports) ' + l10n.t('Fix port conflicts'), detail: l10n.t('Assigns free ports to instances that share a port') },
                { id: 'restart', label: '$(sync) ' + l10n.t('Restart all running instances') },
                { id: 'stop', label: '$(debug-stop) ' + l10n.t('Stop all instances') },
                { id: 'portinfo', label: '$(question) ' + l10n.t('Why do the addresses need a port?'), detail: l10n.t('Shows which program uses ports 80/443') },
                { id: 'orphans', label: '$(trash) ' + l10n.t('Clean up Docker'), detail: l10n.t('Removes containers and images of deleted instances') },
                { id: 'update', label: '$(cloud-download) ' + l10n.t('Update shared services'), detail: l10n.t('Pulls the latest images of the HTTPS proxy, Mailpit and Adminer') },
                { id: 'folder', label: '$(folder) ' + l10n.t('Change instances folder…'), detail: manager.settings.instancesDir },
                { id: 'log', label: '$(output) ' + l10n.t('Show log') },
            ], { placeHolder: l10n.t('Maintenance') });
            switch (pick?.id) {
                case 'ports': {
                    const changes = await withProgress(l10n.t('Checking ports'), () => manager.fixPortConflicts());
                    void vscode.window.showInformationMessage(changes?.length ? changes.join('\n') : l10n.t('No port conflicts found.'));
                    break;
                }
                case 'restart': {
                    const running = (await manager.list()).filter(isRunning);
                    await withProgress(l10n.t('Restarting all instances'), async report => {
                        for (const i of running) {
                            await manager.restart(i.name, m => report(`${i.name}: ${m}`));
                        }
                    });
                    break;
                }
                case 'stop':
                    await vscode.commands.executeCommand('redaxo-instances.stopAllInstances');
                    break;
                case 'portinfo':
                    await vscode.commands.executeCommand('redaxo-instances.showPortDiagnosis');
                    break;
                case 'orphans': {
                    const orphans = await withProgress(l10n.t('Searching'), () => manager.findOrphans());
                    if (!orphans || (orphans.containers.length === 0 && orphans.images.length === 0)) {
                        void vscode.window.showInformationMessage(l10n.t('Nothing to clean up.'));
                        break;
                    }
                    const ok = l10n.t('Remove');
                    const list = [...orphans.containers, ...orphans.images].join('\n');
                    if (await vscode.window.showWarningMessage(l10n.t('Remove {0} unused containers/images?', orphans.containers.length + orphans.images.length), { modal: true, detail: list }, ok) === ok) {
                        await withProgress(l10n.t('Cleaning up'), () => manager.removeOrphans(orphans));
                    }
                    break;
                }
                case 'update':
                    await withProgress(l10n.t('Updating shared services'), async () => {
                        await manager.shared.ensureUp([]);
                        await manager.docker.compose(manager.shared.dir, ['pull']);
                        const status = await manager.shared.status();
                        const running = (Object.keys(status) as SharedService[]).filter(s => status[s]);
                        if (running.length) {
                            await manager.docker.compose(manager.shared.dir, ['up', '-d', ...running]);
                        }
                    });
                    break;
                case 'folder':
                    await vscode.commands.executeCommand('redaxo-instances.changeInstancesPath');
                    break;
                case 'log':
                    log.show();
                    break;
            }
        },

        // ───────────────────────── quick actions for one instance
        'redaxo-instances.showInstanceContextMenu': async (arg: InstanceArg) => {
            const i = await resolve(arg, l10n.t('Which instance?'));
            if (!i) {
                return;
            }
            const running = isRunning(i);
            type Item = vscode.QuickPickItem & { cmd?: string };
            const items: Item[] = [
                running
                    ? { label: '$(debug-stop) ' + l10n.t('Stop'), cmd: 'stopInstance' }
                    : { label: '$(play) ' + l10n.t('Start'), cmd: 'startInstance' },
                ...(running ? [
                    { label: '$(globe) Frontend', cmd: 'openInBrowser' },
                    ...(i.urls.backend ? [{ label: '$(home) Backend', cmd: 'openBackend' }] : []),
                    ...(i.kind === 'redaxo' ? [{ label: '$(clear-all) ' + l10n.t('Clear cache'), cmd: 'clearCache' }, { label: '$(terminal-cmd) ' + l10n.t('REDAXO console…'), cmd: 'runConsoleCommand' }] : []),
                    { label: '$(terminal) ' + l10n.t('Shell'), cmd: 'openTerminal' },
                    { label: '$(database) Adminer', cmd: 'openInAdminer' },
                ] : []),
                { label: '$(key) ' + l10n.t('Access data'), cmd: 'getLoginInfo' },
                { label: '$(folder-opened) ' + l10n.t('Open in VS Code…'), cmd: 'openWorkspace' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(symbol-number) ' + l10n.t('Change PHP version…'), cmd: 'changePhpVersion' },
                { label: '$(link) ' + l10n.t('Domains…'), cmd: 'manageDomains' },
                { label: '$(export) ' + l10n.t('Export…'), cmd: 'exportInstance' },
                { label: '$(trash) ' + l10n.t('Delete…'), cmd: 'deleteInstance' },
            ];
            const pick = await vscode.window.showQuickPick(items, { title: i.name });
            if (pick?.cmd) {
                await vscode.commands.executeCommand(`redaxo-instances.${pick.cmd}`, i.name);
            }
        },
    };

    for (const [id, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));
    }
}
