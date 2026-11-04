import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CoreSettings, redaxoLangFromLocale, systemTimezone, withDefaults } from '../core/settings';

export const SECTION = 'redaxo-instances';

/** Default instances folder when nothing is configured. */
export function defaultInstancesDir(): string {
    return path.join(os.homedir(), 'redaxo-instances');
}

function expandHome(p: string): string {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Reads the (few) user settings – everything else is automatic. */
export function readCoreSettings(): CoreSettings {
    const config = vscode.workspace.getConfiguration(SECTION);
    // REDAXO_INSTANCES_DIR overrides the setting (tests, CI, power users)
    const configured = process.env.REDAXO_INSTANCES_DIR?.trim() || config.get<string>('instancesPath')?.trim();
    return withDefaults({
        instancesDir: configured ? expandHome(configured) : defaultInstancesDir(),
        dockerPath: config.get<string>('dockerPath')?.trim() || 'docker',
        lang: redaxoLangFromLocale(vscode.env.language),
        timezone: systemTimezone(),
    });
}

export async function setInstancesPath(value: string): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update('instancesPath', value, vscode.ConfigurationTarget.Global);
}
