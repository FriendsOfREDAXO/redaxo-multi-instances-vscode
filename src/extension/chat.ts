import * as vscode from 'vscode';
import { resultToMarkdown } from '../core/database';
import { InstanceManager } from '../core/manager';
import { describeInstance, splitArgs } from '../core/tools';
import { LM_TOOL_PREFIX } from './lmTools';

const l10n = vscode.l10n;

const SYSTEM_PROMPT = `You are the REDAXO assistant inside VS Code. You manage local REDAXO CMS / PHP development
instances running in Docker with the redaxo_* tools. Rules:
- Find instance names with redaxo_list_instances before acting on an instance.
- Prefer redaxo_redaxo_console for REDAXO tasks (cache, packages, users) and redaxo_query_database for reading data
  (REDAXO tables use the prefix rex_). Only write to the database when the user explicitly asks for it.
- Never print passwords unless the user explicitly asks for them.
- Answer in the language of the user, concise, with Markdown.`;

/** `@redaxo` chat participant: slash commands for quick actions, free text uses the redaxo_* tools. */
export function registerChatParticipant(context: vscode.ExtensionContext, manager: InstanceManager, onChange: () => void): void {
    if (!vscode.chat?.createChatParticipant) {
        return;
    }

    async function instanceName(token: string | undefined, stream: vscode.ChatResponseStream): Promise<string | undefined> {
        const list = await manager.list({ withStatus: false });
        if (token && list.some(i => i.name === token)) {
            return token;
        }
        if (!token && list.length === 1) {
            return list[0].name;
        }
        stream.markdown(token
            ? l10n.t('Instance "{0}" not found. ', token)
            : l10n.t('Please name the instance. '));
        stream.markdown(list.length ? l10n.t('Available: {0}', list.map(i => `\`${i.name}\``).join(', ')) : l10n.t('There are no instances yet.'));
        return undefined;
    }

    async function slash(request: vscode.ChatRequest, stream: vscode.ChatResponseStream): Promise<void> {
        const [first, ...rest] = request.prompt.trim().split(/\s+/).filter(Boolean);
        const restText = request.prompt.trim().slice(first?.length ?? 0).trim();
        switch (request.command) {
            case 'help':
                stream.markdown([
                    l10n.t('**@redaxo** manages your local REDAXO instances. Commands:'),
                    '',
                    '- `/list` – ' + l10n.t('all instances with status and URL'),
                    '- `/info <name>` – ' + l10n.t('URLs, containers, database connection'),
                    '- `/start <name>` · `/stop <name>`',
                    '- `/console <name> cache:clear` – ' + l10n.t('REDAXO console'),
                    '- `/query <name> SELECT …` – ' + l10n.t('read-only SQL'),
                    '- `/addons <name>` · `/articles <name>` · `/logs <name>`',
                    '- `/create` – ' + l10n.t('wizard for a new instance'),
                    '',
                    l10n.t('Or just ask, e.g. "Install YForm in shop and clear the cache" or "Are there PHP errors in shop?".'),
                    l10n.t('In agent mode the #redaxo-… tools are available; Claude Code can use the same tools via MCP.'),
                ].join('\n'));
                stream.button({ command: 'redaxo-instances.showHelp', title: l10n.t('Open help') });
                stream.button({ command: 'redaxo-instances.setupClaude', title: l10n.t('Connect Claude (MCP)') });
                return;
            case 'list': {
                const list = await manager.list();
                if (!list.length) {
                    stream.markdown(l10n.t('There are no instances yet.'));
                    stream.button({ command: 'redaxo-instances.createInstance', title: l10n.t('Create instance') });
                    return;
                }
                stream.markdown(['| | PHP | MariaDB | URL |', '|---|---|---|---|',
                    ...list.map(i => `| ${i.status === 'running' ? '🟢' : '⚪'} **${i.name}** | ${i.php} | ${i.mariadb} | ${i.urls.frontend} |`)].join('\n'));
                return;
            }
            case 'info':
            case 'config': {
                const name = await instanceName(first, stream);
                if (name) {
                    stream.markdown(describeInstance(await manager.get(name)));
                }
                return;
            }
            case 'create':
                stream.markdown(l10n.t('Opening the wizard for a new instance…'));
                await vscode.commands.executeCommand('redaxo-instances.createInstance');
                return;
            case 'start':
            case 'stop': {
                const name = await instanceName(first, stream);
                if (!name) {
                    return;
                }
                stream.progress(request.command === 'start' ? l10n.t('Starting {0}…', name) : l10n.t('Stopping {0}…', name));
                if (request.command === 'start') {
                    const res = await manager.start(name, m => stream.progress(m));
                    const i = await manager.get(name);
                    stream.markdown(l10n.t('{0} is running: {1}', name, i.urls.frontend));
                    for (const w of res.warnings) {
                        stream.markdown(`\n\n⚠️ ${w}`);
                    }
                } else {
                    await manager.stop(name);
                    stream.markdown(l10n.t('{0} stopped.', name));
                }
                onChange();
                return;
            }
            case 'console':
            case 'addons': {
                const name = await instanceName(first, stream);
                if (!name) {
                    return;
                }
                const args = request.command === 'addons' ? ['package:list'] : splitArgs(rest.join(' ') || 'list');
                stream.progress(`console ${args.join(' ')}`);
                const res = await manager.console(name, args);
                stream.markdown(`\`\`\`text\n${res.output.slice(-15_000)}\n\`\`\``);
                return;
            }
            case 'query':
            case 'articles': {
                const name = await instanceName(first, stream);
                if (!name) {
                    return;
                }
                const sql = request.command === 'articles'
                    ? 'SELECT id, parent_id, name, status, clang_id FROM rex_article ORDER BY parent_id, priority LIMIT 100'
                    : restText.slice(name.length).trim() || restText;
                const result = await manager.query(name, sql, { readOnly: true, maxRows: 100 });
                stream.markdown(resultToMarkdown(result));
                return;
            }
            case 'logs': {
                const name = await instanceName(first, stream);
                if (name) {
                    stream.markdown(`\`\`\`text\n${(await manager.logs(name, { tail: 80 })).slice(-15_000)}\n\`\`\``);
                }
                return;
            }
            case 'install-tools':
                stream.markdown(l10n.t('Instances already include Composer, git, the mariadb client, ImageMagick, libvips, Poppler, Ghostscript and ffmpeg.'));
                return;
        }
    }

    async function toolLoop(request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
        const tools = vscode.lm.tools.filter(t => t.name.startsWith(LM_TOOL_PREFIX));
        const messages: vscode.LanguageModelChatMessage[] = [vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)];
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            } else if (turn instanceof vscode.ChatResponseTurn) {
                const text = turn.response.map(p => (p instanceof vscode.ChatResponseMarkdownPart ? p.value.value : '')).join('');
                if (text) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(text));
                }
            }
        }
        messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

        for (let round = 0; round < 10 && !token.isCancellationRequested; round++) {
            const response = await request.model.sendRequest(messages, { tools }, token);
            const calls: vscode.LanguageModelToolCallPart[] = [];
            const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
            for await (const part of response.stream) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    stream.markdown(part.value);
                    parts.push(part);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    calls.push(part);
                    parts.push(part);
                }
            }
            if (calls.length === 0) {
                return;
            }
            messages.push(vscode.LanguageModelChatMessage.Assistant(parts));
            const results: vscode.LanguageModelToolResultPart[] = [];
            for (const call of calls) {
                try {
                    const result = await vscode.lm.invokeTool(call.name, { input: call.input, toolInvocationToken: request.toolInvocationToken }, token);
                    results.push(new vscode.LanguageModelToolResultPart(call.callId, result.content));
                } catch (error) {
                    results.push(new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart(`Error: ${error instanceof Error ? error.message : String(error)}`)]));
                }
            }
            messages.push(vscode.LanguageModelChatMessage.User(results));
        }
    }

    const participant = vscode.chat.createChatParticipant('redaxo-instances.chat', async (request, chatContext, stream, token) => {
        try {
            if (request.command) {
                await slash(request, stream);
            } else {
                await toolLoop(request, chatContext, stream, token);
            }
        } catch (error) {
            stream.markdown(`\n\n❌ ${error instanceof Error ? error.message : String(error)}`);
        }
        return {};
    });
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
    participant.followupProvider = {
        provideFollowups: () => [
            { prompt: '', command: 'list', label: l10n.t('Show all instances') },
        ],
    };
    context.subscriptions.push(participant);
}
