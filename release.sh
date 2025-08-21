#!/bin/bash

# REDAXO Multi-Instances Manager Release Script

VERSION="v1.1.0"
PACKAGE_NAME="redaxo-multi-instances-manager"
VSIX_FILE="${PACKAGE_NAME}-1.1.0.vsix"

echo "🚀 Creating Release ${VERSION}"

# Check if VSIX exists
if [ ! -f "${VSIX_FILE}" ]; then
    echo "❌ VSIX file not found: ${VSIX_FILE}"
    echo "Creating VSIX package..."
    npm run package
    npx @vscode/vsce package
fi

echo "📦 VSIX file: ${VSIX_FILE} ($(du -h ${VSIX_FILE} | cut -f1))"

# Create release notes
cat > RELEASE_NOTES.md << 'EOF'
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

EOF

echo "📋 Release notes created"

# Delete old release if exists
gh release delete ${VERSION} --yes 2>/dev/null || echo "No existing release to delete"
git tag -d ${VERSION} 2>/dev/null || echo "No existing tag to delete"  
git push --delete origin ${VERSION} 2>/dev/null || echo "No existing remote tag to delete"

# Create new release
echo "🏷️ Creating GitHub release..."
gh release create ${VERSION} \
    --title "🚀 REDAXO Multi-Instances Manager ${VERSION}" \
    --notes-file RELEASE_NOTES.md \
    --target main \
    "${VSIX_FILE}"

echo "✅ Release ${VERSION} created successfully!"
echo "🔗 https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/releases/tag/${VERSION}"
