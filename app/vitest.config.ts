import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// The stores and the i18n setup are plain Vue and Pinia modules (auto-imports are off), so they run in Vitest with a
// browser-like DOM and no Nuxt build. Components that import nothing from Nuxt (#imports, #app) mount the same way,
// through the Vue plugin; the patient screen's components are written that way on purpose.
export default defineConfig({ plugins: [vue()], test: { environment: "happy-dom", include: ["test/**/*.test.ts"] } });
