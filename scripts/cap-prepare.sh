#!/bin/bash
# Stay Hard · Capacitor web-dir prepare
#
# Builds the esbuild bundle and assembles a clean `www/` directory that
# Capacitor will copy into the native iOS/Android app.
#
# Why not `webDir: "."`? — root contains node_modules, src, document-private,
# package.json, etc. which must NOT ship inside the app.
#
# assets/ filtering: excludes Tier[1-6]_* / tier2_throw_asset.js (v3 experiments
# that survived on disk but production uses GymRat_Tier*.png only).

set -euo pipefail
cd "$(dirname "$0")/.."

echo "[cap-prepare] 1/3 building esbuild bundle..."
npm run build >/dev/null

echo "[cap-prepare] 2/3 resetting www/ ..."
rm -rf www
mkdir -p www

echo "[cap-prepare] 3/3 copying web assets..."
# Static entry + PWA metadata
cp index.html www/
cp manifest.json www/
cp sw.js www/
cp sprites.js www/
cp icon-192.png icon-512.png www/

# Asset directory — exclude v3 experiment images (Tier[1-6]_* / tier2_*)
if [ -d assets ]; then
  mkdir -p www/assets
  rsync -a \
    --exclude='Tier[1-6]_*' \
    --exclude='tier2_*' \
    assets/ www/assets/
fi

# Built ESM bundle
if [ -d dist ]; then
  cp -R dist www/
fi

echo "[cap-prepare] ✓ www/ ready ($(du -sh www | cut -f1))"
