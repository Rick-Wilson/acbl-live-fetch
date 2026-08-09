#!/bin/bash
# Build store-ready archives for every target.
#
#   scripts/package-stores.sh
#
# Produces dist/packages/<name>-<version>-<target>.zip for Chrome, Edge and
# Firefox, plus a source archive for Firefox review. Safari is not a zip — it
# ships as a Mac app built in Xcode; this script refreshes the resources that
# project copies from, and tells you what to do next.

set -euo pipefail
cd "$(dirname "$0")/.."

NAME=$(python3 -c "import json;print(json.load(open('package.json'))['name'])")
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/packages"

echo "==> $NAME $VERSION"
rm -rf "$OUT"; mkdir -p "$OUT"

# Guard: the test build widens host permissions for end-to-end testing and must
# never reach a store.
guard_test_origins() {
  local manifest="$1"
  if grep -qE "localhost|127\.0\.0\.1|github\.io" "$manifest"; then
    echo "REFUSING: $manifest contains test-only origins" >&2
    exit 1
  fi
}

for target in chrome edge firefox; do
  echo "==> building $target"
  BROWSER="$target" npx vite build --outDir "dist/$target" >/dev/null
  guard_test_origins "dist/$target/manifest.json"
  (cd "dist/$target" && zip -qr "../../$OUT/$NAME-$VERSION-$target.zip" .)
done

# Firefox reviewers require buildable source when the submission is minified.
echo "==> source archive for Firefox review"
git archive --format=zip --prefix="$NAME-$VERSION/" HEAD \
  -o "$OUT/$NAME-$VERSION-source.zip"

echo "==> refreshing Safari resources"
BROWSER=safari npx vite build --outDir dist/safari >/dev/null
guard_test_origins dist/safari/manifest.json
SAFARI_RES="safari/Bridge Classroom Fetch/Shared (Extension)/Resources"
if [ -d "$SAFARI_RES" ]; then
  rm -rf "${SAFARI_RES:?}/"*
  cp -R dist/safari/* "$SAFARI_RES/"
  echo "    updated $SAFARI_RES"
else
  echo "    no Xcode project yet — create one with:"
  echo "    xcrun safari-web-extension-converter dist/safari --project-location safari/"
fi

echo
ls -lh "$OUT"
cat <<'EOF'

Next steps
  Chrome   upload the -chrome.zip at chrome.google.com/webstore/devconsole
  Edge     upload the -edge.zip at partner.microsoft.com/dashboard/microsoftedge
  Firefox  upload the -firefox.zip AND the -source.zip at addons.mozilla.org
  Safari   open safari/*/*.xcodeproj in Xcode, bump the build number,
           then Product > Archive > Distribute App

See docs/store-review.md for listing copy, permission justifications and the
per-store data-use declarations.
EOF
