// Writes .assets/_headers and .assets/_redirects for the Worker's static assets (Cloudflare reads both files and
// serves neither). Run by stage-assets.sh after the app is staged, because the content security policy pins the
// SHA-256 of each inline script in the app's index.html, and Nuxt writes a new build id into one of them every build.
//
// Usage: node scripts/headers.mjs <assets dir>
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_ROUTES } from "./app-routes.mjs";

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
// - style-src-elem: our CSS and the Google Fonts stylesheet (the same fonts as the old page). style-src repeats it for
//   browsers without the split directives (Safari before 15.4, Firefox before 108), which would otherwise fall back to
//   default-src 'none' and draw the app unstyled; browsers that know style-src-elem ignore it for elements.
// - style-src-attr 'unsafe-inline': style attributes in templates and in HTML the app inserts (the report, the QR
//   SVG). An attribute cannot load anything or run script; allowing it keeps the old page's markup unchanged.
// - font-src: the font files the Google Fonts stylesheet points to.
// - img-src: page images and the logo from our origin, data: for the report's inline logo.
// - connect-src: our API, and the speech service's realtime socket (the server mints a token and returns a wss URL
//   on api.elevenlabs.io, ELEVENLABS_API_BASE in wrangler.jsonc; change both together). The browser makes no https
//   call to the service: tokens and the speaker pass go through the Worker.
// - frame-ancestors, base-uri, form-action, object-src: no framing, no <base> rewrites, no form posts elsewhere, no
//   plugins.
const csp = [
  "default-src 'none'",
  `script-src 'self' ${hashes.join(" ")}`,
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-elem 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' wss://api.elevenlabs.io",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// Rules for every file: no MIME sniffing, no referrer outside our origin, no framing (old browsers read
// X-Frame-Options only); camera, location, payment and USB off, the microphone for our own pages (the AI recorder).
// Nuxt's build files carry a content hash in their names, so they never change and may be cached for a year.
// The policy itself is set on the app's page only, at / and at every route path that serves it (the assets match
// _headers against the address the browser asked for, not the rewritten one): today's page at /legacy/, the phone page
// at /u and the 404 page run inline scripts and styles throughout and get the common headers.
const appPage = `  Content-Security-Policy: ${csp}
  Cross-Origin-Opener-Policy: same-origin
`;
const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self)

/_nuxt/*
  Cache-Control: public, max-age=31536000, immutable
${["/", ...APP_ROUTES].map((r) => `\n${r}\n${appPage}`).join("")}`;
for (const line of headers.split("\n")) if (line.length > 2000) throw new Error("a _headers line exceeds Cloudflare's 2,000 characters");
writeFileSync(path.join(dir, "_headers"), headers);

// Today's page moved from / to /legacy/. Its relative links (the S02 ZIP, embedded page images) now resolve under
// /legacy/, so they are sent to the one copy at the root. The app's route paths are rewritten (200, the address stays)
// to its page at /; the target is / and not /index.html, which the assets would redirect to / first.
// Static rules come first: Cloudflare matches them faster than rules with a splat.
const rewrites = APP_ROUTES.map((r) => `${r} / 200`);
const dynamic = (r) => r.includes(":") || r.includes("*");
const redirects = [
  ...rewrites.filter((r) => !dynamic(r)),
  "/legacy/ukazka/* /ukazka/:splat 302",
  "/legacy/pages/* /pages/:splat 302",
  ...rewrites.filter(dynamic),
  "",
].join("\n");
writeFileSync(path.join(dir, "_redirects"), redirects);

// nuxt generate also prerenders the static routes as folders (patients/index.html, tasks/index.html, ...). The assets
// would serve those at /patients/ without the rules above (no policy), so they go: /patients/ is then a 404 like
// every other path that is no route.
for (const r of APP_ROUTES) if (!dynamic(r)) rmSync(path.join(dir, r), { recursive: true, force: true });
