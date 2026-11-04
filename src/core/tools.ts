import { resultToMarkdown } from './database';
import { InstanceManager } from './manager';
import { Instance } from './model';
import { DEFAULT_MARIADB_VERSION, DEFAULT_PHP_VERSION, MARIADB_VERSIONS, PHP_VERSIONS, fetchRedaxoReleases } from './versions';

/**
 * Tool definitions shared by the VS Code language model tools (Copilot agent mode, @redaxo)
 * and the MCP server (Claude Code, Claude Desktop, other MCP clients).
 */
export interface ToolDefinition {
    /** Base name; LM tools are registered as `redaxo_<name>`, MCP tools use the base name. */
    name: string;
    title: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
    };
    /** Changes state – clients should ask for confirmation. */
    mutating: boolean;
    run(manager: InstanceManager, input: Record<string, unknown>): Promise<string>;
}

const nameProp = { type: 'string', description: 'Instance name (see list_instances)' };

function str(input: Record<string, unknown>, key: string, required = true): string {
    const value = input[key];
    if (typeof value !== 'string' || (required && value.trim() === '')) {
        if (!required && value === undefined) {
            return '';
        }
        throw new Error(`Parameter "${key}" is required`);
    }
    return value.trim();
}

/** Splits a command line like a POSIX shell would (quotes, escapes) – no expansion. */
export function splitArgs(line: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: '"' | "'" | undefined;
    let has = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) {
                quote = undefined;
            } else if (ch === '\\' && quote === '"' && i + 1 < line.length) {
                current += line[++i];
            } else {
                current += ch;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            has = true;
        } else if (ch === '\\' && i + 1 < line.length) {
            current += line[++i];
            has = true;
        } else if (/\s/.test(ch)) {
            if (has || current) {
                args.push(current);
            }
            current = '';
            has = false;
        } else {
            current += ch;
            has = true;
        }
    }
    if (quote) {
        throw new Error('Unterminated quote in command');
    }
    if (has || current) {
        args.push(current);
    }
    return args;
}

export function describeInstance(i: Instance, includeSecrets = false): string {
    const rows: Array<[string, string | undefined]> = [
        ['Name', i.name],
        ['Type', i.kind !== 'redaxo' ? 'PHP project'
            : i.redaxo6 === 'core' ? 'REDAXO 6 core development (git clone of redaxo/core 6.x)'
                : i.redaxo6 ? 'REDAXO 6 development version (Composer project)'
                    : `REDAXO${i.redaxoVersion ? ` ${i.redaxoVersion}` : ''}`],
        ['Status', i.status],
        ['Format', i.format === 'v2' ? 'current' : `${i.format} (1.x – can be modernized)`],
        ['PHP', i.php],
        ['MariaDB', i.mariadb],
        ['Frontend', i.urls.frontend],
        ['Backend', i.urls.backend],
        ['Direct HTTP', i.urls.direct],
        ['Legacy HTTPS', i.urls.legacyHttps],
        ['Host names', i.urls.hosts.join(', ') || undefined],
        ['Instance folder', i.path],
        ['Document root (host)', i.docrootPath],
        ['Web container', i.layout.webContainer],
        ['DB container', i.layout.dbContainer],
        ['DB (inside Docker)', `${i.db.host}:3306 / ${i.db.name}`],
        ['DB (from host)', i.db.externalPort ? `127.0.0.1:${i.db.externalPort}` : undefined],
        ['DB user', i.db.user],
        ['DB password', includeSecrets ? i.db.password : '(hidden)'],
        ['Admin user', i.admin?.user],
        ['Admin password', i.admin ? (includeSecrets ? i.admin.password : '(hidden)') : undefined],
        ['Xdebug', i.format === 'v2' ? (i.xdebug ? 'on (trigger, port 9003)' : 'off') : undefined],
    ];
    return rows.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- **${k}:** ${v}`).join('\n');
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    {
        name: 'list_instances',
        title: 'List REDAXO instances',
        description: 'Lists all local REDAXO/PHP Docker instances with status, PHP/MariaDB versions and URLs.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        mutating: false,
        async run(manager) {
            const list = await manager.list();
            if (list.length === 0) {
                return 'No instances found. Create one with create_instance.';
            }
            return [
                '| Name | Type | Status | PHP | MariaDB | Frontend |',
                '| --- | --- | --- | --- | --- | --- |',
                ...list.map(i => `| ${i.name} | ${i.kind} | ${i.status} | ${i.php} | ${i.mariadb} | ${i.urls.frontend} |`),
            ].join('\n');
        },
    },
    {
        name: 'get_instance',
        title: 'Get instance details',
        description: 'Returns URLs, paths, containers, versions and database connection data of an instance. Secrets are only included when includeSecrets is true.',
        inputSchema: {
            type: 'object',
            properties: { name: nameProp, includeSecrets: { type: 'boolean', description: 'Include passwords (default false)' } },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: false,
        async run(manager, input) {
            return describeInstance(await manager.get(str(input, 'name')), input.includeSecrets === true);
        },
    },
    {
        name: 'list_versions',
        title: 'List available versions',
        description: 'Lists the PHP, MariaDB and REDAXO versions that can be used for new instances.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        mutating: false,
        async run() {
            const redaxo = await fetchRedaxoReleases(fetch, 5);
            return [
                `PHP: ${PHP_VERSIONS.map(v => `${v.version} (${v.status})`).join(', ')}`,
                `MariaDB: ${MARIADB_VERSIONS.map(v => `${v.version}${v.lts ? ' LTS' : ''}`).join(', ')}`,
                `REDAXO: ${redaxo.map(r => r.version).join(', ')}`,
            ].join('\n');
        },
    },
    {
        name: 'create_instance',
        title: 'Create instance',
        description: 'Creates and starts a new local instance. kind "redaxo" installs REDAXO automatically (admin login is generated), kind "custom" creates an empty PHP/Apache project. The first start of a PHP version builds a Docker image (several minutes).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Lowercase letters, digits and hyphens; becomes <name>.localhost' },
                kind: {
                    type: 'string',
                    enum: ['redaxo', 'redaxo6', 'redaxo6-core', 'custom'],
                    description: 'redaxo = REDAXO 5 (stable), redaxo6 = REDAXO 6 development version (Composer project), redaxo6-core = clone of redaxo/core 6.x for core development, custom = empty PHP project',
                },
                php: { type: 'string', enum: PHP_VERSIONS.map(v => v.version) },
                mariadb: { type: 'string', enum: MARIADB_VERSIONS.map(v => v.version) },
                redaxoVersion: { type: 'string', description: '"latest" (default) or a release such as 5.21.6' },
                domains: { type: 'array', items: { type: 'string' }, description: 'Additional host names, e.g. ["shop.localhost"]' },
                gitUrl: { type: 'string', description: 'Clone this repository instead of a fresh installation (type and document root are detected; kind is ignored)' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        async run(manager, input) {
            if (typeof input.gitUrl === 'string' && input.gitUrl.trim()) {
                const fromGit = await manager.createFromGit(input.gitUrl.trim(), {
                    name: str(input, 'name'),
                    php: typeof input.php === 'string' ? input.php : DEFAULT_PHP_VERSION,
                    mariadb: typeof input.mariadb === 'string' ? input.mariadb : DEFAULT_MARIADB_VERSION,
                    domains: Array.isArray(input.domains) ? input.domains.map(String) : [],
                });
                return `Instance created from ${input.gitUrl} and started.\n\n${describeInstance(fromGit)}`;
            }
            const instance = await manager.create({
                name: str(input, 'name'),
                kind: input.kind === 'custom' ? 'custom' : 'redaxo',
                redaxo6: input.kind === 'redaxo6' ? 'project' : input.kind === 'redaxo6-core' ? 'core' : undefined,
                php: typeof input.php === 'string' ? input.php : DEFAULT_PHP_VERSION,
                mariadb: typeof input.mariadb === 'string' ? input.mariadb : DEFAULT_MARIADB_VERSION,
                redaxoVersion: typeof input.redaxoVersion === 'string' ? input.redaxoVersion : 'latest',
                domains: Array.isArray(input.domains) ? input.domains.map(String) : [],
            });
            return `Instance created and started.\n\n${describeInstance(instance)}`;
        },
    },
    {
        name: 'start_instance',
        title: 'Start instance',
        description: 'Starts an instance (and the shared HTTPS proxy / Mailpit) and waits until the web server answers.',
        inputSchema: { type: 'object', properties: { name: nameProp }, required: ['name'], additionalProperties: false },
        mutating: true,
        async run(manager, input) {
            const name = str(input, 'name');
            const { warnings } = await manager.start(name);
            const i = await manager.get(name);
            return `Started ${name}: ${i.urls.frontend}${warnings.length ? `\nWarnings:\n- ${warnings.join('\n- ')}` : ''}`;
        },
    },
    {
        name: 'stop_instance',
        title: 'Stop instance',
        description: 'Stops the containers of an instance (data is kept).',
        inputSchema: { type: 'object', properties: { name: nameProp }, required: ['name'], additionalProperties: false },
        mutating: true,
        async run(manager, input) {
            await manager.stop(str(input, 'name'));
            return `Stopped ${str(input, 'name')}.`;
        },
    },
    {
        name: 'redaxo_console',
        title: 'Run REDAXO console command',
        description: 'Runs bin/console in a running REDAXO instance as www-data, e.g. "cache:clear", "package:list", "package:install yform", "config:get --package=core server". Arguments are not passed through a shell.',
        inputSchema: {
            type: 'object',
            properties: { name: nameProp, command: { type: 'string', description: 'Console command and arguments, without "php bin/console"' } },
            required: ['name', 'command'],
            additionalProperties: false,
        },
        mutating: true,
        async run(manager, input) {
            const args = splitArgs(str(input, 'command').replace(/^(php\s+)?(redaxo\/)?bin\/console\s+/, ''));
            const res = await manager.console(str(input, 'name'), args);
            return `exit code ${res.code}\n\n\`\`\`\n${res.output.slice(-20_000)}\n\`\`\``;
        },
    },
    {
        name: 'query_database',
        title: 'Query database',
        description: 'Executes one SQL statement in the instance database and returns the result as table. Read-only (SELECT/SHOW/DESCRIBE/EXPLAIN) unless allowWrite is true. REDAXO tables use the prefix rex_.',
        inputSchema: {
            type: 'object',
            properties: {
                name: nameProp,
                sql: { type: 'string' },
                allowWrite: { type: 'boolean', description: 'Allow INSERT/UPDATE/DELETE/DDL (default false)' },
                maxRows: { type: 'number', description: 'Maximum rows (default 100)' },
            },
            required: ['name', 'sql'],
            additionalProperties: false,
        },
        mutating: true,
        async run(manager, input) {
            const result = await manager.query(str(input, 'name'), str(input, 'sql'), {
                readOnly: input.allowWrite !== true,
                maxRows: typeof input.maxRows === 'number' ? Math.min(Math.max(1, input.maxRows), 1000) : 100,
            });
            return resultToMarkdown(result, 100);
        },
    },
    {
        name: 'get_logs',
        title: 'Get container logs',
        description: 'Returns the latest log lines of the web (Apache/PHP errors) and/or database container.',
        inputSchema: {
            type: 'object',
            properties: {
                name: nameProp,
                service: { type: 'string', enum: ['web', 'db', 'all'] },
                tail: { type: 'number', description: 'Number of lines (default 100)' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: false,
        async run(manager, input) {
            const service = input.service === 'web' || input.service === 'db' ? input.service : undefined;
            const tail = typeof input.tail === 'number' ? Math.min(Math.max(1, input.tail), 2000) : 100;
            const logs = await manager.logs(str(input, 'name'), { service, tail });
            return `\`\`\`\n${logs.slice(-30_000)}\n\`\`\``;
        },
    },
    {
        name: 'set_domains',
        title: 'Set additional domains',
        description: 'Sets the additional host names of an instance (besides <name>.localhost and *.<name>.localhost) for multi-domain setups such as YRewrite. Updates HTTPS certificates and proxy routing.',
        inputSchema: {
            type: 'object',
            properties: { name: nameProp, domains: { type: 'array', items: { type: 'string' } } },
            required: ['name', 'domains'],
            additionalProperties: false,
        },
        mutating: true,
        async run(manager, input) {
            const name = str(input, 'name');
            await manager.setDomains(name, Array.isArray(input.domains) ? input.domains.map(String) : []);
            const i = await manager.get(name);
            return `Host names of ${name}: ${i.urls.hosts.join(', ')}`;
        },
    },
    {
        name: 'create_snapshot',
        title: 'Create snapshot',
        description: 'Saves the database(s) and files of an instance as a restore point – recommended before AddOn updates, migrations or larger changes. Restoring is done by the user in VS Code.',
        inputSchema: {
            type: 'object',
            properties: { name: nameProp, label: { type: 'string', description: 'Short description, e.g. "before yform update"' } },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        async run(manager, input) {
            const snap = await manager.createSnapshot(str(input, 'name'), typeof input.label === 'string' ? input.label : '');
            return `Snapshot ${snap.id} created (${Math.round(snap.sizeBytes / 1024 / 1024 * 10) / 10} MB, databases: ${snap.databases.join(', ')}).`;
        },
    },
    {
        name: 'list_snapshots',
        title: 'List snapshots',
        description: 'Lists the restore points (snapshots) of an instance.',
        inputSchema: { type: 'object', properties: { name: nameProp }, required: ['name'], additionalProperties: false },
        mutating: false,
        async run(manager, input) {
            const list = await manager.listSnapshots(str(input, 'name'));
            if (!list.length) {
                return 'No snapshots yet.';
            }
            return ['| Snapshot | Label | Created | Size |', '| --- | --- | --- | --- |',
                ...list.map(s => `| ${s.id} | ${s.label || '-'} | ${s.createdAt} | ${Math.round(s.sizeBytes / 1024 / 1024 * 10) / 10} MB |`)].join('\n');
        },
    },
];

export function findTool(name: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS.find(t => t.name === name || `redaxo_${t.name}` === name);
}
