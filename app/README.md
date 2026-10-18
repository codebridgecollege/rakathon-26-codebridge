# app: the Nuxt frontend

The new frontend for GLIDE MDT, built next to today's page (`mocks/src/v3-template.html`) and ported screen by screen
(GitHub issue #13, design in `docs/design/FRONTEND.md`). Ported so far: the shell (header, user picker, stores, boot
from the API) and the patient detail screen (`#/patient/<nr>/<tab>`: header, brief, MDT question, alerts, timeline,
all tabs and the source viewer; `app/components/patient/`), the lists (patients, calendar, tasks, staff,
administration), "Nový pacient" with uploads and the phone QR, and the MDT itself: the session bar, "Projednání na
MDT", the AI recorder and the report with its PDF (`app/components/discussion/`). The whole DOM-only test suite passes
against it, and the Worker serves it at `/`; today's page is at `/legacy/` for a transition period.

- **Nuxt 4 in SPA mode** (`ssr: false`), built with `nuxt generate` into static files.
- **Served by the API Worker at `/`** (`baseURL`), with today's page at `/legacy/`. Routes are hash routes
  (`/#/patients`); today's links (`/#patient/10/labs`) still land on the right screen, and `/app/...` redirects to `/`.
- **Content security policy and headers** come from `api/scripts/headers.mjs`, which pins the hashes of the two inline
  scripts in `index.html` at staging time. A new inline script, an outside script, style or font host, or a new
  connection target needs a change there (FRONTEND.md, "As implemented (step 13)").
- **Size budget:** `npm run size` after `generate` fails when the first load exceeds 200 kB gzip or contains code of
  jsPDF, its fonts or the QR library, found by a string from inside each (`scripts/size-budget.mjs`). Slovak and English catalogs load only when chosen
  (`loadLocale()` in `lib/i18n.ts`).
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
- **Development pages.** `nuxt.config.ts` leaves pages named `pages/dev-*.vue` out of every build unless
  `APP_DEV_PAGES=1`, for parts of a screen checked before the screen holding them is ported. None exist now: the intake
  harness (`#/dev-intake`) went once "Projednání na MDT" was ported, and its extra checks became
  `e2e/specs/intake-details.spec.ts`.
- **The MDT** (steps 8, 9 and the rest of 12): `components/discussion/` holds the card "Projednání na MDT"
  (`DiscussionCard.vue`, mounted by `BriefBlock.vue` and by the patient view's error state), the conclusion draft under
  "Závěr MDT" (`ConclusionDraft.vue`, mounted by `ConclusionBox.vue`), the session bar (`SessionBar.vue`, top of the
  patient view), the recorder panel, the report dialog (an `overlay` kind) and the "Možná jiný pacient" banner. State:
  `stores/discussion.ts` (the record per case, autosave, conflicts, approval, new version, view state),
  `stores/recorder.ts` (one recording for the whole app, so it survives route changes; browser audio and the socket
  in `lib/recorder-audio.ts`), `stores/report.ts` (the ticked sections). The report HTML is `lib/report.ts`
  (`reportHtmlFor()`, also the snapshot an approval sends), the PDF `lib/report-pdf.ts`; jsPDF and the DejaVu subset are
  the old page's vendored files (`mocks/src/vendor/`), loaded as separate assets only when the dialog opens. The
  header's recording pill is `components/RecorderPill.vue`. Rules in `@codebridge/domain/discussion` and
  `@codebridge/domain/recording`. Text in `i18n/*/discussion.ftl`.
- **CSS** is today's page CSS, copied unchanged into `app/assets/v3.css` by `scripts/sync-css.mjs`; a test fails when
  the template's CSS changed and the copy did not. Do not edit `v3.css` by hand. `app/assets/app.css`, loaded after it,
  holds the app's own fixes (accessibility: contrast of faint text, the source viewer's tabs).
- **Dialogs:** the overlay kinds (`stores/overlay.ts`) get focus handling from `OverlayHost.vue` (focus in, Tab kept
  inside, focus back to the opener); dialogs mounted in `app.vue` use `useDialogFocus()` from `lib/dialog.ts`.

## Commands

Install from the repository root (npm workspaces):

```
npm ci                                   # at the root: api, app and packages
npm run dev -w @codebridge/app           # Nuxt dev server; proxies /api to wrangler dev at http://localhost:8787 (API_PROXY to change)
npm run generate -w @codebridge/app      # static build into app/.output/public
npm run typecheck -w @codebridge/app     # nuxt typecheck (app) and vue-tsc on the tests
npm test -w @codebridge/app              # Vitest with happy-dom: stores, boot, catalogs, CSS copy
npm run css:sync -w @codebridge/app      # refresh app/assets/v3.css from the template
npm run size -w @codebridge/app          # first-load size budget of the last generate
```

The app against a local Worker with the seeded demo data, with today's page next to it:

```
npm ci                                   # at the root; `npm ci` inside api/ installs the Worker's dependencies only
cd api
npm run seed:local                       # once; needs uv
npm run dev                              # stages the app, today's page and the headers into .assets/, then wrangler dev
# http://localhost:8787/          the app; /?dev=1 shows the patient count read from the server
# http://localhost:8787/legacy/   today's page
```

The end-to-end suite runs against both (`e2e/README.md`); the base URL needs its trailing slash:

```
npm --prefix e2e test                                              # the app at /
E2E_BASE_URL=http://localhost:8787/legacy/ npm --prefix e2e test   # today's page
```

Install scripts: npm 11 blocks dependency install scripts until approved (`npm approve-scripts --allow-scripts-pending`
lists `esbuild`, `workerd` and `vue-demi`). None is needed: esbuild's and workerd's binaries come as platform packages,
and vue-demi's default files already target Vue 3. The app's own `postinstall` (`nuxt prepare`) is repeated by
`generate` and `typecheck`, so nothing depends on it having run.
