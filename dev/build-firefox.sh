#!/usr/bin/env bash
# Builds the Firefox (AMO) variant: same code, manifest adjusted for
# Firefox MV3 (event-page background instead of a service worker, gecko id).
# NOTE: best-effort port — run through `web-ext lint` / manual test in
# Firefox before submitting to addons.mozilla.org.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./manifest.json').version)")
STAGE=$(mktemp -d)
mkdir -p dist

cp -R manifest.json background.js content.js gif.js popup.html popup.js \
      options.html options.js onboarding.html i18n.js zip.js icons _locales "$STAGE/"

node -e "
const fs = require('fs');
const m = JSON.parse(fs.readFileSync('$STAGE/manifest.json', 'utf8'));
m.background = { scripts: ['background.js'] };
m.browser_specific_settings = { gecko: { id: 'grab-anything@mathaius.dev', strict_min_version: '128.0' } };
fs.writeFileSync('$STAGE/manifest.json', JSON.stringify(m, null, 2));
"

OUT="$PWD/dist/grab-anything-${VERSION}-firefox.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -r "$OUT" . -x '.*' '*/.*' > /dev/null)
rm -rf "$STAGE"
echo "built $OUT"
