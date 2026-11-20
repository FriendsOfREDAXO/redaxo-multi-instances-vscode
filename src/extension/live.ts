import * as path from 'node:path';
import * as vscode from 'vscode';
import { InstanceManager } from '../core/manager';
import { Instance } from '../core/model';
import { ChangedFile, RemoteProfile, compare, deploy, inspectRemote, remoteFile, validateRemoteProfile } from '../core/remote';

const l10n = vscode.l10n;
const SCHEME = 'redaxo-live';

type InstanceArg = string | { instance?: { name: string } } | undefined;

/**
 * Live server commands of an instance: set up (SSH target, path, PHP, host names), compare (with file diffs), pull the
 * live state (database, media) and deploy code (preview, selection, confirmation, backup on the server).
 */
export function registerLiveCommands(context: vscode.ExtensionContext, manager: InstanceManager, log: vscode.LogOutputChannel, refresh: () => void): void {
    // remote file contents for vscode.diff: redaxo-live://<instance>/<path>
    const remote = new Map<string, string>();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: uri => remote.get(uri.toString()) ?? '' }));

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

    const instanceOf = async (arg: InstanceArg, placeHolder: string): Promise<Instance | undefined> => {
        const name = typeof arg === 'string' ? arg : arg?.instance?.name;
        if (name) {
            return manager.get(name);
        }
        const list = (await manager.list()).filter(i => i.format === 'v2');
        const picked = await vscode.window.showQuickPick(list.map(i => ({ label: i.name, description: i.path })), { placeHolder });
        return picked ? list.find(i => i.name === picked.label) : undefined;
    };

    const profileOf = async (i: Instance): Promise<RemoteProfile | undefined> => {
        const p = await manager.remoteProfile(i.name);
        if (!p) {
            const setup = l10n.t('Set up live server…');
            if (await vscode.window.showInformationMessage(l10n.t('No live server is set up for "{0}" yet.', i.name), setup) === setup) {
                await vscode.commands.executeCommand('redaxo-instances.setupLiveServer', i.name);
            }
        }
        return p;
    };

    const progress = <T>(title: string, task: (report: (m: string) => void) => Promise<T>) =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, p => task(m => p.report({ message: m })));

    register('redaxo-instances.setupLiveServer', async arg => {
        const i = await instanceOf(arg, l10n.t('Set up the live server of which instance?'));
        if (!i) {
            return;
        }
        const current = await manager.remoteProfile(i.name);
        const host = (await vscode.window.showInputBox({
            title: l10n.t('Live server of {0} (1/4): SSH', i.name), value: current?.host ?? '', placeHolder: 'user@example.org',
            prompt: l10n.t('user@host or a host from ~/.ssh/config. Login with your SSH key – passwords are never stored.'),
            validateInput: v => (/^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$/.test(v.trim()) ? undefined : l10n.t('user@host or a host alias')),
        }))?.trim();
        if (!host) {
            return;
        }
        const remotePath = (await vscode.window.showInputBox({
            title: l10n.t('Live server of {0} (2/4): folder', i.name), value: current?.path ?? 'httpdocs',
            prompt: l10n.t('Folder on the server that matches the local web root {0} (relative to the SSH home or absolute)', path.basename(i.webrootPath)),
        }))?.trim();
        if (!remotePath) {
            return;
        }
        const php = (await vscode.window.showInputBox({
            title: l10n.t('Live server of {0} (3/4): PHP', i.name), value: current?.php ?? 'php',
            prompt: l10n.t('PHP CLI on the server, e.g. /opt/plesk/php/8.4/bin/php on Plesk'),
        }))?.trim();
        if (!php) {
            return;
        }
        let profile: RemoteProfile = { schema: 1, host, path: remotePath, php, domainMap: current?.domainMap ?? {}, exclude: current?.exclude ?? [], afterDeploy: current?.afterDeploy ?? [], respectGitignore: current?.respectGitignore };
        const errors = validateRemoteProfile(profile);
        if (errors.length) {
            throw new Error(errors.join('\n'));
        }
        const info = await progress(l10n.t('Connecting to {0}…', host), () => inspectRemote(profile));
        if (!info.console) {
            throw new Error(l10n.t('No REDAXO console found in {0} on the server – is the folder right?', info.path));
        }
        profile = { ...profile, console: info.console, media: info.media };
        if (!profile.afterDeploy.length) {
            profile.afterDeploy = i.redaxo6 ? ['{php} {console} cache:clear', '{php} {console} migrate -n', '{php} {console} cache:clear'] : ['{php} {console} cache:clear'];
        }
        const mapText = await vscode.window.showInputBox({
            title: l10n.t('Live server of {0} (4/4): host names', i.name),
            value: Object.entries(profile.domainMap).map(([a, b]) => `${a}=${b}`).join(', '),
            placeHolder: `www.example.org=${i.name}.localhost, shop.example.org=shop.${i.name}.localhost`,
            prompt: l10n.t('Live host = local host, separated by commas – rewritten when the live database is pulled (YRewrite, URL add-on, consent, settings). May stay empty.'),
        });
        if (mapText === undefined) {
            return;
        }
        profile.domainMap = Object.fromEntries(mapText.split(',').map(x => x.split('=').map(y => y.trim().toLowerCase())).filter(x => x.length === 2 && x[0] && x[1]) as [string, string][]);
        await manager.saveRemoteProfile(i.name, profile);
        refresh();
        void vscode.window.showInformationMessage(l10n.t('Live server of {0} saved: REDAXO {1}, PHP {2}, console {3}, media {4}.', i.name,
            info.redaxoVersion ?? '?', info.phpVersion ?? '?', info.console, info.media ?? '—'));
    });

    const showChanges = async (i: Instance, p: RemoteProfile, files: ChangedFile[], title: string, canPickMany: boolean): Promise<ChangedFile[] | undefined> => {
        const label = (c: ChangedFile['change']) => (c === 'new' ? l10n.t('only local') : c === 'changed' ? l10n.t('changed') : l10n.t('only on the server'));
        const icon = (c: ChangedFile['change']) => (c === 'new' ? '$(diff-added)' : c === 'changed' ? '$(diff-modified)' : '$(diff-removed)');
        type Item = vscode.QuickPickItem & { file: ChangedFile };
        const items: Item[] = files.map(f => ({ label: `${icon(f.change)} ${f.path}`, description: label(f.change), file: f, picked: canPickMany }));
        const qp = vscode.window.createQuickPick<Item>();
        qp.title = title;
        qp.items = items;
        qp.canSelectMany = canPickMany;
        qp.matchOnDescription = true;
        qp.placeholder = canPickMany ? l10n.t('Files to deploy – Enter to continue') : l10n.t('Pick a file to see the difference');
        if (canPickMany) {
            qp.selectedItems = items;
        }
        qp.buttons = [];
        const diff = async (f: ChangedFile) => {
            const uri = vscode.Uri.from({ scheme: SCHEME, authority: i.name, path: `/${f.path}` });
            remote.set(uri.toString(), f.change === 'new' ? '' : await remoteFile(p, f.path).catch(e => `(${String(e)})`));
            const local = f.change === 'only-remote' ? vscode.Uri.from({ scheme: SCHEME, authority: `${i.name}-empty`, path: `/${f.path}` }) : vscode.Uri.file(path.join(i.webrootPath, f.path));
            await vscode.commands.executeCommand('vscode.diff', uri, local, `${f.path} (${l10n.t('live')} ↔ ${l10n.t('local')})`, { preview: true, preserveFocus: canPickMany });
        };
        return new Promise(resolve => {
            qp.onDidAccept(async () => {
                if (canPickMany) {
                    resolve(qp.selectedItems.map(x => x.file));
                    qp.hide();
                } else if (qp.selectedItems[0]) {
                    await diff(qp.selectedItems[0].file);
                }
            });
            qp.onDidHide(() => {
                resolve(undefined);
                qp.dispose();
            });
            qp.show();
        });
    };

    register('redaxo-instances.compareWithLive', async arg => {
        const i = await instanceOf(arg, l10n.t('Compare which instance with its live server?'));
        const p = i && await profileOf(i);
        if (!i || !p) {
            return;
        }
        const files = await progress(l10n.t('Comparing {0} with {1}…', i.name, p.host), () => compare(p, i.webrootPath));
        if (!files.length) {
            void vscode.window.showInformationMessage(l10n.t('{0}: local files and live server are the same.', i.name));
            return;
        }
        const n = (c: ChangedFile['change']) => files.filter(f => f.change === c).length;
        await showChanges(i, p, files, l10n.t('{0} ↔ {1}: {2} only local, {3} changed, {4} only on the server', i.name, p.host, n('new'), n('changed'), n('only-remote')), false);
    });

    register('redaxo-instances.pullLive', async arg => {
        const i = await instanceOf(arg, l10n.t('Pull the live state into which instance?'));
        const p = i && await profileOf(i);
        if (!i || !p) {
            return;
        }
        const db = { label: `$(database) ${l10n.t('Database')}`, detail: l10n.t('Replaces the local database with the live one (the local one is saved in backups/ first), host names are rewritten.'), picked: true, key: 'database' as const };
        const media = { label: `$(file-media) ${l10n.t('Media')}`, detail: l10n.t('Copies new and changed media from the server. Nothing is deleted locally.'), picked: true, key: 'media' as const };
        const picked = await vscode.window.showQuickPick([db, media], { canPickMany: true, title: l10n.t('Pull from {0} into {1}', p.host, i.name) });
        if (!picked?.length) {
            return;
        }
        const what = { database: picked.some(x => x.key === 'database'), media: picked.some(x => x.key === 'media') };
        if (what.database) {
            const go = l10n.t('Replace local database');
            const answer = await vscode.window.showWarningMessage(l10n.t('Replace the database of "{0}" with the live database from {1}?', i.name, p.host),
                { modal: true, detail: l10n.t('Local content that is not on the server is lost – the current database is saved to backups/ before.') }, go);
            if (answer !== go) {
                return;
            }
        }
        const r = await progress(l10n.t('Pulling the live state into {0}…', i.name), report => manager.pullLive(i.name, what, report));
        refresh();
        const parts = [
            ...(r.dumpBytes !== undefined ? [l10n.t('database ({0} MB)', (r.dumpBytes / 1024 / 1024).toFixed(1))] : []),
            ...(r.media !== undefined ? [l10n.t('{0} media files', r.media)] : []),
        ];
        const open = l10n.t('Open');
        if (await vscode.window.showInformationMessage(l10n.t('Live state pulled into {0}: {1}.', i.name, parts.join(', ')), open) === open) {
            void vscode.env.openExternal(vscode.Uri.parse(i.urls.frontend));
        }
    });

    register('redaxo-instances.deployToLive', async arg => {
        const i = await instanceOf(arg, l10n.t('Deploy which instance to its live server?'));
        const p = i && await profileOf(i);
        if (!i || !p) {
            return;
        }
        const dry = await progress(l10n.t('Preparing the deploy of {0} (dry run)…', i.name), () => deploy(p, i.webrootPath, { dryRun: true }));
        if (!dry.files.length) {
            void vscode.window.showInformationMessage(l10n.t('{0}: nothing to deploy – the live server has the same files.', i.name));
            return;
        }
        const files = await showChanges(i, p, dry.files, l10n.t('Deploy {0} → {1}: pick the files', i.name, p.host), true);
        if (!files?.length) {
            return;
        }
        const go = l10n.t('Deploy {0} files', files.length);
        const detail = [
            l10n.t('Only these files are transferred – no database, no media, no local configuration. Nothing is deleted on the server.'),
            l10n.t('Overwritten files are kept on the server in ~/backup-deploy-<time>/files.'),
            ...(p.afterDeploy.length ? [l10n.t('Afterwards: {0}', p.afterDeploy.join(' · '))] : []),
        ].join('\n\n');
        if (await vscode.window.showWarningMessage(l10n.t('Deploy {0} files to {1}:{2}?', files.length, p.host, p.path), { modal: true, detail }, go) !== go) {
            return;
        }
        const result = await progress(l10n.t('Deploying {0}…', i.name), () => deploy(p, i.webrootPath, { onlyFiles: files.map(f => f.path) }));
        log.info(`Deploy ${i.name} → ${p.host}:${p.path}: ${result.files.length} files, backup ${result.backupDir}`);
        for (const a of result.afterDeploy) {
            log.info(`${a.ok ? '✓' : '✗'} ${a.command}\n${a.output}`);
        }
        const failed = result.afterDeploy.find(a => !a.ok);
        const showLog = l10n.t('Show log');
        const message = failed
            ? l10n.t('{0} files deployed (backup {1}), but "{2}" failed on the server.', result.files.length, result.backupDir ?? '—', failed.command)
            : l10n.t('{0} files deployed to {1} (backup {2}).', result.files.length, p.host, result.backupDir ?? '—');
        const answer = await (failed ? vscode.window.showErrorMessage(message, showLog) : vscode.window.showInformationMessage(message, showLog));
        if (answer === showLog) {
            log.show(true);
        }
    });
}
