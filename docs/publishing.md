# Veröffentlichen

## GitHub-Release (VSIX)

Tag setzen und pushen – der Workflow `.github/workflows/release.yml` testet, baut das VSIX und erstellt das Release
mit den Notes der Version aus `CHANGELOG.md`:

```bash
git tag v2.0.0
git push origin v2.0.0
```

Alternativ lokal: `./release.sh` (benötigt die GitHub CLI `gh`).

## VS Code Marketplace

Einmalig: Personal Access Token in Azure DevOps anlegen (Scope **Marketplace → Manage**) und anmelden:

```bash
npx @vscode/vsce login skerbis
```

Veröffentlichen (baut automatisch über `vscode:prepublish`):

```bash
npx @vscode/vsce publish          # Version aus package.json
npx @vscode/vsce publish patch    # oder mit Versionssprung
```

Die Extension ist nach einigen Minuten unter
`https://marketplace.visualstudio.com/items?itemName=skerbis.redaxo-multi-instances-manager` verfügbar.

## Checkliste

- `CHANGELOG.md` ergänzt, Version in `package.json` erhöht
- `npm run lint`, `npm run test:unit`, `npm run test:integration` grün
- bei Änderungen an `assets/docker/` oder `src/core/`: `npm run test:e2e` (Docker)
- neue UI-Texte übersetzt (`npm run l10n:export`, dann `l10n/bundle.l10n.de.json` ergänzen)
