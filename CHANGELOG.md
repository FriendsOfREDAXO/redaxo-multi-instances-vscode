# Changelog

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