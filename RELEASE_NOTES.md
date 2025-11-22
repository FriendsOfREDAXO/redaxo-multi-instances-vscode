# 🚀 REDAXO Multi-Instances Manager - Release Notes

# Release Notes

## Version 1.9.0 (2025-11-21)

### 🎯 Custom Instance Full Support
Die Extension unterstützt jetzt **vollständig** Custom REDAXO Instances mit individuellen Verzeichnisstrukturen!

**Was bedeutet das?**
- ✅ Custom Instances wie "welling", "core" funktionieren jetzt mit allen Chat Commands
- ✅ Automatische Erkennung verschiedener REDAXO-Ordnerstrukturen
- ✅ Keine manuelle Konfiguration nötig - alles wird automatisch erkannt

### 🔍 Smart Path Detection
**3 unterstützte REDAXO-Strukturen:**

1. **Root-Level** (z.B. Custom Instance "welling"):
   ```
   /var/www/html/
   ├── bin/console              ← Console hier
   ├── data/core/config.yml     ← Config hier
   ├── src/addons/              ← AddOns hier
   └── public/
   ```

2. **Standard** (klassische REDAXO Installation):
   ```
   /var/www/html/
   └── redaxo/
       ├── bin/console          ← Console hier
       ├── data/core/config.yml ← Config hier
       └── src/addons/          ← AddOns hier
   ```

3. **Public-Subfolder** (Custom mit public/ Ordner):
   ```
   /var/www/html/
   └── public/
       └── redaxo/
           ├── bin/console      ← Console hier
           └── data/...         ← Daten hier
   ```

### 🚀 Dynamic Console Path Resolution
Die REDAXO Console wird jetzt **automatisch** am richtigen Ort gefunden:
- Custom: `/var/www/html/bin/console`
- Standard: `/var/www/html/redaxo/bin/console`
- Public: `/var/www/html/public/redaxo/bin/console`

**Beispiel vorher:**
```
@redaxo /addons welling
❌ Error: Could not open input file: /var/www/html/redaxo/bin/console
```

**Beispiel jetzt:**
```
@redaxo /addons welling
✅ 60 AddOns listed successfully!
```

### ⚡ Performance Caching
Path-Detection Ergebnisse werden gecacht:
- **Erster Zugriff**: Prüft alle möglichen Pfade (ca. 100-200ms)
- **Weitere Zugriffe**: Verwendet Cache (sofort, <1ms)
- **Caching pro Container**: Jeder Container behält seine erkannte Struktur

### 🔧 Enhanced Chat Participant Commands
**Alle Commands funktionieren jetzt mit Custom Instances:**

```typescript
@redaxo /addons welling          // ✅ Zeigt alle 60+ AddOns
@redaxo /console welling cache:clear  // ✅ Führt Console-Befehle aus
@redaxo /config welling          // ✅ Liest config.yml
@redaxo /logs welling            // ✅ Zeigt REDAXO Logs
@redaxo /query welling SELECT * FROM rex_article  // ✅ SQL Queries
```

### 📁 Flexible FileSystem Service
**Alle convenience methods unterstützen dynamische Pfaderkennung:**
- `readConfig()` - REDAXO config.yml
- `listAddons()` - AddOn-Verzeichnis
- `readLog()` - Log-Dateien
- `readTemplate()` - Templates
- `readModuleInput/Output()` - Module
- `listPlugins()` - Plugins

**Technisch:**
```typescript
// Vorher (hardcoded):
return this.readFile(instanceName, 'redaxo/data/core/config.yml');

// Jetzt (dynamisch):
const basePath = await this.detectRedaxoBasePath(containerName);
return this.readFile(instanceName, `${basePath}data/core/config.yml`);
// → 'data/core/config.yml' (root-level)
// → 'redaxo/data/core/config.yml' (standard)
// → 'public/redaxo/data/core/config.yml' (public)
```

### 🛠️ Technical Improvements

**RedaxoConsoleService:**
- ✅ `getConsolePath()` mit Cache-Map
- ✅ Prüft Custom-Pfad zuerst (häufigster Fall)
- ✅ Robuste try-catch Blöcke pro Pfad-Check
- ✅ Verwendet `getContainerName()` Helper statt direktem DockerService-Aufruf

**FileSystemService:**
- ✅ `detectRedaxoBasePath()` mit Cache-Map
- ✅ Prüft root-level zuerst mit `/data/core/` Verification
- ✅ 9 convenience methods umgestellt auf dynamische Pfaderkennung
- ✅ `getRecentLogs()` verwendet detected base path

**Container Support:**
- ✅ Standard: `redaxo-name` → `redaxo-name-mysql`
- ✅ Custom: `nameweb` → `namedb` (z.B. wellingweb/wellingdb)
- ✅ Helper-Methoden in allen Services für Container-Auflösung

### 🔍 Error Handling
Bessere Fehlermeldungen bei nicht gefundenen Containern:
```typescript
// FileReadResult
{ success: false, content: '', error: 'Container not found...', path: '...' }

// FileListResult  
{ success: false, files: [], error: 'Container not found...', path: '...' }

// FileInfo[]
return [];  // Empty array

// boolean
return false;
```

### 📊 Bundle Size
- **Development**: 343 KB
- **Production**: 197 KB (minimized)
- **Total Package**: 923.75 KB

---

## Version 1.8.2 (2025-11-21)

### 🗄️ Adminer Database Management
- **Global Adminer Container**: One Adminer instance manages all REDAXO databases
- **One-Click Access**: Right-click on running instance → "Open in Adminer"
- **Smart Credential Pre-Fill**: Browser opens with server, username, and database already filled
- **Clipboard Integration**: Password automatically copied to clipboard for easy paste (Cmd+V)
- **Large File Support**: 512MB upload limit for importing/exporting large database dumps
- **Port 9200**: Adminer runs on dedicated port http://localhost:9200

### 🔧 Context Menu Commands
- **Open in Adminer**: Quick database access from context menu (running instances only)
- **Show REDAXO Logs**: View redaxo.log and system.log directly from VS Code
- **Install CLI Tools**: Install vim, nano, curl, wget, git, mysql/mariadb tools

### 🐳 Docker Integration
- **Automatic Network Setup**: Creates `redaxo-adminer-network` for container communication
- **Smart Container Connection**: Automatically connects DB containers to Adminer network
- **Custom Instance Support**: Intelligent hostname resolution for both standard and custom instances
- **DNS-Compliant Naming**: Handles custom instance naming patterns (removes underscores)

### 📊 PHP Configuration
- **upload_max_filesize**: 512M
- **post_max_size**: 512M  
- **memory_limit**: 512M
- **max_execution_time**: 600s

### 🎯 Technical Details
- **AdminerService**: New service for Adminer lifecycle management
- **URL Parameters**: `?username=X&db=Y&server=Z` for auto-filling form fields
- **Image**: `adminer:latest` with custom PHP configuration
- **Manual Controls**: Start/Stop Adminer commands available via Command Palette

---

## Version 1.8.1 (2025-11-21)

### 🔍 Improved Database Tool Detection
- **MariaDB/MySQL Auto-Detection**: `/install-tools` command now automatically detects whether containers use MariaDB or MySQL
- **Native Tool Support**: Uses `mariadb`/`mariadb-dump` for MariaDB images and `mysql`/`mysqldump` for MySQL images
- **Smart Installation**: Checks for existing tools before installation to avoid redundant operations
- **Accurate Reporting**: Shows actual installed/found tool names instead of generic terms

### 🛠️ Technical Improvements
- **DatabaseQueryService**: Enhanced `ensureMysqlClient()` to detect both MariaDB and MySQL native clients
- **Chat Participant**: Improved `installDbContainerTools()` with intelligent database system detection
- **Package Manager Support**: Better fallback logic for apt-get, apk, and yum package managers

### 📦 CLI Tools Installation
**Web Container Tools:**
- vim, nano, curl, wget, unzip, git

**Database Container Tools:**
- MariaDB: `mariadb`, `mariadb-dump`, vim, nano
- MySQL: `mysql`, `mysqldump`, vim, nano

---

## Version 1.8.0 (2025-01-21)

### 🤖 GitHub Copilot Chat Integration
- **New Chat Participant**: `@redaxo` for direct instance management from Copilot Chat
- **10 Slash Commands**: Full control over REDAXO instances via chat interface
  - `/create` - Create new instance
  - `/start [name]` - Start instance
  - `/stop [name]` - Stop instance
  - `/console <instance> <command>` - Execute REDAXO console commands
  - `/query <instance> <SQL>` - Run SQL queries
  - `/articles [instance]` - List articles
  - `/addons [instance]` - Manage AddOns
  - `/config <instance> <key>` - Read config values
  - `/logs <instance>` - View container logs
  - `/install-tools <instance>` - Install CLI tools

### ⚡ Direct Instance Communication
- **REDAXO Console Service**: Execute REDAXO console commands via Docker exec
- **Database Query Service**: Run MySQL queries directly with automatic client installation
- **FileSystem Service**: Read/write files in REDAXO containers
- **Log Access**: Read REDAXO logs (redaxo.log, system.log) from multiple locations

### 🔧 Enhanced Container Support
- **Dynamic Container Detection**: Supports both Standard (`redaxo-name`) and Custom (`nameweb`) naming patterns
- **Flexible Port Management**: Automatic detection of mapped database ports
- **Multiple Log Paths**: Searches 8 different log file locations for comprehensive coverage

### 📖 Documentation
- **Extended README**: Comprehensive Copilot Chat command documentation
- **Service APIs**: New `COMMUNICATION_SERVICES.md` for service documentation
- **Examples**: Practical use cases for all chat commands

### 🏆 Technical Excellence
- **Bundle Size**: 160 KB (minimized)
- **Three Core Services**: RedaxoConsoleService, DatabaseQueryService, FileSystemService
- **Follow-up Suggestions**: Context-aware command suggestions in chat
- **Error Handling**: Robust error handling with helpful user messages
