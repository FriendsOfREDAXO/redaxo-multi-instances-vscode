import * as path from 'node:path';
import * as vscode from 'vscode';
import { LocalServer, LocalServerKind, detectServer, findPhpBinaries } from '../core/localServers';
import { InstanceManager } from '../core/manager';
import { validateInstanceName } from '../core/model';
import { ClaudeItem, ClaudeSessionItem, claudeChildren, claudeItemFor } from './tree';
import { SiteInfo, backupSqlite, detectSites } from '../core/sites';
import { projectParent } from '../core/claude';

const l10n = vscode.l10n;

export function kindLabel(kind: LocalServerKind): string {
    switch (kind) {
        case 'php': return l10n.t('PHP built-in server');
        case 'static': return l10n.t('Static files');
        case 'command': return l10n.t('Own command');
    }
}

export class LocalServerItem extends vscode.TreeItem {
    constructor(readonly server: LocalServer, readonly httpsUrl: string | undefined) {
        super(server.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `local:${server.name}`;
        this.contextValue = `localServer ${server.status}`;
        this.description = `${kindLabel(server.kind)} · :${server.port}`;
        this.iconPath = server.status === 'running'
            ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('circle-large-outline');
        const md = new vscode.MarkdownString(`**${server.name}** — ${server.status === 'running' ? l10n.t('running') : l10n.t('stopped')}\n\n`);
        md.appendMarkdown(`| | |\n|---|---|\n| ${l10n.t('Type')} | ${kindLabel(server.kind)} |\n| ${l10n.t('Folder')} | \`${server.path}\` |\n`);
        md.appendMarkdown(`| ${l10n.t('Address')} | ${server.directUrl} |\n`);
        if (httpsUrl) {
            md.appendMarkdown(`| HTTPS | ${httpsUrl} |\n`);
        }
        this.tooltip = md;
    }
}

export class LocalDetailItem extends vscode.TreeItem {
    constructor(readonly server: LocalServer, key: string, label: string, description: string, icon: string, command?: vscode.Command, tooltip?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = `local:${server.name}:${key}`;
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.command = command;
        this.tooltip = tooltip ?? description;
        this.contextValue = `localDetail ${key}`;
    }
}

/** "Sites" of a multi-site project (config/sites/*.php) below its local server. */
export class SitesItem extends vscode.TreeItem {
    constructor(readonly server: LocalServer, readonly sites: SiteInfo[]) {
        super(l10n.t('Sites'), vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `local:${server.name}:sites`;
        this.description = String(sites.length);
        this.iconPath = new vscode.ThemeIcon('globe');
        this.contextValue = 'localSites';
        this.tooltip = l10n.t('Websites of this project (config/sites) – all served by this server');
    }
}

export class SiteItem extends vscode.TreeItem {
    constructor(readonly server: LocalServer, readonly site: SiteInfo, readonly url: string) {
        super(site.key, vscode.TreeItemCollapsibleState.None);
        this.id = `local:${server.name}:site:${site.key}`;
        this.description = site.hosts.join(', ');
        this.iconPath = new vscode.ThemeIcon(site.database ? 'database' : 'globe');
        this.contextValue = site.database ? 'localSite sqlite' : 'localSite';
        this.tooltip = new vscode.MarkdownString(`**${site.key}**\n\n${url}${site.database ? `\n\nSQLite: \`${site.database}\`` : ''}`);
        this.command = { command: 'redaxo-instances.openUrl', title: '', arguments: [url] };
    }
}

type Element = LocalServerItem | LocalDetailItem | SitesItem | SiteItem | ClaudeItem | ClaudeSessionItem;

export class LocalServersTreeProvider implements vscode.TreeDataProvider<Element>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<Element | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly manager: InstanceManager) {}

    refresh(): void {
        this.emitter.fire(undefined);
    }

    getTreeItem(element: Element): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: Element): Promise<Element[]> {
        if (!element) {
            const servers = await this.manager.local.list().catch(() => []);
            void vscode.commands.executeCommand('setContext', 'redaxo-instances.hasLocalServers', servers.length > 0);
            return Promise.all(servers.map(async s => new LocalServerItem(s, s.status === 'running' ? await this.manager.localServerHttpsUrl(s) : undefined)));
        }
        if (element instanceof LocalServerItem) {
            const s = element.server;
            const open = (url: string): vscode.Command => ({ command: 'redaxo-instances.openUrl', title: '', arguments: [url] });
            const items: Element[] = [];
            if (element.httpsUrl) {
                items.push(new LocalDetailItem(s, 'https', 'Frontend', element.httpsUrl, 'globe', open(element.httpsUrl)));
            }
            items.push(new LocalDetailItem(s, 'direct', element.httpsUrl ? l10n.t('Direct') : 'Frontend', s.directUrl, element.httpsUrl ? 'link' : 'globe', open(s.directUrl)));
            const what = s.kind === 'command' ? s.command ?? '' : s.kind === 'php'
                ? `${path.basename(path.dirname(path.dirname(s.php ?? 'php')))} · ${s.docroot || '.'}${s.router ? ` → ${s.router}` : ''}`
                : `${s.docroot || '.'}${s.liveReload ? ` · ${l10n.t('live reload')}` : ''}`;
            items.push(new LocalDetailItem(s, 'config', kindLabel(s.kind), what, s.kind === 'command' ? 'terminal' : s.kind === 'php' ? 'code' : 'file-code',
                { command: 'redaxo-instances.editLocalServer', title: '', arguments: [s.name] }, l10n.t('Click to change')));
            items.push(new LocalDetailItem(s, 'folder', l10n.t('Folder'), s.path.replace(process.env.HOME ?? '\0', '~'), 'folder',
                { command: 'vscode.openFolder', title: '', arguments: [vscode.Uri.file(s.path), { forceNewWindow: true }] }, s.path));
            items.push(new LocalDetailItem(s, 'log', l10n.t('Log'), path.basename(s.logFile), 'output',
                { command: 'redaxo-instances.showLocalServerLog', title: '', arguments: [s.name] }));
            const sites = await detectSites(s.path).catch(() => undefined);
            if (sites) {
                items.push(new SitesItem(s, sites));
            }
            const parent = await projectParent(s.path);
            const claude = await claudeItemFor({ key: `local:${s.name}`, name: s.name, folder: s.path }, '', parent ? [parent] : []);
            if (claude) {
                items.push(claude);
            }
            return items;
        }
        if (element instanceof SitesItem) {
            const https = element.server.status === 'running' ? await this.manager.localServerHttpsUrl(element.server) : undefined;
            const port = https ? (/:(\d+)\/$/.exec(https)?.[1] ?? '') : '';
            return element.sites.map(site => {
                const host = site.hosts[0] ?? `${site.key}.localhost`;
                // HTTPS only for hosts the proxy knows (taken over with "Use hosts for HTTPS")
                const proxied = https && element.server.domains.includes(host);
                return new SiteItem(element.server, site, proxied ? `https://${host}${port ? `:${port}` : ''}/` : `http://${host}:${element.server.port}/`);
            });
        }
        if (element instanceof ClaudeItem) {
            return claudeChildren(element);
        }
        return [];
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

type ServerArg = string | LocalServerItem | LocalDetailItem | undefined;

function serverName(arg: ServerArg): string | undefined {
    return typeof arg === 'string' ? arg : arg?.server.name;
}

export function registerLocalServerCommands(context: vscode.ExtensionContext, manager: InstanceManager, tree: LocalServersTreeProvider, log: vscode.LogOutputChannel, onChange: () => void): void {
    const refresh = () => {
        tree.refresh();
        onChange();
    };
    const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message);
        void vscode.window.showErrorMessage(message);
    };
    const pick = async (arg: ServerArg, placeHolder: string, filter?: (s: LocalServer) => boolean): Promise<string | undefined> => {
        const name = serverName(arg);
        if (name) {
            return name;
        }
        const servers = (await manager.local.list()).filter(s => !filter || filter(s));
        if (!servers.length) {
            void vscode.window.showInformationMessage(l10n.t('No local server found.'));
            return undefined;
        }
        return (await vscode.window.showQuickPick(servers.map(s => ({ label: s.name, description: `${kindLabel(s.kind)} · ${s.path}` })), { placeHolder }))?.label;
    };
    const withProgress = <T>(title: string, task: () => Promise<T>) =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);

    const register = (id: string, fn: (...args: never[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: never[]) => {
            try {
                await fn(...args);
            } catch (error) {
                fail(error);
            }
        }));

    register('redaxo-instances.createLocalServer', async (folderArg?: vscode.Uri) => {
        const folder = folderArg instanceof vscode.Uri ? folderArg : (await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            openLabel: l10n.t('Serve this folder'), title: l10n.t('New local server (without Docker)'),
        }))?.[0];
        if (!folder) {
            return;
        }
        const dir = folder.fsPath;
        const detected = await detectServer(dir);
        const kinds: (vscode.QuickPickItem & { serverKind: LocalServerKind })[] = [
            { serverKind: 'static', label: `$(file-code) ${kindLabel('static')}`, detail: l10n.t('HTML, CSS, JS – with live reload. Needs neither PHP nor Node.') },
            { serverKind: 'php', label: `$(code) ${kindLabel('php')}`, detail: l10n.t('php -S with document root and router script, e.g. for flat-file CMS with SQLite.') },
            { serverKind: 'command', label: `$(terminal) ${kindLabel('command')}`, detail: l10n.t('Any dev server: npm run dev, Vite, Hugo, Python … – the port is in $PORT.') },
        ];
        for (const k of kinds) {
            if (k.serverKind === detected.kind) {
                k.description = l10n.t('detected ({0})', detected.reason);
            }
        }
        const kindPick = await vscode.window.showQuickPick(kinds.sort((a, b) => Number(b.serverKind === detected.kind) - Number(a.serverKind === detected.kind)),
            { title: l10n.t('How should {0} be served?', path.basename(dir)), placeHolder: l10n.t('Type of server') });
        if (!kindPick) {
            return;
        }
        const kind = kindPick.serverKind;
        const same = kind === detected.kind;

        const suggestion = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site';
        const names = new Set([...(await manager.list({ withStatus: false })).map(i => i.name), ...(await manager.local.configs()).map(s => s.name)]);
        const name = await vscode.window.showInputBox({
            title: l10n.t('Name'), value: suggestion,
            prompt: l10n.t('Becomes the address {0}.localhost', '<name>'),
            validateInput: v => validateInstanceName(v) ?? (names.has(v) ? l10n.t('"{0}" already exists', v) : undefined),
        });
        if (!name) {
            return;
        }

        let docroot = '';
        let router: string | undefined;
        let php: string | undefined;
        let command: string | undefined;
        if (kind === 'static' || kind === 'php') {
            const root = await vscode.window.showInputBox({ title: l10n.t('Document root'), value: same ? detected.docroot : '', prompt: l10n.t('Folder inside {0} that is served (empty = the folder itself)', path.basename(dir)) });
            if (root === undefined) {
                return;
            }
            docroot = root.trim();
        }
        if (kind === 'php') {
            const binaries = await findPhpBinaries();
            if (!binaries.length) {
                void vscode.window.showErrorMessage(l10n.t('No PHP found on this computer. Install it, e.g. with "brew install php".'));
                return;
            }
            const bin = binaries.length === 1 ? binaries[0] : (await vscode.window.showQuickPick(binaries.map(b => ({ label: `PHP ${b.version}`, description: b.path, b })), { title: l10n.t('PHP version') }))?.b;
            if (!bin) {
                return;
            }
            php = bin.path;
            const r = await vscode.window.showInputBox({ title: l10n.t('Router script'), value: same ? detected.router ?? '' : '',
                prompt: l10n.t('Front controller for requests that are no file, e.g. public/index.php (empty = none)') });
            if (r === undefined) {
                return;
            }
            router = r.trim() || undefined;
        }
        if (kind === 'command') {
            command = (await vscode.window.showInputBox({ title: l10n.t('Command'), value: same ? detected.command ?? '' : 'python3 -m http.server $PORT --bind 127.0.0.1',
                prompt: l10n.t('Runs in {0}. $PORT is the port – listen on 127.0.0.1 so the HTTPS proxy can reach the server.', path.basename(dir)) }))?.trim();
            if (!command) {
                return;
            }
        }
        const portText = await vscode.window.showInputBox({ title: l10n.t('Port'), prompt: l10n.t('Empty = choose a free port automatically'),
            validateInput: v => (v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) >= 1024 && Number(v) <= 65535) ? undefined : l10n.t('A port between 1024 and 65535')) });
        if (portText === undefined) {
            return;
        }
        const server = await withProgress(l10n.t('Starting {0}…', name), async () => {
            const created = await manager.createLocalServer({ name, kind, path: dir, docroot, router, php, command, port: portText.trim() ? Number(portText) : undefined });
            return manager.local.start(created.name);
        });
        refresh();
        const url = (await manager.localServerHttpsUrl(server)) ?? server.directUrl;
        const open = l10n.t('Open');
        if (await vscode.window.showInformationMessage(l10n.t('{0} runs at {1}', server.name, url), open) === open) {
            void vscode.env.openExternal(vscode.Uri.parse(url));
        }
    });

    register('redaxo-instances.startLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Start which local server?'), s => s.status !== 'running');
        if (!name) {
            return;
        }
        await withProgress(l10n.t('Starting {0}…', name), () => manager.local.start(name));
        await manager.syncLocalProxy();
        refresh();
    });
    register('redaxo-instances.stopLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Stop which local server?'), s => s.status === 'running');
        if (name) {
            await manager.local.stop(name);
            refresh();
        }
    });
    register('redaxo-instances.restartLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Restart which local server?'));
        if (name) {
            await withProgress(l10n.t('Restarting {0}…', name), () => manager.local.restart(name));
            refresh();
        }
    });
    register('redaxo-instances.openLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Open which local server?'));
        if (!name) {
            return;
        }
        let server = await manager.local.get(name);
        if (server.status !== 'running') {
            server = await withProgress(l10n.t('Starting {0}…', name), () => manager.local.start(name));
            refresh();
        }
        void vscode.env.openExternal(vscode.Uri.parse((await manager.localServerHttpsUrl(server)) ?? server.directUrl));
    });
    register('redaxo-instances.showLocalServerLog', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Show the log of which local server?'));
        if (name) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file((await manager.local.get(name)).logFile));
            await vscode.window.showTextDocument(doc, { preview: true });
        }
    });
    register('redaxo-instances.editLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Change which local server?'));
        if (!name) {
            return;
        }
        const s = await manager.local.get(name);
        const fields: (vscode.QuickPickItem & { field: 'port' | 'docroot' | 'router' | 'command' | 'liveReload' })[] = [
            { field: 'port', label: l10n.t('Port'), description: String(s.port) },
            ...(s.kind !== 'command' ? [{ field: 'docroot' as const, label: l10n.t('Document root'), description: s.docroot || '.' }] : []),
            ...(s.kind === 'php' ? [{ field: 'router' as const, label: l10n.t('Router script'), description: s.router ?? '—' }] : []),
            ...(s.kind === 'command' ? [{ field: 'command' as const, label: l10n.t('Command'), description: s.command }] : []),
            ...(s.kind === 'static' ? [{ field: 'liveReload' as const, label: l10n.t('Live reload'), description: s.liveReload ? l10n.t('on') : l10n.t('off') }] : []),
        ];
        const f = await vscode.window.showQuickPick(fields, { title: l10n.t('Change {0}', name) });
        if (!f) {
            return;
        }
        let change: Parameters<typeof manager.local.update>[1];
        if (f.field === 'liveReload') {
            change = { liveReload: !s.liveReload };
        } else {
            const current = f.field === 'port' ? String(s.port) : (s[f.field] ?? '');
            const value = await vscode.window.showInputBox({ title: f.label, value: current,
                validateInput: v => (f.field === 'port' && !(/^\d+$/.test(v) && Number(v) >= 1024 && Number(v) <= 65535) ? l10n.t('A port between 1024 and 65535') : undefined) });
            if (value === undefined) {
                return;
            }
            change = f.field === 'port' ? { port: Number(value) } : { [f.field]: value.trim() || undefined };
            if (f.field === 'docroot') {
                change = { docroot: value.trim() };
            }
        }
        const running = s.status === 'running';
        if (running) {
            await manager.local.stop(name);
        }
        await manager.local.update(name, change);
        if (running) {
            await withProgress(l10n.t('Restarting {0}…', name), () => manager.local.start(name));
        }
        await manager.syncLocalProxy();
        refresh();
    });
    register('redaxo-instances.renameLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Rename which local server?'));
        if (!name) {
            return;
        }
        const taken = new Set([...(await manager.list({ withStatus: false })).map(x => x.name), ...(await manager.local.configs()).map(x => x.name)]);
        const newName = await vscode.window.showInputBox({
            title: l10n.t('Rename {0}', name), value: name, prompt: l10n.t('Becomes the address {0}.localhost', '<name>'),
            validateInput: v => (v === name ? undefined : validateInstanceName(v) ?? (taken.has(v) ? l10n.t('"{0}" already exists', v) : undefined)),
        });
        if (newName && newName !== name) {
            await withProgress(l10n.t('Renaming {0} to {1}…', name, newName), () => manager.renameLocalServer(name, newName));
            refresh();
        }
    });
    register('redaxo-instances.removeLocalServer', async (arg: ServerArg) => {
        const name = await pick(arg, l10n.t('Remove which local server?'));
        if (!name) {
            return;
        }
        const s = await manager.local.get(name);
        const remove = l10n.t('Remove');
        const answer = await vscode.window.showWarningMessage(l10n.t('Remove the local server "{0}"?', name), {
            modal: true, detail: l10n.t('The server is stopped and removed from the list. The folder {0} stays untouched.', s.path),
        }, remove);
        if (answer === remove) {
            await manager.removeLocalServer(name);
            refresh();
        }
    });
    register('redaxo-instances.backupSiteDatabase', async (item: SiteItem) => {
        if (!(item instanceof SiteItem) || !item.site.database) {
            return;
        }
        const dir = path.join(manager.settings.instancesDir, '.redaxo-mi', 'local', 'backups', item.server.name);
        const file = await withProgress(l10n.t('Backing up the database of {0}…', item.site.key), () => backupSqlite(item.site.database ?? '', dir, item.site.key));
        const reveal = process.platform === 'darwin' ? l10n.t('Reveal in Finder') : l10n.t('Reveal in file manager');
        if (await vscode.window.showInformationMessage(l10n.t('Database of {0} saved: {1}', item.site.key, path.basename(file)), reveal) === reveal) {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
        }
    });
    register('redaxo-instances.useSiteHostsForHttps', async (item: SitesItem) => {
        if (!(item instanceof SitesItem)) {
            return;
        }
        const hosts = [...new Set(item.sites.flatMap(s => s.hosts))].filter(h => h !== `${item.server.name}.localhost` && !h.endsWith(`.${item.server.name}.localhost`));
        await manager.local.update(item.server.name, { domains: [...new Set([...item.server.domains, ...hosts])].sort() });
        await manager.syncLocalProxy();
        refresh();
        void vscode.window.showInformationMessage(l10n.t('{0} host names of {1} go through the HTTPS proxy now (when it runs).', hosts.length, item.server.name));
    });
    register('redaxo-instances.stopAllLocalServers', async () => {
        for (const s of await manager.local.list()) {
            if (s.status === 'running') {
                await manager.local.stop(s.name);
            }
        }
        refresh();
    });
}
