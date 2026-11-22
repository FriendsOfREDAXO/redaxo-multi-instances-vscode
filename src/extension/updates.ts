import * as vscode from 'vscode';
import { InstanceManager } from '../core/manager';
import { Instance } from '../core/model';
import { PackageUpdate } from '../core/updates';

const l10n = vscode.l10n;

type InstanceArg = string | { instance?: { name: string } } | undefined;

function describe(u: PackageUpdate): string {
    return u.blocked
        ? l10n.t('{0} → {1} · composer.json allows only "{2}"', u.installed, u.latest, u.constraint ?? '')
        : `${u.installed} → ${u.latest}${u.major ? ` · ${l10n.t('major version – read the changelog')}` : ''}${u.prerelease ? ` · ${l10n.t('pre-release')}` : ''}`;
}

/** Add-on updates of an instance (pick, optional snapshot, install) and an overview of all running instances. */
export function registerUpdateCommands(context: vscode.ExtensionContext, manager: InstanceManager, log: vscode.LogOutputChannel, refresh: () => void): void {
    const register = (id: string, fn: (arg: InstanceArg) => Promise<void>) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, async (arg: InstanceArg) => {
            try {
                await fn(arg);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log.error(message);
                void vscode.window.showErrorMessage(message);
            }
        }));
    const running = async () => (await manager.list()).filter(i => i.format === 'v2' && i.kind === 'redaxo' && (i.status === 'running' || i.status === 'partial'));
    const progress = <T>(title: string, task: (report: (m: string) => void) => Promise<T>) =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, p => task(m => p.report({ message: m })));

    register('redaxo-instances.checkUpdates', async arg => {
        const name = typeof arg === 'string' ? arg : arg?.instance?.name ?? (await vscode.window.showQuickPick((await running()).map(i => i.name), { placeHolder: l10n.t('Check add-on updates of which instance?') }));
        if (!name) {
            return;
        }
        const updates = await progress(l10n.t('Checking updates of {0}…', name), () => manager.listUpdates(name));
        if (!updates.length) {
            void vscode.window.showInformationMessage(l10n.t('{0}: everything is up to date.', name));
            return;
        }
        type Item = vscode.QuickPickItem & { update: PackageUpdate };
        const items: Item[] = updates.map(u => ({
            label: `${u.major || u.blocked || u.prerelease ? '$(warning)' : '$(arrow-up)'} ${u.key}`,
            description: describe(u),
            detail: u.name !== u.key ? u.name : undefined,
            picked: !u.major && !u.blocked && !u.prerelease,
            update: u,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true, matchOnDescription: true,
            title: l10n.t('{0}: {1} updates ({2} major)', name, updates.length, updates.filter(u => u.major).length),
            placeHolder: l10n.t('Major versions and pre-releases are not ticked – read their changelog first'),
        });
        if (!picked?.length) {
            return;
        }
        const withSnapshot = l10n.t('With snapshot');
        const without = l10n.t('Without snapshot');
        const answer = await vscode.window.showWarningMessage(l10n.t('Update {0} packages in "{1}"?', picked.length, name), {
            modal: true, detail: `${picked.map(p => `${p.update.key}: ${describe(p.update)}`).join('\n')}\n\n${l10n.t('A snapshot saves database and files first, so the update can be undone (Snapshots…).')}`,
        }, withSnapshot, without);
        if (!answer) {
            return;
        }
        const results = await progress(l10n.t('Updating {0}…', name), report => manager.updatePackages(name, picked.map(p => p.update.key), { snapshot: answer === withSnapshot }, report));
        for (const r of results) {
            log.info(`${name}: ${r.ok ? '✓' : '✗'} ${r.key}\n${r.output}`);
        }
        refresh();
        const failed = results.filter(r => !r.ok);
        const showLog = l10n.t('Show log');
        const message = failed.length
            ? l10n.t('{0}: {1} of {2} updated – not updated: {3}', name, results.length - failed.length, results.length, failed.map(f => f.key).join(', '))
            : l10n.t('{0}: {1} packages updated.', name, results.length);
        if (await (failed.length ? vscode.window.showWarningMessage(message, showLog) : vscode.window.showInformationMessage(message, showLog)) === showLog) {
            log.show(true);
        }
    });

    register('redaxo-instances.checkAllUpdates', async () => {
        const list = await running();
        if (!list.length) {
            void vscode.window.showInformationMessage(l10n.t('No REDAXO instance is running.'));
            return;
        }
        const rows = await progress(l10n.t('Checking updates of {0} instances…', list.length), async report => {
            const out: { instance: Instance; updates?: PackageUpdate[]; error?: string }[] = [];
            for (const i of list) {
                report(i.name);
                try {
                    out.push({ instance: i, updates: await manager.listUpdates(i.name) });
                } catch (error) {
                    out.push({ instance: i, error: error instanceof Error ? error.message : String(error) });
                }
            }
            return out;
        });
        const md = [`# ${l10n.t('Add-on updates')} – ${new Date().toLocaleString(vscode.env.language)}`, ''];
        for (const r of rows) {
            md.push(`## ${r.instance.name} (${r.instance.redaxo6 ? 'REDAXO 6' : `REDAXO ${r.instance.redaxoVersion ?? ''}`})`, '');
            if (r.error) {
                md.push(`> ${l10n.t('Error')}: ${r.error}`, '');
            } else if (!r.updates?.length) {
                md.push(l10n.t('Everything is up to date.'), '');
            } else {
                md.push(`| ${l10n.t('Package')} | ${l10n.t('Installed')} | ${l10n.t('Newest')} | |`, '|---|---|---|---|');
                for (const u of r.updates) {
                    md.push(`| ${u.key} | ${u.installed} | ${u.latest} | ${[u.blocked ? `composer.json: \`${u.constraint}\`` : '', u.major ? l10n.t('major version') : '', u.prerelease ? l10n.t('pre-release') : ''].filter(Boolean).join(', ')} |`);
                }
                md.push('');
            }
        }
        md.push(`*${l10n.t('Install: right-click an instance → Tools → Add-on Updates…')}*`);
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: md.join('\n') });
        await vscode.commands.executeCommand('markdown.showPreview', doc.uri).then(undefined, () => vscode.window.showTextDocument(doc));
    });
}
