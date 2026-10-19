// Runs the in-memory NIS test double (memory-server.ts) on localhost, for local development without Docker.
//   node fhir/nis/serve.ts [--port 8090] [--seed]
// --seed loads the Bundles from fhir/nis/out/ (run build.ts first). Listens on 127.0.0.1 only: the data is synthetic,
// but the habit is the one a real NIS needs.
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { MemoryFhir } from "./memory-server.ts";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || 8090;
// 127.0.0.1, not localhost: the server listens on IPv4 only, and localhost may resolve to ::1 first.
const base = `http://127.0.0.1:${port}/fhir`;
const fhir = new MemoryFhir(base);

if (args.includes("--seed")) {
  const out = path.join(import.meta.dirname, "out");
  if (!existsSync(out)) throw new Error("fhir/nis/out/ is missing; run node fhir/nis/build.ts first");
  for (const f of readdirSync(out).filter((x) => x.endsWith(".json")).sort()) {
    const r = fhir.load(JSON.parse(readFileSync(path.join(out, f), "utf8")));
    console.log(`${f}: ${r.entry.length} resources`);
  }
}

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const r = await fhir.handle(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, ...(body && req.method !== "GET" ? { body } : {}) }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  // Method and path only; a search's form body (which may hold a birth number) is never printed.
  console.log(`${req.method} ${(req.url ?? "").split("?")[0]} ${r.status}`);
}).listen(port, "127.0.0.1", () => console.log(`NIS test double at ${base}`));
