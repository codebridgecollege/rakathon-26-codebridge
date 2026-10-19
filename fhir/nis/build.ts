// Writes the NIS test Bundles (bundles.ts) to fhir/nis/out/, which is gitignored: the PDFs inside are already in git
// as files, so their base64 copies are not committed twice. Run from the repository root:
//   node fhir/nis/build.ts            (Node 22.18+ runs TypeScript directly)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildBundles } from "./bundles.ts";

const root = path.resolve(import.meta.dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(path.join(root, p), "utf8"));

export function loadFixtures(withPdfs = true) {
  return {
    case10: json("fixtures/data/mock-case-10.json"),
    s01: json("fixtures/data/mock-case-S01.json"),
    s02: json("fixtures/data/mock-case-S02.json"),
    s02Referral: json("samples/S02_pacient/upload/zadost-fhir.json"),
    pdf: (p: string) => {
      if (!withPdfs) return null;
      // Only committed synthetic files are read; private/ is never a source.
      if (p.startsWith("private/")) throw new Error("private/ is never read");
      const f = path.join(root, p);
      return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
    },
  };
}

if (import.meta.main) {
  const out = path.join(root, "fhir/nis/out");
  mkdirSync(out, { recursive: true });
  for (const [name, b] of Object.entries(buildBundles(loadFixtures()))) {
    writeFileSync(path.join(out, `${name}.json`), JSON.stringify(b, null, 2));
    console.log(`${name}.json: ${b.entry.length} resources`);
  }
}
