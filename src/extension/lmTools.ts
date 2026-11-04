import * as vscode from 'vscode';
import { InstanceManager } from '../core/manager';
import { TOOL_DEFINITIONS, ToolDefinition } from '../core/tools';

const l10n = vscode.l10n;

export const LM_TOOL_PREFIX = 'redaxo_';

function confirmation(tool: ToolDefinition, input: Record<string, unknown>): vscode.LanguageModelToolConfirmationMessages | undefined {
    if (!tool.mutating) {
        return undefined;
    }
    // read-only SQL needs no confirmation
    if (tool.name === 'query_database' && input.allowWrite !== true) {
        return undefined;
    }
    const target = typeof input.name === 'string' ? input.name : '';
    const details = Object.entries(input)
        .filter(([k]) => k !== 'name')
        .map(([k, v]) => `- **${k}:** \`${typeof v === 'string' ? v : JSON.stringify(v)}\``)
        .join('\n');
    return {
        title: `${tool.title}${target ? `: ${target}` : ''}`,
        message: new vscode.MarkdownString(details || tool.description),
    };
}

/** Registers every shared tool definition as VS Code language model tool (`redaxo_<name>`). */
export function registerLanguageModelTools(context: vscode.ExtensionContext, manager: InstanceManager, onChange: () => void): void {
    if (!vscode.lm?.registerTool) {
        return;
    }
    for (const tool of TOOL_DEFINITIONS) {
        context.subscriptions.push(vscode.lm.registerTool<Record<string, unknown>>(`${LM_TOOL_PREFIX}${tool.name}`, {
            prepareInvocation(options) {
                const input = options.input ?? {};
                return {
                    invocationMessage: l10n.t('{0} {1}', tool.title, typeof input.name === 'string' ? input.name : '').trim(),
                    confirmationMessages: confirmation(tool, input),
                };
            },
            async invoke(options, token) {
                if (token.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }
                try {
                    const text = await tool.run(manager, options.input ?? {});
                    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
                } finally {
                    if (tool.mutating) {
                        onChange();
                    }
                }
            },
        }));
    }
}
