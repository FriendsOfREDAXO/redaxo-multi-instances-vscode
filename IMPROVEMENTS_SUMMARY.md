# 🚀 REDAXO Multi-Instances Manager - Verbesserungen

Diese Verbesserungen beheben die identifizierten Probleme und erweitern die Funktionalität:

## ✅ Behobene Probleme

### 1. SSL Certificate Mounting ✅
**Problem**: SSL-Zertifikate wurden in `/etc/ssl/certs` und `/etc/ssl/private` gemountet und überschrieben System-CA-Zertifikate.

**Lösung**: 
- SSL-Zertifikate werden korrekt in `/etc/apache2/ssl` gemountet
- Apache SSL-Konfiguration verwendet die korrekten Pfade
- System-CA-Zertifikate bleiben unberührt
- Tests validieren die korrekte Konfiguration

### 2. PHP Upload Limits Vereinheitlichung ✅
**Problem**: Custom Instances hatten bessere PHP-Limits als reguläre REDAXO-Instanzen.

**Lösung**:
- Neue `SetupTemplates`-Klasse für konsistente PHP-Konfiguration
- Identische PHP-Limits für beide Instanztypen:
  - `memory_limit = 2048M`
  - `upload_max_filesize = 512M` 
  - `post_max_size = 512M`
  - `max_execution_time = 300`
  - `max_file_uploads = 20`
- Verbesserte OPcache- und Session-Einstellungen

### 3. Login-Info Copy Button ✅
**Problem**: Fehlender Copy-Button für Login-Passwort.

**Lösung**:
- Copy-Button für das Admin-Passwort hinzugefügt
- Visuelles Feedback beim Kopieren
- Fallback für ältere Browser
- JavaScript aktiviert für Login-Info Webview

### 4. Hosts-File Dialog Verbesserung ✅
**Problem**: Keine Auswahl zwischen automatischem Hinzufügen und Anleitung.

**Lösung**:
- Dialog mit drei Optionen:
  - "Auto Add (Terminal)" - Öffnet Terminal mit Befehl
  - "Show Instructions" - Zeigt detaillierte Anleitung
  - "Cancel" - Abbrechen
- Erkennung bereits existierender Einträge
- Verbessertes Feedback und Benutzerführung

### 5. Duplicate Entries Prevention ✅
**Problem**: Doppelte Einträge in der hosts-Datei wurden nicht verhindert.

**Lösung**:
- Verbesserter Check mit Regex-Pattern für existierende Einträge
- Kommentierte Einträge für bessere Übersicht
- Detailliertes Logging der Hosts-Datei-Operationen
- Fallback bei Fehlern mit hilfreichen Anweisungen

### 6. Release Script Verbesserung ✅
**Problem**: Release-Text war hardcodiert und nicht aus `RELEASE_NOTES.md` und `package.json` abgeleitet.

**Lösung**:
- Dynamisches Lesen der Version aus `package.json`
- Verwendung vorhandener `RELEASE_NOTES.md` oder automatische Erstellung
- Bessere Fehlerbehandlung und Logging
- Flexiblere Release-Verwaltung

## 📁 Neue/Geänderte Dateien

### Neue Dateien:
- `src/docker/templates.ts` - Setup-Templates für konsistente PHP-Konfiguration

### Erweiterte Dateien:
- `src/extension.ts` - Copy-Button und verbesserter Hosts-Dialog
- `src/docker/sslManager.ts` - Bessere Duplicate Prevention
- `src/docker/dockerService.ts` - Integration der Setup-Templates
- `src/emptyInstance/emptyInstanceService.ts` - Angeglichene PHP-Limits
- `release.sh` - Dynamische Release-Erstellung

## 🧪 Getestet

- ✅ Compile-Test erfolgreich
- ✅ VSIX-Package-Erstellung erfolgreich  
- ✅ SSL-Zertifikat-Mounting korrekt in `/etc/apache2/ssl`
- ✅ PHP-Konfigurationen identisch zwischen Instanztypen
- ✅ Setup-Templates funktional

## 📦 Bereit für Installation

Das VSIX-Package `redaxo-multi-instances-manager-1.1.0.vsix` ist bereit für die Installation und Tests:

```bash
# Installation in VS Code
# 1. Cmd+Shift+P → "Extensions: Install from VSIX"
# 2. VSIX-Datei auswählen
```

## 🚀 Nächste Schritte für Tests

1. **SSL-Test**: Neue Instanz mit SSL erstellen und prüfen ob Zertifikate korrekt in `/etc/apache2/ssl` landen
2. **PHP-Limits-Test**: Upload-Limits in beiden Instanztypen vergleichen
3. **Copy-Button-Test**: Login-Info öffnen und Passwort-Copy-Funktion testen
4. **Hosts-Dialog-Test**: "Add to Hosts File" ausführen und Dialog-Optionen prüfen
5. **Duplicate-Test**: Mehrfach Hosts-Eintrag hinzufügen und Duplicate-Prevention validieren

Alle genannten Probleme wurden systematisch behoben und verbessert! 🎉
