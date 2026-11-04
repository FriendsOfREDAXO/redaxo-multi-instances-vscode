import * as vscode from 'vscode';
import { detectMkcert } from '../core/certs';
import { Logger } from '../core/docker';
import { InstanceManager } from '../core/manager';
import { writeSharedSettings } from '../core/settings';
import { registerChatParticipant } from './chat';
import { installMcpServer } from './claude';
import { CommandContext, registerCommands } from './commands';
import { SECTION, readCoreSettings } from './config';
import { DockerWatcher } from './dockerWatcher';
import { registerLanguageModelTools } from './lmTools';
import { ProblemsWatcher } from './problems';
import { InstancesTreeProvider, ServicesTreeProvider } from './tree';

const l10n = vscode.l10n;

export interface ExtensionApi {
    manager: InstanceManager;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
    const log = vscode.window.createOutputChannel('REDAXO Instances', { log: true });
    context.subscriptions.push(log);
    const logger: Logger = {
        info: m => log.info(m),
        warn: m => log.warn(m),
        error: m => log.error(m),
        trace: m => log.trace(m),
    };

    let settings = readCoreSettings();
    const manager = new InstanceManager(() => settings, logger);
    let trusted: boolean | undefined;

    const tree = new InstancesTreeProvider(manager);
    const services = new ServicesTreeProvider(manager, () => trusted);
    const instancesView = vscode.window.createTreeView('redaxo-instances.instancesView', { treeDataProvider: tree, showCollapseAll: true });
    context.subscriptions.push(tree, services, instancesView,
        vscode.window.createTreeView('redaxo-instances.servicesView', { treeDataProvider: services }));

    // status bar: running / total
    const status = vscode.window.createStatusBarItem('redaxo-instances.status', vscode.StatusBarAlignment.Left, 50);
    status.name = 'REDAXO Instances';
    status.command = 'redaxo-instances.instancesView.focus';
    context.subscriptions.push(status);
    tree.onDidLoad(list => {
        const running = list.filter(i => i.status === 'running' || i.status === 'partial');
        status.text = `$(server-environment) ${running.length}/${list.length}`;
        const md = new vscode.MarkdownString(`**REDAXO** – ${l10n.t('{0} of {1} instances running', running.length, list.length)}\n\n`, true);
        for (const i of running) {
            md.appendMarkdown(`- [${i.name}](${i.urls.frontend})\n`);
        }
        status.tooltip = md;
        instancesView.badge = running.length ? { value: running.length, tooltip: l10n.t('{0} running', running.length) } : undefined;
        if (list.length > 0) {
            status.show();
        } else {
            status.hide();
        }
    }, undefined, context.subscriptions);

    const refresh = () => {
        tree.refresh();
        services.refresh();
    };

    const problems = new ProblemsWatcher(manager);
    context.subscriptions.push(problems);
    tree.onDidLoad(list => void problems.update(list), undefined, context.subscriptions);

    const watcher = new DockerWatcher(() => manager.docker);
    context.subscriptions.push(watcher, watcher.onDidChange(refresh), watcher.onDidChangeAvailability(refresh));

    const ctx: CommandContext = {
        context, manager, tree, services, log, problems,
        setTrusted: value => {
            trusted = value;
            services.refresh();
        },
        refresh,
    };
    registerCommands(ctx);
    registerLanguageModelTools(context, manager, refresh);
    registerChatParticipant(context, manager, refresh);

    const syncSettings = async () => {
        try {
            await writeSharedSettings(settings);
        } catch (error) {
            log.warn(`Could not write shared settings: ${String(error)}`);
        }
    };

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(SECTION)) {
            settings = readCoreSettings();
            void syncSettings();
            void watcher.start();
            refresh();
        }
    }));

    // background initialisation – never block activation
    void (async () => {
        await syncSettings();
        await installMcpServer(context).catch(error => log.warn(`MCP server not installed: ${String(error)}`));
        const mk = await detectMkcert();
        trusted = Boolean(mk.path && mk.caInstalled);
        await watcher.start();
        refresh();
        log.info(`Instances folder: ${settings.instancesDir}`);
    })();

    return { manager };
}

export function deactivate(): void {
    // disposables are cleaned up via context.subscriptions
}
