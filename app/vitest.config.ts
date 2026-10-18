import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// The stores and the i18n setup are plain Vue and Pinia modules (auto-imports are off), so they run in Vitest with a
// browser-like DOM and no Nuxt build. Components compile with Vue's own plugin (the version Nuxt uses); a test that
// needs the Nuxt runtime would add @nuxt/test-utils.
export default defineConfig({ plugins: [vue()], test: { environment: "happy-dom", include: ["test/**/*.test.ts"] } });
