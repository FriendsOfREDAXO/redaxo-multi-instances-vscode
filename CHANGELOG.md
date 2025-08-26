# Change Log

All notable changes to the "redaxo-multi-instances-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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