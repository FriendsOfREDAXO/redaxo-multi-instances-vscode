# Microsoft Visual Studio Marketplace Veröffentlichung

## 🏪 Schritte zur Marketplace Veröffentlichung

### 1. Azure DevOps Setup
1. Account erstellen: https://dev.azure.com/
2. Personal Access Token generieren:
   - User Settings → Personal Access Tokens
   - Name: "VS Code Extension Publishing"
   - Scopes: **Marketplace (Manage)**
   - Token kopieren und sicher speichern

### 2. Publisher Verification
```bash
# Publisher "skerbis" ist bereits in package.json definiert
# Falls noch nicht existiert, erstellen:
npx @vscode/vsce create-publisher skerbis
```

### 3. Login mit Personal Access Token
```bash
npx @vscode/vsce login skerbis
# Token eingeben wenn gefragt
```

### 4. Extension veröffentlichen
```bash
# Aktuelle Version (1.5.0) veröffentlichen:
npx @vscode/vsce publish

# Oder mit Minor Version bump:
npx @vscode/vsce publish minor

# Oder mit Patch Version bump:
npx @vscode/vsce publish patch
```

### 5. Marketplace-Ready Checklist ✅

Ihre Extension ist bereits marketplace-ready:
- ✅ `publisher` definiert: "skerbis"
- ✅ `icon` vorhanden: resources/icon.png
- ✅ `repository` URL korrekt
- ✅ `homepage` URL korrekt  
- ✅ `bugs` URL für Issues
- ✅ `license` definiert: MIT
- ✅ `categories` definiert
- ✅ Vollständige README.md
- ✅ CHANGELOG.md vorhanden
- ✅ Detaillierte Beschreibung

### 6. Nach der Veröffentlichung
- Extension wird in ca. 5-10 Minuten im Marketplace verfügbar
- URL: `https://marketplace.visualstudio.com/items?itemName=skerbis.redaxo-multi-instances-manager`
- Benutzer können installieren via: `ext install skerbis.redaxo-multi-instances-manager`

### 7. Updates veröffentlichen
```bash
# Version in package.json erhöhen und dann:
npm run package
npx @vscode/vsce publish
```

## 🎯 Wichtige Hinweise:
- **Erste Veröffentlichung** kann bis zu 24h dauern für Review
- **Updates** sind meist sofort verfügbar
- **Publisher Name** kann nicht mehr geändert werden
- **Icon** sollte mindestens 128x128px sein (✅ bereits erfüllt)
