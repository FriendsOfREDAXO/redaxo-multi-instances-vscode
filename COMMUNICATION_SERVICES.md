# 🚀 REDAXO Communication Services

Direkte Kommunikation mit laufenden REDAXO-Instanzen via Docker Exec.

## 📦 Services

### 1. RedaxoConsoleService
Führe REDAXO Console Commands direkt aus.

**Location:** `src/docker/redaxoConsoleService.ts`

**Verwendung:**
```typescript
import { RedaxoConsoleService } from './docker/redaxoConsoleService';

// Via DockerService
const result = await dockerService.console.clearCache('demo-site');
console.log(result.output);

// Direkt
const result = await RedaxoConsoleService.execute('demo-site', 'cache:clear');
```

**Verfügbare Methoden:**
- `clearCache(instanceName)` - Cache leeren
- `listPackages(instanceName)` - Installierte AddOns auflisten
- `installAddon(instanceName, addonName)` - AddOn installieren
- `activateAddon(instanceName, addonName)` - AddOn aktivieren
- `deactivateAddon(instanceName, addonName)` - AddOn deaktivieren
- `uninstallAddon(instanceName, addonName)` - AddOn deinstallieren
- `listUsers(instanceName)` - Benutzer auflisten
- `backupDatabase(instanceName)` - Datenbank-Backup erstellen
- `getSystemInfo(instanceName)` - System-Report
- `execute(instanceName, command, args?)` - Beliebiger Console Command

### 2. DatabaseQueryService
MySQL-Queries direkt auf der REDAXO-Datenbank ausführen.

**Location:** `src/docker/databaseQueryService.ts`

**Verwendung:**
```typescript
import { DatabaseQueryService } from './docker/databaseQueryService';

// Via DockerService
const articles = await dockerService.database.getArticles('demo-site', 10);
console.log(`Gefunden: ${articles.rowCount} Artikel`);

// Direkt
const result = await DatabaseQueryService.query('demo-site', 'SELECT * FROM rex_article LIMIT 10');
```

**Verfügbare Methoden:**
- `query(instanceName, sql)` - Beliebige SQL Query
- `select(instanceName, table, conditions?, limit?)` - SELECT Query
- `count(instanceName, table, conditions?)` - Zeilen zählen
- `getArticles(instanceName, limit?)` - REDAXO Artikel
- `getUsers(instanceName)` - REDAXO Benutzer
- `getTemplates(instanceName)` - REDAXO Templates
- `getModules(instanceName)` - REDAXO Module
- `getPackages(instanceName)` - Installierte Packages
- `getTables(instanceName)` - Tabellen auflisten
- `describeTable(instanceName, tableName)` - Tabellenstruktur
- Database export/import: handled via Adminer UI or external tools; direct export/import methods were removed from the extension to avoid duplication and to rely on Adminer for safe interactive imports/exports.

### 3. FileSystemService
Dateien im Container lesen/schreiben.

**Location:** `src/docker/fileSystemService.ts`

**Verwendung:**
```typescript
import { FileSystemService } from './docker/fileSystemService';

// Via DockerService
const config = await dockerService.fileSystem.readConfig('demo-site');
console.log(config.content);

// Direkt
const result = await FileSystemService.readFile('demo-site', 'redaxo/data/core/config.yml');
```

**Verfügbare Methoden:**
- `readFile(instanceName, filePath)` - Datei lesen
- `writeFile(instanceName, filePath, content)` - Datei schreiben
- `listFiles(instanceName, dirPath)` - Dateien auflisten
- `listFilesDetailed(instanceName, dirPath)` - Dateien mit Details
- `fileExists(instanceName, filePath)` - Prüfen ob Datei existiert
- `deleteFile(instanceName, filePath)` - Datei löschen
- `copyFile(instanceName, sourcePath, destPath)` - Datei kopieren
- `readConfig(instanceName)` - config.yml lesen
- `listAddons(instanceName)` - AddOns auflisten
- `readAddonConfig(instanceName, addonName)` - AddOn package.yml lesen
- `readTemplate(instanceName, templateId)` - Template lesen
- `readLog(instanceName, logFile?)` - Log-Datei lesen
- `getRecentLogs(instanceName, lines?)` - Letzte Log-Einträge

## 🎯 Beispiel-Commands für extension.ts

```typescript
// Command: REDAXO Console Command ausführen
vscode.commands.registerCommand('redaxo-instances.executeConsole', async () => {
    const instanceName = await selectInstance('Select instance:');
    if (!instanceName) return;
    
    const command = await vscode.window.showInputBox({
        prompt: 'Enter REDAXO console command',
        placeHolder: 'e.g., cache:clear, package:list'
    });
    
    if (command) {
        const result = await dockerService.console.execute(instanceName, command);
        if (result.success) {
            vscode.window.showInformationMessage(`✅ ${result.output}`);
        } else {
            vscode.window.showErrorMessage(`❌ ${result.error}`);
        }
    }
});

// Command: Artikel aus Datenbank anzeigen
vscode.commands.registerCommand('redaxo-instances.showArticles', async () => {
    const instanceName = await selectInstance('Select instance:');
    if (!instanceName) return;
    
    const articles = await dockerService.database.getArticles(instanceName, 20);
    
    if (articles.success) {
        const panel = vscode.window.createWebviewPanel(
            'redaxoArticles',
            `Articles - ${instanceName}`,
            vscode.ViewColumn.One,
            {}
        );
        
        panel.webview.html = `
            <h1>REDAXO Articles</h1>
            <ul>
                ${articles.rows.map(a => `<li>${a.name} (ID: ${a.id})</li>`).join('')}
            </ul>
        `;
    }
});

// Command: Config-Datei anzeigen
vscode.commands.registerCommand('redaxo-instances.showConfig', async () => {
    const instanceName = await selectInstance('Select instance:');
    if (!instanceName) return;
    
    const config = await dockerService.fileSystem.readConfig(instanceName);
    
    if (config.success) {
        const doc = await vscode.workspace.openTextDocument({
            content: config.content,
            language: 'yaml'
        });
        await vscode.window.showTextDocument(doc);
    } else {
        vscode.window.showErrorMessage(`Failed to read config: ${config.error}`);
    }
});

// Command: AddOn installieren
vscode.commands.registerCommand('redaxo-instances.installAddon', async () => {
    const instanceName = await selectInstance('Select instance:');
    if (!instanceName) return;
    
    const addonName = await vscode.window.showInputBox({
        prompt: 'Enter addon name',
        placeHolder: 'e.g., yform, backup'
    });
    
    if (addonName) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${addonName}...`,
            cancellable: false
        }, async () => {
            const result = await dockerService.console.installAddon(instanceName, addonName);
            if (result.success) {
                await dockerService.console.activateAddon(instanceName, addonName);
                vscode.window.showInformationMessage(`✅ ${addonName} installed and activated!`);
            } else {
                vscode.window.showErrorMessage(`❌ Failed: ${result.error}`);
            }
        });
    }
});

// Command: Datenbank-Query ausführen
vscode.commands.registerCommand('redaxo-instances.executeQuery', async () => {
    const instanceName = await selectInstance('Select instance:');
    if (!instanceName) return;
    
    const query = await vscode.window.showInputBox({
        prompt: 'Enter SQL query',
        placeHolder: 'e.g., SELECT * FROM rex_article LIMIT 10'
    });
    
    if (query) {
        const result = await dockerService.database.query(instanceName, query);
        
        if (result.success) {
            // Show results in output channel
            outputChannel.clear();
            outputChannel.appendLine(`Query: ${result.query}`);
            outputChannel.appendLine(`Rows: ${result.rowCount}`);
            outputChannel.appendLine('\nResults:');
            outputChannel.appendLine(JSON.stringify(result.rows, null, 2));
            outputChannel.show();
        } else {
            vscode.window.showErrorMessage(`Query failed: ${result.error}`);
        }
    }
});
```

## 🔧 Integration in package.json

```json
{
  "contributes": {
    "commands": [
      {
        "command": "redaxo-instances.executeConsole",
        "title": "REDAXO: Execute Console Command",
        "icon": "$(terminal)"
      },
      {
        "command": "redaxo-instances.showArticles",
        "title": "REDAXO: Show Articles",
        "icon": "$(list-unordered)"
      },
      {
        "command": "redaxo-instances.showConfig",
        "title": "REDAXO: Show Config",
        "icon": "$(file-code)"
      },
      {
        "command": "redaxo-instances.installAddon",
        "title": "REDAXO: Install AddOn",
        "icon": "$(package)"
      },
      {
        "command": "redaxo-instances.executeQuery",
        "title": "REDAXO: Execute Database Query",
        "icon": "$(database)"
      }
    ]
  }
}
```

## 🎨 Verwendung mit Copilot Chat Participant

Die Services können später als **Language Model Tools** registriert werden:

```typescript
vscode.lm.registerTool('redaxo_console', {
    invoke: async (options, token) => {
        const { instanceName, command } = options;
        const result = await RedaxoConsoleService.execute(instanceName, command);
        return {
            content: result.output
        };
    }
});

vscode.lm.registerTool('redaxo_query', {
    invoke: async (options, token) => {
        const { instanceName, query } = options;
        const result = await DatabaseQueryService.query(instanceName, query);
        return {
            content: JSON.stringify(result.rows)
        };
    }
});
```

Dann kann Copilot diese Tools **automatisch** nutzen:
```
User: Wie viele Artikel hat meine demo-site?
Copilot: [nutzt redaxo_query Tool]
         SELECT COUNT(*) FROM rex_article WHERE status=1
         Ergebnis: 42 Artikel
```

## 📊 Response Types

Alle Services geben strukturierte Response-Objekte zurück:

```typescript
// Console Result
{
    success: boolean;
    output: string;
    error?: string;
    exitCode: number;
}

// Query Result
{
    success: boolean;
    rows: any[];
    rowCount: number;
    error?: string;
    query: string;
}

// File Result
{
    success: boolean;
    content: string;
    error?: string;
    path: string;
}
```

## 🔒 Sicherheit

- Alle Commands werden in isolierten Docker-Containern ausgeführt
- Keine direkten Host-System-Zugriffe
- SQL-Queries werden escaped
- File-Operationen sind auf Container-Dateisystem beschränkt
- Container muss laufen (wird automatisch geprüft)

## 🚀 Nächste Schritte

1. ✅ Services sind fertig implementiert
2. ⏳ Commands in extension.ts registrieren (optional)
3. ⏳ Copilot Chat Participant implementieren (Phase 2)
4. ⏳ Language Model Tools registrieren (Phase 3)
