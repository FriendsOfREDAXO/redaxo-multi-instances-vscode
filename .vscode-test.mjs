import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: 'stable',
	mocha: {
		ui: 'suite',
		timeout: 20000
	},
	env: {
		NODE_ENV: 'test'
	}
});
