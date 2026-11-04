import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { TOOL_DEFINITIONS } from '../../src/core/tools';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const nlsDe = JSON.parse(readFileSync(path.join(root, 'package.nls.de.json'), 'utf8'));
const declared = new Set<string>(pkg.contributes.commands.map((c: { command: string }) => c.command));

/** All command ids the 1.x extension contributed – they must keep working. */
const LEGACY_COMMANDS = ['createInstance', 'changeInstancesPath', 'startInstance', 'stopInstance', 'deleteInstance', 'openInBrowser',
    'openBackend', 'openTerminal', 'showLogs', 'showRedaxoLogs', 'installCLITools', 'openInAdminer', 'startAdminer', 'stopAdminer',
    'createDatabase', 'copyCopilotInstructions', 'getLoginInfo', 'showModernLoginInfo', 'setupSSL', 'repairInstance', 'changePhpVersion',
    'changeMariaDbVersion', 'updateHosts', 'openWorkspace', 'openInFinder', 'refresh', 'showInstanceContextMenu', 'showHelp', 'openReadme',
    'exportInstance', 'importInstance', 'maintenanceMenu'];

describe('package.json', () => {
    it('keeps all command ids of version 1.x', () => {
        for (const id of LEGACY_COMMANDS) {
            assert.ok(declared.has(`redaxo-instances.${id}`), id);
        }
    });

    it('keeps the setting keys of version 1.x', () => {
        for (const key of ['dockerPath', 'instancesPath', 'instancesDirectory', 'defaultPhpVersion', 'defaultMariaDbVersion', 'autoRefresh']) {
            assert.ok(pkg.contributes.configuration.properties[`redaxo-instances.${key}`], key);
        }
    });

    it('only references declared commands in menus', () => {
        for (const [menu, items] of Object.entries(pkg.contributes.menus as Record<string, Array<{ command: string }>>)) {
            for (const item of items) {
                assert.ok(declared.has(item.command), `${menu}: ${item.command}`);
            }
        }
    });

    it('registers every declared command in code (and vice versa)', () => {
        const source = readFileSync(path.join(root, 'src', 'extension', 'commands.ts'), 'utf8');
        const registered = new Set([...source.matchAll(/^\s+'(redaxo-instances\.[A-Za-z]+)':/gm)].map(m => m[1]));
        for (const id of declared) {
            assert.ok(registered.has(id), `not registered: ${id}`);
        }
        for (const id of registered) {
            assert.ok(declared.has(id), `not declared: ${id}`);
        }
    });

    it('declares exactly the shared language model tools', () => {
        const tools = pkg.contributes.languageModelTools as Array<{ name: string; inputSchema: unknown; modelDescription: string }>;
        assert.deepEqual(tools.map(t => t.name).sort(), TOOL_DEFINITIONS.map(t => `redaxo_${t.name}`).sort());
        for (const def of TOOL_DEFINITIONS) {
            const t = tools.find(x => x.name === `redaxo_${def.name}`)!;
            assert.deepEqual(t.inputSchema, def.inputSchema, def.name);
            assert.equal(t.modelDescription, def.description, def.name);
        }
    });

    it('has English and German texts for every placeholder', () => {
        const keys = [...JSON.stringify(pkg.contributes).matchAll(/"%([^%"]+)%"/g), ...JSON.stringify({ d: pkg.displayName, x: pkg.description }).matchAll(/"%([^%"]+)%"/g)].map(m => m[1]);
        for (const key of keys) {
            assert.ok(nls[key], `en: ${key}`);
            assert.ok(nlsDe[key], `de: ${key}`);
        }
        assert.deepEqual(Object.keys(nlsDe).sort(), Object.keys(nls).sort());
    });

    it('translates every runtime string to German', () => {
        const bundle = JSON.parse(readFileSync(path.join(root, 'l10n', 'bundle.l10n.json'), 'utf8')) as Record<string, string>;
        const de = JSON.parse(readFileSync(path.join(root, 'l10n', 'bundle.l10n.de.json'), 'utf8')) as Record<string, string>;
        const missing = Object.keys(bundle).filter(k => !(k in de));
        assert.deepEqual(missing, []);
        assert.ok(readdirSync(path.join(root, 'l10n')).includes('bundle.l10n.de.json'));
    });
});
