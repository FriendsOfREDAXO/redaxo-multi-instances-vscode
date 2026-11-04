import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'out/**', '.vscode-test/**', 'src/core/assets.generated.ts', 'node_modules/**', 'test/e2e/legacy/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/naming-convention': ['warn', { selector: 'import', format: ['camelCase', 'PascalCase'] }],
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            curly: 'warn',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
        },
    },
    {
        files: ['**/*.mjs', 'scripts/**/*.js'],
        languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
    },
);
