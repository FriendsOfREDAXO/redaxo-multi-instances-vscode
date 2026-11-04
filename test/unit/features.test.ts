import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describeOccupant, parsePfRedirect, pfFlushCommand } from '../../src/core/diagnose';
import { detectProject, gitignoreLines, mergeGitignore, prepareClonedRedaxo5, repoName } from '../../src/core/git';
import { parseByteSize } from '../../src/core/manager';
import { parsePhpErrorLine, parseSystemLogLine, resolveProblemFile, severityOf } from '../../src/core/problems';
import { instanceFromConfig } from '../../src/core/store';
import { renderCaddyfile, renderDevcontainer, xdebugLaunchConfig } from '../../src/core/templates';
import { sampleConfig } from './store.test';

const ports = { proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 };

async function tmp(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'rmi-feat-'));
}

describe('problems (log parsing)', () => {
    it('parses REDAXO system.log lines', () => {
        const p = parseSystemLogLine('2026-11-04T19:33:37+01:00 | Fatal error | Call to undefined function foo() | redaxo/src/addons/project/boot.php | 12 | https://shop.localhost/');
        assert.deepEqual(p, { level: 'Fatal error', message: 'Call to undefined function foo()', file: 'redaxo/src/addons/project/boot.php', line: 12, url: 'https://shop.localhost/' });
        assert.equal(parseSystemLogLine('2026-11-04 10:00:00 | rex_sql_exception | Table missing')?.level, 'rex_sql_exception');
        assert.equal(parseSystemLogLine('garbage'), undefined);
    });

    it('parses PHP error log lines', () => {
        const a = parsePhpErrorLine('[Wed Nov 04 18:00:00.1 2026] [php:error] [pid 42] [client 172.19.0.1:0] PHP Fatal error:  Uncaught Error: Call to undefined function nope() in /var/www/html/public/err.php:3');
        assert.equal(a?.level, 'Fatal error');
        assert.equal(a?.file, '/var/www/html/public/err.php');
        assert.equal(a?.line, 3);
        const b = parsePhpErrorLine('PHP Warning:  Undefined variable $x in /var/www/html/public/index.php on line 7');
        assert.deepEqual([b?.level, b?.file, b?.line], ['Warning', '/var/www/html/public/index.php', 7]);
        assert.equal(parsePhpErrorLine('AH00558: apache2: Could not reliably determine'), undefined);
    });

    it('maps severities', () => {
        assert.equal(severityOf('Fatal error'), 'error');
        assert.equal(severityOf('rex_sql_exception'), 'error');
        assert.equal(severityOf('Warning'), 'warning');
        assert.equal(severityOf('Deprecated'), 'warning');
        assert.equal(severityOf('Notice'), 'info');
    });

    it('maps container and relative paths to the host', async () => {
        const dir = await tmp();
        try {
            const instance = instanceFromConfig(dir, sampleConfig(), ports);
            await fs.mkdir(path.join(instance.docrootPath, 'redaxo', 'src'), { recursive: true });
            await fs.writeFile(path.join(instance.docrootPath, 'redaxo', 'src', 'x.php'), '<?php');
            await fs.writeFile(path.join(instance.docrootPath, 'err.php'), '<?php');
            assert.equal(await resolveProblemFile(instance, '/var/www/html/public/err.php'), path.join(instance.docrootPath, 'err.php'));
            assert.equal(await resolveProblemFile(instance, 'redaxo/src/x.php'), path.join(instance.docrootPath, 'redaxo', 'src', 'x.php'));
            assert.equal(await resolveProblemFile(instance, 'missing.php'), undefined);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

describe('git', () => {
    it('derives repository names', () => {
        assert.equal(repoName('git@github.com:kunde/Shop.git'), 'Shop');
        assert.equal(repoName('https://gitlab.example.org/a/b/projekt/'), 'projekt');
    });

    it('detects REDAXO 6, REDAXO 5 and PHP projects', async () => {
        const dir = await tmp();
        try {
            const mk = async (name: string, files: Record<string, string>) => {
                const d = path.join(dir, name);
                for (const [f, c] of Object.entries(files)) {
                    await fs.mkdir(path.dirname(path.join(d, f)), { recursive: true });
                    await fs.writeFile(path.join(d, f), c);
                }
                return detectProject(d);
            };
            assert.deepEqual(await mk('r6', { 'composer.json': '{"require":{"redaxo/core":"^6.0"}}' }).then(p => [p.kind, p.redaxo6, p.docroot]), ['redaxo', 'project', '/var/www/html/public']);
            assert.deepEqual(await mk('core', { 'composer.json': '{"name":"redaxo/core"}' }).then(p => [p.redaxo6, p.docroot]), ['core', '/var/www/html/project/public']);
            assert.deepEqual(await mk('r5p', { 'public/redaxo/src/core/boot.php': '' }).then(p => [p.kind, p.redaxo6, p.docroot]), ['redaxo', undefined, '/var/www/html/public']);
            assert.deepEqual(await mk('r5', { 'redaxo/src/core/boot.php': '' }).then(p => [p.kind, p.docroot]), ['redaxo', '/var/www/html']);
            assert.deepEqual(await mk('php', { 'public/index.php': '' }).then(p => [p.kind, p.docroot]), ['custom', '/var/www/html/public']);
            assert.deepEqual(await mk('plain', { 'index.php': '' }).then(p => [p.kind, p.docroot]), ['custom', '/var/www/html']);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('forces the REDAXO 5 setup for cloned projects with a committed config', async () => {
        const dir = await tmp();
        try {
            const cfg = path.join(dir, 'redaxo', 'data', 'core', 'config.yml');
            await fs.mkdir(path.dirname(cfg), { recursive: true });
            await fs.writeFile(cfg, 'setup: false\ndb: x\n');
            assert.equal(await prepareClonedRedaxo5(dir), true);
            assert.match(await fs.readFile(cfg, 'utf8'), /^setup: true$/m);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('writes REDAXO-aware .gitignore entries without duplicates', async () => {
        const dir = await tmp();
        try {
            const lines = gitignoreLines({ kind: 'redaxo', docroot: '/var/www/html/public' });
            assert.ok(lines.includes('/public/redaxo/data/core/config.yml'));
            assert.ok(lines.includes('/public/redaxo/cache/*'));
            assert.ok(gitignoreLines({ kind: 'redaxo', redaxo6: 'project', docroot: '/var/www/html/public' }).includes('/var/'));
            await fs.writeFile(path.join(dir, '.gitignore'), '/vendor/\n');
            const added = await mergeGitignore(dir, ['/vendor/', '.env']);
            assert.deepEqual(added, ['.env']);
            assert.deepEqual(await mergeGitignore(dir, ['/vendor/', '.env']), []);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});

describe('port diagnosis', () => {
    it('reads pf redirects (e.g. yerd)', () => {
        const anchor = 'rdr pass on lo0 inet proto tcp from any to any port 80 -> 127.0.0.1 port 8080\nrdr pass on lo0 inet proto tcp from any to any port 443 -> 127.0.0.1 port 8443\n';
        assert.equal(parsePfRedirect(anchor, 80), 8080);
        assert.equal(parsePfRedirect(anchor, 443), 8443);
        assert.equal(parsePfRedirect(anchor, 8000), undefined);
        const o = { port: 80, redirect: { anchor: 'dev.yerd', file: '/etc/pf.anchors/dev.yerd', toPort: 8080 }, server: 'yerd' };
        assert.equal(describeOccupant(o), '80: firewall redirect "dev.yerd" → 8080, server: yerd');
        assert.equal(pfFlushCommand(o), 'sudo pfctl -a dev.yerd -F nat');
        assert.equal(describeOccupant({ port: 443 }), '443: unknown program');
    });
});

describe('templates for 2.1', () => {
    it('lists all instances on the page for unknown hosts (German)', () => {
        const caddy = renderCaddyfile([], { lang: 'de_de', directory: [{ name: 'shop', url: 'https://shop.localhost/' }] });
        assert.match(caddy, /:443 \{\n\ttls internal \{\n\t\ton_demand/);
        assert.match(caddy, /ist keiner Instanz zugeordnet/);
        assert.match(caddy, /href="https:\/\/shop\.localhost\/"/);
        assert.match(caddy, /ask http:\/\/127\.0\.0\.1:5555\//);
        assert.doesNotMatch(caddy.slice(caddy.indexOf('(directory)')), /style="[^"]*\{/, 'no braces in styles');
        assert.match(renderCaddyfile([], { lang: 'en_gb' }), /is not assigned to an instance/);
    });

    it('renders a dev container and an Xdebug launch configuration', () => {
        const i = instanceFromConfig('/x/shop', sampleConfig(), ports);
        const dc = JSON.parse(renderDevcontainer(i));
        assert.deepEqual(dc.dockerComposeFile, ['../docker-compose.yml']);
        assert.equal(dc.service, 'web');
        assert.equal(dc.workspaceFolder, '/var/www/html');
        assert.equal(dc.remoteUser, 'www-data');
        assert.equal(dc.customizations.vscode.settings['intelephense.environment.phpVersion'], '8.5.0');
        const launch = xdebugLaunchConfig(i, '/x/shop/project');
        assert.deepEqual(launch.pathMappings, { '/var/www/html': '/x/shop/project' });
        assert.equal(launch.port, 9003);
    });

    it('parses docker byte sizes', () => {
        assert.equal(parseByteSize('512MiB'), 512 * 1024 * 1024);
        assert.equal(parseByteSize('1.5GB'), 1_500_000_000);
        assert.equal(parseByteSize('nonsense'), 0);
    });
});
