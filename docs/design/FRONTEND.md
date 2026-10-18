# Frontend: framework, language and rendering

Status: decided 2026-10-18; step 2 of the migration (the scaffold) is built
on a branch, see "As implemented (step 2)". This is work for after the
hackathon; the current page stays the demo until the new one matches it.

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
- **Staging is opt-in.** `stage-assets.sh` builds and stages the app only
  with `STAGE_APP=1` (`npm run dev:app` in `api/`); CI does not set it, so
  deploys are unchanged. Nuxt's own `404.html` and `200.html` are not
  staged: the assets' 404 handling serves the nearest `404.html`, and
  Nuxt's would answer every unknown `/app/...` path with the app.
- **CI** installs from the root lockfile; `npm ci` inside `api/` installs
  only the Worker's workspace dependencies, so the Worker job does not
  download Nuxt. The Worker job also runs `packages/domain`'s type check
  and tests. The app and the client have no CI job yet.
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

## Decisions (2026-10-18)

- **No offline demo is needed.** Embedded mode ends with the old page;
  Pages is retired when the new app takes over.
- **The port starts as soon as the team decides to do it.** The clinical
  behaviour of the ported screens is reviewed afterwards, against the
  DOM-only test suite and the old page.
- **i18n uses Fluent** (`I18N.md`).
- **citry is not used,** and the spike is dropped (see "citry").
- **Nuxt 4,** with auto-imports off; upgrade cost is not a concern for the team.
