import { defineConfig } from "vitest/config";

// Node with a mocked fetch: the tests check what the client sends and how it reads answers, not the Worker.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
