#!/usr/bin/env bash
# Publishes mock v3 to Cloudflare Pages as the site root (index.html), with the page images it loads.
# The browser allows the microphone (AI záznam) only on HTTPS outside the claude.ai viewer, hence a real host.
# Needs a Cloudflare login: `npx -y wrangler@4 login` once, or CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${CF_PAGES_PROJECT:-codebridge-mdt}"

# CI deploys the committed build (mocks/v3.html and mocks/pages/), so it sets RUN_BUILD=0.
if [ "${RUN_BUILD:-1}" = 1 ]; then uv run mocks/build.py; fi
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp mocks/v3.html "$OUT/index.html"
cp -R mocks/pages "$OUT/pages"
# Without a 404 page, Pages answers every unknown path with the app; a real 404 keeps old links from looking alive.
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">%s</a>.</p>\n' "$PROJECT.pages.dev" > "$OUT/404.html"
# stt-config.js holds a local key override and is never published.

npx -y wrangler@4 pages project list 2>/dev/null | grep -q " $PROJECT " ||
  npx -y wrangler@4 pages project create "$PROJECT" --production-branch main --force
npx -y wrangler@4 pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true
echo "https://$PROJECT.pages.dev"
