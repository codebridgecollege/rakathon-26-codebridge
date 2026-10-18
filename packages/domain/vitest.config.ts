import { defineConfig } from "vitest/config";

// Plain Node: the rules are pure, so they need neither workerd nor a browser.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
