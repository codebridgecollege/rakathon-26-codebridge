import path from "node:path";
import { readFileSync } from "node:fs";
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
            ELEVENLABS_API_KEY: "test-el",
            AZURE_OPENAI_KEY: "test-az",
            AI_GATEWAY_TOKEN: "",
            AI_GATEWAY_BASE: "",
            ELEVENLABS_API_BASE: "https://elevenlabs.test",
            AZURE_OPENAI_BASE: "https://azure.test/openai/v1",
            AUTH_MODE: "demo",
            DATA_API: "on",
            // Step 6: the document Workflow calls PageKit here; the tests mock this host.
            PAGEKIT_URL: "https://pagekit.test",
          },
        },
      }),
    ],
  };
});
