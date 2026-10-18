# API Worker (`api/`)

A Cloudflare Worker named `codebridge-mdt` (a Worker is a script on
Cloudflare's runtime). It serves the Nuxt app (`app/`) at `/`, today's page
(the built mock v3) at `/legacy/` for a transition period, both as static
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
npm run dev                      # stage-assets.sh builds the app and stages it with mocks/ into .assets, then wrangler dev
npm run typecheck
npm test                         # Vitest in workerd with local D1/R2 and the migrations; outbound fetch is mocked
npm run types                    # after any wrangler.jsonc change; CI fails on a stale file
```

CI (`.github/workflows/deploy-worker.yml`) tests the Worker, the app and both packages, stages the files, checks the
app's size budget, and deploys `main` to production and `backend` to the `backend` preview alias. A manual deploy is
`npm run deploy`.

## Static files, headers and redirects (frontend step 13)

`scripts/stage-assets.sh` fills `.assets/`:

| Path | What |
|---|---|
| `/`, `/_nuxt/*` | the Nuxt app (`app/.output/public`); Nuxt's own `404.html` and `200.html` are dropped |
| `/legacy/` | today's page, `mocks/v3.html` unchanged |
| `/pages/`, `/ukazka/` | page images of the embedded mode, the S02 ZIP |
| `/u` | the phone page (`mocks/src/phone-upload.html`) |
| `/404.html` | the Czech 404 (`not_found_handling: 404-page`) |

`scripts/headers.mjs` then writes `.assets/_headers` and `.assets/_redirects`, which the assets binding reads (neither
is served). Every file gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`
and a Permissions-Policy (camera, location, payment and USB off; the microphone for our own pages); `/_nuxt/*` is
cached for a year (content-hashed names); the app's page (`/`) also gets the content security policy,
with the SHA-256 of each inline script in its `index.html` (the script stops when the count is not two), and
`Cross-Origin-Opener-Policy: same-origin`. The old page, `/u` and the 404 page get no policy: they run inline scripts.
`/api` answers set nosniff in `src/index.ts`. Redirects: `/app/...` (the app's address during the port) to `/`, and
`/legacy/ukazka/*` and `/legacy/pages/*` (the old page's relative links) to the root copies. These rules are checked
with `run_worker_first: ["/api/*"]` only. Access mode (`true`, runbook below) routes every request through the Worker,
whose Hono app answers only `/api`; that switch needs a forward to `env.ASSETS.fetch` and a fresh check that the
headers and redirects still arrive. Check after any change: `curl -sI http://localhost:8787/` and `npm --prefix e2e test`
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

- The seed reads only committed synthetic data (`mocks/src/data`, `data/derived`,
  `data/rakathon-26`, `samples`), never `private/`. It reuses `mocks/build.py`'s
  `page_index()` and `guidance()`, so the server holds what the page embeds.
- Identity lives in the `patients` table only. The seed fails when a patient's name
  or birth number is left in stored JSON or case rows outside a `quote` field;
  `seed/out/identity-scan.txt` lists paths, never values.
- After changing a fixture, reseed; the page's `?parity` check compares the server's
  patients, staff and tasks with the embedded ones (console). `?data=embedded`
  forces the embedded data on the Worker.
- Routes that return case content check role and membership
  (`packages/domain/src/access.ts`) and write an `access_log` row before reading the content
  (`src/middleware/audit.ts`); a failed insert answers 500 with no content.
- `DATA_API` (`on`/`off`) switches the data API and `/api/health`'s `features.data`. `DEMO_RESET_ENABLED` (`true` on the
  demo Worker) allows reset-demo.
  `CLINICAL_ACCESS` is `all_roles` (demo default: every role reads clinical content)
  or `doctors_only` (INTEGRATION.md); open question in `docs/agent/OPEN_QUESTIONS.md`.
- Demo mode takes the user from `X-Demo-User: <staff id>` or the `cb_demo_user` cookie
  (page images cannot send a header); default `d2p1`. Access mode maps the verified
  e-mail to `users.email`.
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
- Every write sends `X-Data-Epoch` (from `/api/health` `demo.data_epoch`); a stale one answers 409 `data_reset`.
  Approve and new case need `Idempotency-Key`; a retry with the same body replays the first answer.
- Answers are `{ data, data_epoch, state }`; `state` is what the page applies (`src/store/work.ts`, `caseStates`).
- Access-log lines carry no patient text (names, birth numbers, conclusions, quotes, file names, typed reasons);
  `test/write.test.ts` checks every line it writes. Refusals (403) are logged by `middleware/write-guard.ts`.
- `POST /api/admin/reset-demo` (administrator, `DEMO_RESET_ENABLED=true`): archives the audit to R2
  `audit-archive/<time>.jsonl`, then one batch empties the mutable tables and reinserts the rows from R2
  `seed/reset.json` (written by `seed.py`; identity is not in it, seeded patient rows stay in D1), bumps
  `demo_state.data_epoch`, aborts open audio uploads and deletes R2 `uploads/`, `audio/`, `jobs/`, `cache/summary/`.
  45 statements with today's seed (step 6 rows go through a trigger, see below); keep it under 50 (the Workers Free
  per-invocation limit) when adding tables.
- Append-only triggers allow DELETE only while `demo_state.reset_in_progress = 1` (migration 0003). A pilot database
  must not have that exception.
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
- Deploy before migrating when a migration drops what old code reads: migration 0009 drops
  `transcript_passes.audio_on_failure`, which the previous Worker's Workflow and cron query read, while the new code
  works on either schema. So `npm run deploy` first, then `npm run migrate:remote`.
- Deploying: the Workflow and the cron trigger are registered only by `wrangler deploy` (`npm run deploy`), not by
  `wrangler versions upload`, which CI uses for the `backend` preview alias. A preview's approvals start instances of
  the Workflow as the last `wrangler deploy` registered it, so deploy after changing `src/workflows/`.
- `seed.py --reset` empties the audio tables but does not delete R2 `audio/` objects (nor step 6's `uploads/`); reset-demo does, and the
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
  document already there. Files live under R2 `uploads/<case>/`, which reset-demo and the intake
  discard delete. Rules in `src/domain/documents.ts`; the fixture's patient (`fixture_patients`, D1 only) is compared
  with the case's patient and only the result (`matches`, `conflicts`, `cannot_verify`) leaves the server.
- Intake: `src/routes/intake.ts`, `src/store/intake.ts`, rules in `src/domain/intake.ts` and `packages/domain/src/fhir.ts`. An
  open intake (`cases.intake_open = 1`) is hidden from lists and the workflow, takes uploads only, and is 404 to anyone
  but its creator; the cron sweep removes it after 24 hours. The attach reads `fixtures/<id>/prepared.json`, written by
  `seed.py` (identity scan strict, quotes checked on their page). Keep every new list or write route consistent with
  that rule (`caseFor`, `openCase`, `listCases`, `visibleCaseIds`).
- Reset: rows added by uploads, intakes and pipeline runs are removed by the trigger `demo_reset_uploads` (it fires on
  the reset batch's `reset_in_progress = 1` update), so the reset batch stays at its size (45 statements locally). A new
  table written by these routes goes into that trigger, not into the batch.
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
- The phone page is `mocks/src/phone-upload.html`, staged as `.assets/u.html` (`/u`; no Worker route).
- End to end with real browsers (needs Playwright with Chromium and WebKit; it prints counts only):

  ```
  cd api && npm run seed:local && npm run stage && npx wrangler dev --port 8799
  PLAYWRIGHT_PATH=<dir>/node_modules/playwright node api/scripts/e2e-phone-upload.mjs http://localhost:8799 --reset
  ```
  `--reset` runs reset-demo before (the S02 patient can be added once per seeded state) and after.

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
