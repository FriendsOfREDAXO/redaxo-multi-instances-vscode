import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// never touch the real instances folder or settings of the developer
const sandbox = mkdtempSync(join(tmpdir(), 'redaxo-mi-vscode-test-'));

export default defineConfig({
    label: 'integration',
    files: 'out/test/integration/**/*.test.js',
    version: 'stable',
    workspaceFolder: './test/integration/fixture',
    mocha: { ui: 'bdd', timeout: 60000 },
    env: {
        REDAXO_INSTANCES_DIR: join(sandbox, 'instances'),
        REDAXO_MI_CONFIG_DIR: join(sandbox, 'config'),
    },
});
