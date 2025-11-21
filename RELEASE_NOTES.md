# 🚀 REDAXO Multi-Instances Manager - Release Notes

# Release Notes

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
