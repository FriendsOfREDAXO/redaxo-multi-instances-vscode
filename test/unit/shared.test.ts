import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Docker, silentLogger } from '../../src/core/docker';
import { SHARED_DIR } from '../../src/core/model';
import { withDefaults } from '../../src/core/settings';
import { SharedServices } from '../../src/core/shared';

describe('shared services state', () => {
    it('picks up port changes made by another process (extension ↔ MCP server)', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-shared-'));
        try {
            const state = path.join(dir, SHARED_DIR, 'state.json');
            await fs.mkdir(path.dirname(state), { recursive: true });
            const write = async (https: number, mtime: number) => {
                await fs.writeFile(state, JSON.stringify({ ports: { proxyHttp: 8880, proxyHttps: https, mailpit: 8026, adminer: 9200 } }));
                await fs.utimes(state, mtime, mtime);
            };
            await write(8843, 1_000);
            const shared = new SharedServices(() => new Docker('docker', silentLogger), () => withDefaults({ instancesDir: dir }), silentLogger);
            assert.equal((await shared.ports()).proxyHttps, 8843);
            await write(443, 2_000);
            assert.equal((await shared.ports()).proxyHttps, 443);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
