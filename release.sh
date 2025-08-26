#!/bin/bash

# REDAXO Multi-Instances Manager Release Script

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")
VSIX_FILE="${PACKAGE_NAME}-${VERSION}.vsix"

echo "🚀 Creating Release v${VERSION}"

# Check if VSIX exists
if [ ! -f "${VSIX_FILE}" ]; then
    echo "❌ VSIX file not found: ${VSIX_FILE}"
    echo "Creating VSIX package..."
    npm run package
    npx @vscode/vsce package
fi

echo "📦 VSIX file: ${VSIX_FILE} ($(du -h ${VSIX_FILE} | cut -f1))"

# Use existing RELEASE_NOTES.md if it exists, otherwise create a minimal one
if [ -f "RELEASE_NOTES.md" ]; then
    echo "📋 Using existing RELEASE_NOTES.md"
else
    echo "📝 Creating release notes from package.json..."
    DISPLAY_NAME=$(node -p "require('./package.json').displayName")
    DESCRIPTION=$(node -p "require('./package.json').description")
    
    cat > RELEASE_NOTES.md << EOF
## � ${DISPLAY_NAME} v${VERSION}

${DESCRIPTION}

### 📥 Installation
1. VSIX herunterladen
2. VS Code → \`Cmd+Shift+P\` → "Extensions: Install from VSIX"
3. Datei auswählen

### ❤️ Community
GitHub Issues & REDAXO Slack – siehe README.

EOF
fi

echo "📋 Release notes prepared"

# Delete old release if exists
gh release delete "v${VERSION}" --yes 2>/dev/null || echo "No existing release to delete"
git tag -d "v${VERSION}" 2>/dev/null || echo "No existing tag to delete"  
git push --delete origin "v${VERSION}" 2>/dev/null || echo "No existing remote tag to delete"

# Create new release
echo "🏷️ Creating GitHub release..."
gh release create "v${VERSION}" \
    --title "🚀 ${DISPLAY_NAME} v${VERSION}" \
    --notes-file RELEASE_NOTES.md \
    --target main \
    "${VSIX_FILE}"

echo "✅ Release v${VERSION} created successfully!"
echo "🔗 https://github.com/FriendsOfREDAXO/redaxo-multi-instances-vscode/releases/tag/v${VERSION}"
