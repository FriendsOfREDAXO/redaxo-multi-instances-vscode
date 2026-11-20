import * as assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalServers, detectServer, devCommand } from '../../src/core/localServers';

const STATIC_SERVER = path.join(__dirname, '..', '..', 'dist', 'static-server.js');

async function tmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'rmi-local-'));
}

async function write(dir: string, files: Record<string, string>): Promise<void> {
    for (const [file, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
        await fs.writeFile(path.join(dir, file), content);
    }
}

describe('local servers', () => {
    it('detects PHP front controllers, dev scripts and static sites', async () => {
        const php = await tmpDir();
        await write(php, { 'public/index.php': '<?php', 'composer.json': '{}' });
        assert.deepEqual(await detectServer(php), { kind: 'php', docroot: 'public', router: 'public/index.php', reason: 'public/index.php' });

        const vite = await tmpDir();
        await write(vite, { 'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }), 'index.html': '' });
        assert.equal((await detectServer(vite)).command, 'npm run dev -- --port $PORT --host 127.0.0.1');

        const html = await tmpDir();
        await write(html, { 'dist/index.html': '<h1>x</h1>' });
        assert.deepEqual(await detectServer(html), { kind: 'static', docroot: 'dist', reason: 'dist/index.html' });
    });

    it('binds well-known dev servers to IPv4 loopback', () => {
        assert.equal(devCommand('dev', 'next dev'), 'npm run dev -- -p $PORT -H 127.0.0.1');
        assert.equal(devCommand('dev', 'astro dev'), 'npm run dev -- --port $PORT --host 127.0.0.1');
        assert.equal(devCommand('start', 'node server.js'), 'npm run start -- --port $PORT');
    });

    it('validates names, folders and document roots', async () => {
        const instances = await tmpDir();
        const project = await tmpDir();
        const local = new LocalServers(() => instances);
        await assert.rejects(local.add({ name: 'Bad Name', kind: 'static', path: project, docroot: '' }), /Invalid name/);
        await assert.rejects(local.add({ name: 'site', kind: 'static', path: path.join(project, 'missing'), docroot: '' }), /Folder not found/);
        await assert.rejects(local.add({ name: 'site', kind: 'static', path: project, docroot: '../etc' }), /inside the project/);
        await assert.rejects(local.add({ name: 'site', kind: 'php', path: project, docroot: '' }), /PHP/);
        const s = await local.add({ name: 'site', kind: 'static', path: project, docroot: 'dist/', port: 18_431 });
        assert.equal(s.docroot, 'dist');
        assert.equal(s.directUrl, 'http://site.localhost:18431/');
        assert.deepEqual(s.hosts, ['site.localhost', '*.site.localhost']);
        await assert.rejects(local.add({ name: 'site', kind: 'static', path: project, docroot: '' }), /already exists/);
        await assert.rejects(local.add({ name: 'other', kind: 'static', path: project, docroot: '', port: 18_431 }), /already used/);
    });

    it('starts and stops the static server (detached, pid file, log)', async function () {
        if (!existsSync(STATIC_SERVER)) {
            this.skip(); // needs `npm run compile`
        }
        this.timeout(20_000);
        const instances = await tmpDir();
        const project = await tmpDir();
        await write(project, { 'index.html': '<html><body>Hallo</body></html>', 'about.html': 'about', 'css/a.css': 'body{}' });
        const local = new LocalServers(() => instances, () => STATIC_SERVER);
        const { port } = await local.add({ name: 'site', kind: 'static', path: project, docroot: '' });
        const started = await local.start('site');
        try {
            assert.equal(started.status, 'running');
            const home = await fetch(`http://127.0.0.1:${port}/`);
            assert.equal(home.status, 200);
            assert.match(await home.text(), /Hallo<script>.*__rmi-live.*<\/script><\/body>/);
            assert.equal((await fetch(`http://127.0.0.1:${port}/about`)).status, 200);
            assert.equal((await fetch(`http://127.0.0.1:${port}/css/a.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
            assert.equal((await fetch(`http://127.0.0.1:${port}/css`, { redirect: 'manual' })).status, 301);
            assert.equal((await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
        } finally {
            await local.stop('site');
        }
        assert.equal((await local.get('site')).status, 'stopped');
        assert.match(await local.log('site'), /GET \/ 200/);
    });
});
