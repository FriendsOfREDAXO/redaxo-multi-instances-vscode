## 🚀 REDAXO Multi-Instances Manager v1.0.0

### ✨ Core Features
- 🏗️ **Multi-Instance Management** - Erstellen, starten, stoppen und löschen von REDAXO-Instanzen  
- 🔒 **SSL/HTTPS Support** - Automatische SSL-Zertifikate mit mkcert
- 🐳 **Docker Integration** - Vollständig containerisierte Umgebung
- 📊 **Dashboard** - Modernes Webview-Dashboard mit TreeView
- 🔑 **Login-Informationen** - Automatische Anzeige von Zugangsdaten und URLs

### 🔧 Technical Features
- **PHP Support** - PHP 7.4, 8.1, 8.2, 8.3, 8.4, 8.5
- **MariaDB Support** - MariaDB 10.6 - 11.2
- **Port Management** - Automatische Port-Zuweisung (HTTP + HTTPS)
- **SSL Zertifikate** - Lokale Entwicklungszertifikate mit mkcert
- **Docker Compose** - Automatische Container-Orchestrierung

### 📥 Installation

#### Option 1: VSIX Package (Empfohlen)
1. **VSIX-Datei herunterladen** von diesem Release
2. **VS Code öffnen**
3. **Command Palette**: `Cmd+Shift+P` / `Ctrl+Shift+P`
4. **"Extensions: Install from VSIX"** eingeben
5. **VSIX-Datei auswählen** und installieren

#### Option 2: Repository klonen
```bash
git clone https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode.git
cd redaxo-multi-instances-vscode
npm install
npm run compile
```

### 🔒 SSL/HTTPS Setup (Optional)

#### macOS
```bash
brew install mkcert nss
mkcert -install
```

#### Linux  
```bash
sudo apt install libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

### 🏁 Erste Schritte
1. **Dashboard öffnen**: `Cmd+Shift+P` → `REDAXO: Show Dashboard`
2. **Instanz erstellen**: `REDAXO: Create New Instance` 
3. **Konfiguration**: Name, PHP-Version (7.4-8.5), MariaDB-Version, SSL optional
4. **Zugriff**: Über automatisch generierte URLs (mit korrekten Ports!)

### 🌐 Beispiel URLs
- **HTTP Frontend**: `http://localhost:8080`
- **HTTP Backend**: `http://localhost:8080/redaxo`
- **HTTPS Frontend**: `https://instancename.local:8443` 
- **HTTPS Backend**: `https://instancename.local:8443/redaxo`

### 📞 Support & Community
- **GitHub Issues**: [Probleme melden](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/issues)
- **REDAXO Community**: [REDAXO Slack](https://redaxo.org/slack/)
- **Dokumentation**: [Repository README](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode)

---
**Made with ❤️ for the REDAXO Community**
