import * as assert from 'node:assert/strict';
import {
    DEFAULT_MARIADB_VERSION, DEFAULT_PHP_VERSION, MARIADB_VERSIONS, PHP_VERSIONS, compareVersions, fetchRedaxoReleases,
    getRedaxoMinPhp, isPhpCompatibleWithRedaxo, normalizeMariaDbVersion, normalizePhpVersion, resolvePhpImageTag,
} from '../../src/core/versions';

describe('versions', () => {
    it('compares versions numerically', () => {
        assert.equal(compareVersions('8.10', '8.9'), 1);
        assert.equal(compareVersions('10.11', '11.4'), -1);
        assert.equal(compareVersions('5.21.6', '5.21'), 1);
        assert.equal(compareVersions('6.x-dev', '6.0'), 0);
    });

    it('offers PHP 8.1–8.6 and no PHP 7', () => {
        assert.deepEqual(PHP_VERSIONS.map(v => v.version), ['8.6', '8.5', '8.4', '8.3', '8.2', '8.1']);
        assert.ok(PHP_VERSIONS.every(v => v.imageTag.endsWith('-apache')));
    });

    it('has supported defaults', () => {
        assert.ok(PHP_VERSIONS.some(v => v.version === DEFAULT_PHP_VERSION));
        assert.ok(MARIADB_VERSIONS.some(v => v.version === DEFAULT_MARIADB_VERSION && v.lts));
        assert.ok(!MARIADB_VERSIONS.some(v => v.version === '10.6'), '10.6 is EOL');
    });

    it('knows the PHP requirements of REDAXO', () => {
        assert.equal(getRedaxoMinPhp('6.x-dev'), '8.5');
        assert.equal(getRedaxoMinPhp('5.21.6'), '8.3');
        assert.equal(getRedaxoMinPhp('5.20.2'), '8.1');
        assert.equal(getRedaxoMinPhp('latest'), '8.3');
        assert.ok(!isPhpCompatibleWithRedaxo('8.2', '5.21.0'));
        assert.ok(isPhpCompatibleWithRedaxo('8.2', '5.20.2'));
        assert.ok(!isPhpCompatibleWithRedaxo('8.4', '6.x-dev'));
    });

    it('normalizes outdated versions from old settings', () => {
        assert.equal(normalizePhpVersion('7.4'), DEFAULT_PHP_VERSION);
        assert.equal(normalizePhpVersion('8.2'), '8.2');
        assert.equal(normalizeMariaDbVersion('10.6'), DEFAULT_MARIADB_VERSION);
    });

    it('prefers the GA image tag once it exists', async () => {
        assert.equal(await resolvePhpImageTag('8.6'), '8.6-rc-apache');
        assert.equal(await resolvePhpImageTag('8.6', async tag => tag === '8.6-apache'), '8.6-apache');
        assert.equal(await resolvePhpImageTag('8.6', async () => { throw new Error('offline'); }), '8.6-rc-apache');
        await assert.rejects(resolvePhpImageTag('7.4'));
    });

    it('falls back to the bundled REDAXO version when offline', async () => {
        const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
        const releases = await fetchRedaxoReleases(offline);
        assert.equal(releases.length, 1);
        assert.match(releases[0].downloadUrl, /github\.com\/redaxo\/core\/releases\/download\//);
    });
});
