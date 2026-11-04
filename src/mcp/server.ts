/**
 * MCP server (stdio) for Claude Code, Claude Desktop and other MCP clients.
 * Shares all logic with the VS Code extension via src/core.
 *
 *   claude mcp add --scope user redaxo-instances -- node <path>/mcp-server.js
 *
 * Settings are read from the file written by the extension (see sharedSettingsFile()),
 * or from REDAXO_INSTANCES_DIR.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '../core/docker';
import { InstanceManager } from '../core/manager';
import { CoreSettings, readSharedSettings, sharedSettingsFile } from '../core/settings';
import { TOOL_DEFINITIONS, findTool } from '../core/tools';

declare const EXTENSION_VERSION: string;

// stdout belongs to the protocol – log to stderr only
const log: Logger = {
    info: m => process.stderr.write(`[info] ${m}\n`),
    warn: m => process.stderr.write(`[warn] ${m}\n`),
    error: m => process.stderr.write(`[error] ${m}\n`),
    trace: () => {},
};

export async function main(): Promise<void> {
    let settings: CoreSettings | undefined = await readSharedSettings();
    const manager = new InstanceManager(() => {
        if (!settings) {
            throw new Error(`No instances folder configured. Open VS Code with the REDAXO Multi-Instances extension once, or set REDAXO_INSTANCES_DIR. (expected ${sharedSettingsFile()})`);
        }
        return settings;
    }, log);

    const server = new Server(
        { name: 'redaxo-instances', version: typeof EXTENSION_VERSION === 'string' ? EXTENSION_VERSION : '0.0.0' },
        {
            capabilities: { tools: {} },
            instructions: 'Manages local REDAXO CMS / PHP development instances running in Docker. '
                + 'Use list_instances first to find instance names. Instances are reachable via https://<name>.localhost. '
                + 'Prefer redaxo_console for REDAXO tasks (cache, packages) and query_database for read-only SQL.',
        },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOL_DEFINITIONS.map(t => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: {
                title: t.title,
                readOnlyHint: !t.mutating,
                destructiveHint: false,
                openWorldHint: false,
            },
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async request => {
        const tool = findTool(request.params.name);
        if (!tool) {
            return { content: [{ type: 'text', text: `Unknown tool ${request.params.name}` }], isError: true };
        }
        // pick up changes made in VS Code (instances folder, ports) without restarting
        settings = (await readSharedSettings()) ?? settings;
        try {
            const text = await tool.run(manager, (request.params.arguments ?? {}) as Record<string, unknown>);
            return { content: [{ type: 'text', text }] };
        } catch (error) {
            return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
    });

    await server.connect(new StdioServerTransport());
    log.info(`REDAXO Multi-Instances MCP server ready (${settings?.instancesDir ?? 'no instances folder'})`);
}

main().catch(error => {
    log.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
