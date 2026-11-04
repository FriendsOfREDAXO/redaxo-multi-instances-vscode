import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOL_DEFINITIONS } from '../../src/core/tools';

describe('MCP server (stdio)', function () {
    this.timeout(60_000);
    let dir: string;
    let client: Client;

    before(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-mcp-'));
        await fs.mkdir(path.join(dir, 'instances'));
        client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(new StdioClientTransport({
            command: process.execPath,
            args: [require.resolve('tsx/cli'), path.join(__dirname, '..', '..', 'src', 'mcp', 'server.ts')],
            env: { ...process.env, REDAXO_MI_CONFIG_DIR: dir, REDAXO_INSTANCES_DIR: path.join(dir, 'instances') } as Record<string, string>,
            stderr: 'ignore',
        }));
    });

    after(async () => {
        await client?.close();
        await fs.rm(dir, { recursive: true, force: true });
    });

    it('lists all tools with annotations', async () => {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(t => t.name).sort(), TOOL_DEFINITIONS.map(t => t.name).sort());
        const list = tools.find(t => t.name === 'list_instances')!;
        assert.equal(list.annotations?.readOnlyHint, true);
        assert.equal(tools.find(t => t.name === 'create_instance')!.annotations?.readOnlyHint, false);
    });

    it('calls tools', async () => {
        const res = await client.callTool({ name: 'list_instances', arguments: {} });
        assert.match(JSON.stringify(res.content), /No instances found/);
        const versions = await client.callTool({ name: 'list_versions', arguments: {} });
        assert.match(JSON.stringify(versions.content), /PHP: 8\.6/);
    });

    it('reports errors as tool errors', async () => {
        const res = await client.callTool({ name: 'get_instance', arguments: { name: 'missing' } });
        assert.equal(res.isError, true);
        assert.match(JSON.stringify(res.content), /not found/);
    });
});
