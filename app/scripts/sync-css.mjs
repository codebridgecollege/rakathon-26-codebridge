// Copies today's page CSS into the app unchanged, so the new shell looks exactly like the old page while screens are
// ported. The source is the <style> block of mocks/src/v3-template.html with mocks/src/prognosis.css filled in at its
// placeholder, as mocks/build.py does. `node scripts/sync-css.mjs --check` exits 1 when the copy is stale (the app's
// tests run the same comparison).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mocks = path.join(here, "../../mocks/src");
const out = path.join(here, "../app/assets/v3.css");

export function pageCss() {
  const html = readFileSync(path.join(mocks, "v3-template.html"), "utf8");
  const m = /<style>\n([\s\S]*?)<\/style>/.exec(html);
  if (!m) throw new Error("no <style> block in v3-template.html");
  return m[1].replace("/*PROGNOSIS_CSS*/", () => readFileSync(path.join(mocks, "prognosis.css"), "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = pageCss();
  if (process.argv.includes("--check")) {
    const same = readFileSync(out, "utf8") === css;
    if (!same) console.error("app/app/assets/v3.css differs from the template; run node app/scripts/sync-css.mjs");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(out, css);
}
