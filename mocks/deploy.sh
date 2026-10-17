#!/usr/bin/env bash
# Publishes mock v3 to Cloudflare Pages as the site root (index.html), with the page images it loads.
# The browser allows the microphone (AI záznam) only on HTTPS outside the claude.ai viewer, hence a real host.
# The server routes (functions/: /api/summarize, /api/stt/*) need two secrets once, typed at the prompt:
#   npx -y wrangler@4.147.0 pages secret put AZURE_OPENAI_KEY --project-name codebridge-mdt
#   npx -y wrangler@4.147.0 pages secret put ELEVENLABS_API_KEY --project-name codebridge-mdt
# Needs a Cloudflare login: `npx -y wrangler@4.147.0 login` once, or CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${CF_PAGES_PROJECT:-codebridge-mdt}"

# CI deploys the committed build (mocks/v3.html and mocks/pages/), so it sets RUN_BUILD=0.
if [ "${RUN_BUILD:-1}" = 1 ]; then uv run mocks/build.py; fi
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
mkdir "$OUT/public"
cp mocks/v3.html "$OUT/public/index.html"
cp -R mocks/pages "$OUT/public/pages"
# The intake demo patient's documents as a ZIP, linked from the "Nový pacient" dialog.
cp -R mocks/ukazka "$OUT/public/ukazka"
# Wrangler picks up Pages Functions from ./functions next to where it runs.
cp -R mocks/functions "$OUT/functions"
# Model names and limits come from configuration (CLAUDE.md), not from the functions' code.
cp mocks/pages-wrangler.toml "$OUT/wrangler.toml"
# Without a 404 page, Pages answers every unknown path with the app; a real 404 keeps old links from looking alive.
printf '<!doctype html><meta charset="utf-8"><title>Stránka nenalezena</title><p>Stránka nenalezena. Aplikace je na <a href="/">%s</a>.</p>\n' "$PROJECT.pages.dev" > "$OUT/public/404.html"

npx -y wrangler@4.147.0 pages project list 2>/dev/null | grep -q " $PROJECT " ||
  npx -y wrangler@4.147.0 pages project create "$PROJECT" --production-branch main --force
(cd "$OUT" && npx -y wrangler@4.147.0 pages deploy public --project-name "$PROJECT" --branch main --commit-dirty=true)
echo "https://$PROJECT.pages.dev"
