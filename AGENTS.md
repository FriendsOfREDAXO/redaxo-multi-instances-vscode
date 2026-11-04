# AGENTS.md

Guidance for AI coding assistants working on this repository (the VS Code extension itself).

## Overview

VS Code extension that manages local REDAXO / PHP development instances with Docker. It also ships a standalone
MCP server (stdio) for Claude Code / Claude Desktop. Both share all logic via `src/core`.

## Layout

```
src/core/        Node-only logic, no `vscode` import (used by the extension AND the MCP server)
  versions.ts    single source of truth for PHP / MariaDB / REDAXO versions and shared service images
  model.ts       instance model (v2 config, 1.x formats), validation
  store.ts       reading instances from disk (v2 `redaxo-instance.json` + detection of 1.x formats)
  templates.ts   docker-compose.yml, Caddyfile, AGENTS.md for instances
  manager.ts     InstanceManager: create/start/stop/import/export/modernize/console/query …
  shared.ts      shared services (Caddy HTTPS proxy, Mailpit, Adminer) + automatic port allocation
  tools.ts       AI tool definitions shared by the LM tools and the MCP server
src/extension/   VS Code layer (native UI only: TreeViews, QuickPicks, notifications, terminals)
src/mcp/         MCP server entry point (bundled to dist/mcp-server.js)
assets/docker/   Dockerfile, entrypoint.sh, php.ini, vhost.conf – embedded at build time
                 (scripts/generate-assets.mjs → src/core/assets.generated.ts, gitignored)
test/unit/       mocha + tsx, no Docker
test/integration/ runs inside VS Code (@vscode/test-cli)
test/e2e/        real Docker; test/e2e/legacy/ holds verbatim 1.21.0 generators – never modify them
```

## Commands

```bash
npm run compile          # generate assets, type check, bundle (esbuild)
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e         # slow, needs Docker
npm run l10n:export      # after adding/changing vscode.l10n.t() strings – then update l10n/bundle.l10n.de.json
```

## Rules

- **Compatibility is mandatory:** 1.x instances (`legacy-standard`, `legacy-custom`), command ids, setting keys and
  1.x export archives must keep working. Migrations are opt-in and create a backup first.
- `src/core` must not import `vscode`. Run processes via `run()` from `core/exec.ts` with argument arrays – never
  build shell strings from user input.
- Versions only change in `core/versions.ts`. Changing anything in `assets/docker` changes the image hash, so all
  instances rebuild their image on the next start – keep the Dockerfile cache-friendly (big layers first).
- UI: native VS Code UI only (no webviews). Every user-visible string goes through `vscode.l10n.t()` (runtime) or
  `package.nls.json` (manifest) and needs a German translation; `test/unit/manifest.test.ts` checks this.
- New LM/MCP tools are added to `TOOL_DEFINITIONS` and to `contributes.languageModelTools` in package.json
  (the manifest test compares both).
- Keep settings minimal – prefer automatic detection over new options.
