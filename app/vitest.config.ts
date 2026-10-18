import { defineConfig } from "vitest/config";

// The stores and the i18n setup are plain Vue and Pinia modules (auto-imports are off), so they run in Vitest with a
// browser-like DOM and no Nuxt build. Component tests that need the Nuxt runtime would add @nuxt/test-utils.
export default defineConfig({ test: { environment: "happy-dom", include: ["test/**/*.test.ts"] } });
