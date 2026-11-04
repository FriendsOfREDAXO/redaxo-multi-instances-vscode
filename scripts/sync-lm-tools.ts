// Writes contributes.languageModelTools in package.json from TOOL_DEFINITIONS (src/core/tools.ts).
// New tools get English placeholders in package.nls.json / package.nls.de.json – translate them afterwards.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_DEFINITIONS } from '../src/core/tools';

const root = join(__dirname, '..');
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const write = (f: string, data: unknown) => writeFileSync(join(root, f), JSON.stringify(data, null, 2) + '\n');

const pkg = read('package.json');
const en = read('package.nls.json');
const de = read('package.nls.de.json');

pkg.contributes.languageModelTools = TOOL_DEFINITIONS.map(tool => {
    for (const [key, value] of [[`tool.${tool.name}.name`, tool.title], [`tool.${tool.name}.description`, tool.title]]) {
        en[key] ??= value;
        de[key] ??= value;
    }
    return {
        name: `redaxo_${tool.name}`,
        displayName: `%tool.${tool.name}.name%`,
        toolReferenceName: `redaxo-${tool.name.replace(/_/g, '-')}`,
        canBeReferencedInPrompt: true,
        icon: '$(server-environment)',
        userDescription: `%tool.${tool.name}.description%`,
        modelDescription: tool.description,
        tags: ['redaxo', 'docker', 'php'],
        inputSchema: tool.inputSchema,
    };
});

write('package.json', pkg);
write('package.nls.json', en);
write('package.nls.de.json', de);
console.log(`${TOOL_DEFINITIONS.length} language model tools written`);
