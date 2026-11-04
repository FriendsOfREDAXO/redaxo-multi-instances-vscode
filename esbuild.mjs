// Bundles the extension and the standalone MCP server.
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Prints errors in a format understood by the `$esbuild-watch` problem matcher. */
const problemMatcherPlugin = {
    name: 'problem-matcher',
    setup(build) {
        build.onStart(() => console.log('[watch] build started'));
        build.onEnd(result => {
            for (const { text, location } of result.errors) {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            }
            console.log('[watch] build finished');
        });
    },
};

const common = {
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent',
    define: { EXTENSION_VERSION: JSON.stringify(version) },
    plugins: [problemMatcherPlugin],
};

const contexts = await Promise.all([
    esbuild.context({ ...common, entryPoints: ['src/extension/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] }),
    esbuild.context({ ...common, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp-server.js', banner: { js: '#!/usr/bin/env node' } }),
]);

if (watch) {
    await Promise.all(contexts.map(c => c.watch()));
} else {
    await Promise.all(contexts.map(c => c.rebuild()));
    await Promise.all(contexts.map(c => c.dispose()));
}
