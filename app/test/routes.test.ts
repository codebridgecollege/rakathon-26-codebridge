// Every page of the app is reachable by its address after a reload: the Worker serves the app's page only for the
// route prefixes in api/scripts/app-routes.mjs (any other path is its real 404), so a page whose path no prefix covers
// would open by a click and fail on a reload or a link.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pagesDir = path.join(import.meta.dirname, "../app/pages");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? files(path.join(d, f)) : [path.join(d, f)]));

// The list is read as text, so the test does not depend on how the build script is written as a module.
const source = readFileSync(path.join(import.meta.dirname, "../../api/scripts/app-routes.mjs"), "utf8");
const APP_ROUTES = JSON.parse(/APP_ROUTES = (\[[^\]]*\])/.exec(source)![1]!) as string[];

// Cloudflare's rule match as headers.mjs uses it: a static path matches itself, a trailing splat any rest, also an
// empty one (/patient/ is served too; the app shows its empty fallback there, checked against wrangler dev).
const served = (p: string) => APP_ROUTES.some((r) => (r.endsWith("/*") ? p.startsWith(r.slice(0, -1)) : p === r));

// Example addresses of a page file: [x] becomes a value, [[x]] (optional) gives the address with and without it.
function examples(file: string): string[] {
  const segs = path.relative(pagesDir, file).replace(/\.vue$/, "").split(path.sep);
  if (segs.at(-1) === "index") segs.pop();
  let out = [""];
  for (const s of segs) {
    if (/^\[\[.+\]\]$/.test(s)) out = out.flatMap((o) => [o, `${o}/x1`]);
    else out = out.map((o) => `${o}/${s.startsWith("[") ? "x1" : s}`);
  }
  return out.map((o) => o || "/");
}

describe("app routes and the Worker", () => {
  it("serves the app's page for every page's address", () => {
    const pages = files(pagesDir).filter((f) => f.endsWith(".vue"));
    expect(pages.length).toBeGreaterThan(5);
    for (const f of pages) {
      const rel = path.relative(pagesDir, f);
      // / is the page itself; [view].vue is the in-app fallback for any other one-segment path, which the Worker
      // deliberately answers with its 404 page.
      if (rel === "index.vue" || rel === "[view].vue") continue;
      for (const p of examples(f)) expect(served(p), `${rel}: ${p}`).toBe(true);
    }
  });

  it("leaves other paths to the 404 page", () => {
    for (const p of ["/", "/neexistuje", "/patient", "/patients/10", "/app/patients", "/legacy/", "/u", "/api/health"]) expect(served(p), p).toBe(false);
  });
});
