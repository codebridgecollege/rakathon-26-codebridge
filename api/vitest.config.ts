import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { buildBundles } from "../fhir/nis/bundles.ts";

// Tests run inside workerd with the bindings from wrangler.jsonc (local D1 and R2), so they exercise the same
// runtime as production. The migrations are read here in Node and applied inside the tests (test/data.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  // The seed's STAFF_DEPTS block, so the domain test can check the server's default staff against what the seed
  // writes into D1 (workerd cannot read files outside the Worker).
  const seed = readFileSync(path.join(import.meta.dirname, "seed/seed.py"), "utf8");
  const staffBlock = /^STAFF_DEPTS = \[[\s\S]*?\n\]/m.exec(seed)?.[0] ?? "";
  const staffBlockB = /^STAFF_DEPTS_B = \[[\s\S]*?\n\]/m.exec(seed)?.[0] ?? "";
  // The Worker's own source, for the reminder test that flags SQL on org tables without org_id (test/org-sql.test.ts).
  const src = path.join(import.meta.dirname, "src");
  const sources = Object.fromEntries(
    (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts") && !f.endsWith("worker-configuration.d.ts"))
      .map((f) => [f, readFileSync(path.join(src, f), "utf8")]),
  );
  // The NIS test Bundles (fhir/nis/bundles.ts) without the PDF bytes, for the in-memory FHIR server in test/nis.test.ts.
  const json = (p: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "..", p), "utf8"));
  const nisBundles = buildBundles({
    case10: json("fixtures/data/mock-case-10.json"),
    s01: json("fixtures/data/mock-case-S01.json"),
    s02: json("fixtures/data/mock-case-S02.json"),
    s02Referral: json("samples/S02_pacient/upload/zadost-fhir.json"),
    pdf: () => null,
  });
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // The Workflow runs with the Worker's own bindings, not the per-test env, so its secrets and endpoints are
        // pinned here: a developer's .dev.vars must never reach a test, and an unmocked call goes to a .test host.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_SEED_STAFF: staffBlock,
            TEST_SEED_STAFF_B: staffBlockB,
            TEST_SOURCES: sources,
            TEST_NIS_BUNDLES: JSON.stringify(nisBundles),
            // The lab values of S01 and S02 as their prepared fixtures hold them, the reference the NIS mapping is
            // compared with (test/nis-map.test.ts).
            TEST_NIS_LAB_REFERENCE: JSON.stringify({
              S01: json("fixtures/data/mock-case-S01.json").labs_series,
              S02: json("fixtures/data/mock-case-S02.json").labs_series,
            }),
            ELEVENLABS_API_KEY: "test-el",
            AZURE_OPENAI_KEY: "test-az",
            AI_GATEWAY_TOKEN: "",
            AI_GATEWAY_BASE: "",
            ELEVENLABS_API_BASE: "https://elevenlabs.test",
            AZURE_OPENAI_BASE: "https://azure.test/openai/v1",
            MODEL_BASE: "https://model.test/openai/v1",
            MODEL_API_KEY: "",
            AUTH_MODE: "demo",
            DATA_API: "on",
            // Step 6: the document Workflow calls the page reader here; the tests mock this host.
            PAGE_READER_URL: "https://page-reader.test",
            // Issue #22: no org has a NIS unless a test sets one.
            NIS_CONFIG: "{}",
            // No container in tests (wrangler dev and workerd run none); the mocked host above stands in for it.
            PAGE_READER_CONTAINER: "off",
            // Workflows run with these bindings: the case merge runs for demo org B, as on the deployed host.
            PIPELINE_ORGS: "demo-b",
          },
          // The PAGE_READER binding names the class in another Worker (codebridge-page-reader); workerd refuses to start
          // when that Worker is missing, so the tests get an empty stand-in. Nothing calls it (PAGE_READER_CONTAINER off).
          workers: [
            {
              name: "codebridge-page-reader",
              modules: true,
              compatibilityDate: "2026-09-30",
              script: "export class PageReader { fetch() { return new Response(null, { status: 503 }); } }\nexport default { fetch: () => new Response(null, { status: 404 }) };",
              durableObjects: { PAGE_READER: "PageReader" },
            },
          ],
        },
      }),
    ],
  };
});
