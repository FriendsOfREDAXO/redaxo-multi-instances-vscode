# 🚀 REDAXO Multi-Instances Manager - Release Notes

# Release Notes

## Version 1.7.1 (2025-08-30)

### 🔧 Bug Fixes
- **Admin Password Fix**: Corrected REDAXO admin password display to show actual password from .env file instead of hardcoded 'admin'
- **Login Info Functionality**: Fixed copy and visibility toggle buttons for admin password
- **Password Authentication**: Admin password now correctly reads from MYSQL_PASSWORD environment variable

### 🛠️ Technical Improvements
- Fixed JavaScript selectors for login info password field interactions
- Improved password field visibility toggle with proper placeholder handling
- Enhanced password extraction from Docker environment variables

---

## Version 1.7.0 (2025-08-29)

### 🔧 Improvements
- **Login Info UI**: Removed Modern Login Info preview from context menu
- **URL Functionality**: Maintained clickable URLs in login info while removing demo preview
- **User Experience**: Streamlined context menu by removing preview/demo entries

### 🛠️ Technical Changes
- Cleaned up package.json context menu entries
- Maintained full login info functionality without preview mode
- Improved user interface consistency

---

## Version 1.6.5 (2025-08-29)
*Veröffentlicht: 29. August 2025*

### 🎯 Intelligente Benutzeroberfläche
- **🔍 Context-Aware Login-Info**: REDAXO Backend Login nur bei Standard REDAXO Instances angezeigt
- **💡 Custom Instance Klarstellung**: Informative Password-Hinweise für Custom Instances
- **🌐 DNS-konforme Container**: Alle Container-Namen ohne Unterstriche für bessere Kompatibilität

### 🗄️ MariaDB Version Updates
- **📦 MariaDB 11.6** (Neueste LTS) - Empfohlen
- **⚡ MariaDB 11.5** (Stabil)
- **🔧 MariaDB 11.4** (Bewährt)
- **📊 Mehrere Optionen**: 11.3, 11.2, 10.11 Legacy zur Auswahl

### ✨ Enhanced Custom Instances
- **🏷️ Smart Detection**: Verbesserte Erkennung von Custom vs REDAXO Instances
- **🔑 Password Clarity**: "Custom Instance: Passwort = Instance Name" Hinweise
- **📋 Selective Display**: Nur relevante UI-Elemente basierend auf Instance-Typ

### 🔧 Technical Excellence
- **🌍 DNS Compliance**: Container-Namen ohne Unterstriche (instancenamedb vs instance_db)
- **🔄 Backward Compatibility**: Unterstützt sowohl alte als auch neue Container-Namen
- **⚡ Optimized Detection**: Verbesserte Custom Instance Erkennung in docker-compose.yml

---

## 📦 Version 1.6.4 - Database Port Mapping Final Fix
*Veröffentlicht: 29. August 2025*

### 🔧 Critical Bug Fixes
- **🎯 Fixed External Port Display**: Database externe Ports werden jetzt korrekt angezeigt (3307 vs 3306)
- **🔗 Variable Name Consistency**: Template-Variable-Mapping zwischen dockerService und extension korrigiert
- **📊 Complete Root Credentials**: Root-Credentials jetzt vollständig in External Access Tab verfügbar

### 🏆 Technical Fixes
- **Correct Property Mapping**: `dbExternalPort` und `dbExternalHost` statt `dbPortExternal`/`dbHostExternal`
- **Docker Port Extraction**: MySQL Ports aus docker-compose.yml werden korrekt extrahiert und angezeigt
- **Consistent Database Info**: Einheitliche Darstellung interner (3306) vs externer (gemappter) Ports

---

## 📦 Version 1.6.3 - Database Port Mapping & Root Credentials Fix
*Veröffentlicht: 29. August 2025*

### 🔧 Critical Bug Fixes
- **🎯 Database Port Mapping**: Externe DB-Ports werden jetzt korrekt aus docker-compose.yml extrahiert (z.B. 3307 statt 3306)
- **📊 Root Credentials in External Tab**: Root-User Credentials sind jetzt auch im "External Access" Tab verfügbar
- **🔗 Variable Name Consistency**: Behoben Variable-Mapping zwischen dockerService und extension (dbExternalPort/dbExternalHost)

### ✨ Enhanced Database Access
- **🌐 External Connection**: Externe DB-Verbindungen zeigen jetzt den korrekten gemappten Host-Port (localhost:3307)
- **📦 Internal Connection**: Interne DB-Verbindungen verwenden weiterhin Container-Port (mysql:3306)
- **👤 Complete Root Access**: Root-Credentials in beiden Tabs (Container-Internal & External Access)

### 🔧 Technical Fixes
- **Regex Port Extraction**: Korrekte Extraktion externer Ports aus docker-compose.yml Port-Mappings
- **Template Variable Mapping**: `dbExternalPort` und `dbExternalHost` korrekt gemappt
- **Consistent UI**: Einheitliche Root-Credentials Darstellung in beiden Database-Tabs

---

## 📦 Version 1.6.2 - Modern Login-Info & Auto-SSL
*Veröffentlicht: 28. August 2025*

### 🎨 Modern Login-Info Webview
- **💎 Morphing Glass Design**: Moderne glassmorphische UI mit CSS-Blur-Effekten
- **� Tab-System**: Container-Internal vs External Database Verbindungen
- **👁️ Password Toggles**: Ein-Klick-Sichtbarkeit für alle Credentials
- **🌐 HTTPS URLs**: Korrekte Ports für .local Domains mit SSL-Setup-Hinweisen
- **📋 16+ Copy Buttons**: Alle Credentials, URLs und DB-Parameter kopierbar

### � Automatisches SSL-Setup
- **✅ SSL-Checkbox bei neuen Instanzen**: Automatische SSL-Konfiguration beim Erstellen
- **� Container-SSL-Auto-Config**: Apache SSL-Module und VirtualHosts automatisch konfiguriert  
- **�️ Erweiterte Fehlerbehandlung**: Detaillierte SSL-Logs und mkcert-Path-Detection
- **📜 Zertifikat-Management**: Vollautomatische mkcert Integration mit hosts-Datei

### 🏗️ Template-System
- **📁 Separate HTML/CSS/JS Dateien**: Wartungsfreundliche Template-Architektur statt String-Concatenation
- **� 16 Template-Variablen**: Vollständige Abdeckung aller Instance-Parameter
- **🎯 Webview-safe URIs**: Korrekte Ressourcen-Verlinkung für VS Code Webviews

### 🔧 Technical Excellence
- **199 KiB Bundle**: Optimierte Größe trotz umfangreicher neuer Features
- **🎨 Responsive Design**: Mobile-optimierte Webview für verschiedene Panel-Größen  
- **⚡ Performance**: Stabile Animationen ohne "Weganimieren"-Probleme

---

## 📦 Version 1.6.1 - Complete MySQL Root User Access
*Veröffentlicht: 28. August 2025*

### 🔑 Enhanced Database Administration
- **🚀 Complete MySQL Root User Support**: Vollständiger MySQL Root-User Zugang für beide Instanztypen (REDAXO und Custom Instances)
- **👤 Dual User Management**: Separate Bereiche für Standard User und Root User in sowohl internen als auch externen Verbindungen
- **📋 Enhanced Copy Functionality**: 16+ Copy-Buttons für alle Database-Credentials inklusive Root-User Authentifizierung
- **🔧 Unified Database Access**: Einheitliche Root-User Funktionalität für alle Instance-Typen

### ✨ Advanced UI Features
- **🎯 Clear User Separation**: 
  - **Standard User**: REDAXO Instances (`redaxo`), Custom Instances (`instanceName`)
  - **Root User**: Beide Typen (`root`) mit entsprechenden Passwörtern
- **🌐 Complete Connection Coverage**: 
  - **Container-Internal**: mysql:3306 mit Standard und Root Credentials
  - **External Access**: localhost:port mit Standard und Root Credentials
- **📊 Enhanced Security**: Vollständiger Zugang zu MySQL Root-Funktionalität für erweiterte Database-Administration
- **⚡ Streamlined Workflow**: Ein-Klick-Kopieren für alle User-Typen und Verbindungsarten

### 🔧 Technical Excellence
- **🏗️ DockerService Enhancement**: 
  - Erweiterte `getLoginInfo()` Funktion mit `dbRootPassword` Support
  - Automatische Root Password Detection aus Environment Variables
  - REDAXO Instances: `DB_ROOT_PASSWORD` oder `MYSQL_ROOT_PASSWORD`
  - Custom Instances: Hardcoded `'root'` Password
- **💻 JavaScript Functions**: 4 neue Copy-Funktionen für Root-User Credentials (intern/extern)
- **📦 Optimized Integration**: Effiziente Bundle-Integration (218 KiB) ohne Performance-Impact
- **🔒 Security Compliant**: Sichere Passwort-Handling für beide User-Typen

### 🏆 Database Credentials Overview

#### **🚀 Standard REDAXO Instances:**
```
Standard User: redaxo / [generiert]
Root User: root / [DB_ROOT_PASSWORD]
```

#### **🔧 Custom Instances:**
```
Standard User: [instanceName] / [instanceName]  
Root User: root / root
```

### 💡 What This Means for You
- **✅ Complete Database Control**: Voller MySQL Root-Zugang für alle Instances
- **✅ Enhanced Administration**: Erweiterte Database-Management Möglichkeiten
- **✅ Streamlined Workflow**: Einheitliche Credential-Verwaltung für alle Instance-Typen
- **✅ Copy-Ready**: Alle Credentials mit einem Klick kopierbar für externe Tools

## 📦 Version 1.6.0 - Simplified REDAXO Setup Revolution
*Veröffentlicht: 28. August 2025*

### 🚀 Major Breakthrough: Simplified Installation
- **⚡ Native Docker Image Integration**: Komplett vereinfachte REDAXO Installation durch Nutzung der eingebauten Auto-Setup Funktionalität des FriendsOfREDAXO Docker Images
- **🔧 Eliminated Installation Conflicts**: Behebt dauerhaft "User admin already exists" Fehler durch Wegfall komplexer Database-Cleanup Routinen
- **🏗️ Streamlined Architecture**: Drastische Code-Vereinfachung - von komplexem Database-Management zu eleganter Environment-Variable Konfiguration
- **📦 Optimized Bundle**: Bundle-Größe reduziert von 215 KiB auf 212 KiB durch Code-Optimierung

### ✨ Enhanced User Experience
- **🎯 Simplified Setup Process**: Setup-Script fokussiert sich auf essenzielle Login-Informationen statt technisches Database-Management
- **🔒 Preserved SSL/HTTPS**: Alle SSL-Zertifikat und HTTPS-Funktionen bleiben vollständig erhalten und funktional
- **⚙️ Environment Variable Optimization**: Perfekt abgestimmte REDAXO_* Environment Variables für nahtlose Auto-Installation
- **🛠️ Maintainable Codebase**: Deutlich einfachere und wartbarere Code-Struktur für zukünftige Entwicklungen

### 🔧 Technical Excellence
- **🐋 100% Docker Compatibility**: Voll kompatibel mit friendsofredaxo/docker-redaxo Auto-Setup Features und Best Practices
- **🔐 SSL Configuration Preserved**: Komplette Beibehaltung aller mkcert-basierten SSL-Konfigurationen und Apache-Einstellungen
- **💾 Database Persistence**: MySQL Volume-Persistenz funktioniert jetzt konfliktfrei mit der Auto-Installation
- **🎨 Clean Code Architecture**: Entfernung redundanter Database-Cleanup Logik zugunsten nativer Docker Image Funktionalität

### 🏆 What This Means for You
- **✅ Zero Installation Conflicts**: Keine "admin already exists" Fehler mehr
- **✅ Faster Setup**: Docker Image übernimmt die gesamte REDAXO Installation automatisch
- **✅ SSL Still Works**: Alle HTTPS-Features funktionieren weiterhin perfekt
- **✅ Easier Maintenance**: Einfachere Codebasis bedeutet stabilere Updates
