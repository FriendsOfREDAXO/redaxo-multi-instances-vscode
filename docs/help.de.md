# REDAXO Multi-Instances – Hilfe

Diese Hilfe öffnest du jederzeit mit **REDAXO: Hilfe** (Befehlspalette `⇧⌘P` / `Strg+Umschalt+P`) oder über das **?** in der Instanz-Liste.

- [Schnellstart](#schnellstart)
- [Die Instanz-Liste](#die-instanz-liste)
- [Domains und HTTPS](#domains-und-https)
- [Arbeiten mit einer Instanz](#arbeiten-mit-einer-instanz)
- [REDAXO 6](#redaxo-6)
- [KI: Copilot und Claude (MCP)](#ki-copilot-und-claude-mcp)
- [Xdebug](#xdebug)
- [Export, Import und Instanzen aus 1.x](#export-import-und-instanzen-aus-1x)
- [Problemlösung](#problemlösung)

---

## Schnellstart

1. **Docker** starten (Docker Desktop, OrbStack, Colima oder Docker Engine mit Compose v2).
2. In der Aktivitätsleiste **REDAXO** öffnen → **+** (Neue Instanz).
3. Namen eingeben, z. B. `kunde-shop` → **REDAXO** wählen.
4. Nach etwa einer Minute erscheint eine Meldung mit **Backend öffnen** und **Passwort kopieren**.

Der Name ist gleichzeitig die Adresse: **https://kunde-shop.localhost**.
Beim ersten Start einer PHP-Version wird das Docker-Image gebaut – das dauert einige Minuten, danach geht es in Sekunden.

**Empfohlen:** einmalig **REDAXO: HTTPS-Zertifikaten vertrauen (mkcert)** ausführen. Dann zeigt der Browser keine Zertifikatswarnungen mehr.
mkcert installieren: macOS `brew install mkcert nss` · Windows `winget install FiloSottile.mkcert` · Linux `sudo apt install mkcert libnss3-tools`.

## Die Instanz-Liste

| Symbol | Bedeutung |
|---|---|
| grüner Haken | Instanz läuft |
| leerer Kreis | Instanz ist gestoppt |
| Warnsymbol | nur ein Teil der Container läuft – „Container neu aufbauen“ hilft |

**▶ / ■** rechts neben dem Namen startet bzw. stoppt die Instanz, das **Haus-Symbol** öffnet das Backend.
Aufgeklappt zeigt jede Instanz:

| Eintrag | Klick |
|---|---|
| Frontend / Backend | öffnet die Seite im Browser |
| Domains | zusätzliche Hostnamen verwalten |
| Login | kopiert das Admin-Passwort |
| Datenbank | zeigt alle Zugangsdaten zum Kopieren |
| Ordner | öffnet die Instanz in VS Code |

Alle weiteren Aktionen findest du per **Rechtsklick** auf die Instanz. Der Bereich **Dienste** zeigt den HTTPS-Proxy, Mailpit und Adminer.
Die Statusleiste unten links zeigt, wie viele Instanzen laufen.

## Domains und HTTPS

Ein gemeinsamer Proxy liefert alle Instanzen per HTTPS aus:

- `https://<name>.localhost` und jede Subdomain `https://*.<name>.localhost` funktionieren automatisch.
- Weitere Domains wie `shop.localhost` oder `kunde-b.localhost` per **Domains…** hinzufügen. So lassen sich
  YRewrite-Multidomain-Setups lokal testen: In YRewrite einfach dieselben Domains eintragen.
- `*.localhost` zeigt immer auf deinen Rechner – die Hosts-Datei wird nicht gebraucht.
- Sind die Ports 80/443 belegt (z. B. durch einen anderen lokalen Webserver), wählt der Proxy automatisch freie Ports –
  die Adressen lauten dann z. B. `https://kunde.localhost:8443`. Die Instanz-Liste zeigt immer die richtige Adresse.

Direkt ohne Proxy ist jede Instanz zusätzlich unter `http://localhost:<port>` erreichbar (siehe **Zugangsdaten…**).

## Arbeiten mit einer Instanz

| Aufgabe | So geht's |
|---|---|
| Cache löschen | Rechtsklick → **Cache löschen** |
| REDAXO-Konsole | Rechtsklick → **REDAXO-Konsole…**, z. B. `package:install yform` |
| Shell im Container | Rechtsklick → **Shell öffnen** (Composer, git, ImageMagick, vips … sind installiert) |
| SQL | Rechtsklick → **SQL-Konsole öffnen** oder **Datenbank in Adminer öffnen** (Passwort liegt dann in der Zwischenablage) |
| E-Mails ansehen | Dienste → **Mailpit** – alle Mails der Instanzen landen dort |
| Weitere Datenbank | Rechtsklick → **Weitere Datenbank anlegen…** |
| PHP wechseln | Rechtsklick → **PHP-Version wechseln…** (Daten bleiben erhalten) |
| MariaDB aktualisieren | Rechtsklick → **MariaDB aktualisieren…** (nur nach oben, vorher ggf. exportieren) |
| Logs | Rechtsklick → **Container-Logs anzeigen** bzw. **REDAXO-Systemlog anzeigen** |

**Eigene Anpassungen:** Die Datei `docker/custom-setup.sh` im Instanz-Ordner läuft bei jedem Start im Container
(z. B. zusätzliche Pakete, eigene PHP-Einstellungen). Eigene Compose-Ergänzungen gehören in
`docker-compose.override.yml` – die `docker-compose.yml` wird von der Extension erzeugt.

## REDAXO 6

Im Assistenten gibt es unter **REDAXO 6** zwei Varianten der Entwicklungsversion (PHP 8.5 oder neuer):

- **REDAXO 6** – Composer-Projekt (`redaxo/project:6.x-dev`) zum Ausprobieren und Bauen von Seiten.
- **REDAXO 6 Core** – Klon von `redaxo/core` (Branch `6.x`) zum Mitentwickeln. Die Dev-Instanz liegt in `project/`,
  im Webroot liegt die `AGENTS.md` des Core-Repos mit den Coding-Standards.

Datenbank, Mailer und Basis-URL werden über Umgebungsvariablen gesetzt (`DATABASE_URL`, `MAILER_DSN`, `REX_BASE_URL`).
Bei jedem Start läuft automatisch `console migrate`. AddOns werden in REDAXO 6 per `composer require` hinzugefügt.

## KI: Copilot und Claude (MCP)

### Copilot

- Im Chat **`@redaxo`** ansprechen: `/list`, `/info kunde`, `/start kunde`, `/console kunde cache:clear`,
  `/query kunde SELECT name FROM rex_article`, `/logs kunde`, `/help` – oder einfach frei fragen.
- Im **Agent-Modus** stehen die Tools `#redaxo-…` zur Verfügung. Ändernde Aktionen fragen vorher nach.

### Claude Code und Claude Desktop

Die Extension bringt einen **MCP-Server** mit. Damit kann Claude deine Instanzen genauso bedienen wie du:

1. Befehl **REDAXO: Claude verbinden (MCP)** ausführen.
2. **Claude Code** (gilt für alle Projekte und für die Claude-Code-Erweiterung in VS Code) oder **Claude Desktop** wählen.
3. Claude fragen, z. B. „Zeige meine REDAXO-Instanzen“.

Was Claude damit kann:

| Tool | Beispiel |
|---|---|
| `list_instances` | „Welche Instanzen laufen gerade?“ |
| `get_instance` | „Wie verbinde ich mich mit der Datenbank von kunde?“ |
| `list_versions` | „Welche PHP-Versionen gibt es?“ |
| `create_instance` | „Lege eine REDAXO-6-Instanz test6 an.“ |
| `start_instance` / `stop_instance` | „Starte kunde, stoppe alle anderen.“ |
| `redaxo_console` | „Installiere YForm in kunde.“ |
| `query_database` | „Wie viele Artikel sind offline?“ (nur lesend, außer du erlaubst Schreiben ausdrücklich) |
| `get_logs` | „Gibt es PHP-Fehler in kunde?“ |
| `set_domains` | „Füge shop.localhost zu kunde hinzu.“ |

Passwörter gibt der Server nur heraus, wenn ausdrücklich danach gefragt wird.

Jede Instanz enthält außerdem eine **`AGENTS.md`** (plus `CLAUDE.md` und `.mcp.json`) mit allen Fakten zur Umgebung:
Container-Namen, Pfade, Konsole, Datenbank-Host. Copilot und Claude Code lesen sie automatisch, sobald der
Instanz-Ordner geöffnet ist. Aktualisieren: Rechtsklick → **KI-Anweisungen aktualisieren (AGENTS.md)**.

## Xdebug

1. Rechtsklick → **Xdebug ein-/ausschalten** (die Instanz startet kurz neu).
2. Die PHP-Debug-Erweiterung in VS Code installieren und diese Konfiguration in `.vscode/launch.json` des
   Instanz-Ordners anlegen:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Xdebug (REDAXO)",
      "type": "php",
      "request": "launch",
      "port": 9003,
      "pathMappings": { "/var/www/html": "${workspaceFolder}/project" }
    }
  ]
}
```

3. Xdebug startet nur auf Anfrage (Trigger): Browser-Erweiterung „Xdebug helper“ verwenden oder `?XDEBUG_TRIGGER=1` an die URL hängen.

Bei Instanzen aus Version 1.x (REDAXO-Standard) liegt der Webroot in `data/redaxo` statt in `project`.

## Export, Import und Instanzen aus 1.x

- **Exportieren…** erzeugt ein `.tar.gz` mit allen Dateien und einem Datenbank-Dump.
- **Instanz importieren…** legt daraus eine neue Instanz an – auch mit Exporten aus Version 1.x. Die Datenbank wird
  beim ersten Start automatisch eingespielt, die REDAXO-Server-URL angepasst.
- **Instanzen aus Version 1.x** werden weiter erkannt und funktionieren wie gewohnt. **Instanz modernisieren…**
  stellt sie auf das neue Format um: Vorher entsteht ein vollständiges Backup (`.redaxo-mi/backups/`), Dateien,
  Datenbank, Ports, Zugangsdaten und Container-Namen bleiben erhalten, die alte Konfiguration landet in `.legacy/`.

## Problemlösung

| Problem | Lösung |
|---|---|
| „Docker läuft nicht“ | Docker Desktop starten – die Ansicht aktualisiert sich automatisch. |
| Browser warnt vor dem Zertifikat | mkcert installieren und **HTTPS-Zertifikaten vertrauen** ausführen. Firefox ggf. neu starten. |
| Seite zeigt „… is not running“ | Die Instanz ist gestoppt – in der Liste auf ▶ klicken. |
| Frontend zeigt nach der Installation einen Fehler | Normal bei einer leeren REDAXO-Installation: im Backend einen Startartikel anlegen. |
| Erster Start dauert lange | Das Image für die PHP-Version wird einmalig gebaut. Fortschritt: **Log anzeigen**. |
| Instanz startet nicht / Warnsymbol | Rechtsklick → **Container neu aufbauen**. Dateien und Datenbank bleiben erhalten. |
| Port-Konflikte | **Wartung… → Port-Konflikte beheben** |
| Speicherplatz | **Wartung… → Docker aufräumen** entfernt Container und Images gelöschter Instanzen. |
| Instanzen liegen woanders | **Wartung… → Instanzen-Ordner ändern…** oder Einstellung `redaxo-instances.instancesPath` |

Ausführliche Protokolle aller Aktionen: **REDAXO: Log anzeigen**.
Fragen und Fehler: [GitHub Issues](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/issues) · [REDAXO Slack](https://redaxo.org/slack/)
