# 🚀 REDAXO Multi-Instances Manager 

👉 Für macOs und Linux

Eine mächtige VS Code Extension zur Verwaltung mehrerer REDAXO-Instanzen ("Custom Instances") mit Docker, SSL-Support und modernem Dashboard.

![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue?style=flat-square&logo=visual-studio-code)
![Docker](https://img.shields.io/badge/Docker-Required-blue?style=flat-square&logo=docker)
![REDAXO](https://img.shields.io/badge/REDAXO-5.x-green?style=flat-square)
![PHP](https://img.shields.io/badge/PHP-7.4%20|%208.1--8.5-purple?style=flat-square&logo=php)
![MariaDB](https://img.shields.io/badge/MariaDB-11.3-blue?style=flat-square)
![SSL](https://img.shields.io/badge/SSL-mkcert-orange?style=flat-square&logo=letsencrypt)

## ✨ Features

### 🎯 Kern-Funktionen
- **🏗️ Instanz-Management** - Erstellen, starten, stoppen und löschen von REDAXO-Instanzen
- **🔒 SSL/HTTPS Support** - Automatische SSL-Zertifikate mit mkcert
- **🐳 Docker Integration** - Vollständig containerisierte Umgebung
- **📊 Info Pages* - Modernes Webview-Dashboard je Instanz
- **🔑 Login-Informationen** - Automatische Anzeige von Zugangsdaten und URLs
- **📱 TreeView** - Seitenleiste mit allen Instanzen und deren Status

### 🔧 Technische Features
- **PHP Support** - PHP 7.4, 8.1, 8.2, 8.3, 8.4, 8.5
- **MariaDB Support** - Aktuell 11.3
- **Port Management** - Automatische Port-Zuweisung und -Verwaltung
- **SSL Zertifikate** - Lokale Entwicklungszertifikate mit mkcert
- **Docker Compose** - Automatische Container-Orchestrierung
- **Docker Images** - Basiert auf [friendsofredaxo/redaxo](https://github.com/FriendsOfREDAXO/docker-redaxo) und [mariadb](https://hub.docker.com/_/mariadb) Images

## 🚀 Installation

### Voraussetzungen

1. **VS Code** (Version 1.74.0 oder höher)
2. **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop)
3. **mkcert** (optional, für SSL)

### Extension Installation

#### Option 1: VSIX Package (Aktuell)
1. VSIX-Datei von [Releases](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/releases) herunterladen
2. VS Code öffnen
3. `Cmd+Shift+P` → "Extensions: Install from VSIX"
4. VSIX-Datei auswählen und installieren

#### Option 2: Repository klonen
```bash
git clone https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode.git
cd redaxo-multi-instances-vscode
npm install
npm run compile
```

## 🏁 Erste Schritte

1. **Extension aktivieren** - `Cmd+Shift+P` → `REDAXO: Show Dashboard`
2. **Erste Instanz erstellen** - `REDAXO: Create New Instance`
3. **Instanz konfigurieren** - Name, PHP-Version (7.4 + 8.1–8.5), MariaDB 11.3
4. **SSL aktivieren** - Optional für HTTPS-Support
5. **Zugriff** - Automatisch generierte URLs verwenden

## 📖 Verwendung

### Alle VS Code Kommandos (Auswahl)
- `REDAXO: Create New Instance` - Neue Instanz erstellen
- `REDAXO: Show Dashboard` - Dashboard öffnen
- `REDAXO: Show Login Info` - Login-Daten anzeigen (inkl. DB-Zugang)
- `REDAXO: Start/Stop Instance` - Instanzen verwalten
- `REDAXO: Setup HTTPS/SSL` - SSL für Instanz einrichten

### TreeView (Seitenleiste)
- 🟢 Grün = Instanz läuft
- 🔴 Rot = Instanz gestoppt  
- 🔒 SSL aktiviert
- Rechtsklick für Kontext-Menü

## 🔒 SSL/HTTPS Setup (Optional)

### macOS
```bash
brew install mkcert nss
mkcert -install
```

### Linux
```bash
sudo apt install libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

### Zugriff auf HTTPS-Instanzen
- **Frontend**: `https://instancename.local:8443`
- **Backend**: `https://instancename.local:8443/redaxo/`

## 🔧 Troubleshooting

### Container startet nicht
```bash
docker logs redaxo-instanzname
docker ps -a | grep redaxo
```

### SSL-Zertifikat nicht vertrauenswürdig
```bash
mkcert -uninstall
mkcert -install
```

### Domain nicht erreichbar
```bash
cat /etc/hosts | grep instancename.local
sudo dscacheutil -flushcache  # macOS
```

## 👨‍💻 Entwicklung

```bash
git clone https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode.git
cd redaxo-multi-instances-vscode
npm install
npm run compile
npm run watch  # Watch-Modus
F5  # Development Host starten
```

## 🤝 Beitragen / Changelog Auszug 1.1.0

### Neu / Geändert in 1.1.0
| Änderung | Beschreibung |
|----------|--------------|
| Umbenennung | "Empty Instance" → "Custom Instance" |
| Entfernt | Menüpunkt/Command Database Information |
| Pfad-Handling | Öffnen in Finder / Workspace für project/ Struktur gefixt |
| Versionen | PHP Auswahl bereinigt (7.4, 8.1–8.5) / MariaDB auf 11.3 |
| Cleanup | Alte Test- & Template-Dateien entfernt |
| Branding | README & Release Skript aktualisiert |

---

1. Repository forken
2. Feature Branch erstellen: `git checkout -b feature/name`
3. Änderungen committen: `git commit -m 'Add feature'`
4. Branch pushen: `git push origin feature/name`
5. Pull Request erstellen

## 📞 Support

- **GitHub Issues**: [Issues erstellen](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/issues)
- **REDAXO Community**: [REDAXO Slack](https://redaxo.org/slack/)

## Lead

[Thomas Skerbis](https://github.com/skerbis)

---

**Made with ❤️ by [FriendsOfREDAXO](https://github.com/FriendsOfREDAXO) - Danke Dirk! 🙏**
