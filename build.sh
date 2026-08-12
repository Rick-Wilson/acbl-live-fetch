#!/usr/bin/env bash
# Build the Firefox package from this source archive.
#
# One command, as addons.mozilla.org's source-review checklist asks for. See
# BUILD.md for requirements and for what each step does.
#
#   ./build.sh        →  dist/firefox/
#
# Requires Node.js 20+ and npm 10+; nothing else, and nothing global.
set -euo pipefail

node --version >/dev/null 2>&1 || { echo "Node.js is required — see BUILD.md" >&2; exit 1; }

echo "==> node $(node --version), npm $(npm --version)"

# npm ci, not npm install: installs exactly what package-lock.json pins, which
# is what makes the output reproducible.
echo "==> installing dependencies from package-lock.json"
npm ci

echo "==> building"
BROWSER=firefox npx vite build --outDir dist/firefox

echo
echo "Done. The extension is dist/firefox/ — zip its contents to get the"
echo "uploaded package."
