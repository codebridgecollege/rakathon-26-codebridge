# app: the Nuxt frontend (port in progress)

The new frontend for GLIDE MDT, built next to today's page (`mocks/src/v3-template.html`) and ported screen by screen
(GitHub issue #13, design in `docs/design/FRONTEND.md`). Today it is a shell: the header (brand, main areas, user
picker), an empty main area, the stores and the boot from the API. Today's page stays the demo until the new one
passes the DOM-only test suite.

- **Nuxt 4 in SPA mode** (`ssr: false`), built with `nuxt generate` into static files.
- **Served by the API Worker at `/app/`** (`baseURL`), next to today's page at `/`. Routes are hash routes
  (`/app/#/patients`).
- **Auto-imports are off.** Import every component and composable explicitly; Nuxt's own from `#imports`, `#app` or
  `#components`.
- **Stores** (Pinia, `app/stores/`): `session` (boot, user switch), `staff`, `patients`, `workflow` (tasks and the
  stored workflow state) and `cases` (the per-case cache with today's semantics: keyed by file, absent, loading, ready
  or error, late replies dropped, at most five cases in memory).
- **API** through `@codebridge/api-client` (`packages/api-client`) and the shared rules from `@codebridge/domain`
  (`packages/domain`).
- **Text** comes only from the Fluent catalogs at the repository root (`i18n/cs/*.ftl`, one file per area; `i18n/sk/` and `i18n/en/` fall back
  to Czech), through `fluent-vue` registered in `app/plugins/i18n.ts`. `?lang=sk` picks a language. Never write Czech
  UI text in a component; add a message with a semantic ID.
- **CSS** is today's page CSS, copied unchanged into `app/assets/v3.css` by `scripts/sync-css.mjs`; a test fails when
  the template's CSS changed and the copy did not. Do not edit `v3.css` by hand.

## Commands

Install from the repository root (npm workspaces):

```
npm ci                                   # at the root: api, app and packages
npm run dev -w @codebridge/app           # Nuxt dev server; proxies /api to wrangler dev at http://localhost:8787 (API_PROXY to change)
npm run generate -w @codebridge/app      # static build into app/.output/public
npm run typecheck -w @codebridge/app     # nuxt typecheck (app) and vue-tsc on the tests
npm test -w @codebridge/app              # Vitest with happy-dom: stores, boot, catalogs, CSS copy
npm run css:sync -w @codebridge/app      # refresh app/assets/v3.css from the template
```

The app against a local Worker with the seeded demo data, side by side with today's page:

```
npm ci                                   # at the root; `npm ci` inside api/ installs the Worker's dependencies only
cd api
npm run seed:local                       # once; needs uv
npm run dev:app                          # STAGE_APP=1: builds the app into .assets/app/, then wrangler dev
# http://localhost:8787/      today's page
# http://localhost:8787/app/  the new shell; /app/?dev=1 shows the patient count read from the server
```

`npm run dev` and CI's `npm run stage` stage today's page only, so deploys do not include the app until the team
switches it on.
