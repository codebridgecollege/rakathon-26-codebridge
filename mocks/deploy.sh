#!/usr/bin/env bash
# Publishes mock v3 to Cloudflare Pages as mdt.html, with the page images it loads.
# The browser allows the microphone (AI záznam) only on HTTPS outside the claude.ai viewer, hence a real host.
# Needs a Cloudflare login: `npx -y wrangler@4 login` once, or CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${CF_PAGES_PROJECT:-codebridge-mdt}"

uv run mocks/build.py
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp mocks/v3.html "$OUT/mdt.html"
cp -R mocks/pages "$OUT/pages"
# stt-config.js holds a local key override and is never published.

npx -y wrangler@4 pages project list 2>/dev/null | grep -q " $PROJECT " ||
  npx -y wrangler@4 pages project create "$PROJECT" --production-branch main --force
npx -y wrangler@4 pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true
echo "https://$PROJECT.pages.dev/mdt.html"
