import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { InstanceConfig, defaultLayout } from '../../src/core/model';
import { canonicalPath, instanceFromConfig, instanceFromLegacy, loadInstance, parseEnv, updateEnv } from '../../src/core/store';
import { DockerComposeGenerator } from '../e2e/legacy/dockerCompose';
import { legacyCustomCompose, legacyCustomEnv } from '../e2e/legacy/emptyInstance';

const ports = { proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 };

export function sampleConfig(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
    return {
        schema: 2, name: 'shop', kind: 'redaxo', php: '8.5', phpImageTag: '8.5-apache', mariadb: '12.3', redaxoVersion: '5.21.6',
        domains: ['shop-b.localhost'], ports: { http: 8081, db: 3307 },
        db: { name: 'redaxo', user: 'redaxo', password: 'pw', rootPassword: 'root' },
        admin: { user: 'admin', password: 'adminpw' }, xdebug: false, createdAt: '2026-11-04T00:00:00Z',
        layout: defaultLayout('shop'), ...overrides,
    };
}

describe('store', () => {
    it('parses and updates .env files', () => {
        const env = parseEnv('# c\nA=1\nB="two = 2"\nURL=mysql://u:p@h/db?x=1\n\nbroken\n');
        assert.deepEqual(env, { A: '1', B: 'two = 2', URL: 'mysql://u:p@h/db?x=1' });
        assert.equal(updateEnv('# c\nA=1\nB=2\n', { B: '3', C: '4' }), '# c\nA=1\nB=3\nC=4\n');
    });

    it('resolves symlinks like Docker Compose does (macOS /var → /private/var)', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-link-'));
        try {
            await fs.mkdir(path.join(dir, 'real'));
            await fs.symlink(path.join(dir, 'real'), path.join(dir, 'link'));
            assert.equal(await canonicalPath(path.join(dir, 'link')), await fs.realpath(path.join(dir, 'real')));
            assert.equal(await canonicalPath(path.join(dir, 'missing', '..', 'x')), path.join(dir, 'x'));
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('builds URLs of v2 instances', () => {
        const i = instanceFromConfig('/x/shop', sampleConfig(), ports);
        assert.equal(i.urls.frontend, 'https://shop.localhost/');
        assert.equal(i.urls.backend, 'https://shop.localhost/redaxo/');
        assert.equal(i.urls.direct, 'http://localhost:8081/');
        assert.deepEqual(i.urls.hosts, ['shop.localhost', '*.shop.localhost', 'shop-b.localhost']);
        assert.equal(i.docrootPath, path.join('/x/shop', 'project', 'public'));
        const alt = instanceFromConfig('/x/shop', sampleConfig({ kind: 'custom' }), { ...ports, proxyHttps: 8443 });
        assert.equal(alt.urls.frontend, 'https://shop.localhost:8443/');
        assert.equal(alt.urls.backend, undefined);
    });

    describe('1.x compatibility', () => {
        it('detects 1.x REDAXO instances (generator of 1.21.0)', () => {
            const options = { name: 'demo', phpVersion: '8.2', mariadbVersion: '11.4', autoInstall: true, webserverOnly: false, imageVariant: 'stable' as const };
            const compose = DockerComposeGenerator.generate(options, 'pw1', 'root1', 8080, 8443, 3306, true);
            const env = parseEnv(DockerComposeGenerator.generateEnvFile(options, 'pw1', 'root1', 8080, 8443, 3306, true));
            const i = instanceFromLegacy('/inst/demo', compose, env)!;
            assert.equal(i.format, 'legacy-standard');
            assert.equal(i.kind, 'redaxo');
            assert.deepEqual(i.ports, { http: 8080, https: 8443, db: 3306 });
            assert.equal(i.layout.webContainer, 'redaxo-demo');
            assert.equal(i.layout.dbContainer, 'redaxo-demo-mysql');
            assert.equal(i.layout.webService, 'redaxo');
            assert.equal(i.layout.dbService, 'mysql');
            assert.equal(i.db.host, 'mysql');
            assert.equal(i.db.password, 'pw1');
            assert.equal(i.db.rootPassword, 'root1');
            assert.equal(i.admin?.password, 'pw1');
            assert.equal(i.urls.backend, 'http://localhost:8080/redaxo/');
            assert.equal(i.urls.legacyHttps, 'https://demo.local:8443/');
            assert.equal(i.webImage, 'friendsofredaxo/redaxo:5-stable');
            assert.equal(i.docrootPath, path.join('/inst/demo', 'data', 'redaxo'));
        });

        it('detects 1.x custom instances (incl. underscores)', () => {
            const cfg = { instanceName: 'my_app', phpVersion: '8.3', mariadbVersion: '11.4', enableXdebug: true, httpPort: 8090, httpsPort: 8453 };
            const i = instanceFromLegacy('/inst/my_app', legacyCustomCompose(cfg, 3310), parseEnv(legacyCustomEnv(cfg)))!;
            assert.equal(i.format, 'legacy-custom');
            assert.equal(i.kind, 'custom');
            assert.equal(i.php, '8.3');
            assert.deepEqual(i.ports, { http: 8090, https: 8453, db: 3310 });
            assert.equal(i.layout.webContainer, 'myappweb');
            assert.equal(i.layout.dbContainer, 'myappdb');
            assert.deepEqual(i.layout.dbStorage, { type: 'volume', volume: 'myappdb_data' });
            assert.equal(i.layout.composeProject, 'my_app');
            assert.equal(i.db.host, 'myappdb');
            assert.equal(i.db.name, 'my_app');
            assert.equal(i.db.rootPassword, 'root');
            assert.equal(i.xdebug, true);
        });

        it('ignores unrelated folders', async () => {
            const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmi-store-'));
            try {
                await fs.mkdir(path.join(dir, 'other'));
                await fs.writeFile(path.join(dir, 'other', 'docker-compose.yml'), 'services:\n  app:\n    image: nginx\n');
                assert.equal(await loadInstance(path.join(dir, 'other'), ports), undefined);
                assert.equal(await loadInstance(path.join(dir, 'missing'), ports), undefined);
            } finally {
                await fs.rm(dir, { recursive: true, force: true });
            }
        });
    });
});
