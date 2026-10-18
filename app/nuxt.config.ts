// The frontend (docs/design/FRONTEND.md): a browser-rendered SPA built with `nuxt generate` into static files that the
// API Worker serves at /. Today's page stays reachable at /legacy/ for a transition period.
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
    // The Worker serves this build at the root of .assets/ (api/scripts/stage-assets.sh).
    baseURL: "/",
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
  // base.css holds the base styles; app.css (after it) holds the accessibility fixes on top of them.
  css: ["~/assets/base.css", "~/assets/app.css"],
  // Routes are paths (/patient/10/labs), Vue Router's default history mode. The Worker serves index.html only for the
  // app's route prefixes (APP_ROUTES in api/scripts/app-routes.mjs), so every other path keeps its real 404; a new
  // top-level page needs its prefix there too.
  hooks: {
    // Development pages (pages/dev-*.vue) open parts of a screen before the screen that holds them is ported. They are
    // left out unless APP_DEV_PAGES=1, also under `nuxt dev`, so a stray NODE_ENV cannot ship them.
    "pages:extend"(pages) {
      if (process.env.APP_DEV_PAGES === "1") return;
      for (let i = pages.length - 1; i >= 0; i--) if (pages[i]!.path.startsWith("/dev-")) pages.splice(i, 1);
    },
  },
  devtools: { enabled: false },
  telemetry: false,
  typescript: { strict: true },
  vite: {
    // `nuxt dev` on its own has no API; it proxies /api to a local `wrangler dev` (default port 8787; see app/README.md).
    server: { proxy: { "/api": { target: process.env.API_PROXY ?? "http://localhost:8787", changeOrigin: false } } },
  },
});
