/**
 * End-to-end tests against a real Docker daemon (slow – builds images, installs REDAXO).
 *
 *   npm run test:e2e                  # temp instances folder, everything is removed afterwards
 *   REDAXO_E2E_KEEP=1 npm run test:e2e  # keep instances for manual inspection
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectMkcert } from '../../src/core/certs';
import { run } from '../../src/core/exec';
import { InstanceError, InstanceManager } from '../../src/core/manager';
import { parsePhpErrorLine, toProblem } from '../../src/core/problems';
import { withDefaults } from '../../src/core/settings';
import { DockerComposeGenerator } from './legacy/dockerCompose';
import { legacyCustomCompose, legacyCustomEnv } from './legacy/emptyInstance';
import { SetupTemplates } from './legacy/templates';

const logLines: string[] = [];
const log = {
    info: (m: string) => logLines.push(`[info] ${m}`),
    warn: (m: string) => logLines.push(`[warn] ${m}`),
    error: (m: string) => logLines.push(`[error] ${m}`),
    trace: () => {},
};

let dir: string;
let manager: InstanceManager;
let caFile: string | undefined;

async function curl(url: string, extra: string[] = []): Promise<{ status: number; body: string }> {
    const args = ['-s', '-S', '--max-time', '30', '-w', '\n%{http_code}', ...(caFile ? ['--cacert', caFile] : ['-k']), ...extra, url];
    const res = await run('curl', args, { allowFailure: true });
    const idx = res.stdout.lastIndexOf('\n');
    return { status: parseInt(res.stdout.slice(idx + 1), 10) || 0, body: res.stdout.slice(0, idx) };
}

async function containerPhp(container: string): Promise<string> {
    return (await run('docker', ['exec', container, 'php', '-r', 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;'])).stdout.trim();
}

async function proxyBase(host: string): Promise<string> {
    const ports = await manager.shared.ports();
    return `https://${host}${ports.proxyHttps === 443 ? '' : `:${ports.proxyHttps}`}`;
}

const TEST_PHP = `<?php
if (isset($_GET['mail'])) {
    $ok = mail('test@example.com', 'rmi-e2e-' . $_GET['mail'], 'hello from e2e');
}
header('Content-Type: application/json');
echo json_encode(['https' => $_SERVER['HTTPS'] ?? null, 'host' => $_SERVER['HTTP_HOST'] ?? null,
    'php' => PHP_VERSION, 'remote' => $_SERVER['REMOTE_ADDR'] ?? null, 'mail' => $ok ?? null,
    'ext' => array_values(array_intersect(['gd', 'imagick', 'intl', 'xdebug', 'ffi', 'mbstring', 'pdo_mysql'], array_map('strtolower', get_loaded_extensions())))]);
`;

describe('core e2e (Docker)', function () {
    this.timeout(30 * 60_000);

    before(async () => {
        dir = process.env.REDAXO_E2E_DIR ?? await fs.mkdtemp(path.join(os.tmpdir(), 'redaxo-mi-e2e-'));
        await fs.mkdir(dir, { recursive: true });
        manager = new InstanceManager(() => withDefaults({ instancesDir: dir, lang: 'de_de', timezone: 'Europe/Berlin' }), log);
        const mk = await detectMkcert();
        caFile = mk.caRoot ? path.join(mk.caRoot, 'rootCA.pem') : undefined;
    });

    after(async () => {
        if (process.env.REDAXO_E2E_KEEP) {
            console.log(`instances kept in ${dir}`);
            return;
        }
        for (const i of await manager.list({ withStatus: false })) {
            await manager.remove(i.name).catch(() => {});
        }
        await run('docker', ['compose', 'down', '-v'], { cwd: manager.shared.dir, allowFailure: true });
        await fs.rm(dir, { recursive: true, force: true });
    });

    afterEach(function () {
        if (this.currentTest?.state === 'failed') {
            console.log(logLines.slice(-40).join('\n'));
        }
    });

    describe('REDAXO instance (v2)', () => {
        const name = 'e2e-rx';

        it('creates and installs REDAXO with PHP 8.5 / MariaDB 12.3', async () => {
            const i = await manager.create({ name, kind: 'redaxo', php: '8.5', mariadb: '12.3', domains: ['e2e-shop.localhost'] });
            assert.equal(i.status, 'running');
            assert.equal(i.format, 'v2');
            assert.match(i.redaxoVersion ?? '', /^5\.\d+\.\d+$/);
            assert.equal(await containerPhp(i.layout.webContainer), '8.5');
            await fs.writeFile(path.join(i.docrootPath, 'rmi-test.php'), TEST_PHP);
        });

        it('serves all host names via HTTPS (wildcard + extra domain)', async () => {
            for (const host of [`${name}.localhost`, `de.${name}.localhost`, 'e2e-shop.localhost']) {
                const res = await curl(`${await proxyBase(host)}/rmi-test.php`);
                assert.equal(res.status, 200, `${host}: ${res.body.slice(0, 200)}`);
                const info = JSON.parse(res.body);
                assert.equal(info.https, 'on', 'PHP must see HTTPS');
                assert.match(info.host, new RegExp(`^${host.replace(/\./g, '\\.')}`));
            }
            const backend = await curl(`${await proxyBase(`${name}.localhost`)}/redaxo/`);
            assert.equal(backend.status, 200);
            assert.match(backend.body, /REDAXO/);
        });

        it('has the media toolchain and PHP extensions', async () => {
            const i = await manager.get(name);
            const res = await run('docker', ['exec', i.layout.webContainer, 'sh', '-c', 'vips --version && pdftotext -v 2>&1 | head -1 && magick -version | head -1 && gs --version']);
            assert.match(res.stdout, /vips-8/);
            assert.match(res.stdout, /pdftotext/);
            assert.match(res.stdout, /ImageMagick 7/);
            const info = JSON.parse((await curl(`${i.urls.direct}rmi-test.php`)).body);
            for (const ext of ['gd', 'imagick', 'intl', 'ffi', 'mbstring', 'pdo_mysql']) {
                assert.ok(info.ext.includes(ext), `missing ${ext}`);
            }
        });

        it('delivers PHP mail() to Mailpit', async () => {
            const i = await manager.get(name);
            const marker = Date.now().toString();
            const res = JSON.parse((await curl(`${i.urls.direct}rmi-test.php?mail=${marker}`)).body);
            assert.equal(res.mail, true);
            const ports = await manager.shared.ports();
            let found = false;
            for (let t = 0; t < 10 && !found; t++) {
                const api = await curl(`http://127.0.0.1:${ports.mailpit}/api/v1/messages`);
                found = api.body.includes(`rmi-e2e-${marker}`);
                if (!found) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            assert.ok(found, 'mail not found in Mailpit');
            const viaProxy = await curl(`${await proxyBase('mail.localhost')}/`);
            assert.equal(viaProxy.status, 200);
        });

        it('runs console commands and SQL', async () => {
            assert.equal((await manager.console(name, ['cache:clear'])).code, 0);
            assert.match((await manager.console(name, ['package:list'])).output, /backup/);
            const users = await manager.query(name, 'SELECT login FROM rex_user', { readOnly: true });
            assert.deepEqual(users.rows, [['admin']]);
            await assert.rejects(manager.query(name, 'DELETE FROM rex_user', { readOnly: true }), InstanceError);
            await assert.rejects(manager.query(name, 'SELECT 1; DELETE FROM rex_user', { readOnly: true }), InstanceError);
            const write = await manager.query(name, "UPDATE rex_user SET name = 'E2E' WHERE login = 'admin'");
            assert.equal(write.rowCount, 1);
        });

        it('stops and starts', async () => {
            await manager.stop(name);
            assert.equal((await manager.get(name)).status, 'stopped');
            const proxied = await curl(`${await proxyBase(`${name}.localhost`)}/`);
            assert.equal(proxied.status, 502, 'proxy shows the "not running" page');
            await manager.start(name);
            assert.equal((await manager.get(name)).status, 'running');
        });

        it('switches PHP and MariaDB without losing data', async () => {
            await manager.changePhp(name, '8.4');
            const i = await manager.get(name);
            assert.equal(await containerPhp(i.layout.webContainer), '8.4');
            await manager.changeMariaDb(name, '13.0');
            const version = await manager.query(name, 'SELECT VERSION()', { readOnly: true });
            assert.match(String(version.rows[0][0]), /^13\.0/);
            await assert.rejects(manager.changeMariaDb(name, '12.3'), /Downgrading/);
            const user = await manager.query(name, "SELECT name FROM rex_user WHERE login = 'admin'", { readOnly: true });
            assert.equal(user.rows[0][0], 'E2E');
        });

        it('toggles Xdebug', async () => {
            await manager.setXdebug(name, true);
            const i = await manager.get(name);
            const res = await run('docker', ['exec', i.layout.webContainer, 'php', '-m']);
            assert.match(res.stdout, /xdebug/i);
            await manager.setXdebug(name, false);
        });

        it('changes the additional domains', async () => {
            await manager.setDomains(name, ['e2e-new.localhost']);
            const res = await curl(`${await proxyBase('e2e-new.localhost')}/redaxo/`);
            assert.equal(res.status, 200);
        });

        it('creates additional databases', async () => {
            await manager.createDatabase(name, 'extra_db');
            assert.ok((await manager.listDatabases(name)).includes('extra_db'));
            await manager.query(name, 'CREATE TABLE t (id INT)', { database: 'extra_db' });
        });

        it('exports and imports', async () => {
            const exportDir = path.join(dir, '_exports');
            const res = await manager.exportInstance(name, exportDir);
            assert.ok(res.databaseIncluded);
            assert.ok(res.sizeBytes > 1_000_000);
            const copy = await manager.importInstance(res.archive, 'e2e-copy');
            assert.equal(copy.status, 'running');
            const user = await manager.query('e2e-copy', "SELECT name FROM rex_user WHERE login = 'admin'", { readOnly: true });
            assert.equal(user.rows[0][0], 'E2E');
            assert.ok((await manager.listDatabases('e2e-copy')).includes('extra_db'));
            const server = await manager.console('e2e-copy', ['config:get', '--package=core', 'server']);
            assert.match(server.output, /e2e-copy\.localhost/);
            const backend = await curl(`${await proxyBase('e2e-copy.localhost')}/redaxo/`);
            assert.equal(backend.status, 200);
        });
    });

    describe('custom instance (v2)', () => {
        it('runs an empty PHP 8.6 project with database access', async () => {
            const i = await manager.create({ name: 'e2e-custom', kind: 'custom', php: '8.6', mariadb: '11.8' });
            assert.equal(i.status, 'running');
            const page = await curl(`${await proxyBase('e2e-custom.localhost')}/`);
            assert.equal(page.status, 200);
            assert.match(page.body, /8\.6\.\d/);
            assert.match(page.body, /11\.8\.\d+-MariaDB/);
            await assert.rejects(manager.console('e2e-custom', ['list']), /No REDAXO console/);
        });
    });

    describe('2.1 features', () => {
        it('creates and restores snapshots (database + files)', async () => {
            const name = 'e2e-rx';
            const i = await manager.get(name);
            const file = path.join(i.docrootPath, 'snapshot-test.txt');
            await manager.query(name, "UPDATE rex_user SET name = 'SNAP' WHERE login = 'admin'");
            await fs.writeFile(file, 'v1');
            const snap = await manager.createSnapshot(name, 'e2e test');
            assert.ok(snap.sizeBytes > 100_000);
            assert.deepEqual((await manager.listSnapshots(name)).map(s => s.id), [snap.id]);

            await manager.query(name, "UPDATE rex_user SET name = 'CHANGED' WHERE login = 'admin'");
            await fs.writeFile(file, 'v2');
            await fs.writeFile(path.join(i.docrootPath, 'later.txt'), 'x');

            await manager.restoreSnapshot(name, snap.id);
            const user = await manager.query(name, "SELECT name FROM rex_user WHERE login = 'admin'", { readOnly: true });
            assert.equal(user.rows[0][0], 'SNAP');
            assert.equal(await fs.readFile(file, 'utf8'), 'v1');
            await assert.rejects(fs.access(path.join(i.docrootPath, 'later.txt')));
            assert.equal((await curl(`${await proxyBase(`${name}.localhost`)}/redaxo/`)).status, 200);

            await manager.deleteSnapshot(name, snap.id);
            assert.deepEqual(await manager.listSnapshots(name), []);
        });

        it('duplicates an instance', async () => {
            const copy = await manager.duplicate('e2e-rx', 'e2e-dup');
            assert.equal(copy.status, 'running');
            const user = await manager.query('e2e-dup', "SELECT name FROM rex_user WHERE login = 'admin'", { readOnly: true });
            assert.equal(user.rows[0][0], 'SNAP');
            assert.equal((await curl(`${await proxyBase('e2e-dup.localhost')}/redaxo/`)).status, 200);
            await manager.remove('e2e-dup');
        });

        it('creates an instance from a git repository and sets up git', async () => {
            const repo = path.join(dir, '_repo');
            await fs.mkdir(path.join(repo, 'public'), { recursive: true });
            await fs.writeFile(path.join(repo, 'public', 'index.php'), '<?php echo "from-git " . PHP_VERSION;');
            const git = (...args: string[]) => run('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
            await run('git', ['init', '-b', 'main', repo]);
            await git('add', '-A');
            await git('commit', '-m', 'init');

            const i = await manager.createFromGit(repo, { name: 'e2e-git', php: '8.4', mariadb: '11.8' });
            assert.equal(i.kind, 'custom');
            assert.equal(i.layout.docroot, '/var/www/html/public');
            const page = await curl(`${await proxyBase('e2e-git.localhost')}/`);
            assert.match(page.body, /from-git 8\.4/);

            const status = await manager.setupGit('e2e-git');
            assert.equal(status.isRepo, true);
            assert.equal(status.remote, repo);
            assert.match(await fs.readFile(path.join(i.webrootPath, '.gitignore'), 'utf8'), /\/vendor\//);
            const log = await run('git', ['-C', i.webrootPath, 'log', '--oneline']);
            assert.match(log.stdout, /gitignore/);
        });

        it('shows a help page for unknown host names', async () => {
            const ports = await manager.shared.ports();
            const httpBase = ports.proxyHttp === 80 ? '' : `:${ports.proxyHttp}`;
            const page = await curl(`http://does-not-exist.localhost${httpBase}/`);
            assert.equal(page.status, 404);
            assert.match(page.body, /e2e-rx/);
            const secure = await curl(`${await proxyBase('nope.localhost')}/`, ['-k']);
            assert.equal(secure.status, 404);
        });

        it('reports resources', async () => {
            const r = await manager.resources('e2e-rx');
            assert.ok((r.memoryBytes ?? 0) > 1_000_000, 'memory');
            assert.ok(r.cpuPercent !== undefined, 'cpu');
            if (process.platform !== 'win32') {
                assert.ok((r.diskBytes ?? 0) > 1_000_000, 'disk');
            }
        });

        it('maps PHP errors from the container log to project files', async () => {
            const i = await manager.get('e2e-git');
            await fs.writeFile(path.join(i.docrootPath, 'broken.php'), '<?php\nnot_a_function();\n');
            await curl(`${i.urls.direct}broken.php`);
            await new Promise(r => setTimeout(r, 1000));
            const logs = await run('docker', ['logs', '--tail', '50', i.layout.webContainer], { allowFailure: true });
            const raw = (logs.stdout + logs.stderr).split(/\r?\n/).map(parsePhpErrorLine).find(p => p?.file?.endsWith('broken.php'));
            assert.ok(raw, 'PHP error in container log');
            const problem = await toProblem(i, raw);
            assert.equal(problem.file, path.join(i.docrootPath, 'broken.php'));
            assert.equal(problem.line, 2);
            assert.equal(problem.severity, 'error');
            await manager.remove('e2e-git');
        });
    });

    describe('REDAXO 6 (development version)', () => {
        it('creates a Composer project (redaxo/project:6.x-dev) and runs the setup', async () => {
            const i = await manager.create({ name: 'e2e-rx6', kind: 'redaxo', redaxo6: 'project', php: '8.5', mariadb: '12.3' });
            assert.equal(i.status, 'running');
            assert.equal(i.redaxoVersion, '6.x-dev');
            await fs.access(path.join(i.webrootPath, 'composer.json'));
            await fs.access(path.join(i.webrootPath, 'var', '.redaxo-mi-installed'));
            const backend = await curl(`${await proxyBase('e2e-rx6.localhost')}/redaxo/`);
            assert.equal(backend.status, 200, backend.body.slice(0, 500));
            const status = await manager.console('e2e-rx6', ['migrate:status']);
            assert.equal(status.code, 0, status.output);
            const users = await manager.query('e2e-rx6', 'SELECT login FROM rex_user', { readOnly: true });
            assert.deepEqual(users.rows, [['admin']]);
            await assert.rejects(manager.create({ name: 'e2e-rx6-old', kind: 'redaxo', redaxo6: 'project', php: '8.4', mariadb: '12.3', start: false }), /PHP 8\.5/);
        });

        it('clones redaxo/core 6.x for core development', async () => {
            const i = await manager.create({ name: 'e2e-core6', kind: 'redaxo', redaxo6: 'core', php: '8.5', mariadb: '12.3' });
            assert.equal(i.status, 'running');
            assert.equal(i.layout.docroot, '/var/www/html/project/public');
            const branch = await run('docker', ['exec', i.layout.webContainer, 'git', '-C', '/var/www/html', 'rev-parse', '--abbrev-ref', 'HEAD']);
            assert.equal(branch.stdout.trim(), '6.x');
            const backend = await curl(`${await proxyBase('e2e-core6.localhost')}/redaxo/`);
            assert.equal(backend.status, 200, backend.body.slice(0, 500));
            assert.equal((await manager.console('e2e-core6', ['migrate:status'])).code, 0);
            const agents = await fs.readFile(path.join(i.path, 'AGENTS.md'), 'utf8');
            assert.match(agents, /project\/bin\/console/);
        });
    });

    describe('1.x compatibility', () => {
        it('detects, operates and modernizes a 1.x REDAXO instance', async () => {
            const name = 'legacy-std';
            const instancePath = path.join(dir, name);
            const options = { name, phpVersion: '8.4', mariadbVersion: '11.4', autoInstall: true, webserverOnly: false, imageVariant: 'stable' as const };
            // exactly what DockerService.createInstance() of 1.21.0 wrote
            await fs.mkdir(path.join(instancePath, 'data', 'mysql'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'data', 'redaxo'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'mysql-init'), { recursive: true });
            await fs.writeFile(path.join(instancePath, 'docker-compose.yml'), DockerComposeGenerator.generate(options, 'legacyPw123', 'legacyRoot123', 18381, 18443, 13381, false));
            await fs.writeFile(path.join(instancePath, '.env'), DockerComposeGenerator.generateEnvFile(options, 'legacyPw123', 'legacyRoot123', 18381, 18443, 13381, false));
            const setup = `#!/bin/bash\nif [ -f "/tmp/setup-complete.flag" ]; then exit 0; fi\n${SetupTemplates.generateCustomSetupScript(name, '8.4', false)}\n${SetupTemplates.generateAutoInstallScript(name, '8.4', false)}\ntouch /tmp/setup-complete.flag\n`;
            await fs.writeFile(path.join(instancePath, 'custom-setup.sh'), setup, { mode: 0o755 });
            await run('docker', ['compose', 'up', '-d'], { cwd: instancePath });
            assert.ok(await manager.waitForHttp('http://localhost:18381/', 300_000));
            // wait for the REDAXO setup of the friendsofredaxo image
            for (let t = 0; t < 60; t++) {
                if ((await curl('http://localhost:18381/redaxo/')).status === 200) {
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            let i = await manager.get(name);
            assert.equal(i.format, 'legacy-standard');
            assert.equal(i.kind, 'redaxo');
            assert.equal(i.status, 'running');
            assert.equal(i.ports.http, 18381);
            assert.equal(i.db.password, 'legacyPw123');
            assert.equal(i.layout.webContainer, `redaxo-${name}`);
            assert.equal((await manager.console(name, ['cache:clear'])).code, 0);
            assert.deepEqual((await manager.query(name, 'SELECT login FROM rex_user', { readOnly: true })).rows, [['admin']]);
            await manager.query(name, "UPDATE rex_user SET name = 'LEGACY' WHERE login = 'admin'");
            await assert.rejects(manager.changePhp(name, '8.5'), /modernize/);

            const { backup } = await manager.modernize(name);
            assert.ok(backup && (await fs.stat(backup)).size > 1_000_000);
            i = await manager.get(name);
            assert.equal(i.format, 'v2');
            assert.equal(i.status, 'running');
            assert.equal(i.layout.webContainer, `redaxo-${name}`, 'container names are kept');
            assert.equal(i.ports.http, 18381, 'ports are kept');
            const user = await manager.query(name, "SELECT name FROM rex_user WHERE login = 'admin'", { readOnly: true });
            assert.equal(user.rows[0][0], 'LEGACY', 'data is kept');
            assert.equal((await curl(`${await proxyBase(`${name}.localhost`)}/redaxo/`)).status, 200);
            await manager.changePhp(name, '8.5');
            assert.equal(await containerPhp(i.layout.webContainer), '8.5');
            assert.ok(await fs.stat(path.join(instancePath, '.legacy', 'docker-compose.yml')));
        });

        it('detects and modernizes a 1.x custom instance (keeps the DB volume)', async () => {
            const name = 'legacy-custom';
            const instancePath = path.join(dir, name);
            const cfg = { instanceName: name, phpVersion: '8.3', mariadbVersion: '11.4', enableXdebug: false, httpPort: 18382, httpsPort: 18444 };
            await fs.mkdir(path.join(instancePath, 'project', 'public'), { recursive: true });
            await fs.mkdir(path.join(instancePath, 'database'), { recursive: true });
            await fs.writeFile(path.join(instancePath, 'docker-compose.yml'), legacyCustomCompose(cfg, 13382));
            await fs.writeFile(path.join(instancePath, '.env'), legacyCustomEnv(cfg));
            await fs.writeFile(path.join(instancePath, 'project', 'public', 'index.php'), '<?php echo "legacy custom ok " . PHP_VERSION;');
            // only the database service – the old web image would need a long build
            await run('docker', ['compose', 'up', '-d', '--wait', 'db'], { cwd: instancePath, allowFailure: true });
            for (let t = 0; t < 60; t++) {
                const ping = await run('docker', ['exec', 'legacy-customdb', 'mariadb', '-uroot', '-proot', '-e', 'CREATE TABLE IF NOT EXISTS `legacy-custom`.marker (v VARCHAR(20)); INSERT INTO `legacy-custom`.marker VALUES (\'kept\')'], { allowFailure: true });
                if (ping.code === 0) {
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            let i = await manager.get(name);
            assert.equal(i.format, 'legacy-custom');
            assert.equal(i.kind, 'custom');
            assert.equal(i.layout.dbContainer, 'legacy-customdb');
            assert.equal(i.db.password, name);

            await manager.modernize(name);
            i = await manager.get(name);
            assert.equal(i.format, 'v2');
            assert.equal(i.status, 'running');
            const page = await curl(`${await proxyBase(`${name}.localhost`)}/`);
            assert.match(page.body, /legacy custom ok 8\.3/);
            const marker = await manager.query(name, 'SELECT v FROM marker', { readOnly: true });
            assert.deepEqual(marker.rows, [['kept']]);
        });
    });

    describe('maintenance', () => {
        it('finds no orphans and no port conflicts', async () => {
            const orphans = await manager.findOrphans();
            assert.deepEqual(orphans.containers, []);
            assert.deepEqual(await manager.fixPortConflicts(), []);
        });

        it('deletes instances completely', async () => {
            const i = await manager.get('e2e-copy');
            await manager.remove('e2e-copy');
            await assert.rejects(manager.get('e2e-copy'), /not found/);
            assert.equal(await manager.docker.containerExists(i.layout.webContainer), false);
            const volumes = await run('docker', ['volume', 'ls', '-q', '--filter', `name=${i.layout.composeProject}`]);
            assert.equal(volumes.stdout.trim(), '');
        });
    });
});
