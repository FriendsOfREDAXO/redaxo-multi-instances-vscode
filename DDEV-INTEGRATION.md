# DDEV Integration for REDAXO Multi-Instances

This extension now supports DDEV as an alternative to Docker for managing REDAXO instances. DDEV provides several advantages for local development:

## Features

### 🚀 Easy Setup
- Automatic local domain setup (`.ddev.site`)
- Built-in HTTPS with trusted certificates
- Easy PHP and MariaDB version switching

### 📦 REDAXO Structure Support
- **Classic Structure**: Traditional REDAXO layout with root as webroot
- **Modern Structure**: REDAXO with `public/` folder as webroot

### 🔧 Integrated Management
- Create, start, stop, and delete DDEV projects from VS Code
- Seamless integration with existing Docker workflow
- Visual differentiation between Docker and DDEV instances

## Requirements

1. **DDEV installed**: https://ddev.readthedocs.io/en/stable/#installation
2. **Docker or Podman**: DDEV requires one of these container engines

## Configuration

Add these settings to your VS Code configuration:

```json
{
  "redaxo-instances.ddevPath": "ddev",
  "redaxo-instances.defaultContainerType": "ddev",
  "redaxo-instances.defaultRedaxoStructure": "modern"
}
```

## Creating DDEV Instances

1. Open the "Empty Instance" panel in the REDAXO Multi-Instances view
2. Select **DDEV** as Container Type
3. Choose between **Classic** or **Modern** REDAXO structure
4. Configure PHP and MariaDB versions
5. Enable automatic REDAXO installation
6. Click "Create Custom Instance"

## Instance Management

DDEV instances appear in the instances list with:
- 🚀 or 🌐 icons (instead of 🐳 for Docker)
- "DDEV" label in the description
- Local domain shown (e.g., `myproject.ddev.site`)

### Available Commands

All standard commands work with DDEV instances:
- **Start/Stop**: Uses `ddev start` and `ddev stop`
- **Delete**: Uses `ddev delete` and removes project files
- **Open in Browser**: Opens the `.ddev.site` domain
- **Open Workspace**: Opens the project folder in VS Code

### DDEV-Specific Features

- **Automatic HTTPS**: All DDEV sites use HTTPS by default
- **Local Domains**: Access via `https://projectname.ddev.site`
- **Database Access**: Built-in phpMyAdmin access
- **Mailhog**: Email testing available at `:8025`

## Supported REDAXO Structures

### Classic Structure
- Downloads from: https://github.com/redaxo/redaxo/releases
- Files extracted to project root
- Webroot: project root directory

### Modern Structure  
- Downloads from: https://github.com/skerbis/REDAXO_MODERN_STRUCTURE/releases
- Uses pattern: `redaxo-setup-{VERSION}.zip`
- Webroot: `public/` directory

## Version Management

### PHP Versions
- 7.4, 8.1, 8.2, 8.3, 8.4, 8.5
- Easy switching with `ddev config --php-version=8.3`

### MariaDB Versions  
- 10.4, 10.5, 10.6, 10.11, 11.0, 11.x
- Configured in `.ddev/config.yaml`

## Troubleshooting

### DDEV Not Available
If you see "DDEV is not available" errors:
1. Install DDEV: https://ddev.readthedocs.io/en/stable/#installation
2. Ensure DDEV is in your PATH
3. Update the `redaxo-instances.ddevPath` setting if needed

### Port Conflicts
DDEV automatically manages ports, but if you have conflicts:
```bash
ddev stop --all  # Stop all DDEV projects
ddev start       # Restart your project
```

### SSL Certificate Issues
DDEV uses mkcert for local HTTPS. If you have certificate issues:
```bash
mkcert -install  # Install the local CA
ddev restart     # Restart your project
```

## Migration from Docker

To migrate existing Docker instances to DDEV:

1. Export your database: `docker-compose exec db mysqldump -u root -p redaxo > backup.sql`
2. Create a new DDEV instance with the same name
3. Import the database: `ddev import-db --src=backup.sql`
4. Copy your files to the new instance
5. Delete the old Docker instance

## Advanced Configuration

### Custom .ddev/config.yaml
You can customize DDEV projects by editing `.ddev/config.yaml`:

```yaml
name: my-redaxo-project
type: php
docroot: public
php_version: "8.3"
database:
  type: mariadb
  version: "10.11"
additional_hostnames:
  - my-redaxo-project.local
hooks:
  post-start:
    - exec: composer install
```

### Performance Optimization
Add to `.ddev/config.yaml` for better performance:

```yaml
performance_mode: mutagen  # For Mac/Windows
nfs_mount_enabled: true    # For Mac (legacy)
```

## Resources

- [DDEV Documentation](https://ddev.readthedocs.io/)
- [REDAXO Documentation](https://redaxo.org/docs/)
- [Modern REDAXO Structure](https://github.com/skerbis/REDAXO_MODERN_STRUCTURE)

## Support

For issues specific to DDEV integration:
1. Check the DDEV service is available: `ddev version`
2. Review VS Code Output panel: "REDAXO Instances"
3. Check DDEV project status: `ddev status`
4. Report issues on the extension's GitHub repository