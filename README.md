# redaxo# 🚀 REDAXO Multi-Instances Manager für VS Code

Eine mächtige VS Code Extension zur Verwaltung mehrerer REDAXO-Instanzen mit Docker, SSL-Support und modernem Dashboard.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?style=flat-square&logo=visual-studio-code)
![Docker](https://img.shields.io/badge/Docker-Required-blue?style=flat-square&logo=docker)
![REDAXO](https://img.shields.io/badge/REDAXO-5.x-green?style=flat-square)
![PHP](https://img.shields.io/badge/PHP-7.4--8.5-purple?style=flat-square&logo=php)
![SSL](https://img.shields.io/badge/SSL-mkcert-orange?style=flat-square&logo=letsencrypt)

## 📋 Inhaltsverzeichnis

- [Features](#-features)
- [Installation](#-installation)
- [Erste Schritte](#-erste-schritte)
- [SSL/HTTPS Setup](#-sslhttps-setup)
- [Verwendung](#-verwendung)
- [Konfiguration](#️-konfiguration)
- [Troubleshooting](#-troubleshooting)
- [Entwicklung](#-entwicklung)
- [Beitragen](#-beitragen)

## ✨ Features

### 🎯 Kern-Funktionen
- **🏗️ Instanz-Management** - Erstellen, starten, stoppen und löschen von REDAXO-Instanzen
- **🔒 SSL/HTTPS Support** - Automatische SSL-Zertifikate mit mkcert
- **🐳 Docker Integration** - Vollständig containerisierte Umgebung
- **📊 Dashboard** - Modernes Webview-Dashboard mit Übersicht aller Instanzen
- **🔑 Login-Informationen** - Automatische Anzeige von Zugangsdaten und URLs
- **📱 TreeView** - Seitenleiste mit allen Instanzen und deren Status

### 🔧 Technische Features
- **PHP Support** - PHP 7.4, 8.1, 8.2, 8.3, 8.4, 8.5
- **MariaDB Support** - Verschiedene MariaDB-Versionen (10.6 - 11.2)
- **Port Management** - Automatische Port-Zuweisung und -Verwaltung
- **SSL Zertifikate** - Lokale Entwicklungszertifikate mit mkcert
- **Docker Compose** - Automatische Container-Orchestrierung
- **Backup & Restore** - SQL-Dump Import und Export

### 🌐 Netzwerk Features
- **Lokale Domains** - `instancename.local` für jede Instanz
- **HTTPS Redirects** - Automatische Weiterleitung von HTTP zu HTTPS
- **Proxy Support** - Dokumentation für Reverse Proxy Setup
- **Hosts-Datei Integration** - Automatische Domain-Konfiguration

## 🚀 Installation

### Voraussetzungen

1. **VS Code** (Version 1.74.0 oder höher)
2. **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop)
3. **mkcert** (optional, für SSL) - [Installation Guide](#ssl-setup)

### Extension Installation

#### Option 1: VS Code Marketplace (Coming Soon)
```bash
# Über Command Palette
Ctrl+Shift+P → "Extensions: Install Extensions" → "REDAXO Multi-Instances"
```

#### Option 2: Manuell aus Repository
```bash
# Repository klonen
git clone https://github.com/skerbis/redaxo-multi-instances-vscode.git
cd redaxo-multi-instances-vscode

# Dependencies installieren
npm install

# Extension kompilieren
npm run compile

# Extension in VS Code laden
F5 (Development Host starten)
```

#### Option 3: VSIX Package
```bash
# Extension als Package erstellen
npm run package

# In VS Code installieren
code --install-extension redaxo-multi-instances-*.vsix
```

## 🏁 Erste Schritte

### 1. Extension aktivieren
- VS Code starten
- Command Palette öffnen (`Cmd+Shift+P` / `Ctrl+Shift+P`)
- `REDAXO: Show Dashboard` eingeben und ausführen

### 2. Erste Instanz erstellen
```bash
# Command Palette
Cmd+Shift+P → "REDAXO: Create New Instance"

# Oder über TreeView
Seitenleiste → REDAXO INSTANCES → "+" Button
```

### 3. Instanz konfigurieren
- **Name**: Eindeutiger Instanzname (z.B. `mein-projekt`)
- **PHP Version**: 7.4, 8.1, 8.2, 8.3, 8.4 oder 8.5
- **MariaDB Version**: 10.6, 10.11, 11.1 oder 11.2
- **SSL aktivieren**: Für HTTPS-Support

### 4. Instanz starten
```bash
# Automatischer Start nach Erstellung
# Oder manuell über TreeView: Rechtsklick → "Start Instance"
```

## 🔒 SSL/HTTPS Setup

### mkcert Installation

#### macOS
```bash
# Mit Homebrew (empfohlen)
brew install mkcert
brew install nss  # für Firefox

# CA installieren
mkcert -install
```

#### Linux (Ubuntu/Debian)
```bash
# NSS Tools installieren
sudo apt install libnss3-tools

# mkcert installieren
brew install mkcert
# ODER
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert

# CA installieren
mkcert -install
```

#### Windows
```bash
# Mit Chocolatey
choco install mkcert

# Mit Scoop
scoop bucket add extras
scoop install mkcert

# CA installieren (als Administrator)
mkcert -install
```

### SSL für Instanzen aktivieren

#### Neue Instanz mit SSL
1. `REDAXO: Create New Instance`
2. SSL-Option aktivieren ✅
3. Instanz wird automatisch mit HTTPS konfiguriert

#### SSL zu bestehender Instanz hinzufügen
1. TreeView → Instanz Rechtsklick
2. `Setup HTTPS/SSL` wählen
3. Container wird neu gestartet mit SSL-Support

### Zugriff auf HTTPS-Instanzen
- **Frontend**: `https://instancename.local:8443`
- **Backend**: `https://instancename.local:8443/redaxo/`
- **HTTP-Zugang**: Wird automatisch auf HTTPS umgeleitet

## 📖 Verwendung

### Dashboard

Das Dashboard bietet eine zentrale Übersicht aller Instanzen:

```bash
# Dashboard öffnen
Cmd+Shift+P → "REDAXO: Show Dashboard"
```

**Dashboard Features:**
- 📊 Statusübersicht aller Instanzen
- 🔗 Direkte Links zu Frontend/Backend
- 🔑 Login-Informationen anzeigen
- ⚡ Instanzen starten/stoppen
- 🗑️ Instanzen löschen

### TreeView (Seitenleiste)

Die Seitenleiste zeigt alle Instanzen mit Status-Icons:

- 🟢 **Grün** - Instanz läuft
- 🔴 **Rot** - Instanz gestoppt
- 🟡 **Gelb** - Instanz wird gestartet
- 🔒 **Schloss-Icon** - SSL aktiviert

**TreeView Aktionen:**
- **Rechtsklick** auf Instanz für Kontext-Menü
- **Doppelklick** für Login-Informationen
- **Hover** für Tooltip mit Details

### Kommandos

Alle verfügbaren VS Code Kommandos:

```bash
# Instanz-Management
REDAXO: Create New Instance          # Neue Instanz erstellen
REDAXO: Start Instance              # Instanz starten  
REDAXO: Stop Instance               # Instanz stoppen
REDAXO: Delete Instance             # Instanz löschen
REDAXO: Restart Instance            # Instanz neu starten

# Information & Zugriff
REDAXO: Show Dashboard              # Dashboard öffnen
REDAXO: Show Login Info             # Login-Daten anzeigen
REDAXO: Open Frontend               # Frontend im Browser öffnen
REDAXO: Open Backend                # Backend im Browser öffnen

# SSL & Konfiguration  
REDAXO: Setup HTTPS/SSL             # SSL für Instanz einrichten
REDAXO: Refresh Instances           # Instanzen-Liste aktualisieren

# Import & Export
REDAXO: Import SQL Dump             # SQL-Dump importieren
REDAXO: Export Database             # Datenbank exportieren
```

## ⚙️ Konfiguration

### Port-Management

Automatische Port-Zuweisung verhindert Konflikte:

```bash
Instanz 1: HTTP=8080, HTTPS=8443
Instanz 2: HTTP=8081, HTTPS=8444  
Instanz 3: HTTP=8082, HTTPS=8445
...
```

### Hosts-Datei

Automatische Einträge in `/etc/hosts`:

```bash
# Für Instanz "mein-projekt"
127.0.0.1 mein-projekt.local
127.0.0.1 www.mein-projekt.local
```

## 🔧 Troubleshooting

### Häufige Probleme

#### 1. Container startet nicht
```bash
# Container-Logs prüfen
docker logs redaxo-instanzname

# Ports prüfen
docker ps -a | grep redaxo
```

#### 2. SSL-Zertifikat nicht vertrauenswürdig
```bash
# mkcert CA neu installieren
mkcert -uninstall
mkcert -install
```

#### 3. Domain nicht erreichbar
```bash
# Hosts-Datei prüfen
cat /etc/hosts | grep instancename.local

# DNS-Cache leeren (macOS)
sudo dscacheutil -flushcache
```

## 👨‍💻 Entwicklung

### Repository Setup

```bash
# Repository klonen
git clone https://github.com/skerbis/redaxo-multi-instances-vscode.git
cd redaxo-multi-instances-vscode

# Dependencies installieren
npm install

# Extension kompilieren
npm run compile

# Watch-Modus für Entwicklung
npm run watch
```

### Build-Prozess

```bash
# Entwicklung (Watch-Modus)
npm run watch

# Einmaliger Build
npm run compile

# Extension Package erstellen
npm run package
```

## 🤝 Beitragen

Beiträge sind herzlich willkommen! 

1. **Fork** das Repository
2. **Feature Branch** erstellen: `git checkout -b feature/amazing-feature`
3. **Änderungen committen**: `git commit -m 'Add amazing feature'`
4. **Branch pushen**: `git push origin feature/amazing-feature`
5. **Pull Request** erstellen

## 📜 Lizenz

MIT License - siehe [LICENSE](LICENSE) Datei.

## 🙏 Danksagungen

- **REDAXO CMS** - Das fantastische CMS-System
- **friends of REDAXO** - Docker Images und Community
- **mkcert** - Lokale SSL-Zertifikate
- **VS Code Team** - Hervorragende Extension API

## 📞 Support

- **GitHub Issues**: [Issues erstellen](https://github.com/skerbis/redaxo-multi-instances-vscode/issues)
- **REDAXO Community**: [REDAXO Slack](https://redaxo.org/slack/)

---

**Made with ❤️ for the REDAXO Community**ti-instances-manager README

This is the README for your extension "redaxo-multi-instances-manager". After writing up a brief description, we recommend including the following sections.

## Features

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
