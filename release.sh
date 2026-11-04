#!/bin/bash
# Builds the VSIX and creates a GitHub release with the notes of the current version from CHANGELOG.md.
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")
VSIX="${NAME}-${VERSION}.vsix"

npm run lint
npm run test:unit
npx vsce package

awk -v v="## Version ${VERSION}" '$0 ~ "^"v {f=1; next} /^## Version / && f {exit} f' CHANGELOG.md > /tmp/release-notes.md

gh release create "v${VERSION}" \
    --title "REDAXO Multi-Instances Manager ${VERSION}" \
    --notes-file /tmp/release-notes.md \
    --target main \
    "${VSIX}"
