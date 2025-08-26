## 🚀 REDAXO Multi-Instances Manager v1.3.0

### 🆕 New Features
- 🎯 **Visual Instance Type Distinction**: TreeView zeigt jetzt deutlich REDAXO vs Custom Instanzen
  - 🔧 Custom Instanzen: `package` Icon + "Custom" Label
  - 🏗️ REDAXO Instanzen: `server-environment` Icon + "REDAXO" Label
  - 📄 Erweiterte Tooltips mit Instance-Type-Information
- 📋 **Copy Buttons für Login-Informationen**: Ein-Klick-Kopieren für URLs, Credentials etc.
- 🏠 **Verbesserte Hosts File Integration**: 
  - Intelligente Hosts-Datei-Verwaltung mit Duplikat-Erkennung
  - Automatische Validierung und Bereinigung bestehender Einträge
  - Benutzerfreundlicher Dialog mit Optionen

### 🔧 Technical Improvements  
- 🔒 **SSL Certificate Mounting Fix**: SSL-Zertifikate werden jetzt korrekt in `/etc/apache2/ssl` gemountet (nicht mehr in system CA store)
- ⚡ **Unified PHP Configuration**: Konsistente PHP-Limits über alle Instance-Typen hinweg
  - 2048M memory_limit, 512M upload/post limits
  - Optimierte OPcache-Einstellungen für bessere Performance
- 🐳 **Docker Setup Optimization**: Verbesserte Template-Generierung für konsistente Umgebungen
- 📦 **Dynamic Release Script**: Automatische Versionserkennung aus package.json
- ⚠️ **REDAXO Console Parameter Fix**: Korrigierte `--servername` Parameter für Apache-Kompatibilität

### 🛠️ Bug Fixes
- ✅ Apache Container Startup Issues mit REDAXO Console behoben
- ✅ SSL-Zertifikat-Mounting in korrekten Apache-Pfad
- ✅ PHP-Limits Inkonsistenzen zwischen Standard/Custom Instanzen behoben
- ✅ Duplicate Hosts-Einträge werden vermieden
- ✅ Release-Script mit dynamischer Versionserkennung

### 🔄 Changes since v1.1.0
- ✅ Umbenennung "Empty Instance" → "Custom Instance" (bereits in 1.1.0)
- 🎯 **NEU**: Visuelle Unterscheidung von Instance-Typen in TreeView
- 📋 **NEU**: Copy-Buttons für alle wichtigen URLs und Credentials
- 🔒 **FIXED**: SSL Certificate Mounting-Probleme behoben
- ⚡ **IMPROVED**: Einheitliche PHP-Konfiguration über alle Instance-Typen
- 🏠 **ENHANCED**: Intelligente Hosts-Datei-Verwaltung

### ✨ Core Features (weiterhin verfügbar)
- 🏗️ Multi-Instance Management für REDAXO & Custom PHP-Projekte
- 🔒 SSL/HTTPS mit mkcert Integration
- 🐳 Docker Compose Setup mit optimierten Templates
- 🔑 Login-Informationen Panel mit Copy-Funktionalität
- 📦 Custom Instance Projektstruktur (project/public)
- 🌐 Automatische Port-Verwaltung und SSL-Setup

### 📥 Installation
1. VSIX herunterladen
2. VS Code → `Cmd+Shift+P` → "Extensions: Install from VSIX"
3. Datei auswählen

### 🏁 Quick Start
1. Sidebar öffnen → Instanz erstellen (REDAXO oder Custom)
2. PHP & MariaDB Version auswählen  
3. Optional SSL aktivieren
4. Browser öffnen (Frontend/Backend URLs mit Copy-Button)

### 🌐 Beispiel URLs
- HTTP: `http://localhost:8080`
- Backend: `http://localhost:8080/redaxo` 
- HTTPS (mit Hosts-Eintrag): `https://instancename.local:8443`

### 🔧 System Requirements
- Docker Desktop installiert und laufend
- VS Code 1.74.0 oder höher
- macOS/Linux (Windows mit WSL2)

### ❤️ Community
GitHub Issues & REDAXO Slack – siehe README für Details.

---

## 🚀 REDAXO Multi-Instances Manager v1.1.0

### 🔄 Changes since v1.0.0
- ✅ Umbenennung "Empty Instance" → "Custom Instance"
- �️ Entfernt: "Database Information" Command & Kontextmenü
- 🧭 Verbessert: Pfad-Erkennung für Workspace/Finder (unterstützt jetzt project/ & project/public)
- 🧪 Aufräumen: Alte Test- und Template-Dateien entfernt
- 🔧 Versionierung & Branding aktualisiert
- 🐘 PHP Auswahl eingeschränkt auf 7.4 + 8.1–8.5
- 🐬 MariaDB auf 11.3 konsolidiert (nur aktuelle Version wählbar)

### ✨ Core Features (unverändert)
- 🏗️ Multi-Instance Management
- 🔒 SSL/HTTPS mit mkcert
- 🐳 Docker Compose Setup
- 🔑 Login-Informationen Panel
- 📦 Custom Instance Projektstruktur (project/public)

### 📥 Installation
1. VSIX herunterladen
2. VS Code → `Cmd+Shift+P` → "Extensions: Install from VSIX"
3. Datei auswählen

### 🏁 Quick Start
1. Sidebar öffnen → Instanz erstellen
2. PHP & MariaDB auswählen
3. Optional SSL aktivieren
4. Browser öffnen (Frontend/Backend)

### 🌐 Beispiel URLs
- HTTP: `http://localhost:8080`
- Backend: `http://localhost:8080/redaxo`
- HTTPS (mit Hosts-Eintrag): `https://instancename.local:8443`

### ❤️ Community
GitHub Issues & REDAXO Slack – siehe README.

