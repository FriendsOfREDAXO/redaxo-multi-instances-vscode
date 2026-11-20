import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { claudeProjectKey, isSessionId, listClaudeSessions, parseSessionInfo } from '../../src/core/claude';

const line = (o: object) => JSON.stringify(o);

describe('claude sessions', () => {
    it('names project folders like Claude Code', () => {
        assert.equal(claudeProjectKey('/Users/me/redaxo_instances/shop'), '-Users-me-redaxo-instances-shop');
        assert.equal(claudeProjectKey('/Users/me/redaxo_instances/shop.de/project'), '-Users-me-redaxo-instances-shop-de-project');
    });

    it('accepts only session ids', () => {
        assert.ok(isSessionId('387cf12e-223b-4e12-a5a4-f1c36db02a41'));
        assert.ok(!isSessionId('387cf12e; rm -rf ~'));
    });

    it('prefers a custom title over the generated one and the first prompt', () => {
        const head = [
            line({ type: 'user', cwd: '/x', message: { content: '<command-name>/init</command-name>' } }),
            line({ type: 'user', cwd: '/x', message: { content: [{ type: 'text', text: 'Bitte  das Menü\nreparieren' }] } }),
            line({ type: 'ai-title', aiTitle: 'Menü reparieren' }),
        ].join('\n');
        assert.deepEqual(parseSessionInfo(head), { title: 'Menü reparieren', cwd: '/x', hasMessages: true });
        assert.equal(parseSessionInfo(head, line({ type: 'custom-title', customTitle: 'Navi' })).title, 'Navi');
        assert.equal(parseSessionInfo(head.split('\n').slice(0, 2).join('\n')).title, 'Bitte das Menü reparieren');
    });

    it('ignores cut lines and sessions without messages', () => {
        assert.deepEqual(parseSessionInfo('{"type":"us\n' + line({ type: 'file-history-snapshot' })), { title: '', cwd: undefined, hasMessages: false });
    });

    it('lists sessions of the instance folder and its web root, newest first', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-claude-'));
        const instance = path.join(tmp, 'instances', 'shop');
        const write = async (dir: string, id: string, title: string, mtime: Date) => {
            const folder = path.join(tmp, 'projects', claudeProjectKey(dir));
            await fs.mkdir(folder, { recursive: true });
            const file = path.join(folder, `${id}.jsonl`);
            await fs.writeFile(file, [line({ type: 'user', cwd: dir, message: { content: 'hi' } }), line({ type: 'ai-title', aiTitle: title })].join('\n'));
            await fs.utimes(file, mtime, mtime);
        };
        await write(instance, '11111111-1111-4111-8111-111111111111', 'alt', new Date('2026-01-01'));
        await write(path.join(instance, 'project'), '22222222-2222-4222-8222-222222222222', 'neu', new Date('2026-02-01'));
        await fs.writeFile(path.join(tmp, 'projects', claudeProjectKey(instance), 'notes.jsonl'), '');
        const sessions = await listClaudeSessions(instance, 'project', 20, path.join(tmp, 'projects'));
        assert.deepEqual(sessions.map(s => [s.title, s.cwd]), [['neu', path.join(instance, 'project')], ['alt', instance]]);
        await fs.rm(tmp, { recursive: true, force: true });
    });
});
