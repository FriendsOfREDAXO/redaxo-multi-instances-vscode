# REDAXO DDEV Manager - Installation Guide

## Prerequisites

### 1. Install DDEV

Follow the official DDEV installation guide for your operating system:

**macOS:**
```bash
brew install ddev
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://apt.fury.io/drud/gpg.key | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/ddev.gpg > /dev/null
echo "deb [signed-by=/etc/apt/trusted.gpg.d/ddev.gpg] https://apt.fury.io/drud/ * *" | sudo tee /etc/apt/sources.list.d/ddev.list
sudo apt update
sudo apt install ddev
```

**Windows:**
Use the Windows installer from the [DDEV releases page](https://github.com/drud/ddev/releases).

### 2. Install Docker

DDEV requires Docker Desktop or a compatible container runtime:

- **Docker Desktop**: Download from [docker.com](https://www.docker.com/products/docker-desktop)
- **Colima** (macOS alternative): `brew install colima`
- **Podman** (Linux alternative): Follow [Podman installation guide](https://podman.io/getting-started/installation)

### 3. Verify Installation

After installing DDEV and Docker, verify everything is working:

```bash
# Check DDEV version
ddev version

# Check Docker is running
docker ps

# Test DDEV functionality
ddev config global --instrumentation-opt-in=false
```

## Extension Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "REDAXO DDEV Manager"
4. Click "Install"

### From VSIX Package

1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
4. Click "..." menu → "Install from VSIX..."
5. Select the downloaded `.vsix` file

## Configuration

### Extension Settings

Configure the extension through VS Code settings (`Ctrl+,` / `Cmd+,`):

- **Default REDAXO Version**: Set your preferred REDAXO version for new projects
- **Default PHP Version**: Choose default PHP version (7.4-8.4)
- **Default Database**: Select default database (MySQL/MariaDB versions)
- **Projects Directory**: Set default location for new projects

### DDEV Global Configuration

Recommended global DDEV settings for REDAXO development:

```bash
# Disable telemetry
ddev config global --instrumentation-opt-in=false

# Set default PHP version (optional)
ddev config global --php-version=8.1

# Configure router bind port (if needed)
ddev config global --router-bind-all-interfaces=true
```

## First Project

1. Open VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run "REDAXO DDEV: Open Dashboard"
3. Click "Create New Project"
4. Fill in project details:
   - Project name (e.g., "my-redaxo-site")
   - Project location (full path to directory)
   - REDAXO version
   - PHP version
   - Database type
   - Admin credentials
5. Click "Create Project"

The extension will automatically:
- Create DDEV configuration
- Download and install REDAXO
- Set up the database
- Start the development environment

## Troubleshooting

### DDEV Not Found

If you get "DDEV not found" errors:

1. Ensure DDEV is installed and in your PATH
2. Restart VS Code after DDEV installation
3. Check DDEV installation: `which ddev` or `where ddev`

### Docker Issues

If Docker-related errors occur:

1. Ensure Docker is running
2. Check Docker permissions (Linux)
3. Restart Docker Desktop
4. Try: `ddev debug test`

### Port Conflicts

If port conflicts occur:

1. Stop other web servers (Apache, Nginx)
2. Configure DDEV ports: `ddev config --router-http-port=8080 --router-https-port=8443`
3. Use `ddev describe` to see assigned ports

### Permission Issues (Linux/macOS)

If file permission issues occur:

```bash
# Fix file permissions
sudo chown -R $USER:$USER /path/to/project

# Configure DDEV NFS (macOS)
ddev config global --nfs-mount-enabled=true
```

### Memory Issues

For large projects or multiple instances:

```bash
# Increase Docker memory (Docker Desktop)
# Settings → Resources → Memory: 4GB+

# Optimize DDEV performance
ddev config global --omit-containers=dba
```

## Performance Optimization

### macOS Performance

```bash
# Enable NFS for better file performance
ddev config global --nfs-mount-enabled=true

# Use mutagen for file sync (alternative)
ddev config global --mutagen-enabled=true
```

### Windows Performance

```bash
# Enable WSL2 backend in Docker Desktop
# Use WSL2 file system for projects
```

### General Optimization

```bash
# Disable unused containers globally
ddev config global --omit-containers=dba,mailhog

# Use specific containers per project
ddev config --omit-containers=mailhog
```

## Getting Help

- **DDEV Documentation**: https://ddev.readthedocs.io/
- **REDAXO Documentation**: https://redaxo.org/doku/
- **Extension Issues**: https://github.com/FriendsOfREDAXO/redaxo-ddev-manager/issues
- **DDEV Community**: https://discord.gg/5wjP76mBJD