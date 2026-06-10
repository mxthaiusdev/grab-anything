#!/usr/bin/env bash
# Builds a Chrome Web Store uploadable zip. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./manifest.json').version)")
mkdir -p dist
OUT="dist/grab-anything-${VERSION}.zip"
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json background.js content.js \
  popup.html popup.js options.html options.js \
  onboarding.html i18n.js zip.js \
  icons _locales \
  -x '.*' '*/.*'

echo ""
unzip -l "$OUT"
echo "built $OUT"
