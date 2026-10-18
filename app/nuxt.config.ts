// The new frontend (docs/design/FRONTEND.md): a browser-rendered SPA built with `nuxt generate` into static files that
// the API Worker serves next to today's page, under /app/ while the port is in progress.
import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  // Every screen is patient data behind a login; server rendering would add a render path for that data on every
  // request and buys nothing here (FRONTEND.md, "Rendering: browser, not server").
  ssr: false,
  // Explicit imports only: every component and composable is an `import`, which is easier to read, search and test.
  imports: { autoImport: false },
  components: { dirs: [] },
  modules: ["@pinia/nuxt"],
  app: {
    // Side by side with today's page at /; the Worker serves this build from .assets/app/.
    baseURL: "/app/",
    head: {
      // Static lang for screen readers and hyphenation before the i18n plugin runs; the plugin keeps it in step.
      htmlAttrs: { lang: "cs" },
      title: "GLIDE MDT",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
      // The same fonts as today's page, for visual parity.
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap",
        },
      ],
    },
  },
  css: ["~/assets/v3.css"],
  router: {
    // Hash history keeps today's links (#patient/10/labs) working, and the Worker needs no fallback route that would
    // swallow its 404 page.
    options: { hashMode: true },
  },
  devtools: { enabled: false },
  telemetry: false,
  typescript: { strict: true },
  vite: {
    // `nuxt dev` on its own has no API; it proxies /api to a local `wrangler dev` (see app/README.md).
    server: { proxy: { "/api": { target: process.env.API_PROXY ?? "http://localhost:8799", changeOrigin: false } } },
  },
});
