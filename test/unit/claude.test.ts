import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { claudeProjectKey, isSessionId, listClaudeProjects, listClaudeSessions, moveClaudeSessions, parseSessionInfo, renameClaudeSession } from '../../src/core/claude';

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

    it('renames a session like /rename and can reset the name', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-claude-'));
        const id = '33333333-3333-4333-8333-333333333333';
        const dir = path.join(tmp, 'projects', claudeProjectKey('/x/shop'));
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, `${id}.jsonl`);
        await fs.writeFile(file, [line({ type: 'user', cwd: '/x/shop', message: { content: 'hi' } }), line({ type: 'ai-title', aiTitle: 'Erzeugt' })].join('\n'));
        const list = () => listClaudeSessions('/x/shop', 'project', 20, path.join(tmp, 'projects'));
        await renameClaudeSession({ id, file }, '  Navigation   bauen ');
        assert.equal((await list())[0].title, 'Navigation bauen');
        assert.match(await fs.readFile(file, 'utf8'), /\{"type":"custom-title","customTitle":"Navigation bauen","sessionId":"33333333-/);
        await renameClaudeSession({ id, file }, '');
        assert.equal((await list())[0].title, 'Erzeugt');
        await assert.rejects(renameClaudeSession({ id, file: path.join(dir, 'other.jsonl') }, 'x'));
        await fs.rm(tmp, { recursive: true, force: true });
    });
});

describe('moving claude sessions', () => {
    it('copies sessions and memory to the new folder with rewritten paths and keeps the source', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-move-'));
        const projects = path.join(tmp, 'projects');
        const oldDir = path.join(tmp, 'old', 'shop');
        const newDir = path.join(tmp, 'instances', 'shop');
        await fs.mkdir(newDir, { recursive: true });
        const fromKey = claudeProjectKey(oldDir);
        const src = path.join(projects, fromKey);
        await fs.mkdir(path.join(src, 'memory'), { recursive: true });
        const id = '44444444-4444-4444-8444-444444444444';
        await fs.writeFile(path.join(src, `${id}.jsonl`), [
            line({ type: 'user', cwd: oldDir, message: { content: `edit ${oldDir}/a.php and ${oldDir}2/b.php` } }),
            line({ type: 'ai-title', aiTitle: 'Shop' }),
        ].join('\n'));
        await fs.writeFile(path.join(src, 'memory', 'MEMORY.md'), '- [Note](note.md) — x\n');
        await fs.writeFile(path.join(src, 'memory', 'note.md'), `Code in ${oldDir}\n`);
        // target already has memory
        const dst = path.join(projects, claudeProjectKey(newDir));
        await fs.mkdir(path.join(dst, 'memory'), { recursive: true });
        await fs.writeFile(path.join(dst, 'memory', 'MEMORY.md'), '- [Other](other.md) — y\n');

        const orphan = (await listClaudeProjects(projects)).find(p => p.key === fromKey);
        assert.equal(orphan?.cwd, oldDir);
        assert.equal(orphan?.cwdExists, false);

        const r = await moveClaudeSessions(fromKey, oldDir, newDir, projects);
        assert.deepEqual([r.sessions, r.memory], [1, 2]);
        const moved = await fs.readFile(path.join(dst, `${id}.jsonl`), 'utf8');
        assert.match(moved, new RegExp(`"cwd":"${newDir.replace(/[/.]/g, '\\$&')}"`));
        assert.ok(moved.includes(`${newDir}/a.php`) && moved.includes(`${oldDir}2/b.php`), 'only whole paths are rewritten');
        assert.equal(await fs.readFile(path.join(dst, 'memory', 'MEMORY.md'), 'utf8'), '- [Other](other.md) — y\n- [Note](note.md) — x\n');
        assert.equal(await fs.readFile(path.join(dst, 'memory', 'note.md'), 'utf8'), `Code in ${newDir}\n`);
        assert.ok(await fs.stat(path.join(src, `${id}.jsonl`)), 'source stays');
        const sessions = await listClaudeSessions(newDir, 'project', 20, projects);
        assert.deepEqual(sessions.map(s => [s.title, s.cwd]), [['Shop', newDir]]);
        await fs.rm(tmp, { recursive: true, force: true });
    });
});
