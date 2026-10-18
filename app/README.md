# app: the Nuxt frontend (port in progress)

The new frontend for GLIDE MDT, built next to today's page (`mocks/src/v3-template.html`) and ported screen by screen
(GitHub issue #13, design in `docs/design/FRONTEND.md`). Ported so far: the shell (header, user picker, stores, boot
from the API) and the patient detail screen (`#/patient/<nr>/<tab>`: header, brief, MDT question, alerts, timeline,
all tabs and the source viewer; `app/components/patient/`). Today's page stays the demo until the new one passes the
DOM-only test suite.

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
- **Text** comes only from the Fluent catalogs at the repository root (`i18n/cs/*.ftl`, one file per area, Czech is the
  source; `i18n/sk/` and `i18n/en/` hold the same files and IDs, with a glossary for clinician review at the top of each,
  and fall back to Czech message by message), through `fluent-vue` registered in `app/plugins/i18n.ts`. `?lang=sk` or
  `?lang=en` picks a language. Never write Czech UI text in a component; add a message with a semantic ID to the Czech
  file and its Slovak and English twins: `test/i18n.test.ts` fails when a Czech message is missing in sk or en, has
  other placeholders, or lacks a plural category of its language.
- **Patient screen components** import nothing from Nuxt, so Vitest mounts them with the real Czech catalog
  (`test/patient.ts`: `setupPatient()` fills the stores with a synthetic case, `mountInCase()` provides the case).
  `PatientView` provides the case on screen through `composables/usePatient.ts`; dialogs and drawers go through the
  `overlay` store and are drawn into `#overlay`.
- **"Nový pacient", uploads and "Nahrát z telefonu"** (step 11 of the port):
  - `useNewPatient().open()` (`composables/useNewPatient.ts`) opens the dialog, which `app.vue` mounts once
    (`components/intake/NewPatientDialog.vue`, logic in `stores/intake.ts`). `setNavigation()` tells it where a finished
    intake goes; `plugins/intake.ts` sets the default (`#/patient/<id>` or the list), discards the intake on back or
    forward, and ends the intake and the phone session before a user switch.
  - `components/uploads/CaseUploads.vue` is a case's upload panel for "Projednání na MDT" and the documents tab
    (props: the case, `locked`, `why`, the phone target); `UploadZone.vue` and `UploadList.vue` are its generic parts.
    State in `stores/uploads.ts`.
  - `components/phone/PhoneUploadButton.vue` opens `PhoneUploadDialog.vue` (mounted once in `app.vue`, layer
    `#phoneup`); state and polling in `stores/phone.ts`. The QR library (`qrcode-generator`, pinned) loads only when a
    code is shown. The phone page at `/u` is today's `mocks/src/phone-upload.html`.
  - Toasts: `stores/toast.ts` and `components/AppToasts.vue`.
- **List screens** (steps 3, 4 and part of 12): `pages/patients.vue`, `pages/calendar/[[week]].vue` (the week's
  Monday in the address, so back and forward move between weeks), `pages/tasks.vue`, `pages/staff.vue` and
  `pages/admin.vue`, with their components in `components/lists/`. View state that outlives a visit (search, filters,
  column widths, week, picked patient, task scope) is in `stores/listView.ts`; attendance rows not yet stored are in
  `stores/attendance.ts`. Writes go through `composables/useWrite.ts`. A case opens at `lib/lists.ts` `caseRoute()`
  (`/patient/<n>/overview`), the one place to change when the patient screens land. Text is in `i18n/cs/lists.ftl`.
- **Development harness.** `pages/dev-*.vue` open parts of screens outside the screens that will hold them
  (`#/dev-intake`: a stand-in patient table with "+ Nový pacient", the upload panel of NO-S01 and the phone dialog).
  `nuxt.config.ts` leaves them out unless `APP_DEV_PAGES=1` (also for `nuxt dev`). The e2e harness specs
  (`e2e/harness/`) drive them.
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

The end-to-end suite against the app (`e2e/README.md`); the base URL needs its trailing slash. With the harness pages:

```
cd api && STAGE_APP=1 APP_DEV_PAGES=1 npm run stage && npx wrangler dev   # the app at /app/ with #/dev-intake
E2E_BASE_URL=http://localhost:8787/app/ npm --prefix e2e test                              # the screen specs
E2E_APP_HARNESS=1 E2E_BASE_URL=http://localhost:8787/app/ npm --prefix e2e test -- --project app-harness
```

`npm run dev` and CI's `npm run stage` stage today's page only, so deploys do not include the app until the team
switches it on.
