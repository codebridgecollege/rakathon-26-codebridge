import path from "node:path";
import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with the bindings from wrangler.jsonc (local D1 and R2), so they exercise the same
// runtime as production. The migrations are read here in Node and applied inside the tests (test/data.ts).
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  // The page's defaultStaff() block, so the domain test can check the server's default staff against it (workerd
  // cannot read files outside the Worker).
  const page = readFileSync(path.join(import.meta.dirname, "../mocks/src/v3-template.html"), "utf8");
  const staffBlock = /function defaultStaff\(\) \{[\s\S]*?\n\}/.exec(page)?.[0] ?? "";
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_PAGE_DEFAULT_STAFF: staffBlock } },
      }),
    ],
  };
});
