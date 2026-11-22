import * as assert from 'node:assert/strict';
import { constraintAllows, isMajorUpdate, parseComposerUpdates, parseRedaxoUpdates } from '../../src/core/updates';

describe('add-on updates', () => {
    it('detects major version steps', () => {
        assert.equal(isMajorUpdate('7.8.6', '8.0.0'), true);
        assert.equal(isMajorUpdate('5.9.2', '5.9.4'), false);
        assert.equal(isMajorUpdate('1.5.1', '2.0.0-beta6'), true);
        assert.equal(isMajorUpdate('0.19.7', '0.20.0'), true);
        assert.equal(isMajorUpdate('v5.3.0', 'v5.13.0'), false);
    });

    it('parses the REDAXO installer list (also behind notices)', () => {
        const out = 'Deprecated: something\n[{"key":"cke5","name":"CKEditor 5","latest version":"8.0.0","installed version":"7.8.6"},{"key":"focuspoint","name":"Focuspoint","latest version":"4.2.5","installed version":"4.2.4"}]';
        assert.deepEqual(parseRedaxoUpdates(out).map(u => [u.key, u.installed, u.latest, u.major]), [['cke5', '7.8.6', '8.0.0', true], ['focuspoint', '4.2.4', '4.2.5', false]]);
        assert.deepEqual(parseRedaxoUpdates('[]'), []);
        assert.equal(parseRedaxoUpdates('[{"key":"x","latest version":"2.5.0-beta2","installed version":"2.3.0"}]')[0].prerelease, true);
    });

    it('parses composer outdated', () => {
        const out = JSON.stringify({ installed: [
            { name: 'phpstan/phpstan', version: '2.3.2', latest: '2.3.7', 'latest-status': 'semver-safe-update', description: 'PHPStan' },
            { name: 'psalm/plugin-phpunit', version: '0.19.7', latest: '1.3.2', 'latest-status': 'update-possible', description: 'x' },
            { name: 'a/current', version: '1.0.0', latest: '1.0.0', 'latest-status': 'up-to-date' },
        ] });
        assert.deepEqual(parseComposerUpdates(out).map(u => [u.key, u.major]), [['phpstan/phpstan', false], ['psalm/plugin-phpunit', true]]);
    });

    it('knows whether a constraint allows the newest version', () => {
        assert.equal(constraintAllows('2.3.2', '2.3.7'), false);
        assert.equal(constraintAllows('^2.3', '2.3.7'), true);
        assert.equal(constraintAllows('^0.19', '0.20.0'), false);
        assert.equal(constraintAllows('3.x-dev', '3.1.0'), true);
    });
});
