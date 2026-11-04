import * as assert from 'node:assert/strict';
import * as net from 'node:net';
import { isPortFree } from '../../src/core/ports';
import { instanceHosts, validateDomain, validateInstanceName } from '../../src/core/model';
import { proxyUrl, redaxoLangFromLocale } from '../../src/core/settings';

describe('model', () => {
    it('validates instance names (DNS labels)', () => {
        for (const ok of ['shop', 'kunde-a', 'a', 'x1-2']) {
            assert.equal(validateInstanceName(ok), undefined, ok);
        }
        for (const bad of ['', 'Shop', 'my_shop', '-a', 'a-', 'a.b', 'x'.repeat(41), 'adminer', 'mail']) {
            assert.notEqual(validateInstanceName(bad), undefined, bad);
        }
    });

    it('validates additional domains', () => {
        for (const ok of ['shop.localhost', '*.kunde.localhost', 'kunde-b.test', 'a.b.c.localhost']) {
            assert.equal(validateDomain(ok), undefined, ok);
        }
        for (const bad of ['localhost', '*.localhost', 'shop', 'http://x.localhost', 'a..localhost']) {
            assert.notEqual(validateDomain(bad), undefined, bad);
        }
    });

    it('serves <name>.localhost, the wildcard and extra domains', () => {
        assert.deepEqual(instanceHosts('shop', ['Shop-B.localhost', 'shop.localhost']), ['shop.localhost', '*.shop.localhost', 'shop-b.localhost']);
    });

    it('builds proxy URLs without default ports', () => {
        const ports = { proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 };
        assert.equal(proxyUrl(ports, 'a.localhost'), 'https://a.localhost');
        assert.equal(proxyUrl({ ...ports, proxyHttps: 8443 }, 'a.localhost'), 'https://a.localhost:8443');
        assert.equal(proxyUrl({ ...ports, proxyHttp: 8000 }, 'a.localhost', 'http'), 'http://a.localhost:8000');
    });

    it('maps the VS Code language to a REDAXO backend language', () => {
        assert.equal(redaxoLangFromLocale('de'), 'de_de');
        assert.equal(redaxoLangFromLocale('de-AT'), 'de_de');
        assert.equal(redaxoLangFromLocale('pt-br'), 'pt_br');
        assert.equal(redaxoLangFromLocale('en-US'), 'en_gb');
        assert.equal(redaxoLangFromLocale('ja'), 'en_gb');
    });
});

describe('ports', () => {
    it('detects ports in use', async () => {
        const server = net.createServer();
        await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
        const port = (server.address() as net.AddressInfo).port;
        assert.equal(await isPortFree(port), false);
        await new Promise<void>(r => server.close(() => r()));
        assert.equal(await isPortFree(port), true);
    });
});
