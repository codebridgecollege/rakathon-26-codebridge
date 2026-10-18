#!/usr/bin/env bash
# Copies the built mock into api/.assets, the Worker's static-asset folder.
# mocks/build.py stays the one build of the page; this only stages its output, as mocks/deploy.sh does for Pages.
# With STAGE_APP=1 it also builds the Nuxt app (app/, docs/design/FRONTEND.md) and stages it at /app/, next to
# today's page. CI does not set it, so deploys stay as they were until the team switches the app on.
set -euo pipefail
cd "$(dirname "$0")/.."
MOCKS=../mocks
rm -rf .assets && mkdir -p .assets
cp "$MOCKS/v3.html" .assets/index.html
cp -R "$MOCKS/pages" .assets/pages
# The intake demo patient's documents as a ZIP, linked from the "Nový pacient" dialog.
cp -R "$MOCKS/ukazka" .assets/ukazka
# The phone page of "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md): served at /u (u.html, the assets' default
# html_handling drops the extension), a few kB on its own, never the app.
cp "$MOCKS/src/phone-upload.html" .assets/u.html
# A real 404 keeps old links from looking alive (not_found_handling: 404-page).
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">úvodní stránce</a>.</p>\n' > .assets/404.html
if [ "${STAGE_APP:-0}" = "1" ]; then
  # `npm ci` inside api/ installs the Worker's dependencies only; the app needs the root install.
  if [ ! -d ../node_modules/nuxt ]; then
    echo "STAGE_APP=1 needs the app's dependencies: run npm ci at the repository root first." >&2
    exit 1
  fi
  npm run generate --workspace @codebridge/app
  mkdir -p .assets/app
  cp -R ../app/.output/public/. .assets/app/
  # Nuxt writes its own 404.html and 200.html (both the SPA shell). The assets' 404-page handling serves the nearest
  # 404.html, so Nuxt's would answer every unknown /app/... path with the app instead of the Worker's real 404; the
  # app's routes are hash routes and need neither file.
  rm -f .assets/app/404.html .assets/app/200.html
fi
