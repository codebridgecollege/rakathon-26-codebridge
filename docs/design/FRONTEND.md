# Frontend: framework, language and rendering

Status: decided 2026-10-18; steps 2 to 13 of the migration are built on
branches, see the "As implemented" sections. On branch `port-finish` the
Worker serves the app at `/` and today's page at `/legacy/`; `main` (and so
the demo) still serves today's page at `/` until the team merges it.

The question: should the frontend move from one hand-written page to a
framework, and if so to which one, in which language, and rendered where?
The candidates were Nuxt (Vue) and citry (Juro's Python framework).

Terms used below:
- **SPA**: a single-page app rendered in the browser.
- **SSR**: rendering pages on the server; **hydration** is the browser taking over server-rendered HTML.
- **Nuxt**: a framework on Vue; **Nitro** is its server engine.
- **citry**: Juro's Python server-rendered framework, with a Rust core and, from 0.6.0, Vue in the browser.
- **Embedded mode**: today's single-file page with built-in data that runs without a server (Pages, a file, claude.ai copies).

## Summary

1. **Yes, move to a framework.** The page has outgrown hand-written
   template strings:
   - 5,500 lines and about 60 global state fields, re-rendered with `innerHTML`;
   - about 220 lines of action dispatch;
   - clinical rules copied by hand between the browser and the API;
   - i18n would mean touching about 1,000 strings anyway.
2. **Render in the browser (SPA), not on the server.** Every screen is
   patient data behind a login, nothing needs search engines, and the
   hardest parts only run in the browser:
   - the recorder (microphone and WebSocket);
   - calendar drag and drop;
   - autosave with conflict handling;
   - the PDF and the QR dialog.
   
   Server rendering buys nothing here and adds a render path for patient data on every request.
3. **TypeScript, not Python, for the frontend.** The API and its domain
   rules are TypeScript, so the rules the browser needs (allowed status
   moves, approval checks, task drafting, FHIR import) can be one shared
   package instead of hand-copied code. Python stays where it fits: the
   document pipeline, the build's data preparation and the seed.
4. **Nuxt 4 (decided 2026-10-18), the app in SPA mode** (`ssr: false`),
   built as static files that the existing Worker serves next to its API
   under `/api`, as it serves today's page. Nuxt was chosen over plain Vue
   3 with Vite because public server-rendered pages are likely later, and
   Nuxt renders those per route without a second framework.
5. **citry: not for this app.** Its i18n is the best of the options. But
   this app renders in the browser and its rules and API are TypeScript,
   so a Python server-rendered framework solves a problem the app does not
   have, and:
   - its Vue runtime (0.6.0) is unreleased and mid-migration;
   - it needs a Python process next to the Worker;
   - it has one maintainer;
   - coding agents have not seen its current syntax.
6. **i18n uses Fluent** ([`I18N.md`](I18N.md)): the same `.ftl` catalogs
   for the old page, the new app (through `fluent-vue`) and the Worker. Server and
   refactor work from `I18N.md` can start now on the old page; the strings
   of each screen move into the catalog as it is ported.
7. **The first step is a test suite that drives only the DOM,** run
   against the Worker. Today's browser tests reach into page internals, so
   they cannot judge a port.

## Where the app stands

- **One file,** `mocks/src/v3-template.html`: about 5,500 lines of HTML, CSS and plain JavaScript.
- **Build:** `mocks/build.py` inlines data and vendored libraries into a static page of about 2.3 MB.
- **State and events:**
  - a global state object `S` (about 60 fields);
  - `render()` rebuilds the page with `innerHTML` (about 100 call sites);
  - about 30 document-level event listeners and one string action dispatcher (56 branches).
- **Data:**
  - about 25 small `*Api` functions already form a service layer over the API;
  - a per-case data store loads cases on demand.
- **Serving:** one Worker (`api/`) serves both the page and the API:
  - the built page as `index.html`;
  - page images `pages/` (63 files, 11 MB), the S02 ZIP `ukazka/` and the phone page at `/u`, all staged by `api/scripts/stage-assets.sh`;
  - a Czech 404 page;
  - `/api/*`, handled by the Hono API first.
- **Tests:**
  - 18 API test files (Vitest, about 3,700 lines) test the Worker directly, so they survive a port unchanged.
  - 14 page test files (about 2,500 lines) do not. The jsdom tests call page globals (`action("approve")`, `S.overlay = …`). The main Playwright test (`v3.mjs`) also uses about 170 `page.evaluate` calls and runs the embedded page from a file.
  - Their expectations (requests, replies, what the doctor sees) are the spec for the new tests.
- **Rules copied by hand.** Several domain files in the API say they are ports of template functions: `status.ts` (allowed status moves), `suggest.ts` (task drafts), `fhir.ts` (FHIR import), `rows.ts` (patient rows), `edits.ts`, `staff.ts`. Two copies of a clinical rule can drift.

## Rendering: browser, not server

| | SPA (browser) | SSR (server) |
|---|---|---|
| Search engines | not needed | the main reason for SSR; not needed |
| First paint | fast with code splitting and per-case loading; today's 2.3 MB page with all data inlined is the slow part, not rendering | slightly faster first HTML |
| Patient data | the server sends JSON only; HTML is built in the browser | the server renders patient HTML on every request; it can never be cached, and every page carries the auth check and database reads in its render path |
| Heavy parts (microphone, WebSocket, drag and drop, autosave, PDF, QR) | natural | client-only anyway; server HTML is replaced on hydration |
| Hosting | static files from the existing Worker | a server runtime on every request |

Vue's server rendering is fast: a 2024 Platformatic benchmark put Vue,
Svelte and Solid together near the top
(https://blog.platformatic.dev/ssr-performance-showdown). That speed
matters for public, cacheable pages. GLIDE MDT has none inside the app;
the marketing site (glidemdt.com) is separate.

## Language: TypeScript

- **Shared rules, where they are pure.** About 1,800 lines of domain code
  live in `api/src/domain`.
  - **Can be shared:** status moves, approval checks, task drafting, slots, FHIR import. These become a package (`packages/domain`) used by the browser and the Worker.
  - **Stays on the server:** sessions, upload-session tokens, break-the-glass, audit, database row mapping. A few files import server types (`../http/errors`, `../services/pagekit`); those imports are cut when the package is split out.
  - **Labels move out.** The domain files carry Czech text (error messages, status labels, audit sentences). Moving that text out to the catalogs is the server phase of `I18N.md`, not part of the split.
  - **The server stays the authority.** The browser's copy only lets the page show the right buttons and messages before a request; the server still checks everything.
- **The hard parts are browser APIs:** `getUserMedia`, WebSocket, drag
  and drop, keyboard composition on phones, jsPDF, the QR library. In
  any framework they are JavaScript or TypeScript.
- **One language across page and API** gives typed request and reply
  shapes and one test stack (Vitest, Playwright).
- **Coding agents** know TypeScript and Vue deeply.
- **Python keeps** the pipeline (PyMuPDF, Tesseract), `build.py`'s data
  preparation and the seed. Those produce JSON at build or seed time and
  never run in the page.

## Framework: Nuxt 4 in SPA mode

### Why Nuxt

- **Healthy project** (checked 2026-10-18):
  - weekly patch releases; current release 4.6.2;
  - about 1.4 million weekly downloads, 61k GitHub stars, about 470 open issues and pull requests (low for its size).
- **Governance.** Vercel absorbed NuxtLabs in July 2025. Vercel committed to MIT licensing, open governance and a vendor-neutral Nitro. So far it has kept those commitments: Nuxt UI v4 made its paid components free, and Nuxt Studio is open source. These commitments are self-reported; no outside party enforces them.
- **Vue core** is stable (3.5); Vapor mode (3.6) is a release candidate and not needed here.
- **Modules this app needs,** all maintained:
  - Nuxt UI 4 (dialogs, drawers, tables, date pickers, toasts);
  - Pinia (state, including the recorder's long-lived state);
  - VueUse;
  - `@nuxt/test-utils`.
- **Cloudflare.** Workers with static assets is Nitro's recommended Cloudflare target, and Cloudflare documents Nuxt officially.

### How it is set up

- **SPA mode** (`ssr: false`), built with `nuxt generate` into static files. No Nitro server runs in production, so Nitro's coming v3 migration touches the build only.
- **Serving: the same Worker as today.** It serves the Nuxt output instead of `v3.html`, keeps the Hono API under `/api` (`run_worker_first`), and its staging script keeps:
  - `/u` (the phone page), `pages/` and `ukazka/`;
  - the custom 404 page, which must not be overwritten by Nuxt's own `404.html` or `200.html`.
- **Routes.** Vue Router uses hash history, so today's links (`#patient/10/labs`) keep working and the Worker needs no fallback rule that would swallow the 404 page. Moving to path routes later means adding that fallback.
- **State:**
  - Pinia stores for the session, staff and the case cache;
  - the recorder as a store plus a composable, since it must survive route changes;
  - the shared domain package for the pure rules.
- **i18n.** Fluent, as in `I18N.md`. `fluent-vue` (a Vue 3 plugin on `@fluent/bundle`) is registered in a Nuxt plugin and gives components `$t` and an `<i18n>` component that fills markup through named slots. The Worker uses `@fluent/bundle` with the same `.ftl` files.
  - `@nuxtjs/i18n` is not used, because it is built on vue-i18n, a different message format.
  - In `I18N.md`, the parts about inlining catalogs into the page apply to the old page only.
- **Embedded mode is dropped in the new app.** `nuxt generate` writes many script chunks, which do not load from `file://`, and claude.ai copies need one file. The Worker is the demo. The old single-file page stays on Pages until Pages is retired, so the offline demo exists until then.
- **Size.** The goal is a first load well under today's 2.3 MB: jsPDF with its font, the QR library and the recorder are loaded only when used.
- **Content security policy.** There is none today. Nuxt's SPA output has an inline script, so a strict policy needs script hashes (for example through `nuxt-security`). This is a step of the port, not an afterthought.
- **Accessibility.** The current page has about 100 `aria-*` attributes. Keyboard use, focus handling in dialogs and labels are checked in the new test suite, not assumed from the component library.

### Risks

- **Nuxt 5 and Nitro v3.** Nitro v3 is in beta. In SPA mode with static output the impact is small; any server code written later uses the `nuxt/server` API, which Nuxt 4.6 offers for exactly this move.
- **fluent-vue on Nuxt 4 is unverified.** Its Nuxt integration
  (`unplugin-fluent-vue/nuxt`) declares `@nuxt/kit ^3`, and the project
  has one maintainer. The libraries are small (about 130 KB of TypeScript
  for `fluent-vue` including tests, about 30 KB for the build plugin), so
  if anything breaks we fork and update them. Registering `fluent-vue` in
  a plain Nuxt plugin avoids the integration altogether; the first
  scaffold step checks it.
- **Auto-imports are off.** `imports: { autoImport: false }` and
  `components: { dirs: [] }` in `nuxt.config.ts` make every component and
  composable an explicit `import`, which is easier to read, search and
  test. Nuxt's own composables are then imported from `#imports`.
- **Layered configuration** (Nuxt, Vite, Nitro) is harder to debug than plain Vite; with auto-imports off, most of the "magic" is gone.
- **Public pages later.** When server-rendered public pages come, they are switched on per route (`routeRules`), and a Nitro server joins the Worker for those routes only; the app itself stays a browser-rendered SPA.
- **Not the hackathon.** Porting about 25 rounds of clinical-trust fixes in the template invites regressions. The old page stays the demo until the new one passes the DOM-only test suite.

### Runner-up: plain Vue 3 with Vite

The same SPA without Nuxt: Vue Router, Pinia and `fluent-vue` set up by
hand. It has fewer moving parts and is easier to debug, but gives up
Nuxt's module setup, test utilities and file-based routing. With a
single-file build plugin it could also produce a one-file embedded page,
if that mode turns out to be needed. It is the fallback if Nuxt's build
gets in the way.

Others considered:
- **SvelteKit 3:** very fresh major release, a different ecosystem.
- **Next.js:** React; on Cloudflare it needs the OpenNext adapter.
- **Astro:** made for content sites, not stateful apps.
- **Quasar:** a smaller community and a fixed visual style.

## citry

**What it is.** A typed Python frontend framework: components with
templates, styles, Fluent translations and Python event handlers, with a
Rust core (parser, Vue compiler, i18n) and adapters for FastAPI, Django,
Flask and generic ASGI or WSGI. From 0.6.0 the server compiles templates
to Vue components and the browser hydrates them.

**Strengths for this app:**
- **i18n.** Fluent catalogs with CLDR plurals, typed translation, and extract and check commands. That covers `I18N.md` better than any of the other options.
- **Security.** Strict content security policy and CSRF protection built in.
- **A component library** (Citry UI) with dialogs, drawers, a calendar, a data grid, tabs, toasts and tooltips.
- **Speed.** Its own browser benchmark puts it in the same range as the other stacks it tests. Those runs are single, on one machine, from unreleased builds, and its reports say they give no ranking.

**Why not now:**
- **Moving target.** It is pre-1.0. 0.6.0 (the Vue runtime, which removes the earlier Alpine runtime) is unreleased, and its migration plan lists the core runtime as in progress and integration as pending.
- **A second process.** It needs a Python process. Cloudflare Workers and Pages cannot run it today. citry already builds a Pyodide wheel for its playground, but a Python Worker running it is untested, so in practice it means a Container or another host next to the Worker. If citry only reads the API, access checks and the audit log stay in the API. The costs are still real:
  - a second EU-hosted process with patient data passing through it (logs, caches, crash dumps);
  - forwarding the user's session to the API;
  - a second deploy.
- **Server round trips.** citry runs event handlers in Python on the server, so interactions like drag and drop or autosave either make a round trip or are written as browser code anyway.
- **One maintainer, no known production users.** Teammates cannot find help outside Juro.
- **Agents** have not seen its current syntax. The only agent trial predates the switch to Vue.
- **No help where the app is hardest.** The recorder, the lab chart, the PDF and the QR dialog stay hand-written browser JavaScript.
- **Rules in a third language.** The browser-side copy of the clinical rules would be Python, next to TypeScript in the API and Python in the pipeline, unless the page asks the API for every rule.

**Decision (2026-10-18):** citry is not used, and no spike is planned. The
research above settles it for this app: the reasons are the app's shape
(browser-rendered, TypeScript rules and API), not citry's speed or
maturity alone.

## Migration

**Strategy: a new app beside the old page, screen by screen.** Mounting
Vue inside today's page is awkward, because its global `render()` would
fight Vue for the DOM. Instead:
- a new Nuxt app grows next to it and reads the same API;
- the old page stays the demo until the new one passes the DOM-only test suite screen by screen;
- then the Worker serves the new app at `/`, and the old page stays reachable for a while.

**Repository shape:** npm workspaces with:
- `api/` (unchanged);
- `app/` (Nuxt);
- `packages/domain` (the pure part of `api/src/domain`);
- `packages/api-client` (typed requests and replies);
- `i18n/` (the `.ftl` catalogs and the Fluent wrapper, shared).

**What can start now, on the old page.** From `I18N.md`, these do not
depend on the framework, and the port reuses them:
- the server phase: message keys for errors, codes for labels, the access log as action and parameters, PageKit reasons as codes (3-4 days);
- the meeting language for recordings (1 day);
- the Fluent catalogs and runtime wrapper.

If the port slips, i18n is not blocked: the old page can take the
catalogs too (`I18N.md` phases 0-2).

**Order and rough effort** (one developer with agents):

| Step | What | Effort |
|---|---|---|
| 1 | DOM-only end-to-end suite against the Worker (from today's test expectations), green on the old page: the gate for every ported screen | 3 days |
| 2 | Scaffold, workspaces, `packages/domain` split, typed API client, stores, boot, `fluent-vue` with the Czech catalog | 2 days |
| 3 | Patients list (filters, column resize, paging) | 0.5 day |
| 4 | Calendar (drag and drop, double click, mini month) | 1 day |
| 5 | Patient header, brief, alerts, the MDT question and edits | 1.5 days |
| 6 | Tabs: overview and timeline, documents and pipeline, labs and chart, anamnesis, alerts | 1 day |
| 7 | Tabs: next steps and guidelines, deviations, prognosis | 1 day |
| 8 | Discussion card: autosave, conflicts, approval | 1 day |
| 9 | Recorder (microphone, live socket, part uploads with resume, job polling) as a TypeScript module and store | 2 days |
| 10 | Source viewer and quote matching (pure code, moved) | 0.5 day |
| 11 | New patient wizard, FHIR import and export, uploads, phone QR | 1.5 days |
| 12 | Tasks, staff, administration, small dialogs, report and PDF | 1 day |
| 13 | Content security policy, size budget, accessibility checks, switch the Worker to the new app | 1.5 days |
| 14 | Slovak and English catalogs, clinician review (`I18N.md` phase 4) | 1 day plus review |

That is about 18 days for the port, plus the `I18N.md` server phase and
meeting language (about 4-5 days) if they have not been done on the old
page already.

Each screen is built with its strings in the Czech catalog from the start,
the `lang` marking of content in place, and the clinical-trust behaviour
of the old page (gap wording, "ověřit" marks, frozen approved reports,
drafts labelled as drafts) checked screen by screen.

## As implemented (step 2)

Branch `port-scaffold` (issue #13). Built: npm workspaces, `packages/domain`,
`packages/api-client`, and the `app/` shell (header, empty main area,
stores, boot, `fluent-vue`), served at `/app/` next to today's page.
Commands: [`app/README.md`](../../app/README.md). Where it differs from the
plan above, or adds to it:

- **`fluent-vue` on Nuxt 4 works** registered in a plain Nuxt plugin
  (`app/app/plugins/i18n.ts`): `$t` in templates, `useFluent()` in setup,
  `useIsolating: false`, the Slovak bundle falling back to Czech per
  message. Checked by the app's tests and in Chromium (Playwright) against
  `wrangler dev`: the header matched the old page's in a screenshot, the
  user picker listed the server's staff and a user switch reloaded the data.
  `unplugin-fluent-vue` is not used (no `<fluent>` blocks in components;
  messages live in `i18n/*.ftl`), so its `@nuxt/kit ^3` declaration does not
  matter. `fluent-vue` pulls in `vue-demi`, whose install script picks the
  Vue version; its default files already target Vue 3, so the result does
  not depend on npm's `allowScripts` setting.
- **The Fluent wrapper** (bundles with `useIsolating: false`, the Czech
  fallback, the choice of language) is `app/app/lib/i18n.ts` for now, not a
  shared `i18n/core.js`; it moves there when the old page or the Worker
  reads the catalogs too (`I18N.md` phase 0).
- **What moved to `packages/domain`:** status moves, slots, approval,
  protocol, task drafts, FHIR referral import, fact edits, and their
  dependencies (roles, read rules, the undecided role constants, errors,
  time, the display name rule). Staff validation, alerts, questions,
  suggestions, tasks, sessions, attendance, the report snapshot and the
  pipeline rules stay in `api/src/domain` for now: most are pure too, but
  were not on the list for this step and move when a screen needs them. The system clock stays in
  `api/src/domain/clock.ts`, because `crypto.randomUUID` is a runtime
  global; the package's type check has no DOM or Workers types, so a
  runtime global fails it.
- **Wire types.** `packages/domain/src/wire.ts` types the API's replies.
  `api/src/wire-check.ts` fails the Worker's type check when a patient row,
  the staff list, a task, a case state, an attendance set or a session
  built by the store no longer fits them. The envelopes built inline in
  the routes (health, me, the patient and task lists, the workflow, the
  write answer) are not checked yet; they need typed builders in the
  routes first. Bodies and replies of screens not
  ported yet are loose (`Record<string, unknown>`) and get their types with
  their screen.
- **Client errors carry a catalog ID.** An answer from the API keeps its
  Czech `message_cs`, passed through unchanged; an error the client raises
  itself (no answer, timeout, an HTML page) carries `message_id`, which
  the app translates. The client holds no UI text.
- **Staging** (`stage-assets.sh`) always builds and stages the app (step
  13 below). Nuxt's own `404.html` and `200.html` are not staged: the
  assets' 404 handling serves the nearest `404.html`, and Nuxt's would
  answer every unknown path with the app.
- **CI** installs from the root lockfile and tests the Worker, the app and
  both packages (step 13 below).
- **Hash links** gain a slash: `#calendar` becomes `#/calendar` (Vue
  Router normalizes it). `#patient/10/labs` has no route yet; it comes
  with the patient screens.
- **No embedded mode and no fallback.** When `/api/health` does not report
  our Worker with data, the shell shows the error instead of falling back
  to built-in data.
- **The user picker sends staff ids** as option values (today's page uses
  display names), so no display string is used as a key (I18N.md,
  "Display strings used as keys").
- **Not yet:** the language switcher in the header (the choice already
  follows `?lang=` and a stored choice), Umami analytics (left out of the
  app until the team decides it for `/app/`), the per-case rules of
  `applyCase()` beyond the list row and the tasks (decisions before the
  protocol, typed text kept over an older answer), which come with the
  screens that show them, the `byDocFile` index of the case cache, which
  comes with the source viewer, and the rest of a user switch in the
  template (`switchApiUser()`: storing typed text first, stopping the
  recorder, discarding an open intake, leaving a view the new user may not
  see), which comes with those screens.
- **Dependency audit.** `npm audit` reports high-severity advisories in
  build-time dependencies of Nuxt and Wrangler (for example `braces`,
  `node-forge`); none of them is shipped to the browser. Checked again
  before the app is switched on.

## As implemented (step 11, part)

Branch `port-intake` (issue #13): the "Nový pacient" dialog, the intake on the server, the generic upload
components and the "Nahrát z telefonu" dialog. FHIR export is not part of it. Where it is and how other screens use
it: [`app/README.md`](../../app/README.md). Where it differs from the old page:

- **The intake demo hints come from a small descriptor, not from built-in data.** The old page read the synthetic
  patient S02 from its embedded data for the presenter's hints (missing files, the ZIP link, "už v databázi je") and
  the closing sentence (pages, data gaps). The app has no embedded data, so `app/app/lib/intake-demo.ts` holds those
  few values; a test keeps them equal to `mocks/src/data/mock-case-S02.json`, and the module and the FHIR sample
  load only with the dialog. Whether the prepared record attaches is still the server's verdict alone. Moving the
  counts into the server's intake answer would remove the descriptor; the server deliberately does not name the
  fixture's patient there, so the hints would then change wording.
- **A document's kind** in the intake list ("· Ambulantní vyšetření ...") comes from the server's answer to the
  upload (recognised by hash), not from the file name.
- **Added, nothing visible:** focus moves into a dialog and back to its opener, Tab stays inside, `aria-modal`, the
  current step is `aria-current="step"`, the closing sentence and the toasts have a status role, and an intake
  created after its dialog closed is discarded at once.
- **A user switch** also closes a phone upload session for a case and drops the upload lists read under the previous
  user (the old page kept both).
- **The patient view is not ported yet**, so a finished intake goes to `#/patient/<id>`, which has no route on this
  branch; the specs that open the new patient pass only with the patient screens. A development harness
  checked the rest until the patient screens landed; it is gone, and its extra checks are
  `e2e/specs/intake-details.spec.ts`.

## As implemented (steps 3, 4 and part of 12)

Branch `port-lists` (issue #13): the patient list, the calendar, tasks, staff and administration. Where they live:
[`app/README.md`](../../app/README.md). Text and markup match the old page (compared screen by screen: visible text
and the tag and class structure of the main area). Where it differs:

- **Routes per area by path:** `#/patients`, `#/calendar/<Monday>`, `#/tasks`, `#/staff`, `#/admin`. Today's links
  (`#calendar/2026-10-22`) land on them, a link to any day is rewritten to its Monday, and the header navigates by
  path. The `[view]` route remains for areas not ported yet.
- **Column filters hold codes** (owner, department or "", the slot's day, the status code), not display text.
- **The calendar card does not edit the MDT question.** The old page let a doctor open the edit dialog from the
  card; that dialog belongs to the patient screens, so the card shows the question as text until they land.
- **Added, nothing visible:** the card is a named region, the waiting list a list, toasts have a status role, the
  filter popover's button says it opens a dialog and gets the focus back, both dialogs keep Tab inside, and "Vybráno"
  is a pressed button.
- **Opening a case** goes to `#/patient/<n>/overview` (`caseRoute()` in `app/app/lib/lists.ts`), which has no route
  on this branch; the specs that open a case pass only with the patient screens.

## As implemented (steps 5, 6, 7 and 10)

Branch `port-patient` (issue #13): the patient detail screen (S-3) at `#/patient/<nr>/<tab>`: header, status menu,
MDT question, brief, alerts, timeline, every tab, the guideline drawer, the prognosis drawers, the FHIR export and the
source viewer. Components in `app/app/components/patient/`, rules in `packages/domain` (`case-data.ts`,
`case-view.ts`, `quote-match.ts`, `page-text.ts`, `labs.ts`, `guideline.ts`, `prognosis.ts`, `fhir-export.ts`), text
in `i18n/cs/patient.ftl` (IDs start with `patient-`). The e2e specs `patient-detail`, `patient-tabs`,
`source-viewer`, the FHIR export of `report-export` and `phone-width` pass against the new app and stay green on
today's page. Where it differs from the old page or the plan:

- **Routes.** `#patient/10/labs` and `#/patient/10` both reach the screen; a missing or unavailable tab is replaced by
  the first one the case shows. `#present/<nr>` and `#protocol/<nr>` redirect to the overview. The address shows
  `#/patient/...`, so the one spec that reads the address accepts both forms.
- **Case data in the view's shape** comes from `fromExtraction()` in `packages/domain/src/case-data.ts`, computed
  from the cases store's raw reply; the guideline layer lives in the store's case entry, as in the template.
- **Saved prognosis from the API.** The old page embedded the saved study search; the app reads
  `GET /api/cases/:id/prognosis` (an audited read) once per case and day.
- **Small text changes,** all in plurals that read wrongly for some counts before (for example "z 1 události",
  "1 strana", "1 odběr"); the demo's counts read as today. Some bare "-" became the gap dash with the fixed wording in
  its tooltip (TK/P, document dates, an unknown page count).
- **Accessibility, nothing visible:** the source viewer's tabs set `aria-selected`; alerts are a list of list items;
  the edit dialog's text field has a name; toasts have a status role.
- **Ported later** (steps 8, 9 and the rest of 12, below): the discussion card and the conclusion draft, the session
  bar, the report dialog, the "Možná jiný pacient" banner and stopping the recorder when a case is closed. "Zahájit
  MDT" from the case header now starts the session on that case, as the old page did.
- **Retrospective assessments** stay empty as on the old page (it never filled `S.retro`); `prior_assessments` from
  the guidance reply is not shown yet.

## As implemented (steps 8, 9 and the rest of 12)

Branch `port-discussion` (issue #13): the session bar (S-4), "Projednání na MDT" (S-5) with the conclusion draft, the
AI recorder ("AI záznam"), the report dialog and its PDF, and the "Možná jiný pacient" banner. Where they live:
[`app/README.md`](../../app/README.md). The whole e2e suite passes against the new app and stays green on today's page.
Where it differs from the old page or the plan:

- **The recorder runs in server mode only** (`features.transcripts`, which every seeded Worker reports): lines and
  5 MiB audio parts go to the server while a case is discussed, approval starts the speaker pass there, and the page
  polls the job. The in-browser speaker pass and summary of the Pages build (`wavOf`, `recPostPass`, `recSummarize`)
  are not ported, because the app has no embedded mode. Without server storage the recorder shows live words and
  holds no audio.
- **Fixed on the way** (the old page had these too): stopping while the microphone, the server or the token was still
  being asked for left a second microphone or socket running; a sentence arriving on a closing socket after a user
  switch was shown and sent; transcript and job replies from before a user switch landed in the new user's view. A
  failed transcript read is retried when the case is shown again instead of in a loop.
- **Upload rows wrap** (old page and app): with a warning under a row, the file name shrank to zero width, so the
  doctor saw that a document belonged to another patient but not which one.
- **The report is a Czech record whatever the screen's language:** the snapshot frozen at approval, the preview and
  the PDF read the Czech catalog, so one decision never mixes languages and the printed gap wording is the fixed Czech
  one. An approved case without a stored snapshot prints the attendance frozen at approval, not today's.
- **Approval stores again right before it is sent:** the recording's last words and an attendance change may take
  seconds, and text typed meanwhile is stored first, so the frozen report and the tasks the server makes name the same
  steps. A retry whose report changed gets a new idempotency key. (The old page sent the live fields.)
- **A user switch waits for the drafts,** as the old page did: a draft that cannot be stored refuses the switch with the
  old message, and nothing of the current user ends before that check. The recording stops on a switch also without
  server storage, and audio parts still on their way stop retrying after a purge or a switch.
- **The report** prints the old wording; a partial due date prints as a month ("3/2024", the old page printed
  "NaN. 3. 2024"), and a source without a page number prints "s. " instead of "s. undefined".
- **"Zahájit MDT" from a case header** starts the session on that case, as the old page did.
- **Accessibility, nothing visible:** the card's summary sets `aria-expanded`; the "Koncept nového závěru" label is the
  draft field's description; the report dialog has `aria-modal` and focus handling.
- **The intake development harness is gone**; its checks that the screen specs lacked are
  `e2e/specs/intake-details.spec.ts`, green on both pages.

## As implemented (step 13)

Branch `port-finish` (issue #13): the switch, the content security policy, the size budget, the accessibility checks
and layout parity. Not deployed and not merged; the user decides when. Where it differs from the plan above or adds
to it:

- **The switch.** `api/scripts/stage-assets.sh` always builds the app (no `STAGE_APP` flag) and stages it at the root
  of `.assets/` (Nuxt `baseURL` `/`); today's page is `mocks/v3.html` unchanged at `/legacy/`. `/u`, `/pages/`,
  `/ukazka/`, the Czech 404 page and `/api/*` stay as they were. Redirects (`.assets/_redirects`): `/app/...` (the
  app's address during the port) to `/`, and the old page's relative links under `/legacy/` (the S02 ZIP, embedded
  page images) to the root copies. Old hash links (`/#patient/10/labs`, `/#calendar/2026-10-22`) reach the app's
  screens; `e2e/specs/serving.spec.ts` checks one, and `list-links` the list screens.
- **Content security policy,** set by `api/scripts/headers.mjs` in `.assets/_headers` for the app's page only (`/`),
  not through `nuxt-security`: the SPA shell has exactly two inline scripts (the import map and Nuxt's config), and the
  script pins their SHA-256 at staging time, after each build, and stops when the count changes. The policy:
  `default-src 'none'`; `script-src 'self'` plus the two hashes (no `unsafe-inline`, no `unsafe-eval`; jsPDF and its
  fonts load as same-origin files); `style-src-elem 'self' https://fonts.googleapis.com`; `style-src-attr
  'unsafe-inline'` (style attributes in templates and in HTML the app inserts: the report and the QR SVG; an attribute
  cannot load or run anything); `font-src https://fonts.gstatic.com`; `img-src 'self' data: blob:`; `connect-src 'self'
  https://api.elevenlabs.io wss://api.elevenlabs.io` (the realtime socket the server's token points to,
  `ELEVENLABS_API_BASE`); `manifest-src 'self'`; `frame-ancestors 'none'`; `base-uri 'none'`; `form-action 'self'`;
  `object-src 'none'`. No `media-src` or `frame-src`: the app plays no audio and frames nothing; the PDF and FHIR
  downloads are `blob:` links with `download`, which the policy does not govern. Every static file also gets
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY` and a
  Permissions-Policy that allows only the microphone; the app's page gets `Cross-Origin-Opener-Policy: same-origin`;
  `/api` answers get nosniff. The old page, `/u` and the 404 page have no policy (inline scripts throughout).
- **Checked in the browser:** the e2e fixture fails any test on a policy violation Chromium reports; the whole suite
  (97 tests) runs on `/` without one. A deliberately wrong hash makes the fixture fail, so the check is live. Not
  watched: pages in a second browser context (the phone, the second doctor in `conflicts`), and `?lang=sk`/`en`,
  checked once by hand (catalogs load, no violation). The recorder spec now stubs the socket at
  `wss://api.elevenlabs.io`, because the policy refuses any other host.
- **Size.** First load, gzip, measured by `app/scripts/size-budget.mjs` (index.html, the entry and its static imports,
  the patient list screen): 176 kB (JS 164 kB, CSS 11.5 kB, index.html 0.9 kB), against 712 kB gzip (2.3 MB raw) for
  today's page. Slovak and English catalogs now load only when chosen (they were 52 kB of the first load). Already
  lazy: jsPDF (132 kB gzip) and its fonts (173 kB) load with the report dialog, the QR library with the phone
  dialog; the patient screen adds 55 kB, the calendar 8 kB. The recorder's browser code (microphone and socket,
  about 1 kB) stays in the entry: the header's recording pill reads its store. Nuxt adds prefetch hints for the lazy
  chunks, which the browser may fetch when idle. CI fails above 200 kB or when jsPDF, its fonts or the QR library
  reach the first load (`npm run size -w @codebridge/app`).
- **Accessibility.** `e2e/specs/accessibility.spec.ts` runs axe-core 4.13.0 (WCAG 2.1 A and AA rules) on the list
  screens, every tab of NO-010 and NO-S01, the discussion card, and the dialogs "Nový pacient", "Záznam z MDT",
  "Původní dokument" and "Nahrát z telefonu", and fails on serious or critical violations; it also presses Tab and
  Shift+Tab 40 times in each dialog and checks focus stays in, Escape closes, and focus returns to the opener. Found
  and fixed, no visible text changed:
  - nested controls: an oncology fact's pencil sat inside its source link (`role="button"`); it now follows the link;
  - faint text (calendar times, small labels) below 4.5:1; `--faint` is darker (`#5f7179`, in `app/assets/app.css`);
  - the source viewer's tabs carried `aria-pressed` (not allowed on a tab); they keep `aria-selected`, and the page
    area scrolls from the keyboard (focusable region);
  - the patient screen's dialogs and drawers took no focus and did not return it; `OverlayHost.vue` now does both for
    every overlay kind, keeps Tab inside, and the overlays say `aria-modal`.
  Remaining, not failing: violations of moderate or minor impact are not listed by the spec; the old page at
  `/legacy/` is not checked. No skip link: the header has five controls before the main area.
- **Layout parity.** The old page has no doctype (quirks mode); the app is in standards mode. Element boxes on nine
  screens were compared (old against new, 1440 px wide). Two quirks are reproduced in `app/assets/app.css`: a
  textarea's baseline gap (the notes field and "Závěr MDT" sat 6 px lower) and the table line height (patient list
  rows were up to 19 px taller). Now within 3 px: patient list, calendar, tasks, staff, NO-S01 labs, NO-010 next steps.
  Left: the oncology diagnosis headline (`p.dxh`) is 7 px taller and the "Chybí originály" box on the documents tab
  4 px taller, both from quirks mode's line height for inline text of a smaller size; everything below them moves by
  that much.
- **CI** (`deploy-worker.yml`): one root `npm ci`, then the Worker's types, type check and tests, type checks and tests
  of `packages/domain`, `packages/api-client` and the app, staging (which builds the app and writes the headers) and
  the size budget; the deploy job stages from a root install. The workflow also runs on changes to `app/`, `i18n/`
  and `packages/`. The e2e suite is not in CI (it needs the seeded local Worker); run it before merging.
- **Install scripts.** npm 11 lists `esbuild`, `workerd` and `vue-demi` as having unapproved install scripts. None is
  needed: the build and `wrangler dev` work without them (`app/README.md`). CI's npm 10 runs them as before.
- **To go live:** merge into `main` (CI deploys the Worker); check `/`, `/legacy/`, `/u` and
  `curl -sI https://<worker-host>/` for the policy; run the e2e suite against a preview alias first
  (`E2E_BASE_URL=https://<preview-host>/ E2E_ALLOW_RESET=<preview-host>`). Pages (`deploy-mock.yml`) keeps serving
  the old page until it is retired. Umami is not in the app; adding it needs `script-src` and `connect-src` for its
  host.

## Decisions (2026-10-18)

- **No offline demo is needed.** Embedded mode ends with the old page;
  Pages is retired when the new app takes over.
- **The port starts as soon as the team decides to do it.** The clinical
  behaviour of the ported screens is reviewed afterwards, against the
  DOM-only test suite and the old page.
- **i18n uses Fluent** (`I18N.md`).
- **citry is not used,** and the spike is dropped (see "citry").
- **Nuxt 4,** with auto-imports off; upgrade cost is not a concern for the team.
