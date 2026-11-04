import * as assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, findTool, splitArgs } from '../../src/core/tools';

describe('tools', () => {
    it('splits command lines like a shell (without expansion)', () => {
        assert.deepEqual(splitArgs('package:install yform'), ['package:install', 'yform']);
        assert.deepEqual(splitArgs(`config:set --package=core "server name" 'a b' x\\ y ""`), ['config:set', '--package=core', 'server name', 'a b', 'x y', '']);
        assert.deepEqual(splitArgs('echo $(rm -rf /) ; ls'), ['echo', '$(rm', '-rf', '/)', ';', 'ls']);
        assert.throws(() => splitArgs('"open'));
    });

    it('has unique names and valid schemas', () => {
        const names = TOOL_DEFINITIONS.map(t => t.name);
        assert.equal(new Set(names).size, names.length);
        for (const tool of TOOL_DEFINITIONS) {
            assert.equal(tool.inputSchema.type, 'object');
            for (const req of tool.inputSchema.required ?? []) {
                assert.ok(req in tool.inputSchema.properties, `${tool.name}.${req}`);
            }
            assert.ok(tool.description.length > 20);
        }
        assert.equal(findTool('redaxo_list_instances')?.name, 'list_instances');
        assert.equal(findTool('list_instances')?.name, 'list_instances');
    });

    it('marks read-only tools correctly', () => {
        const readOnly = TOOL_DEFINITIONS.filter(t => !t.mutating).map(t => t.name).sort();
        assert.deepEqual(readOnly, ['get_instance', 'get_logs', 'list_instances', 'list_versions']);
    });
});
