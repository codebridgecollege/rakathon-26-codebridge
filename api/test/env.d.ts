// The migrations vitest.config.ts reads in Node and hands to the tests as a binding.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    TEST_SEED_STAFF: string;
    TEST_SEED_STAFF_B: string;
    TEST_SOURCES: Record<string, string>;
  }
}
