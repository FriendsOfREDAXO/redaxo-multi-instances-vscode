import * as assert from 'node:assert/strict';
import { domainRewrites, parseItemized, sq, validateRemoteProfile, RemoteProfile } from '../../src/core/remote';

const profile = (p: Partial<RemoteProfile>): RemoteProfile => ({ schema: 1, host: 'user@example.org', path: 'httpdocs', php: 'php', domainMap: {}, exclude: [], afterDeploy: [], ...p });

describe('remote', () => {
    it('parses rsync itemized output of rsync 3 and openrsync', () => {
        const out = [
            '<f+++++++ assets/new.css',
            '<fcsT.... README.md',
            '<f..T.... only-time.txt',
            '>f+++++++++ from-server.txt',
            '<fcsT...... src/Changed.php',
            'cd+++++++ newdir/',
            '*deleting old.php',
            '*deleting olddir/',
        ].join('\n');
        assert.deepEqual(parseItemized(out), [
            { path: 'assets/new.css', change: 'new' },
            { path: 'README.md', change: 'changed' },
            { path: 'from-server.txt', change: 'new' },
            { path: 'src/Changed.php', change: 'changed' },
            { path: 'old.php', change: 'only-remote' },
        ]);
    });

    it('quotes for POSIX shells', () => {
        assert.equal(sq("it's"), `'it'\\''s'`);
        assert.equal(sq('a b;rm'), `'a b;rm'`);
    });

    it('rejects SSH options and shell syntax in the profile', () => {
        assert.deepEqual(validateRemoteProfile(profile({})), []);
        assert.equal(validateRemoteProfile(profile({ host: '-oProxyCommand=x' })).length, 1);
        assert.equal(validateRemoteProfile(profile({ host: 'a;b' })).length, 1);
        assert.equal(validateRemoteProfile(profile({ port: 70000 })).length, 1);
        assert.equal(validateRemoteProfile(profile({ domainMap: { 'www.example.org': 'x.localhost;' } })).length, 1);
    });
});

describe('domain rewrites', () => {
    it('rewrites existing columns only and quotes values', () => {
        const sql = domainRewrites({ 'www.example.org': 'shop.localhost' }, new Set(['rex_yrewrite_domain.domain', 'rex_config.value']));
        assert.deepEqual(sql, [
            "UPDATE `rex_yrewrite_domain` SET domain = REPLACE(domain, 'www.example.org', 'shop.localhost') WHERE domain LIKE '%www.example.org%';",
            "UPDATE `rex_config` SET value = REPLACE(value, 'www.example.org', 'shop.localhost') WHERE value LIKE '%www.example.org%';",
        ]);
        assert.deepEqual(domainRewrites({ "x'; DROP TABLE a; --": 'y' }, new Set(['rex_config.value'])), []);
    });
});
