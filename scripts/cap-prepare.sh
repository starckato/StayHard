#!/bin/bash
# QROK · Capacitor web-dir prepare
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
cp privacy.html terms.html www/ 2>/dev/null || true

# Asset directory.
# 2026-04-24: tier[1-3]/ 서브폴더 캐릭터 art 는 Will Cube 시스템 + 캐릭터 룸에서
# 사용. 루트의 Tier4_cha.png / Tier5_cha.png / Tier6_cha.png 도 향후 사용.
# tier2_throw_asset.js (v3 실험) 만 계속 제외.
if [ -d assets ]; then
  mkdir -p www/assets
  rsync -a \
    --exclude='tier2_*.js' \
    assets/ www/assets/
fi

# Built ESM bundle
if [ -d dist ]; then
  cp -R dist www/
fi

echo "[cap-prepare] ✓ www/ ready ($(du -sh www | cut -f1))"
