#!/usr/bin/env bash
# Stages the Worker's static files in api/.assets: the Nuxt app (app/, docs/design/FRONTEND.md) at /, today's page
# (mocks/build.py's output) at /legacy/ for a transition period, and the files both read (page images, the S02 ZIP,
# the phone page). scripts/headers.mjs then writes the security headers, the redirects and the rewrites of the app's
# route paths for these files.
set -euo pipefail
cd "$(dirname "$0")/.."
MOCKS=../mocks
# `npm ci` inside api/ installs the Worker's dependencies only; the app needs the root install.
if [ ! -d ../node_modules/nuxt ]; then
  echo "Staging builds the app and needs its dependencies: run npm ci at the repository root first." >&2
  exit 1
fi
npm run generate --workspace @codebridge/app
rm -rf .assets && mkdir -p .assets
cp -R ../app/.output/public/. .assets/
# Nuxt writes its own 404.html and 200.html (both the SPA shell). The assets' 404-page handling serves the nearest
# 404.html, so Nuxt's would answer every unknown path with the app instead of the Worker's real 404. The app's route
# paths are served by rewrites that headers.mjs writes for the prefixes in scripts/app-routes.mjs, never by a fallback.
rm -f .assets/404.html .assets/200.html
# Today's page, unchanged, at /legacy/ (legacy/index.html; the assets' default html_handling serves it there).
mkdir -p .assets/legacy
cp "$MOCKS/v3.html" .assets/legacy/index.html
cp -R "$MOCKS/pages" .assets/pages
# The intake demo patient's documents as a ZIP, linked from the "Nový pacient" dialog.
cp -R "$MOCKS/ukazka" .assets/ukazka
# The phone page of "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md): served at /u (u.html, the assets' default
# html_handling drops the extension), a few kB on its own, never the app.
cp "$MOCKS/src/phone-upload.html" .assets/u.html
# A real 404 keeps old links from looking alive (not_found_handling: 404-page).
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">úvodní stránce</a>.</p>\n' > .assets/404.html
node scripts/headers.mjs .assets
