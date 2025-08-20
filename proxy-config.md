# Reverse Proxy Setup für REDAXO Multi-Instances

## nginx Reverse Proxy (Empfohlen)

### 1. nginx installieren
```bash
brew install nginx
```

### 2. nginx Konfiguration
```nginx
# /usr/local/etc/nginx/nginx.conf

http {
    # SSL Konfiguration für alle *.local Domains
    server {
        listen 443 ssl http2;
        server_name *.local;
        
        # Wildcard SSL Zertifikat
        ssl_certificate /path/to/wildcard-local.pem;
        ssl_certificate_key /path/to/wildcard-local-key.pem;
        
        # Proxy zu richtigem Container basierend auf Subdomain
        location / {
            set $backend "";
            if ($host ~ "^([^.]+)\.local$") {
                set $subdomain $1;
                # Mapping zu Container-Ports (dynamisch aus Container-Registry)
            }
            
            proxy_pass https://127.0.0.1:$backend_port;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

## Option 2: Docker Compose mit Traefik (Automatisch)

```yaml
# traefik-proxy/docker-compose.yml
version: '3.8'
services:
  traefik:
    image: traefik:v3.0
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command:
      - --providers.docker=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.mkcert.acme.caserver=https://acme-v02.api.letsencrypt.org/directory

  # REDAXO Container mit Labels
  redaxo:
    image: friendsofredaxo/redaxo:5
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.redaxo-${INSTANCE_NAME}.rule=Host(\`${INSTANCE_NAME}.local\`)"
      - "traefik.http.routers.redaxo-${INSTANCE_NAME}.tls=true"
```

## Option 3: Port-Forwarding Script (Einfach)

```bash
#!/bin/bash
# port-forward.sh

# Alle aktiven REDAXO Container ermitteln und Port-Forwarding einrichten
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep redaxo- | while read line; do
    name=$(echo $line | cut -d' ' -f1)
    https_port=$(echo $line | grep -o '0.0.0.0:[0-9]*->443' | cut -d':' -f2 | cut -d'-' -f1)
    
    if [ ! -z "$https_port" ]; then
        instance_name=$(echo $name | sed 's/redaxo-//')
        echo "Forwarding ${instance_name}.local:443 -> :${https_port}"
        
        # iptables rule für Port-Forwarding
        sudo iptables -t nat -A OUTPUT -p tcp --dport 443 -d ${instance_name}.local -j REDIRECT --to-port ${https_port}
    fi
done
```

## Welche Lösung empfiehlst du?

**Für die Extension würde ich empfehlen:**

1. **Kurzfristig:** URLs mit Ports anzeigen (wie jetzt gefixt)
2. **Langfristig:** Traefik-Integration in die Extension einbauen
3. **Optional:** nginx-Setup-Command in der Extension

Was denkst du - soll ich eine dieser Lösungen implementieren?
