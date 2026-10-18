#!/usr/bin/env bash
# Stages the Worker's static files in api/.assets: the Nuxt app (app/, docs/design/FRONTEND.md) at /, the page
# images at /pages/, the intake demo patient's ZIP at /ukazka/, the phone page at /u and the 404 page.
# scripts/headers.mjs then writes the security headers and the rewrites of the app's route paths for these files.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=..
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
# The rendered pages of the synthetic documents (data/derived/pages/<pdf stem>/p<n>.png and the p<n>.redacted.png that
# scripts/redact_pages.py writes), served at /pages/<pdf stem>/. Only the page images: the text layers, word boxes and
# redaction records next to them stay out of the public files.
(cd "$ROOT/data/derived/pages" && find . -type f -regex '.*/p[0-9][0-9]*\(\.redacted\)\{0,1\}\.png' -print) | while read -r f; do
  mkdir -p ".assets/pages/$(dirname "$f")"
  cp "$ROOT/data/derived/pages/$f" ".assets/pages/$f"
done
# The intake demo patient's documents as a ZIP (fixtures/prepare.py), linked from the "Nový pacient" dialog.
cp -R "$ROOT/fixtures/ukazka" .assets/ukazka
# The phone page of "Nahrát z telefonu" (docs/design/PHONE-UPLOAD.md): served at /u (u.html, the assets' default
# html_handling drops the extension), a few kB on its own, never the app.
cp public/phone-upload.html .assets/u.html
# A real 404 keeps old links from looking alive (not_found_handling: 404-page).
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">úvodní stránce</a>.</p>\n' > .assets/404.html
node scripts/headers.mjs .assets
