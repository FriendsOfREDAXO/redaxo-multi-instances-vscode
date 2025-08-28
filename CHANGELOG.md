# Changelog

## [1.6.4] - 2025-08-29

### 🔧 Bug Fixes
- **Database Port Mapping**: Fixed external port display to show correct mapped ports from docker-compose.yml
- **Root Credentials**: Added root database credentials to External Access tab
- **Variable Consistency**: Fixed template variable mapping between dockerService and webview rendering

### 🏆 Technical Improvements
- **Correct Property Names**: Fixed `dbExternalPort`/`dbExternalHost` vs `dbPortExternal`/`dbHostExternal` mismatch
- **Port Extraction**: MySQL ports correctly extracted from docker-compose.yml port mappings
- **Database Info Display**: Proper differentiation between internal (3306) and external (mapped) ports

## [1.6.3] - 2025-08-29

### 🔧 Critical Bug Fixes
- **Database Port Mapping**: External DB ports correctly extracted from docker-compose.yml  
- **Root Credentials Display**: Root credentials available in both Container-Internal and External Access tabs
- **Variable Name Consistency**: Fixed variable mapping between dockerService and extension

## [1.6.2] - 2025-08-28

### 🔧 Critical Fixes
- **Hosts File Management**: Behebung von Duplikaten in /etc/hosts durch exakte Pattern-Matching
- **SSL_ERROR_RX_RECORD_TOO_LONG Fix**: Vollständige HTTP-zu-HTTPS Redirect-Implementierung verhindert Mixed-Protocol Fehler
- **Improved Host Detection**: Präzise `grep` Pattern vermeiden False-Positives bei ähnlichen Hostnamen (z.B. 'hhhh.local' vs 'hhhhhhh.local')

### ✨ New Features  
- **Hosts File Manager**: Neue `Manage Hosts File` Funktion mit drei Optionen:
  - **Show Hosts File**: Zeigt alle .local Einträge in der hosts-Datei
  - **Clean Duplicates**: Entfernt automatisch doppelte Einträge
  - **Reset Local Entries**: Komplettes Reset aller .local Einträge
- **Enhanced SSL Configuration**: Verbesserte Apache SSL-Konfiguration mit automatischen HTTP-Redirects
- **Duplicate Cleanup**: Automatische Bereinigung bei Host-Einträgen vor dem Hinzufügen neuer

### 🛡️ Security & Reliability
- **Exact Host Matching**: `^127\.0\.0\.1[[:space:]]+instancename\.local[[:space:]]*$` Pattern verhindert False-Positives
- **SSL Protocol Optimization**: Separate HTTP (Port 80) und HTTPS (Port 443) VirtualHosts mit korrekten Redirects  
- **Apache Module Management**: Korrekte SSL-Modul Aktivierung/Deaktivierung basierend auf SSL-Einstellungen
- **Backup Integration**: Automatische hosts-Datei Backups vor Änderungen

### 🔧 Technical Improvements
- **cleanupHostsFile()**: Neue Funktion entfernt duplicate Einträge vor dem Hinzufügen
- **Enhanced SSL Setup**: HTTP VirtualHost mit Redirect zu HTTPS verhindert Mixed-Content Fehler
- **Improved Error Handling**: Bessere Fehlerbehandlung bei hosts-Datei Operationen
- **Bundle Size**: 234 KiB mit allen neuen Host-Management Features

## [1.6.1] - 2025-08-28

### 🔑 Enhanced Database Access
- **MySQL Root User Support**: Vollständiger MySQL Root-User Zugang für beide Instanztypen (REDAXO und Custom)
- **Expanded Credentials Display**: Separate Bereiche für Standard User und Root User in beiden Verbindungstypen
- **Enhanced Copy Functionality**: 16+ Copy-Buttons für alle Database-Credentials inklusive Root-User
- **Unified Database Management**: Einheitliche Root-User Funktionalität für Standard REDAXO und Custom Instances
### ✨ UI Improvements
- **Clear User Separation**: Deutliche Trennung zwischen Standard User (redaxo/instanceName) und Root User
- **Complete Credential Coverage**: Sowohl interne (Container-zu-Container) als auch externe (localhost:port) Root-User Credentials
- **Enhanced Security**: Vollständiger Zugang zu MySQL Root-Funktionalität für erweiterte Database-Administration
- **Copy-Button Enhancement**: Ein-Klick-Kopieren für alle User-Typen und Verbindungsarten

### 🔧 Technical
- **DockerService Enhancement**: Erweiterte `getLoginInfo()` mit `dbRootPassword` für beide Instanztypen
- **Root Password Detection**: Automatische Erkennung von `DB_ROOT_PASSWORD`/`MYSQL_ROOT_PASSWORD` (REDAXO) und `'root'` (Custom)
- **JavaScript Functions**: Neue Copy-Funktionen für Root-User Credentials (intern/extern)
- **Bundle Optimization**: Effiziente Integration ohne signifikante Größenzunahme (218 KiB)

## [1.6.0] - 2025-08-28

### 🚀 Major Improvements
- **Simplified REDAXO Setup**: Komplett vereinfachte Installation durch Nutzung der nativen Docker Image Auto-Setup Funktionalität
- **Eliminated Installation Conflicts**: Behebt "User admin already exists" Fehler durch Wegfall komplexer Database-Cleanup Routinen
- **Native Docker Integration**: Voll auf FriendsOfREDAXO/docker-redaxo Image Auto-Installation optimiert
- **Reduced Bundle Size**: Code-Optimierung reduziert Bundle-Größe von 215 KiB auf 212 KiB

### ✨ Enhanced
- **Streamlined Setup Process**: Setup-Script fokussiert sich auf Login-Informationen statt komplexe Database-Management
- **Preserved SSL/HTTPS**: Alle SSL-Zertifikat und HTTPS-Funktionen bleiben vollständig erhalten
- **Environment Variable Setup**: Optimierte REDAXO_* Environment Variables für nahtlose Auto-Installation
- **Maintainable Codebase**: Deutlich einfachere und wartbarere Code-Struktur

### 🔧 Technical
- **Docker Image Compatibility**: 100% kompatibel mit friendsofredaxo/docker-redaxo Auto-Setup Features
- **SSL Configuration**: Beibehaltung aller mkcert-basierten SSL-Konfigurationen und Apache-Einstellungen
- **Database Persistence**: MySQL Volume-Persistenz funktioniert jetzt konfliktfrei mit Auto-Installation

## [1.5.2] - 2025-08-27

### 🔧 Fixed
- **MySQL External Access**: Verbesserte MySQL Port-Mapping für externe Datenbankverbindungen
- **Login Information**: Vollständige Anzeige von internen und externen Datenbankzugangsdaten
- **Custom Instances**: MySQL Ports werden jetzt korrekt für Custom Instances zugewiesen
- **Port Management**: Automatische Zuweisung freier MySQL Ports für alle Instanztypen

### ✨ Enhanced
- **Database Credentials**: Separate Bereiche für interne (Container-zu-Container) und externe (localhost:port) Verbindungen
- **Copy Functionality**: 10+ Copy-Buttons für alle Datenbankverbindungsparameter
- **Instance Detection**: Verbesserte Erkennung von Custom vs. REDAXO Instanzen für korrekte Credential-Anzeige

## [1.5.1] - 2025-08-26

### 🎨 Changed
- **Activity Bar Icon**: Neues großes, fettes "R" Icon für bessere Sichtbarkeit
- **Visual Branding**: Optimierte REDAXO Erkennbarkeit in VS Code Activity Bar
- **Icon Format**: Monochrome SVG mit automatischer Theme-Anpassung

## [1.5.0] - 2025-08-26

All notable changes to the "redaxo-multi-instances-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.4.0] - 2025-08-26

### Added
- **Help & Documentation System**: Comprehensive help page with quick start guide
- **Intuitive Instance Interaction**: Single-click on instances now opens action menu
- **Built-in Help Button**: Question mark icon in toolbar for easy access to documentation
- **Instance Type Comparison**: Clear explanation of Custom Instance vs. Create Instance difference

### Changed
- **Instance Click Behavior**: Single-click now shows action menu instead of opening browser
- Right-click context menu still available for power users

## [1.3.0] - 2025-08-26

### Added
- Visual Instance Type Distinction in TreeView with different icons and labels
- Copy buttons for login information (URLs, credentials, etc.)
- Enhanced hosts file management with duplicate detection
- Unified PHP configuration templates across all instance types
- Dynamic release script with automatic version detection from package.json

### Fixed
- SSL certificate mounting path corrected to `/etc/apache2/ssl`
- REDAXO console parameter fixed (`--servername` instead of `--server-name`)
- Apache container startup issues resolved
- PHP limits inconsistencies between standard and custom instances
- Duplicate hosts file entries prevention

### Changed
- Custom instances now show "Custom" label and package icon in TreeView
- Standard REDAXO instances show "REDAXO" label and server-environment icon
- Improved tooltips with instance type information
- Enhanced hosts file dialog with better user experience

## [1.1.0] - Previous Release

### Added
- Custom Instance support (renamed from Empty Instance)
- Improved path detection for workspace/finder operations

### Removed
- Database Information command and context menu

### Changed
- PHP version selection limited to 7.4 and 8.1-8.5
- MariaDB consolidated to version 11.3
- Updated branding and versioning

## [Unreleased]

- Initial release