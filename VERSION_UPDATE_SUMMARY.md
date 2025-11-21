# Version Update Summary - November 2025

## Überblick
Diese Aktualisierung modernisiert die unterstützten PHP- und MariaDB-Versionen basierend auf aktuellen Empfehlungen und Best Practices für REDAXO-Installationen.

## PHP-Versionen

### Entfernte Versionen
- **PHP 8.0** - End of Life (EOL) seit November 2023

### Aktuelle Unterstützte Versionen
- **PHP 7.4** - Legacy (EOL, aber für Migration beibehalten)
- **PHP 8.1** - Minimum für REDAXO 5.20.0+
- **PHP 8.2** - Stabil und empfohlen
- **PHP 8.3** - Stabil und empfohlen
- **PHP 8.4** - **Standard/Empfohlen** - Stabil seit 21. November 2024
- **PHP 8.5** (NEU) - **Neueste** - Stabil seit 20. November 2025

### Begründung
- PHP 8.0 erhält keine Sicherheitsupdates mehr
- PHP 7.4 ist EOL, wird aber für Migrationszwecke beibehalten
- REDAXO 5.20.0+ erfordert mindestens PHP 8.1
- PHP 8.4 ist die empfohlene stabile Version mit aktiver Unterstützung bis Dezember 2028
- PHP 8.5 ist jetzt stabil (seit 20. November 2025) und bietet neue Features wie Pipe Operator und URI Extension

## MariaDB-Versionen

### Entfernte Versionen
- **MariaDB 10.4** - End of Life (EOL) Juni 2024
- **MariaDB 10.5** - End of Life (EOL) Juni 2025
- **MariaDB 10.6** - End of Life (EOL) Juli 2026
- **MariaDB 11.0** - Kurzlebige Version, nicht LTS
- **MariaDB 11.1, 11.2, 11.3, 11.5** - Zwischenversionen, nicht LTS

### Aktuelle Unterstützte Versionen
- **MariaDB 10.11** (LTS) - Unterstützt bis Februar 2028 (Legacy)
- **MariaDB 11.4** (LTS) - **Standard/Empfohlen** - Unterstützt bis Mai 2029
- **MariaDB 11.6** - Stabile Version
- **MariaDB 11.8** (LTS) - Neueste LTS, unterstützt bis Juni 2028
- **MariaDB Latest** - Automatisch die neueste stabile Version

### Begründung
- Fokus auf Long-Term Support (LTS) Versionen für bessere Stabilität
- MariaDB 11.4 (LTS) ist die empfohlene Version mit langem Support-Zeitraum
- MariaDB 11.8 (LTS) ist die neueste LTS-Version
- Alte 10.x Versionen (außer 10.11) werden bald EOL erreichen
- REDAXO benötigt mindestens MariaDB 10.2 für volle utf8mb4-Unterstützung

## Änderungen in den Dateien

### package.json
- PHP Standard: 8.4 (beibehalten)
- PHP-Versionen: [7.4, 8.1, 8.2, 8.3, 8.4, 8.5]
- MariaDB Standard: 11.4 (beibehalten)
- MariaDB-Versionen: [10.11, 11.4, 11.6, 11.8, latest]

### src/extension.ts
- Aktualisierte Quick-Pick-Listen für PHP und MariaDB
- Beschriftungen mit Empfehlungen (z.B., "PHP 8.4 (empfohlen)")
- Klare LTS-Kennzeichnungen bei MariaDB

### src/emptyInstance/emptyInstanceProvider.ts
- Aktualisierte HTML-Dropdown-Optionen
- Standardwerte auf PHP 8.4 und MariaDB 11.4 gesetzt
- Entfernung veralteter Versionen

### src/test/dockerCompose.test.ts
- Test-Standardversionen auf PHP 8.4 und MariaDB 11.4 aktualisiert

### README.md
- Aktualisierte Version-Badges
- Klarere Versionsinformationen mit Empfehlungen
- LTS-Kennzeichnungen für bessere Transparenz

## Kompatibilität

### REDAXO
- Alle aktuellen REDAXO 5.x Versionen werden unterstützt
- REDAXO 5.20.0+ erfordert PHP ≥ 8.1
- Volle utf8mb4-Unterstützung (Emojis) ab MariaDB 10.2

### FriendsOfREDAXO Docker Image
- **stable** Tag: Nutzt niedrigste aktiv unterstützte PHP-Version
- **edge** Tag: Nutzt neueste PHP-Version (auch RC)
- Beide Tags funktionieren mit den neuen Versionen

## Empfehlungen für Benutzer

### Neue Installationen
- PHP 8.4 (Standard)
- MariaDB 11.4 (Standard, LTS)

### Bestehende Installationen
- PHP 7.4/8.0 sollten auf mindestens PHP 8.1 aktualisiert werden (7.4 verfügbar für Migration)
- PHP 8.5 ist verfügbar für Early Adopters
- MariaDB 10.4-10.6 sollten auf 10.11 oder 11.4 (LTS) aktualisiert werden
- Backups vor Upgrades erstellen!

### Langzeit-Projekte
- PHP 8.3 oder 8.4 (lange aktive Unterstützung, empfohlen)
- PHP 8.5 (neueste Features, für experimentelle Projekte)
- MariaDB 11.4 oder 11.8 (LTS mit Support bis 2029)

## Quellen
- [PHP Supported Versions](https://www.php.net/supported-versions.php)
- [PHP 8.5 Release](https://www.php.net/releases/8.5/index.php)
- [MariaDB Lifecycle](https://endoflife.date/mariadb)
- [REDAXO System Requirements](https://redaxo.org/download/core/)
- [FriendsOfREDAXO Docker Image](https://github.com/FriendsOfREDAXO/docker-redaxo)

## Datum
November 2025 (aktualisiert am 21. November 2025)
