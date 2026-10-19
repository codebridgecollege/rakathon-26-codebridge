// Loads the NIS test Bundles (fhir/nis/out/, from build.ts) into a local FHIR server: the HAPI FHIR container
// (docker-compose.yml) or the in-memory double started without --seed.
//   node fhir/nis/seed.ts [base]          default base http://127.0.0.1:8090/fhir
// Refuses any host that is not this machine: our test data never goes to a public FHIR server (CLAUDE.md).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:8090/fhir").replace(/\/+$/, "");
const host = new URL(base).hostname;
if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
  console.error(`Refusing to seed ${host}: only a FHIR server on this machine may receive the test data.`);
  process.exit(1);
}

const out = path.join(import.meta.dirname, "out");
for (const f of readdirSync(out).filter((x) => x.endsWith(".json")).sort()) {
  const res = await fetch(base, { method: "POST", headers: { "content-type": "application/fhir+json", accept: "application/fhir+json" }, body: readFileSync(path.join(out, f)) });
  const body = (await res.json()) as { entry?: unknown[]; issue?: { diagnostics?: string }[] };
  if (!res.ok) {
    console.error(`${f}: HTTP ${res.status} ${body.issue?.[0]?.diagnostics ?? ""}`);
    process.exit(1);
  }
  console.log(`${f}: ${body.entry?.length ?? 0} resources`);
}
