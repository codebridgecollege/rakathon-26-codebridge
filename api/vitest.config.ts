import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

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
          },
        },
      }),
    ],
  };
});
