#!/usr/bin/env bash
# Copies the built mock into api/.assets, the Worker's static-asset folder.
# mocks/build.py stays the one build of the page; this only stages its output, as mocks/deploy.sh does for Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
MOCKS=../mocks
rm -rf .assets && mkdir -p .assets
cp "$MOCKS/v3.html" .assets/index.html
cp -R "$MOCKS/pages" .assets/pages
# The intake demo patient's documents as a ZIP, linked from the "Nový pacient" dialog.
cp -R "$MOCKS/ukazka" .assets/ukazka
# A real 404 keeps old links from looking alive (not_found_handling: 404-page).
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">úvodní stránce</a>.</p>\n' > .assets/404.html
