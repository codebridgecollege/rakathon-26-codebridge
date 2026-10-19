# End-to-end suite (DOM only)

A Playwright suite that drives the app the way a user does and reads only what a user sees: roles, accessible
names, labels and visible Czech text. It runs against a running Worker (`api/`), which serves the app and the API
together, or against several local Workers at once (`npm run test:parallel`). It was step 1 of the frontend port
(`docs/design/FRONTEND.md`, "Migration", issue #13) and now gates the deploy of main in CI.

## What the suite may and may not touch

- **Allowed:** `getByRole`, `getByLabel`, `getByText`, accessible names, `aria-*` states (`aria-pressed`,
  `aria-expanded`, `aria-current`, `aria-invalid`); downloads and their bytes; file choosers; network stubs
  (`page.route`, `page.routeWebSocket`) for outside services (ElevenLabs, Azure); holding back (never changing) an
  answer of our own API until a click has happened, to fix an order that timing alone does not (`approve-pending.spec.ts`); `page.waitForResponse` where the page
  gives no visible signal (autosave, the phone upload token, the end of an upload session); properties of a DOM element
  itself (`img.naturalWidth`, `document.documentElement.scrollWidth`).
- **Not allowed:** `page.evaluate` into app state (Pinia stores, component instances), `data-*` selectors, CSS class
  selectors, ids. A test that used them would check markup, not what a user sees.
- Structural reads that remain, each because the page gives nothing better yet:
  - `locator("mark")` in `source-viewer.spec.ts`, HTML's own element for highlighted text;
  - `alertEntry()` in `patient-detail.spec.ts` takes the smallest element holding an alert's text and its button,
    because alerts are not list items or articles;
  - the birth-number cell is taken by its column position in `patients-list.spec.ts`;
  - the pencil of an oncology fact is found in the fact's parent (`locator("..")`) in `patient-detail.spec.ts`: it
    sits right after the fact's source link.
  When the app gives alerts a list or article role, switch these to roles.

## Run it

Once, from the repository root:

```
npm ci                                                # the app and the Worker
npm --prefix e2e ci
npm --prefix e2e run install-browsers                 # Chromium for Playwright
```

### On four local Workers at once

```
npm --prefix api run stage                            # builds the app the Workers serve (again after app changes)
npm --prefix e2e run test:parallel                    # needs uv for the seed
```

`run-parallel.mjs` seeds one local state (`api/.wrangler/e2e/seed`, with `api/seed/seed.py --persist-to`), copies it
for each Worker (`api/.wrangler/e2e/w<i>`), starts the Workers with `wrangler dev` on ports 8801 to 8804, waits for
`/api/health`, runs the suite with one Playwright worker per Worker and stops the Workers when the suite ends or is
interrupted. Each test runs on its Playwright worker's Worker (`servers.ts`), so its demo reset touches no other test's
data. The seeded state is reused while the files the seed reads (migrations, `seed.py`, `fixtures/`, `data/derived/`,
`data/rakathon-26/`, `samples/`) and `package-lock.json` are unchanged; `--reseed` forces a new seed. The runner stops
when one of its ports already answers, so it never resets another run's Worker. `E2E_WORKERS=2` changes the count, `E2E_PORT_BASE` the
first port; Playwright arguments go after `--` (`npm --prefix e2e run test:parallel -- specs/calendar.spec.ts`). The
Workers' logs are `api/.wrangler/e2e/w<i>.log`.

Measured on an Apple Silicon laptop, 100 tests: 31 s on four Workers, 1.4 min on one; seeding takes about 1.5
minutes and only happens when its inputs changed.

### Against one running Worker

Against `wrangler dev` with the seeded local D1 and R2 (`api/AGENTS.md`):

```
cd api && cp .dev.vars.example .dev.vars              # once; the suite needs no keys
npm run seed:local                                    # needs uv; seeds .wrangler/ from committed synthetic data
npm run dev                                           # stages the app, serves http://localhost:8787

# in a second terminal, from the repository root:
npm --prefix e2e test
```

`npm --prefix e2e run typecheck` type-checks the suite. `npx playwright show-report e2e/playwright-report` opens the
HTML report; failures keep a trace (`npx playwright show-trace <trace.zip>`).

Against another Worker (a preview alias or the demo):

```
E2E_BASE_URL=https://<worker-host> E2E_ALLOW_RESET=<worker-host> npm --prefix e2e test
```

Every test resets both demo orgs through `POST /api/admin/reset-demo` before it starts (`fixtures.ts`), which wipes what
other people did on that Worker. The suite therefore refuses a non-local URL unless `E2E_ALLOW_RESET` names that
host; use it on a preview alias, or on the shared demo only when nobody is using it. The local check cannot see
`wrangler dev --remote`, which serves on localhost but writes to the deployed D1 and R2: never run the suite against
that. The Worker must have `DATA_API=on` and
`DEMO_RESET_ENABLED=true`; the global setup checks `/api/health` and stops with a message otherwise.

What the suite assumes about the server: the seed of `api/seed/seed.py`, `UPLOAD_POLICY=fixtures_only`, and no speech,
summary or pipeline keys (`features.stt`, `features.summarize` and `features.pipeline` false; the global setup stops if
one is on). The recorder test turns `stt` on by rewriting the health answer in the browser, so it runs the same with or without a key and never calls ElevenLabs.

### In CI

The `e2e` job of `.github/workflows/deploy-worker.yml` runs on pushes to main and backend and on pull requests that
touch the app, the Worker, the fixtures or `e2e/`: it installs, stages, runs `npm --prefix e2e run test:parallel`
with four Workers, caches Chromium by `e2e/package-lock.json` and the seeded state by the seed's inputs, and uploads `playwright-report/`, `test-results/`
(traces of failed tests) and the Workers' logs as the `playwright-report` artifact when it fails. The job has no
secrets. The deploy job needs it and the unit tests, so main deploys only when both pass. The job takes about 2.5
minutes with the seeded state cached and 4 to 6 minutes when it seeds.

## How it is built

- `playwright.config.ts`: one Playwright worker per Worker (`servers.ts`: `E2E_BASE_URLS`, a comma-separated list
  that `run-parallel.mjs` sets, or `E2E_BASE_URL`, default `http://localhost:8787`), single tests spread over the
  workers when there are several, Chromium, `cs-CZ`, Europe/Prague.
- `global-setup.ts` and `reset.ts`: check every Worker and reset its demo. A reset acts in the org of the
  administrator who asks for it (the seed has two demo orgs, `docs/design/AUTH.md`), so the fixture resets both: demo
  org A, with the hackathon demo, and demo org B, which the seed leaves empty (departments and people, no patient
  data). `specs/orgs.spec.ts` checks every screen of the empty org B, that an org B user sees none of org A, and that a
  patient created in org B stays there.
- `fixtures.ts`: the base URL of the test's Worker (from the Playwright worker's `parallelIndex`), an auto fixture that
  resets both demo orgs of that Worker before every test and fails a test on any uncaught page error or any content security policy
  violation Chromium reports in the console (pages opened in a second browser context, the phone and the second
  doctor, are not watched), and the `App` helper (open a route, pick the user, open a patient, open a tab, find a
  dialog).
- `discussion.ts`, `intake.ts`, `files.ts`: helpers for the discussion card, the new patient dialog with the S02 files,
  and file choosing. Uploaded files are the committed synthetic S02 PDFs or generated bytes.
- The app's demo date is fixed at 16. 10. 2026 and the seed's seminar is Thursday 22. 10. 2026, so dates in
  assertions do not move with the real clock. Approval times do (they come from the server clock) and are matched by
  pattern.
- No sleeps: every wait is Playwright's auto-waiting on something visible, or on a named response. No retries
  either: a test that passes only on a second try is a flake to fix.
- An absence check (`toHaveCount(0)`) always follows a check that the content it would be in has rendered, so it cannot
  pass on a page that is still loading. A read that does not wait (`allInnerTexts()`) follows a wait for its content.
- Every test starts from a reset demo and depends on no other test, so tests may run in any order and on any Worker.

## Rules for the specs

1. A change to the app's wording is a change to the suite in the same commit.
2. Specs name routes without a leading slash (`app.open("patient/10/labs")`); the first `open()` loads the page,
   later ones change the address with the browser's history API without a load, because the demo user picked in the
   header lives in the page.
3. A spec changes only where the app's behaviour changed on purpose, and the commit says so.
4. The app keeps the demo date fixed at 16. 10. 2026 while it runs on the demo seed; the calendar and report specs
   depend on it.
5. `accessibility.spec.ts` (axe-core through `@axe-core/playwright`, WCAG 2.1 A and AA) fails on violations of serious
   or critical impact on the app's screens and dialogs, and checks that dialogs take focus, keep Tab inside, close on
   Escape and give focus back. `serving.spec.ts` checks the headers, `/u`, the page images, the demo ZIP and the 404.

Known gaps the specs work around (tighten them when the app changes):
- The yellow box that marks the quote on the page image has no accessible name, so only the legend and the absence of
  "Citace nenalezena přesně" show that the quote was found on the image.
- Toasts vanish after 2.6 s, so specs check them right after the action.
- Booking from the calendar goes through the patient list's "Naplánovat" and drag and drop; the unscheduled panel is
  a list in the app, so a spec could book from it by role.
- `discussion.ts` decides whether to open the discussion card once the case's tabs have rendered; the card's summary
  sets `aria-expanded`, which `expand()` could read instead.

## Coverage

Screens and features from `docs/design/PRODUCT.md` against the spec files in `specs/`.

| PRODUCT.md | What is checked | Spec |
|---|---|---|
| S-1, F-01 Patient database | rows and columns, gap dash, search by name, ID and diagnosis, status and owner column filters, clear filters, submitted-from filter, paging state, open a row and back, column resize, links to the list screens | `patients-list`, `list-links` |
| S-2, F-11 MDT calendar | seminar week, booked and free slots, out-of-hours slots, week arrows, Dnes, mini month, browser back; card on click, Otevřít případ, close; double click opens; book with Naplánovat (persists), out-of-hours mark, Uvolnit termín, drag and drop both ways; coordinator books, administrator refused | `calendar` |
| S-3, F-16 Patient detail and brief | header (ID, status, owner, slot, actions), "Stručný souhrn", current state, oncology summary, unprocessed case | `patient-detail` |
| F-07 Missing-documents alert | always signalled on the brief, list one click away | `patient-detail`, `new-patient` |
| F-09 Conflicting and outdated alerts | grouped alerts, assistant's observation label, acknowledge, resolve, reopen, history after reload | `patient-detail`, `patient-tabs` |
| F-12 Case status | status menu change and history; close from the card and reopen; Projednán on approval | `patient-detail`, `discussion` |
| F-38 Doctor edits | edit the MDT question and a summary fact, "upraveno" mark, persistence, "Vrátit původní"; confirm the drafted question; the "Návrh asistenta" label on a drafted question until it is confirmed or edited, also on the calendar card (app only) | `patient-detail` |
| F-19 Timeline categories | category checkboxes, counts, "Vše" on and off, partial date kept | `patient-detail` |
| F-05, F-03 Documents and readability | document list with readability, column filter, search, missing originals | `patient-tabs` |
| F-06 Structured anamnesis | the Anamnéza tab with edit buttons | `patient-tabs` |
| F-21 Lab value trends | case 10's undated panel (original unit and range, no chart); S01's four draws, chart follows the picked test, value opens its source page | `patient-tabs` |
| F-27 Guideline layer | statements sorted by strength with the "not an order of options" note, entry opens to "Proč:" and "otevřít v doporučení", layer on and off; retrospective deviations read-only table with the edition valid at the decision | `patient-tabs` |
| Prognosis tab | saved study search for the MDT date, studies table, PubMed link | `patient-tabs` |
| F-18 Source view | reference opens the page image (really loaded), quote text, page switcher, zoom, close, transcription tab with the quote marked, redaction demo, alert page link | `source-viewer`, `patient-tabs` |
| S-4, F-15 MDT session | start dialog (order, attendance), session bar, current pill, next and pill navigation, reload keeps it, end | `session-recorder` |
| S-5, F-22, F-23 Projednání na MDT | sections, draft label, notes and conclusion autosave across reload, attendance per department across reload, next step across reload | `discussion` |
| F-24 Decision history | approval names the doctor, approver joins attendance, new version supersedes and keeps the previous one; a click right after typing, or while the guideline layer still loads, still approves (after the save) | `discussion`, `approve-pending` |
| F-25 Live listening | unavailable state without a speech service; with a stubbed token and socket: start, live words in the case, stop | `session-recorder` |
| F-31 PDF report | dialog, section picks, preview, gap wording in the report, draft PDF (file name and `%PDF-` bytes); frozen after approval | `report-export` |
| FHIR export | dialog, identity warning, downloaded Bundle with provenance | `report-export` |
| S-6, F-32 Tasks | drafts after approval, confirm and dismiss (doctor only), coordinator's read-only view, digest e-mail, done toggle and reopen across reload | `tasks` |
| F-02 Case intake | required fields and format check, FHIR sample (consent never imported), S02 seven PDFs, processing stages, Přidat do databáze, new patient opens with documents and the CEA trend, discard on close, Escape and Zpět, a non-demo file, dropped files, a route change, the administrator's note | `new-patient`, `intake-details` |
| F-04 Wrong patient and duplicates | duplicate birth number warning, link to the existing patient, "Přesto vytvořit nový záznam"; a document of another patient gets an identity warning on upload | `new-patient`, `uploads` |
| F-34 Extra documents | upload in Projednání listed as Nahráno, kept across reload, removed; no upload zone for the administrator | `uploads` |
| Phone upload (`docs/design/PHONE-UPLOAD.md`) | QR dialog, validity text, token never shown, phone page in a second context, file arrives on the desktop, Hotovo ends the link; a phone file into the intake | `uploads`, `intake-details` |
| S-8, F-39 Staff | doctor reads only; coordinator adds (appears in the picker, survives reload), renames, removes | `staff-admin` |
| S-7 Administrace | visible to the administrator only, access log with the doctor's earlier case view, demo reset from the UI | `staff-admin` |
| Autosave conflicts | a second doctor's saved draft makes my save show "Koncept mezitím upravil(a) ..." with their name; "Načíst uloženou verzi" loads theirs | `conflicts` |
| Organizations (AUTH.md) | the picker's users of both orgs; the empty org B's patient list, calendar, tasks, staff and access log hold none of org A; an org A case link leads back; a patient created in org B stays there | `orgs` |
| Roles | picker, doctor may edit and approve, coordinator changes status but not clinical content, administrator only reads | `roles`, `discussion`, `tasks`, `calendar` |
| F-36 Mobile web | no sideways scroll at 400 px on the list, calendar, tasks and patient tabs | `phone-width` |
| Accessibility | axe (WCAG 2.1 A/AA, serious and critical) on the list screens, every tab of NO-010 and NO-S01, the discussion card and four dialogs; dialog focus and Tab trap, also for the phone dialog stacked over another | `accessibility` |
| Serving | security headers and the content security policy, also on every app route path, `/u`, the page images (not their text layers), the demo ZIP, the 404 for other paths (`/app/`, `/legacy/` and its old redirects included), `/api` untouched, a deep link after a reload | `serving` |

Not covered, and why:
- **Not built in the page:** F-08, F-10, F-13, F-14, F-20, F-26, F-28, F-29, F-30.
- **No visible UI:** F-37 (pseudonymization happens on the server), F-33 (re-check on upload, server side).
- **Needs a service the suite does not run:** the document pipeline ("Přečíst bez AI", F-35) needs the page reader
  (`features.pipeline`); the speaker pass and AI summary after approval need ElevenLabs and Azure (only the live
  recorder states are covered).
- **Not reachable from the UI:** break-the-glass ("Otevřít mimo tým"). Every seeded department is a member of every
  case, and a doctor added in a new department sees an empty patient list (the server lists only member cases), so
  the page never offers the button. The API tests cover the route.
- **Stale tab after a reset:** a tab opened before a reset reloads on its next write; covered by the API tests.
- The access log's content beyond one case view, and the exact report and FHIR content, are covered by the API tests.
- **Not yet covered, worth adding with the port:**
  - paging across more than one page (the seed has 11 patients, 20 fit on a page);
  - "Změnit termín" from the patient header;
  - the guideline citation fields (society, version, section, page) and the "otevřít v doporučení" link target.
