import * as assert from 'node:assert/strict';
import { DOCKER_ASSETS, DOCKER_ASSETS_HASH } from '../../src/core/assets.generated';
import { defaultImageFiles, hashImageFiles, renderAgentsMd, renderCaddyfile, renderCompose, renderSharedCompose, webImageName } from '../../src/core/templates';
import { instanceFromConfig } from '../../src/core/store';
import { sampleConfig } from './store.test';

const ports = { proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 };
const settings = { lang: 'de_de', timezone: 'Europe/Berlin' };

describe('templates', () => {
    it('embeds the docker assets', () => {
        for (const f of ['Dockerfile', 'entrypoint.sh', 'php.ini', 'vhost.conf']) {
            assert.ok(DOCKER_ASSETS[f]?.length > 100, f);
        }
        assert.match(DOCKER_ASSETS.Dockerfile, /libvips-tools/);
        assert.match(DOCKER_ASSETS.Dockerfile, /poppler-utils/);
        assert.match(DOCKER_ASSETS.Dockerfile, /imagemagick/);
        assert.match(DOCKER_ASSETS.Dockerfile, /install-php-extensions imagick/);
        assert.equal(hashImageFiles(defaultImageFiles()).length, 10);
        assert.ok(DOCKER_ASSETS_HASH);
    });

    it('shares the web image between instances with the same PHP version', () => {
        assert.equal(webImageName('8.6-rc-apache', 'abc'), 'redaxo-mi-web:8.6-rc-abc');
        const a = renderCompose(sampleConfig(), { settings, ports, filesHash: 'h1' });
        const b = renderCompose(sampleConfig({ name: 'other' }), { settings, ports, filesHash: 'h1' });
        const image = (s: string) => /image: (redaxo-mi-web:\S+)/.exec(s)?.[1];
        assert.equal(image(a), image(b));
    });

    it('renders a REDAXO 5 compose file', () => {
        const yml = renderCompose(sampleConfig(), { settings, ports, filesHash: 'h1' });
        assert.match(yml, /^name: redaxo-shop$/m);
        assert.match(yml, /container_name: redaxo-shop-web/);
        assert.match(yml, /"127\.0\.0\.1:8081:80"/);
        assert.match(yml, /"127\.0\.0\.1:3307:3306"/);
        assert.match(yml, /REDAXO_SERVER: "https:\/\/shop\.localhost\/"/);
        assert.match(yml, /REDAXO_ADMIN_PASSWORD: "adminpw"/);
        assert.match(yml, /condition: service_healthy/);
        assert.match(yml, /MARIADB_AUTO_UPGRADE: "1"/);
        assert.match(yml, /image: mariadb:12\.3/);
        assert.match(yml, /redaxo-mi-composer-cache:\n {4}external: true/);
        assert.match(yml, /db-data:\n/);
        assert.match(yml, /redaxo-mi:\n {4}external: true/);
        assert.doesNotMatch(yml, /REDAXO6_SOURCE/);
    });

    it('renders a REDAXO 6 compose file with environment configuration', () => {
        const yml = renderCompose(sampleConfig({ redaxo6: 'core', redaxoVersion: '6.x-dev', db: { name: 'redaxo', user: 'redaxo', password: 'p@ss/w', rootPassword: 'r' } }),
            { settings, ports: { ...ports, proxyHttps: 8443 }, filesHash: 'h1' });
        assert.match(yml, /REDAXO6_SOURCE: "core"/);
        assert.match(yml, /DATABASE_URL: "mysql:\/\/redaxo:p%40ss%2Fw@db:3306\/redaxo"/);
        assert.match(yml, /MAILER_DSN: "smtp:\/\/redaxo-mi-mailpit:1025"/);
        assert.match(yml, /REX_BASE_URL: "https:\/\/shop\.localhost:8443\/"/);
        assert.match(yml, /REX_MODE: "dev"/);
    });

    it('keeps names, bind mounts and aliases of modernized 1.x instances', () => {
        const cfg = sampleConfig({ name: 'demo' });
        cfg.layout = { ...cfg.layout, composeProject: 'demo', webService: 'redaxo', dbService: 'mysql', webContainer: 'redaxo-demo', dbContainer: 'redaxo-demo-mysql',
            webroot: 'data/redaxo', docroot: '/var/www/html', dbStorage: { type: 'bind', path: './data/mysql' }, dbAliases: ['demodb'] };
        const yml = renderCompose(cfg, { settings, ports, filesHash: 'h1' });
        assert.match(yml, /^name: demo$/m);
        assert.match(yml, /^ {2}redaxo:$/m);
        assert.match(yml, /^ {2}mysql:$/m);
        assert.match(yml, /- \.\/data\/redaxo:\/var\/www\/html/);
        assert.match(yml, /- \.\/data\/mysql:\/var\/lib\/mysql/);
        assert.match(yml, /APACHE_DOCUMENT_ROOT: "\/var\/www\/html"/);
        assert.match(yml, /aliases:\n {10}- demodb/);
        assert.doesNotMatch(yml, /db-data/);
    });

    it('renders the shared services on the allocated ports', () => {
        const yml = renderSharedCompose({ proxyHttp: 8000, proxyHttps: 8443, mailpit: 8026, adminer: 9201 }, { ipv6Loopback: true });
        assert.doesNotMatch(renderSharedCompose({ proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 }, { ipv6Loopback: false }), /::1/);
        assert.match(yml, /"127\.0\.0\.1:8443:443"/);
        assert.match(yml, /"\[::1\]:8443:443"/);
        assert.match(yml, /"127\.0\.0\.1:8026:8025"/);
        assert.match(yml, /image: adminer:6\./);
    });

    it('renders the Caddyfile for all host names', () => {
        const caddy = renderCaddyfile([
            { name: 'shop', hosts: ['shop.localhost', '*.shop.localhost'], upstream: 'redaxo-shop-web:80', cert: { cert: 'shop.pem', key: 'shop-key.pem' } },
            { name: 'blog', hosts: ['blog.localhost'], upstream: 'redaxo-blog-web:80' },
        ]);
        assert.match(caddy, /^shop\.localhost, \*\.shop\.localhost \{$/m);
        assert.match(caddy, /tls \/certs\/shop\.pem \/certs\/shop-key\.pem/);
        assert.match(caddy, /http:\/\/shop\.localhost, http:\/\/\*\.shop\.localhost \{/);
        assert.match(caddy, /blog\.localhost \{\n\ttls internal/);
        assert.match(caddy, /auto_https disable_redirects/);
    });

    it('describes instances for AI assistants without secrets', () => {
        const md = renderAgentsMd(instanceFromConfig('/x/shop', sampleConfig(), ports));
        assert.match(md, /https:\/\/shop\.localhost\//);
        assert.match(md, /redaxo\/bin\/console/);
        assert.doesNotMatch(md, /adminpw/);
        assert.doesNotMatch(md, /: pw\b/);
        const md6 = renderAgentsMd(instanceFromConfig('/x/shop', sampleConfig({ redaxo6: 'project', redaxoVersion: '6.x-dev' }), ports));
        assert.match(md6, /REDAXO 6 conventions/);
        assert.match(md6, /\/var\/www\/html\/bin\/console/);
    });
});
