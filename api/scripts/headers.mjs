// Writes .assets/_headers and .assets/_redirects for the Worker's static assets (Cloudflare reads both files and
// serves neither). Run by stage-assets.sh after the app is staged, because the content security policy pins the
// SHA-256 of each inline script in the app's index.html, and Nuxt writes a new build id into one of them every build.
//
// Usage: node scripts/headers.mjs <assets dir>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/headers.mjs <assets dir>");
const html = readFileSync(path.join(dir, "index.html"), "utf8");

// Inline scripts the browser executes or parses as script: the import map and Nuxt's config script. A JSON data block
// (type="application/json") is never executed, so the policy does not govern it and it needs no hash.
const hashes = [];
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const attrs = m[1];
  if (/\bsrc\s*=/i.test(attrs)) continue;
  const type = /\btype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.toLowerCase() ?? "";
  if (type === "application/json") continue;
  hashes.push(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
}
// Nuxt's SPA shell has exactly these two today; a different count means its output changed and the policy needs a look.
if (hashes.length !== 2) throw new Error(`expected 2 inline scripts in the app's index.html, found ${hashes.length}`);

// Every source is named for a reason:
// - script-src: our bundles and the two inline scripts by hash; jsPDF and its fonts load as same-origin files.
//   No 'unsafe-inline' and no 'unsafe-eval'.
// - style-src-elem: our CSS and the Google Fonts stylesheet (the same fonts as the old page).
// - style-src-attr 'unsafe-inline': style attributes in templates and in HTML the app inserts (the report, the QR
//   SVG). An attribute cannot load anything or run script; allowing it keeps the old page's markup unchanged.
// - font-src: the font files the Google Fonts stylesheet points to.
// - img-src: page images and the logo from our origin, data: for small inline images, blob: for object URLs.
// - connect-src: our API, and the speech service's realtime socket (the server mints a token and returns a wss URL
//   on api.elevenlabs.io, ELEVENLABS_API_BASE in wrangler.jsonc; change both together).
// - frame-ancestors, base-uri, form-action, object-src: no framing, no <base> rewrites, no form posts elsewhere, no
//   plugins.
const csp = [
  "default-src 'none'",
  `script-src 'self' ${hashes.join(" ")}`,
  "style-src-elem 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Rules for every file: no MIME sniffing, no referrer outside our origin, no framing (old browsers read
// X-Frame-Options only), and only the microphone (the AI recorder) among the powerful features.
// The policy itself is set on the app's page only: today's page at /legacy/, the phone page at /u and the 404 page run
// inline scripts and styles throughout and get the common headers.
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self)

/
  Content-Security-Policy: ${csp}
  Cross-Origin-Opener-Policy: same-origin
`;
for (const line of headers.split("\n")) if (line.length > 2000) throw new Error("a _headers line exceeds Cloudflare's 2,000 characters");
writeFileSync(path.join(dir, "_headers"), headers);

// Today's page moved from / to /legacy/. Its relative links (the S02 ZIP, embedded page images) now resolve under
// /legacy/, so they are sent to the one copy at the root. /app/ was the new app's address during the port; a
// redirect keeps those bookmarks working (the browser keeps the #/route across a redirect without a fragment).
// Static rules come first: Cloudflare matches them faster than rules with a splat.
const redirects = `/app / 301
/app/ / 301
/legacy/ukazka/* /ukazka/:splat 302
/legacy/pages/* /pages/:splat 302
/app/* / 301
`;
writeFileSync(path.join(dir, "_redirects"), redirects);
