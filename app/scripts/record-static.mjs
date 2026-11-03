// Records the API answers of a local demo Worker into app/static-demo/, so `npm run dev:static` can show the app with
// no Worker, database or keys (for UI work only; see app/README.md, "Static copy"). Every answer is the seeded synthetic
// demo data (fixtures/, data/), read as the demo's default doctor, MUDr. Svobodová (d2p1), who sees every demo case.
//
// Usage: start the Worker with seeded data (`npm run seed:local` and `npm run dev` in api/), then from the repo root:
//   node app/scripts/record-static.mjs [http://localhost:8787]
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const OUT = path.join(import.meta.dirname, "..", "static-demo");
const USER = "d2p1";
// The access log is the administrator's; recorded as org A's administrator so the Administrace page has rows.
const ADMIN = "admin";

const index = {};
let n = 0;

// One answer: kept under a file name derived from its path, listed in index.json by the path the app requests.
async function record(url, user = USER) {
  if (url in index) return null;
  const r = await fetch(BASE + "/api" + url, { headers: { "x-demo-user": user } });
  const type = r.headers.get("content-type") ?? "application/octet-stream";
  const ext = type.includes("json") ? "json" : type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : "bin";
  const file = `${String(n++).padStart(4, "0")}-${url.replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 80)}.${ext}`;
  const body = Buffer.from(await r.arrayBuffer());
  await writeFile(path.join(OUT, "api", file), body);
  index[url] = { file, type, status: r.status };
  return ext === "json" && r.ok ? JSON.parse(body.toString("utf8")) : null;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, "api"), { recursive: true });

for (const url of ["/health", "/me", "/demo/memberships", "/staff", "/workflow", "/tasks?scope=all", "/tasks?scope=mine", "/calendar", "/prognosis/config"]) {
  await record(url);
}
await record("/admin/access-log", ADMIN);

const list = await record("/patients");
for (const p of list?.patients ?? []) {
  const id = encodeURIComponent(p.id);
  for (const part of ["", "/extraction", "/decisions", "/history", "/guidance", "/prognosis", "/intake", "/transcript", "/nis"]) {
    await record(`/cases/${id}${part}`);
  }
  await record(`/cases/${id}?via=link`);
  const docs = await record(`/cases/${id}/documents`);
  for (const d of docs?.documents ?? []) {
    const doc = encodeURIComponent(d.id);
    await record(`/documents/${doc}/pipeline`);
    for (let page = 1; page <= (d.page_count ?? 0); page++) {
      await record(`/documents/${doc}/pages/${page}`);
      await record(`/documents/${doc}/pages/${page}/image`);
    }
  }
}

await writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 1) + "\n");
console.log(`recorded ${Object.keys(index).length} answers into ${path.relative(process.cwd(), OUT)}/`);
