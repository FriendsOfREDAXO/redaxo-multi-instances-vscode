import * as vscode from 'vscode';
import { InstanceManager } from '../core/manager';
import { Instance } from '../core/model';
import { SharedService } from '../core/shared';

const l10n = vscode.l10n;

/** Values for the `viewItem` when clauses, e.g. `instance running v2 redaxo`. */
export function instanceContext(i: Instance): string {
    const state = i.status === 'running' || i.status === 'partial' ? 'running' : 'stopped';
    return ['instance', state, i.format === 'v2' ? 'v2' : 'legacy', i.kind].join(' ');
}

export class InstanceItem extends vscode.TreeItem {
    constructor(readonly instance: Instance) {
        super(instance.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `instance:${instance.name}`;
        this.contextValue = instanceContext(instance);
        const parts = [`PHP ${instance.php}`, `MariaDB ${instance.mariadb}`];
        if (instance.kind === 'custom') {
            parts.unshift(l10n.t('PHP project'));
        }
        if (instance.format !== 'v2') {
            parts.push('1.x');
        }
        this.description = parts.join(' · ');
        this.iconPath = statusIcon(instance);
        this.tooltip = instanceTooltip(instance);
        this.accessibilityInformation = { label: `${instance.name}, ${statusLabel(instance)}, ${this.description}` };
    }
}

function statusLabel(i: Instance): string {
    switch (i.status) {
        case 'running': return l10n.t('running');
        case 'partial': return l10n.t('partially running');
        case 'stopped': return l10n.t('stopped');
        default: return l10n.t('unknown (Docker not reachable)');
    }
}

function statusIcon(i: Instance): vscode.ThemeIcon {
    switch (i.status) {
        case 'running': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
        case 'partial': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        case 'stopped': return new vscode.ThemeIcon('circle-large-outline');
        default: return new vscode.ThemeIcon('question');
    }
}

export function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u++;
    }
    return `${v.toLocaleString(vscode.env.language, { maximumFractionDigits: v < 10 && u > 0 ? 1 : 0 })} ${units[u]}`;
}

function instanceTooltip(i: Instance): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${i.name}** — ${statusLabel(i)}\n\n`);
    md.appendMarkdown(`| | |\n|---|---|\n`);
    md.appendMarkdown(`| ${l10n.t('Type')} | ${i.kind === 'redaxo' ? `REDAXO ${i.redaxoVersion ?? ''}` : l10n.t('PHP project')} |\n`);
    md.appendMarkdown(`| PHP | ${i.php}${i.xdebug ? ' + Xdebug' : ''} |\n`);
    md.appendMarkdown(`| MariaDB | ${i.mariadb} |\n`);
    md.appendMarkdown(`| Frontend | ${i.urls.frontend} |\n`);
    if (i.urls.hosts.length > 2) {
        md.appendMarkdown(`| ${l10n.t('Domains')} | ${i.urls.hosts.join(', ')} |\n`);
    }
    md.appendMarkdown(`| ${l10n.t('Folder')} | \`${i.path}\` |\n`);
    if (i.format !== 'v2') {
        md.appendMarkdown(`\n$(info) ${l10n.t('Created with version 1.x. Use "Modernize" to get HTTPS on *.localhost, PHP switching and more.')}`);
    }
    return md;
}

export type DetailKind = 'url' | 'secret' | 'copy' | 'folder' | 'action';

export class DetailItem extends vscode.TreeItem {
    constructor(
        readonly instance: Instance,
        key: string,
        label: string,
        description: string,
        readonly kind: DetailKind,
        icon: string,
        readonly value?: string,
        command?: vscode.Command,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = `detail:${instance.name}:${key}`;
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = `detail ${kind}`;
        this.command = command;
        if (kind === 'secret') {
            this.tooltip = l10n.t('Click to copy');
        } else if (value) {
            this.tooltip = value;
        }
    }
}

function details(i: Instance): DetailItem[] {
    const items: DetailItem[] = [];
    const open = (url: string): vscode.Command => ({ command: 'redaxo-instances.openUrl', title: l10n.t('Open'), arguments: [url] });
    const copy = (value: string, what: string): vscode.Command => ({ command: 'redaxo-instances.copyValue', title: l10n.t('Copy'), arguments: [value, what] });

    if (i.format !== 'v2') {
        items.push(new DetailItem(i, 'modernize', l10n.t('Modernize instance…'), l10n.t('1.x format'), 'action', 'sparkle', undefined,
            { command: 'redaxo-instances.modernizeInstance', title: '', arguments: [i.name] }));
    }
    items.push(new DetailItem(i, 'frontend', 'Frontend', i.urls.frontend, 'url', 'globe', i.urls.frontend, open(i.urls.frontend)));
    if (i.urls.backend) {
        items.push(new DetailItem(i, 'backend', 'Backend', i.urls.backend, 'url', 'home', i.urls.backend, open(i.urls.backend)));
    }
    if (i.urls.legacyHttps) {
        items.push(new DetailItem(i, 'https', 'HTTPS (1.x)', i.urls.legacyHttps, 'url', 'lock', i.urls.legacyHttps, open(i.urls.legacyHttps)));
    }
    const extra = i.urls.hosts.filter(h => !h.startsWith('*.') && h !== `${i.name}.localhost`);
    if (i.format === 'v2') {
        items.push(new DetailItem(i, 'domains', l10n.t('Domains'), extra.length ? extra.join(', ') : l10n.t('add more…'), 'action', 'link', undefined,
            { command: 'redaxo-instances.manageDomains', title: '', arguments: [i.name] }));
    }
    if (i.admin) {
        items.push(new DetailItem(i, 'login', l10n.t('Login'), `${i.admin.user} / ••••••••`, 'secret', 'key', i.admin.password,
            copy(i.admin.password, l10n.t('Admin password'))));
    }
    const dbHost = `127.0.0.1:${i.db.externalPort ?? '?'}`;
    items.push(new DetailItem(i, 'database', l10n.t('Database'), `${i.db.name} · ${i.db.user} · ${dbHost}`, 'secret', 'database', i.db.password,
        { command: 'redaxo-instances.getLoginInfo', title: '', arguments: [i.name] }));
    items.push(new DetailItem(i, 'folder', l10n.t('Folder'), i.path.replace(process.env.HOME ?? '\0', '~'), 'folder', 'folder', i.path,
        { command: 'redaxo-instances.openWorkspace', title: '', arguments: [i.name] }));
    return items;
}

export type InstancesTreeElement = InstanceItem | DetailItem;

export class InstancesTreeProvider implements vscode.TreeDataProvider<InstancesTreeElement>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<InstancesTreeElement | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    private instances: Instance[] = [];
    private loading?: Promise<Instance[]>;
    private readonly onDidLoadEmitter = new vscode.EventEmitter<Instance[]>();
    /** Fired after the instance list was (re)loaded. */
    readonly onDidLoad = this.onDidLoadEmitter.event;

    constructor(private readonly manager: InstanceManager) {}

    get current(): readonly Instance[] {
        return this.instances;
    }

    refresh(): void {
        this.loading = undefined;
        this.emitter.fire(undefined);
    }

    async load(): Promise<Instance[]> {
        this.loading ??= this.manager.list().then(list => {
            this.instances = list;
            void vscode.commands.executeCommand('setContext', 'redaxo-instances.hasInstances', list.length > 0);
            this.onDidLoadEmitter.fire(list);
            return list;
        }).catch(() => {
            this.instances = [];
            return [];
        });
        return this.loading;
    }

    getTreeItem(element: InstancesTreeElement): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: InstancesTreeElement): Promise<InstancesTreeElement[]> {
        if (!element) {
            return (await this.load()).map(i => new InstanceItem(i));
        }
        if (element instanceof InstanceItem) {
            return details(element.instance);
        }
        return [];
    }

    /** Resources are measured only when the tooltip is shown (docker stats takes a moment). */
    async resolveTreeItem(item: vscode.TreeItem, element: InstancesTreeElement, token: vscode.CancellationToken): Promise<vscode.TreeItem> {
        if (!(element instanceof InstanceItem)) {
            return item;
        }
        try {
            const r = await this.manager.resources(element.instance.name);
            if (token.isCancellationRequested) {
                return item;
            }
            const md = instanceTooltip(element.instance);
            const parts: string[] = [];
            if (r.cpuPercent !== undefined) {
                parts.push(`CPU ${r.cpuPercent.toLocaleString(vscode.env.language)} %`);
            }
            if (r.memoryBytes !== undefined) {
                parts.push(`RAM ${formatBytes(r.memoryBytes)}`);
            }
            if (r.diskBytes !== undefined) {
                parts.push(`${l10n.t('Disk')} ${formatBytes(r.diskBytes)}`);
            }
            if (parts.length) {
                md.appendMarkdown(`\n\n$(pulse) ${parts.join(' · ')}`);
            }
            item.tooltip = md;
        } catch {
            // keep the static tooltip
        }
        return item;
    }

    getParent(element: InstancesTreeElement): InstancesTreeElement | undefined {
        return element instanceof DetailItem ? new InstanceItem(element.instance) : undefined;
    }

    dispose(): void {
        this.emitter.dispose();
        this.onDidLoadEmitter.dispose();
    }
}

export class ServiceItem extends vscode.TreeItem {
    constructor(readonly service: SharedService, running: boolean, label: string, description: string, icon: string, tooltip: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = `service:${service}`;
        this.description = description;
        this.tooltip = tooltip;
        this.contextValue = `service ${service} ${running ? 'running' : 'stopped'}`;
        this.iconPath = new vscode.ThemeIcon(icon, running ? new vscode.ThemeColor('testing.iconPassed') : undefined);
        if (service !== 'proxy') {
            this.command = { command: service === 'adminer' ? 'redaxo-instances.startAdminer' : 'redaxo-instances.openMailpit', title: l10n.t('Open') };
        }
    }
}

export class ServicesTreeProvider implements vscode.TreeDataProvider<ServiceItem>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly manager: InstanceManager, private readonly trusted: () => boolean | undefined) {}

    refresh(): void {
        this.emitter.fire();
    }

    getTreeItem(element: ServiceItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ServiceItem[]> {
        let status: Record<SharedService, boolean> = { proxy: false, mailpit: false, adminer: false };
        try {
            status = await this.manager.shared.status();
        } catch {
            // Docker not available
        }
        const ports = await this.manager.shared.ports();
        const trusted = this.trusted();
        const httpsPort = ports.proxyHttps === 443 ? '' : `:${ports.proxyHttps}`;
        const off = l10n.t('stopped');
        return [
            new ServiceItem('proxy', status.proxy, l10n.t('HTTPS proxy'),
                status.proxy ? `https://*.localhost${httpsPort}` : off,
                trusted === false ? 'unlock' : 'lock',
                trusted === false
                    ? l10n.t('Certificates are not trusted – install mkcert and run "Trust HTTPS certificates".')
                    : l10n.t('Routes https://<name>.localhost and all extra domains to the instances.')),
            new ServiceItem('mailpit', status.mailpit, 'Mailpit', status.mailpit ? `https://mail.localhost${httpsPort}` : off, 'mail',
                l10n.t('Catches all e-mails sent by the instances.')),
            new ServiceItem('adminer', status.adminer, 'Adminer', status.adminer ? `https://adminer.localhost${httpsPort}` : off, 'database',
                l10n.t('Database management (Adminer).')),
        ];
    }

    dispose(): void {
        this.emitter.dispose();
    }
}
