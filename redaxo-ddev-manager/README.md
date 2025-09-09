# REDAXO DDEV Manager - VS Code Extension

A VS Code extension for managing REDAXO CMS projects with DDEV. This extension provides a complete DDEV-based development environment for REDAXO with an intuitive dashboard interface.

## Features

- **DDEV Project Management**: Create, start, stop, restart, and delete DDEV projects
- **REDAXO Installation**: Automatic REDAXO installation with version selection (5.15+)
- **Modern Dashboard**: Beautiful webview-based UI for project management
- **TreeView Integration**: Visual project status and management in VS Code sidebar
- **Database Tools**: Import/export database dumps with phpMyAdmin integration
- **Development Tools**: Built-in Mailhog, Xdebug, and other development utilities
- **SSL Support**: Automatic HTTPS with DDEV's certificate management
- **Project Sharing**: ngrok integration for sharing projects
- **Multi-PHP Support**: PHP versions 7.4 through 8.4
- **Database Options**: MySQL and MariaDB support

## Installation

1. Install [DDEV](https://ddev.readthedocs.io/en/stable/)
2. Install this extension from VS Code marketplace
3. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
4. Run `REDAXO DDEV: Open Dashboard` to get started

## Usage

### Creating a New REDAXO Project

1. Open the REDAXO DDEV Dashboard
2. Click "Create New Project"
3. Configure your project settings:
   - Project name and location
   - REDAXO version
   - PHP version
   - Database type
4. The extension will automatically:
   - Create DDEV configuration
   - Download and install REDAXO
   - Set up the database
   - Generate SSL certificates

### Managing Existing Projects

- View all projects in the REDAXO DDEV TreeView
- Start/stop projects with one click
- Access project URLs directly from VS Code
- Open terminals in project containers
- Import/export database dumps

## Requirements

- DDEV installed and configured
- Docker Desktop or compatible container runtime
- VS Code 1.74.0 or higher

## Extension Commands

- `redaxo-ddev.openDashboard`: Open REDAXO DDEV Dashboard
- `redaxo-ddev.createProject`: Create new REDAXO project
- `redaxo-ddev.startProject`: Start DDEV project
- `redaxo-ddev.stopProject`: Stop DDEV project
- `redaxo-ddev.restartProject`: Restart DDEV project
- `redaxo-ddev.deleteProject`: Delete DDEV project
- `redaxo-ddev.importDatabase`: Import database dump
- `redaxo-ddev.exportDatabase`: Export database dump
- `redaxo-ddev.openUrl`: Open project URL in browser
- `redaxo-ddev.refreshProjects`: Refresh project list

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.