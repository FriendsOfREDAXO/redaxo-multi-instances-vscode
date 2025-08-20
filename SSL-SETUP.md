# 🔒 HTTPS/SSL Setup mit mkcert für REDAXO Multi-Instances

## Warum mkcert?

`mkcert` erstellt lokal vertrauenswürdige SSL-Zertifikate für die Entwicklung ohne Konfiguration. Es installiert automatisch eine lokale Certificate Authority (CA) und generiert Zertifikate, die von allen Browsern akzeptiert werden.

## Installation

### macOS
```bash
# Mit Homebrew (empfohlen)
brew install mkcert
brew install nss # für Firefox Support

# Initial Setup - CA installieren
mkcert -install
```

### Linux
```bash
# Ubuntu/Debian - NSS Tools installieren
sudo apt install libnss3-tools

# Mit Homebrew on Linux
brew install mkcert

# Oder Binary Download
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo cp mkcert-v*-linux-amd64 /usr/local/bin/mkcert

# Initial Setup - CA installieren
mkcert -install
```

### Windows
```bash
# Mit Chocolatey
choco install mkcert

# Mit Scoop
scoop bucket add extras
scoop install mkcert

# Initial Setup - CA installieren (als Administrator)
mkcert -install
```

## Extension-Funktionen mit SSL

### 🆕 Neue Instance mit SSL
1. **Instance erstellen** - SSL wird automatisch erkannt und aktiviert
2. **Lokale Domain** - `instancename.local` wird automatisch eingerichtet
3. **Automatische Ports** - HTTP (8080) + HTTPS (8443) werden vergeben
4. **Browser-Trust** - Zertifikate werden sofort vertrauenswürdig angezeigt

### 🔧 SSL zu bestehender Instance hinzufügen
1. **Rechtsklick** auf Instance in TreeView
2. **"Setup HTTPS/SSL"** wählen  
3. **Automatischer Neustart** der Container
4. **Neue URLs** werden im TreeView angezeigt

### 🌐 Zugriff auf HTTPS-Instanzen
- **Frontend**: `https://instancename.local:8443`
- **Backend**: `https://instancename.local:8443/redaxo/`
- **HTTP-Redirect**: HTTP wird automatisch auf HTTPS umgeleitet

## Features

### ✅ Was automatisch passiert:
- **CA Installation** bei Extension-Start (falls mkcert verfügbar)
- **Domain-Zertifikate** für `instancename.local`, `www.instancename.local`, `localhost`, `127.0.0.1`
- **Apache SSL-Konfiguration** mit Sicherheits-Headern
- **HTTPS-Redirect** von HTTP-Requests
- **Docker-Compose Update** für SSL-Container
- **Port-Management** für HTTP + HTTPS

### 🛡️ Sicherheits-Features:
- **HSTS Header** (Strict Transport Security)
- **X-Frame-Options** DENY
- **X-Content-Type-Options** nosniff
- **Automatische HTTP→HTTPS Redirects**

### 📋 Hosts-Datei erweitern (optional)
Für bessere lokale Domain-Auflösung:

```bash
# /etc/hosts erweitern
echo "127.0.0.1 instancename.local www.instancename.local" | sudo tee -a /etc/hosts
```

## Troubleshooting

### mkcert nicht gefunden
```bash
# Installation überprüfen
mkcert -version

# CA Status überprüfen
mkcert -CAROOT
ls -la $(mkcert -CAROOT)
```

### Browser vertraut Zertifikat nicht
```bash
# CA neu installieren
mkcert -uninstall
mkcert -install

# Firefox: about:config → security.tls.certificate_transparency.ct_logs_api_enabled: false
```

### Container startet nicht mit SSL
```bash
# SSL-Ordner überprüfen
ls -la instances/instancename/ssl/

# Apache-Config überprüfen
docker logs redaxo-instancename

# Ports überprüfen
docker ps -a | grep instancename
```

## Manuelle Zertifikat-Erstellung

Falls Sie Zertifikate manuell erstellen möchten:

```bash
cd instances/instancename
mkdir ssl
mkcert -cert-file ssl/instancename.pem -key-file ssl/instancename-key.pem instancename.local "*.instancename.local" localhost 127.0.0.1
```

## Vorteile vs. Self-Signed Certificates

| Feature | mkcert | Self-Signed |
|---------|--------|-------------|
| Browser-Trust | ✅ Sofort | ❌ Warnung |
| Setup-Aufwand | ✅ Minimal | ❌ Komplex |
| CA-Management | ✅ Automatisch | ❌ Manuell |
| Multi-Domain | ✅ Ja | ❌ Schwierig |
| Mobile Support | ✅ Mit Setup | ❌ Sehr schwierig |

---

**💡 Tipp**: mkcert ist perfekt für die lokale Entwicklung, aber verwenden Sie es NIEMALS in Produktionsumgebungen!
