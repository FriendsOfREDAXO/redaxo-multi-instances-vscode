# Release erstellen

Die Extension wird ausschließlich über die
[GitHub-Releases](https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/releases) als VSIX verteilt
(nicht über den VS Code Marketplace).

## Ablauf

1. Version in `package.json` erhöhen und in `CHANGELOG.md` einen Abschnitt `## Version x.y.z (Datum)` anlegen –
   sein Inhalt wird zum Text des Releases.
2. Prüfen:
   - `npm run lint`, `npm run test:unit`, `npm run test:integration`
   - bei Änderungen an `assets/docker/` oder `src/core/`: `npm run test:e2e` (Docker) bzw. den Workflow „E2E (Docker)“
   - neue UI-Texte übersetzt (`npm run l10n:export`, dann `l10n/bundle.l10n.de.json` ergänzen)
3. Nach `main` mergen, dann Tag setzen und pushen:

   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

Der Workflow `.github/workflows/release.yml` testet, baut das VSIX und erstellt das GitHub-Release mit den
Release-Notes aus `CHANGELOG.md`.

Alternativ lokal: `./release.sh` (benötigt die GitHub CLI `gh`).
