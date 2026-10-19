# API Worker (`api/`)

A Cloudflare Worker named `codebridge-mdt` (a Worker is a script on
Cloudflare's runtime). It serves the Nuxt app (`app/`) at `/` as static
files, and the API under `/api`. Design: `docs/research/backend-steps/step-0-1.md`,
section "Issue: Step 1".

## Run, test, deploy

`api/` is an npm workspace of the repository root (with `app/` and `packages/*`); the lockfile is the root
`package-lock.json`, and `npm ci` here installs the Worker's dependencies from it (not the app's). The pure case
rules come from `@codebridge/domain` (`packages/domain`). Staging (`npm run stage`, also run by `dev` and `deploy`)
builds the Nuxt app, so it needs `npm ci` at the root first.

```
npm ci
cp .dev.vars.example .dev.vars   # local keys, gitignored; agents never read it
npm run dev                      # stage-assets.sh builds the app and stages it into .assets, then wrangler dev
npm run typecheck
npm test                         # Vitest in workerd with local D1/R2 and the migrations; outbound fetch is mocked
npm run types                    # after any wrangler.jsonc change; CI fails on a stale file
```

CI (`.github/workflows/deploy-worker.yml`) tests the Worker, the app and both packages, stages the files, checks the
app's size budget, and deploys `main` to production and `backend` to the `backend` preview alias. On `main` it applies
the D1 migrations right before the deploy (below, "Migrations in CI"). A manual deploy is `npm run deploy`.

### Migrations in CI

The deploy job on `main` runs, in this order: stage the files, `npx wrangler d1 migrations apply codebridge-mdt
--remote` (from `api/`, with the repository's `CLOUDFLARE_API_TOKEN`, which has D1 Edit, and `CLOUDFLARE_ACCOUNT_ID`),
then `wrangler deploy`. wrangler answers its own "Ok to proceed?" with yes in CI. A failed migration fails the step, so
the job stops and the old Worker keeps serving; D1 runs each migration file as one batch, so the failed file is not half
applied, but files before it in the same run stay applied. With no new migration the step only reports that and the
deploy follows.

- **The window.** Between the migration and the end of `wrangler deploy` (usually under a minute) the old Worker runs
  on the new schema. A migration therefore has to work with the Worker already deployed: add tables and columns, and
  never drop or rename what the deployed code reads in the same change. To remove something, first ship code that no
  longer reads it, then drop it in a later migration. A migration that cannot work with the old code (0011 rebuilds every
  org table) needs a person watching the merge (below, "Organizations").
- **No cancelled runs on `main`.** On other refs a newer push cancels the running workflow; on `main` it waits
  (`cancel-in-progress` is off there), so a run is never stopped between the migration and the deploy. A deploy that
  fails after a successful migration leaves the old code on the new schema until someone reruns the job or runs
  `npm run deploy`.
- **The `backend` preview never migrates.** It uses the same database as production, so a schema change must reach
  `main` first; uploading a `backend` version whose code needs a migration that `main` has not applied breaks the
  preview, and migrating from the preview would break production. Push such a change to `backend` only after it is on
  `main`.
- **The manual fallback** stays: `npm run migrate:remote` from `api/` with your own wrangler login applies the same
  migrations when the CI step fails on the token, the network or Cloudflare. A migration whose SQL fails fails by hand
  too: fix it forward with a new migration (files before it in the run stay applied), never by editing an applied file.
  Do not run it while a `main` deploy job is running.

## Static files, headers and redirects (frontend step 13)

`scripts/stage-assets.sh` fills `.assets/`:

| Path | What |
|---|---|
| `/`, `/_nuxt/*` | the Nuxt app (`app/.output/public`); Nuxt's own `404.html` and `200.html` are dropped |
| `/patients`, `/calendar/:week`, `/patient/:nr/:tab`, ... | the app's page again, by a 200 rewrite for each route path in `scripts/app-routes.mjs` |
| `/pages/<pdf stem>/p<n>.png`, `p<n>.redacted.png` | the page images, copied from `data/derived/pages` (images only, not the text layers or redaction records) |
| `/ukazka/` | the S02 ZIP (`fixtures/ukazka`, written by `fixtures/prepare.py`) |
| `/u` | the phone page (`public/phone-upload.html`) |
| `/404.html` | the Czech 404 (`not_found_handling: 404-page`) |

`scripts/headers.mjs` then writes `.assets/_headers` and `.assets/_redirects`, which the assets binding reads (neither
is served). Every file gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`
and a Permissions-Policy (camera, location, payment and USB off; the microphone for our own pages); `/_nuxt/*` is
cached for a year (content-hashed names); the app's page (`/` and every route path, since the rules match the
address asked for) also gets the content security policy, with the SHA-256 of each inline script in its `index.html`
(the script stops when the count is not two), and `Cross-Origin-Opener-Policy: same-origin`. The phone page at `/u` and
the 404 page get no policy: they run inline scripts. `/api` answers set nosniff in `src/index.ts`. Rewrites (200): the
app's route paths to `/`. Any other path is the 404 page, so there is no SPA fallback; the folders Nuxt prerenders
for the static routes (`patients/index.html`, ...) are deleted, or `/patients/` would serve the app without the
policy. These rules are checked with `run_worker_first: ["/api/*"]` only. Access mode (`true`, runbook below) routes
every request through the Worker, whose Hono app answers only `/api`; that switch needs a forward to
`env.ASSETS.fetch` and a fresh check that the headers and redirects still arrive. Check after any change:
`curl -sI http://localhost:8787/`, `curl -sI http://localhost:8787/patient/10/labs` and `npm --prefix e2e test`
(`specs/serving.spec.ts`).

## Data: D1, R2 and the seed (step 2)

Design: `docs/research/backend-steps/step-2.md`. D1 database `codebridge-mdt`
(binding `DB`) and R2 bucket `codebridge-mdt` (binding `DOCS`), both created
once with the EU jurisdiction (it can only be set at creation):

```
npx wrangler d1 create codebridge-mdt --jurisdiction=eu
npx wrangler r2 bucket create codebridge-mdt --jurisdiction eu
npx wrangler d1 info codebridge-mdt          # shows "jurisdiction: eu"
```

```
npm run migrate:local | migrate:remote   # apply migrations/ (the seed does this too)
npm run seed:local                       # wipe and reseed the local state in .wrangler/ (needs uv)
npm run seed:remote                      # first seed of the deployed D1/R2; refuses an already seeded database
npm run seed:remote:reset                # wipe and reseed the shared demo; also deletes its access log
uv run seed/seed.py --dry-run            # write seed/out/ only (SQL, R2 manifest, identity scan)
```

- The seed reads only committed synthetic data (`fixtures/data`, `data/derived`,
  `data/rakathon-26`, `samples`), never `private/`. It imports `page_index()` and
  `guidance()` from `fixtures/prepare.py` ([`fixtures/README.md`](../fixtures/README.md)).
- Identity lives in the `patients` table only. The seed fails when a patient's name
  or birth number is left in stored JSON or case rows outside a `quote` field;
  `seed/out/identity-scan.txt` lists paths, never values.
- After changing a fixture, reseed.
- Routes that return case content check role and membership
  (`packages/domain/src/access.ts`) and write an `access_log` row before reading the content
  (`src/middleware/audit.ts`); a failed insert answers 500 with no content.
- `DATA_API` (`on`/`off`) switches the data API and `/api/health`'s `features.data`. `DEMO_RESET_ENABLED` (`true` on the
  demo Worker) allows reset-demo.
  `CLINICAL_ACCESS` is `all_roles` (demo default: every role reads clinical content)
  or `doctors_only` (INTEGRATION.md); open question in `docs/agent/OPEN_QUESTIONS.md`.
- Demo mode takes the membership from `X-Demo-User: <membership id>` or the `cb_demo_user` cookie
  (page images cannot send a header); default `d2p1` (demo org A). A person's id still works and means their first
  active membership. Access mode maps the verified e-mail to `users.email`, then to the person's first active
  membership (the login of step 3 lets a person in several orgs choose). See "Organizations" below.
- D1 limits: GLOB/LIKE patterns at most 50 bytes, 100 KB per SQL statement, and an
  unused bound value is an error.

## Writes (step 4)

Design and the exact contract: `docs/research/backend-steps/step-4.md`, section "As implemented".

- Rules live in `packages/domain/src` (`@codebridge/domain`, shared with the app) and `src/domain/` (server-only rules),
  pure with an injected clock: `roles.ts` is the permission matrix; the role questions the team
  has not decided are one constant each in `packages/domain/src/config.ts` (open question in `docs/agent/OPEN_QUESTIONS.md`).
- A write route checks role and membership (`caseFor` in `src/routes/write-context.ts`), runs the domain rule, then
  commits one D1 batch through `src/store/write.ts`: guards first (each re-checks a value the route read; a false one
  fails `write_guards`' CHECK and rolls back the whole batch), the changes, the access-log rows. Map a constraint to a
  Czech refusal with `tx.onConstraint`, never by catching a 500.
- Every write sends `X-Data-Epoch`, the data epoch of the org it acts in (from `/api/me`, `/api/workflow` or any
  write answer; `/api/health` gives the picked demo user's org, or demo org A); a stale one answers 409 `data_reset`.
  Approve and new case need `Idempotency-Key`; a retry with the same body replays the first answer.
- Answers are `{ data, data_epoch, state }`; `state` is what the page applies (`src/store/work.ts`, `caseStates`).
- Access-log lines carry no patient text (names, birth numbers, conclusions, quotes, file names, typed reasons);
  `test/write.test.ts` checks every line it writes. Refusals (403) are logged by `middleware/write-guard.ts`.
- `POST /api/admin/reset-demo` (an administrator of a demo org, `DEMO_RESET_ENABLED=true`) resets that org only:
  archives its audit to R2 `org/<org>/audit-archive/<time>.jsonl`, then one batch empties the org's mutable tables
  (`WHERE org_id = ...`) and reinserts the org's section of R2 `seed/reset.json` (written by `seed.py`; identity is not
  in it, seeded patient rows stay in D1), bumps that org's `demo_state.data_epoch`, aborts its open audio uploads and
  deletes R2 `org/<org>/uploads/`, `audio/`, `jobs/`, `cache/summary/` (for demo org A also the same prefixes without
  `org/`, used before orgs). People (`users`) are never deleted: the reset upserts the seeded people and memberships
  and ends any other membership of the org. Row ids are not reset (`sqlite_sequence` is shared by all orgs). 45
  statements for org A with today's seed (step 6 rows go through a trigger, see below).
- Append-only triggers allow DELETE of a row only while its own org's `demo_state.reset_in_progress = 1` (migration
  0011), so a reset of one org cannot delete another org's history. A pilot database must not have that exception.
- Deviation assessments have no write route (user decision 2026-10-17).

## AI recording and the speaker pass (step 5)

Design and contract: `docs/research/backend-steps/step-5.md`, section "As implemented". Part (b), prognosis, is not
built.

- Routes in `src/routes/transcript.ts`: recordings, live lines, audio parts (raw PCM, `application/octet-stream`; the
  write middleware exempts that one route from the JSON check), the stored transcript, jobs and retry. Rules in
  `src/domain/transcript.ts`; R2 and D1 audio work in `src/store/audio.ts`; jobs in `src/store/jobs.ts`.
- Approval plans the pass in its own batch (`hooks.planSpeakerPass`, `addSpeakerPass` in `src/routes/hooks.ts`) and
  starts `SpeakerPassWorkflow` (`src/workflows/speaker-pass.ts`, binding `SPEAKER_PASS`) after the commit. Closing a
  case and ending a seminar purge audio there too.
- Workflow params and step results carry ids and counts only, never transcript text, audio or prompts;
  `test/transcript.test.ts` checks every step result. Keep it so when adding a step.
- A failed pass keeps its audio for "Zkusit znovu" until a pass succeeds or the case closes, at most 7 days (user
  decision 2026-10-18, DATA-PROTECTION.md "Meeting audio"); the seminar end does not delete it. The retry route checks
  the objects in R2 and, if they are gone, marks the audio deleted and answers 409 `not_retryable`, which the page
  takes quietly (it reloads the transcript, no toast).
- `scheduled()` (`src/scheduled.ts`, cron every 15 minutes) deletes unapproved audio older than 6 hours, any audio
  older than 7 days, and audio left by a finished pass, and restarts passes whose start failed.
- R2 lifecycle backstop, applied once per bucket (check with `npx wrangler r2 bucket lifecycle list codebridge-mdt -J eu`):

  ```
  npx wrangler r2 bucket lifecycle add codebridge-mdt audio-backstop-7d audio/ --expire-days 7 --abort-multipart-days 7 -J eu -y
  npx wrangler r2 bucket lifecycle remove codebridge-mdt --name audio-backstop-1d -J eu   # a bucket set up before 2026-10-18
  npx wrangler r2 bucket lifecycle add codebridge-mdt summary-cache-30d cache/summary/ --expire-days 30 -J eu -y
  ```

  New objects go under `org/<org>/` (migration 0011), and an R2 rule matches a prefix only, so each org gets its own
  rules; the ones above keep covering objects written before orgs. For each demo org (`demo-a`, `demo-b`):

  ```
  npx wrangler r2 bucket lifecycle add codebridge-mdt audio-backstop-7d-demo-a org/demo-a/audio/ --expire-days 7 --abort-multipart-days 7 -J eu -y
  npx wrangler r2 bucket lifecycle add codebridge-mdt summary-cache-30d-demo-a org/demo-a/cache/summary/ --expire-days 30 -J eu -y
  npx wrangler r2 bucket lifecycle add codebridge-mdt audit-archive-30d-demo-a org/demo-a/audit-archive/ --expire-days 30 -J eu -y
  ```
  A hospital org gets the audio and cache rules but no audit-archive rule (its archive follows FNO's retention).
- A migration that drops what the deployed code reads breaks it in the window above, because CI migrates first. Ship
  it in two changes: code that works on either schema, then the drop. (Migration 0009, which drops
  `transcript_passes.audio_on_failure`, was applied by hand after the deploy, before CI migrated.)
- Deploying: the Workflow and the cron trigger are registered only by `wrangler deploy` (`npm run deploy`), not by
  `wrangler versions upload`, which CI uses for the `backend` preview alias. A preview's approvals start instances of
  the Workflow as the last `wrangler deploy` registered it, so deploy after changing `src/workflows/`.
- `seed.py --reset` empties the audio tables but does not delete R2 audio objects (nor step 6's uploads); reset-demo does, and the
  lifecycle rule removes the rest within about eight days.
- Workflow tests: `introspectWorkflow(env.SPEAKER_PASS)` with `await using`, `disableRetryDelays()`. The Workflow runs
  with the Worker's bindings, not the per-test env, so `vitest.config.ts` pins its secrets and endpoints to `.test`
  hosts. A test that approves a case with audio or lines starts a pass; let it finish inside the test (`settle`).

## Uploads, intake and the document pipeline (step 6)

Design and contract: `docs/research/backend-steps/step-6.md`, section "As implemented".

- Uploads: `src/routes/documents.ts` (raw body, one file per request; the write middleware skips the JSON parse for
  this path only). Every file is accepted, never refused for its type, size or origin (user decision 2026-10-18).
  `UPLOAD_POLICY=fixtures_only` stores the bytes of registered synthetic fixtures only (`fixture_files` by SHA-256); any
  other file gets a listing row (name, size, media type, uploader, time; `original_r2_key`, `sha256`, `fixture_id` NULL,
  `content_stored: false` in the answer) and nothing in R2. A repeat (same bytes or same name) answers 200 with the
  document already there. Files live under R2 `org/<org>/uploads/<case>/`, which reset-demo and the intake
  discard delete. Rules in `src/domain/documents.ts`; the fixture's patient (`fixture_patients`, D1 only) is compared
  with the case's patient and only the result (`matches`, `conflicts`, `cannot_verify`) leaves the server.
- Intake: `src/routes/intake.ts`, `src/store/intake.ts`, rules in `src/domain/intake.ts` and `packages/domain/src/fhir.ts`. An
  open intake (`cases.intake_open = 1`) is hidden from lists and the workflow, takes uploads only, and is 404 to anyone
  but its creator; the cron sweep removes it after 24 hours. The attach reads `fixtures/<id>/prepared.json`, written by
  `seed.py` (identity scan strict, quotes checked on their page). Keep every new list or write route consistent with
  that rule (`caseFor`, `openCase`, `listCases`, `visibleCaseIds`).
- Reset: rows added by uploads, intakes and pipeline runs are removed by the trigger `demo_reset_uploads` (it fires on
  reset batch's `reset_in_progress = 1` update of that org, and deletes that org's rows only), so the reset batch stays
  at its size. A new table written by these routes goes into that trigger, not into the batch.
- Pipeline without an LLM: `src/workflows/process-document.ts` (binding `PROCESS_DOCUMENT`), `src/routes/pipeline.ts`,
  `src/services/pagekit.ts`. PageKit is `pipeline/container/server.py`; the Worker reaches it at `PAGEKIT_URL` or,
  once configured, through a `PAGEKIT` container binding; with neither the pipeline answers 503 `pipeline_off`. Step
  results hold ids, counts and codes only (`test/pipeline.test.ts`). Runs are `pipeline_runs`, never the case's view.
- Local end to end with the real files:

  ```
  cd pipeline && uv run python container/server.py --port 8080      # PageKit (needs tesseract with ces)
  cd api && npm run seed:local && npx wrangler dev --port 8799 --var PAGEKIT_URL:http://localhost:8080
  node api/scripts/e2e-intake.mjs http://localhost:8799 --pipeline --reset
  ```
- Python tests of the pipeline: `cd pipeline && uv run pytest -q`.

## Upload from a phone (issue #10)

Design and contract: `docs/design/PHONE-UPLOAD.md`, section "As implemented".

- Routes in `src/routes/upload-sessions.ts`, rules in `src/domain/upload-sessions.ts`, table `upload_sessions`
  (migration 0010). The desktop routes (`POST /upload-sessions`, `GET` and `DELETE /upload-sessions/:id`) run behind
  the viewer and write middleware like any write. The phone's two routes (`/upload-sessions/current` and
  `/upload-sessions/current/files`) are mounted before `auth()`: the phone is not logged in, the token in
  `Authorization: Bearer` is the credential, and the request acts for the session's creator (`actAsCreator`), whose
  role, membership and case state are checked again for every file. Files go through `receiveUpload` in
  `src/routes/documents.ts`, the same path as a desktop upload.
- Only `token_hash` (SHA-256) is stored. Never log the token, its hash or a file name; `test/upload-sessions.test.ts`
  checks the access log and the console output.
- The phone page is `api/public/phone-upload.html`, staged as `.assets/u.html` (`/u`; no Worker route).
- End to end with real browsers (needs Playwright with Chromium and WebKit; it prints counts only):

  ```
  cd api && npm run seed:local && npm run stage && npx wrangler dev --port 8799
  PLAYWRIGHT_PATH=<dir>/node_modules/playwright node api/scripts/e2e-phone-upload.mjs http://localhost:8799 --reset
  ```
  `--reset` runs reset-demo before (the S02 patient can be added once per seeded state) and after.

## The old Pages address

`https://codebridge-mdt.pages.dev` (Cloudflare Pages project `codebridge-mdt`) hosted the old single-file page, and
colleagues still open it. It now serves only `api/pages-redirect/`: a `_redirects` file that sends every path, with
its query string, to the app on the Worker (`/* https://codebridge-mdt.juraj-oravec-josefson.workers.dev/:splat
302`), and an `index.html` with a link for a client that ignores the redirect. The browser keeps the fragment, so a
phone link `/u#<token>` still works. 302 and not 301, so browsers do not cache it and the target can change later
(for example to a custom domain): edit the one line in `_redirects`.

`.github/workflows/deploy-pages-redirect.yml` deploys the folder on every push to main that changes it (or by hand,
`workflow_dispatch`), with the repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The deploy has no
`functions/` folder, so it also retires the old Pages Functions. Try it locally:

```
npx --prefix api wrangler pages dev api/pages-redirect --port 8860
curl -sI 'http://localhost:8860/patient/10/labs?x=1'   # 302, location .../patient/10/labs?x=1
```

## Organizations (AUTH.md steps 1 and 2)

Design: `docs/design/AUTH.md` and `docs/design/DATABASE.md`, each with a section "As implemented (steps 1-2)".

- **Schema (migration 0011).** `orgs`; `users` is the person (name, titles, e-mail, active); `memberships` holds a
  person's role, function and activity in one org (one per person and org; in demo org A its id is the person's id);
  `user_identities` and `auth_sessions` exist for the login of step 3 and are unused. Every org table has `org_id NOT
  NULL` with no default, `UNIQUE (org_id, id)` on parents, composite foreign keys `(org_id, x_id)`, references to people
  through `memberships(org_id, user_id)`, and unique keys that start with `org_id`. `cases.case_no` is the number people
  see, counted per org; `cases.id` is unique across orgs (`orgs.case_id_prefix`: none in demo org A, `B-` in org B).
  The app still shows `cases.id`, so org B's cases read `B-NO-...` until the frontend shows `case_no` (step 4).
- **One way to bind the org.** SQL names the org as `?org`; `orgStmt(db, org, sql, ...args)` (`src/store/sql.ts`)
  binds it as the next numbered parameter, `Tx` (`src/store/write.ts`) does the same for its statements and guards, and
  `orgQuery(c, sql, ...args)` (`src/routes/write-context.ts`) reads in the viewer's org. The org-bound stores
  (`D1Directory`, `D1Cases`, `D1Audit`, `D1Work`) take the org in their constructor. Routes take the org from the viewer
  (the membership), workflows get it in their parameters (`org`; an instance started before orgs has none and means
  demo org A, `src/domain/orgs.ts`), and the cron job loops over the orgs. A record of another org answers as if it did
  not exist (404, or the route's own "not found" refusal).
- **Checks.** `test/org-sql.test.ts` flags any SQL string in `src/` that touches an org table without naming `org_id`
  (a reminder: joins and subqueries escape it; mark a statement that is global by design, or a fragment whose caller
  adds the org, with `/* org-scope: <reason> */`). `test/orgs.test.ts` acts in org B with org A's IDs on every route and
  requires 404 or empty answers and org A unchanged. `test/data.ts` seeds a look-alike org B with one case for every
  test (test data only; the real seed's org B is empty, below).
- **Demo org B is empty.** The seed gives demo org B ("Ukázková nemocnice B") its setup only: the org, its two
  departments and four people (`lekar1.b`, `lekar2.b`, `koordinator.b`, `admin.b` `@codebridge.demo`) with their
  memberships. It holds no patient, case, document, alert, slot or task; that is where the team puts its own test data,
  and its demo reset returns it to the empty setup. `seed.py` stops when a seeded row of any other table, or an R2 object
  under `org/demo-b/` or keyed by a `B-` case ID, belongs to org B.
- **Migrating a deployed database.** 0011 rebuilds every org table, and old and new code do not run on each other's
  schema. CI applies it on `main` right before the deploy ("Migrations in CI"), so merging this needs a person watching:
  first check that no job or pipeline run is queued or running (a step of an old Workflow that runs after the migration
  fails for good), merge, and watch the `main` deploy job (if its migration step fails on the token or the network, run
  `npm run migrate:remote` by hand and rerun the job; a SQL failure needs a fix, see the fallback above). Once it has deployed, run `npm run seed:remote:reset` (the reset document's format changed,
  and org B and the demo e-mails come from the seed), and redeploy `backend` from a branch with these changes. The demo
  is down in between: the old Worker runs on the new schema until the deploy finishes, and the data is wrong until the
  reseed. Rows written before keep their R2 keys
  (`docs/`, `pages/`, `uploads/`, `audio/` without the `org/` prefix), which stay readable. Add the per-org lifecycle
  rules above.
- **Adding an org.** A row in `orgs` (a short lowercase id, a unique `case_id_prefix`), its `demo_state` row,
  memberships for its people, departments and their members. A demo org also needs its section in `seed/reset.json`
  (`seed.py`) and its default staff in `packages/domain/src/staff-default.ts`; the lifecycle rules for its prefix.

## Where configuration lives

- Vars (endpoints, models, language, limits, `AUTH_MODE`) in `wrangler.jsonc`.
- Keys only as secrets: `npx wrangler secret put ELEVENLABS_API_KEY`,
  `AZURE_OPENAI_KEY`, optionally `AI_GATEWAY_TOKEN`. Locally in `.dev.vars`.
  Never in code, CI, logs or git.
- `.dev.vars.example` lists the secret names; `src/worker-configuration.d.ts`
  is generated from it and `wrangler.jsonc`.

## Rules for code here

- Errors are `{ error: { code, message_cs } }` from `src/http/errors.ts`; never
  put the upstream status, upstream body or a key in a response.
- Log only route, status, upstream status, attempts and duration; never a
  transcript, audio or token (Workers Logs sit outside our EU control).
- Every `/api` answer carries `Cache-Control: no-store`.
- The rate limiter namespace ids (26101 to 26104) must stay unique in the account.

## Access runbook (when the team switches on login)

1. In Zero Trust, protect `codebridge-mdt.<subdomain>.workers.dev` and the
   preview URLs (`*-codebridge-mdt.<subdomain>.workers.dev`): the Workers
   settings "Cloudflare Access" toggle, or a self-hosted application.
2. Policy: team e-mails, mentors and jury, by one-time PIN or GitHub.
3. Copy the application's AUD tag.
4. In `wrangler.jsonc` set `ACCESS_TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`),
   `ACCESS_AUD`, `AUTH_MODE=access`, and `assets.run_worker_first: true`
   (so the Worker checks every request, not only `/api`). Run `npm run types`.
5. Add a bypass policy for `/u` and `/api/upload-sessions/current*`: the
   phone of "Nahrát z telefonu" is not logged in, and the session token is
   those routes' credential (`docs/design/PHONE-UPLOAD.md`).
6. Redeploy, then check that both the production and the preview URL ask
   for login and that `/api/health` shows `auth_mode: "access"`.
7. Check in Workers Logs that invocation logs do not record request
   headers; the `Cf-Access-Jwt-Assertion` header is a bearer credential
   that carries the user's e-mail, and the phone's `Authorization` header
   carries an upload token.

Access service tokens carry no e-mail and are refused (401); the app has
no machine clients. If the team's key set cannot be fetched, the API
answers 503 `upstream_busy` instead of 401, so users are not sent into a
login loop by our outage.

## AI Gateway (off)

Before setting `AI_GATEWAY_BASE`, check on a scratch gateway that (a) it
accepts the APIM host and the `/openai/v1/chat/completions` path, (b)
whether it retries 429 itself (then lower `LLM_MAX_ATTEMPTS`), and (c) its
logging is off.
