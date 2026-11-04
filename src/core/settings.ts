import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Settings needed by the core – independent of VS Code (shared with the MCP server).
 * Everything else (ports, versions, language) is determined automatically.
 */
export interface CoreSettings {
    instancesDir: string;
    dockerPath: string;
    /** REDAXO backend language, e.g. de_de (derived from the VS Code display language). */
    lang: string;
    /** Time zone for new REDAXO installations (derived from the system). */
    timezone: string;
}

/** Host ports of the shared services – allocated automatically, persisted in the shared state. */
export interface SharedPorts {
    proxyHttp: number;
    proxyHttps: number;
    mailpit: number;
    adminer: number;
    /**
     * Bind the proxy ports on all interfaces. Needed for ports < 1024 when Docker Desktop runs without its
     * privileged helper (only 0.0.0.0 bindings are allowed then).
     */
    proxyBindAll?: boolean;
}

export const PREFERRED_PORTS: SharedPorts = { proxyHttp: 80, proxyHttps: 443, mailpit: 8025, adminer: 9200 };

const REDAXO_LANGS = ['de_de', 'en_gb', 'es_es', 'it_it', 'nl_nl', 'pt_br', 'sv_se'];

/** Maps a locale (e.g. `de`, `en-US`) to a REDAXO backend language. */
export function redaxoLangFromLocale(locale: string | undefined): string {
    const l = (locale ?? '').toLowerCase().replace('-', '_');
    return REDAXO_LANGS.find(r => r === l) ?? REDAXO_LANGS.find(r => r.startsWith(`${l.slice(0, 2)}_`)) ?? 'en_gb';
}

export function systemTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
    } catch {
        return 'Europe/Berlin';
    }
}

export function withDefaults(partial: Partial<CoreSettings> & { instancesDir: string }): CoreSettings {
    return {
        dockerPath: partial.dockerPath || 'docker',
        lang: partial.lang || redaxoLangFromLocale(process.env.LANG?.split('.')[0]),
        timezone: partial.timezone || systemTimezone(),
        instancesDir: partial.instancesDir,
    };
}

/** Base URL of a host served by the shared HTTPS proxy. */
export function proxyUrl(ports: SharedPorts, host: string, scheme: 'https' | 'http' = 'https'): string {
    const port = scheme === 'https' ? ports.proxyHttps : ports.proxyHttp;
    const isDefault = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80);
    return `${scheme}://${host}${isDefault ? '' : `:${port}`}`;
}

/**
 * Location of the settings file written by the extension and read by the MCP server,
 * so that Claude Code / Claude Desktop use the same instances folder.
 */
export function sharedSettingsFile(): string {
    const base = process.env.REDAXO_MI_CONFIG_DIR
        ?? (process.platform === 'win32'
            ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'redaxo-multi-instances')
            : path.join(os.homedir(), '.config', 'redaxo-multi-instances'));
    return path.join(base, 'settings.json');
}

export async function writeSharedSettings(settings: CoreSettings, file = sharedSettingsFile()): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

export async function readSharedSettings(file = sharedSettingsFile()): Promise<CoreSettings | undefined> {
    let data: Partial<CoreSettings> = {};
    try {
        data = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<CoreSettings>;
    } catch {
        // not written yet
    }
    const instancesDir = process.env.REDAXO_INSTANCES_DIR ?? data.instancesDir;
    return instancesDir ? withDefaults({ ...data, instancesDir }) : undefined;
}
