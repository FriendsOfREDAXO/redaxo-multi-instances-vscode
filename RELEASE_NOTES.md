# 🚀 REDAXO Multi-Instances Manager - Release Notes

## 📦 Version 1.5.1 - Activity Bar Icon Update
*Veröffentlicht: 26. August 2025*

### 🎨 Visual Improvements
- **Neues Activity Bar Icon**: Großes, fettes "R" für bessere Erkennbarkeit
- **Icon Optimierung**: Perfekt sichtbar in VS Code Activity Bar bei allen Theme-Farben
- **Brand Recognition**: Klares REDAXO Branding in der VS Code Sidebar

### 📊 Technische Details
- Activity Bar Icon: `resources/activity-bar-icon.svg`
- Monochrome SVG für automatische Theme-Anpassung
- 16x16px optimiert für perfekte Darstellung

---

## 📦 Version 1.5.0 - Container Resource Monitoring
*Veröffentlicht: 26. August 2025*

### 🆕 New Features (v1.5.0)
- **📊 Container-Ressourcen-Monitor**: Live-Anzeige von CPU und RAM-Verbrauch direkt in der TreeView
  - Ressourcen werden automatisch alle 30 Sekunden aktualisiert
  - Kompakte Anzeige in der TreeView-Beschreibung: `📊 2.1% CPU, 5.3% RAM`
  - Detaillierte Ressourcen-Info im Tooltip mit Web/DB-Container-Aufschlüsselung
  - Asynchrone Laden mit sofortigem TreeView-Update
- **🔧 Smart Container-Log-Management**: Korrekte Container-Namen für alle Instanz-Typen
  - Custom Instances: `instancename_web` / `instancename_db`
  - REDAXO Instances: `redaxo-instancename` / `redaxo-instancename_db`
  - Benutzer-Auswahl zwischen Web- und Database-Container-Logs
  - Automatische Erkennung des Instanz-Typs für korrekte Container-Namen
- **⚡ Auto-Refresh TreeView**: Automatische Aktualisierung der TreeView alle 30 Sekunden
  - Live-Updates der Ressourcen-Informationen
  - Bessere Performance durch asynchrone Ressourcen-Laden
  - Sofortige Anzeige-Updates nach Ressourcen-Laden

### 🔧 Technical Improvements (v1.5.0)
- **ResourceMonitor-Klasse**: Vollständige Docker-Stats-Integration mit CPU/RAM-Monitoring
- **Enhanced TreeView**: Erweiterte Tooltips und Beschreibungen mit Live-Ressourcen-Daten
- **Container-Name-Resolver**: Intelligente Erkennung der korrekten Container-Namen
- **Memory-Optimized**: Effiziente Ressourcen-Abfrage ohne Performance-Impact

### 🔄 Previous Features (v1.4.0)
- �️ **Intuitive Click Behavior**: Instanzen-Klick öffnet Aktionsmenü statt Browser
- ❓ **Comprehensive Help System**: Detaillierte Hilfe-Sektion mit allen Features
- 🚀 **REDAXO Loader Integration**: Download-Link und Anleitung für automatische REDAXO-Installation

### 🔄 Previous Features (v1.3.0)
- 🎯 **Visual Instance Type Distinction**: TreeView zeigt deutlich REDAXO vs Custom Instanzen
- 📋 **Copy Buttons für Login-Informationen**: Ein-Klick-Kopieren für URLs, Credentials etc.
- 🏠 **Verbesserte Hosts File Integration**: Intelligente Hosts-Datei-Verwaltung
- 🔒 **SSL Certificate Mounting Fix**: Korrekte SSL-Pfade
- ⚡ **Unified PHP Configuration**: Konsistente PHP-Limits über alle Instance-Typen

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
4. **NEU**: Klick auf Instanz öffnet Aktionsmenü
5. **NEU**: Live-Ressourcen in TreeView anzeigen (📊 CPU/RAM)
6. Browser, Info-Panel oder andere Aktionen wählen

### 📊 Ressourcen-Monitor Features
- **Live-Anzeige**: CPU und RAM direkt in der TreeView-Beschreibung
- **Auto-Update**: Ressourcen aktualisieren sich alle 30 Sekunden  
- **Detaillierte Info**: Hover über Instanz für erweiterte Ressourcen-Details
- **Container-spezifisch**: Separate Anzeige für Web- und DB-Container
- **Performance**: Effiziente Ressourcen-Abfrage ohne Verzögerung

### 🔧 Container-Log-Verbesserungen
- **Smart Container-Namen**: Automatische Erkennung der korrekten Container-Namen
- **Custom Instances**: `instancename_web` und `instancename_db`
- **REDAXO Instances**: `redaxo-instancename` und `redaxo-instancename_db`
- **Log-Auswahl**: Wählen zwischen Web- und Database-Container-Logs

### 🆕 REDAXO Loader für Custom Instances
1. [REDAXO Loader](https://redaxo.org/loader) herunterladen
2. In `project/public/` Ordner der Custom Instance kopieren
3. Instance im Browser öffnen
4. REDAXO Version auswählen und automatisch installieren

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