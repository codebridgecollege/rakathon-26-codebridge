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
npm run dev                      # stage-assets.sh builds the app and stages it into .assets, then wrangler dev (demo mode)
npm run dev:oidc                 # the same with the login (AUTH_MODE=oidc); needs OIDC_CLIENT_SECRET and SESSION_KEY in .dev.vars
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
  org table; 0016 rebuilds the extraction runs and alert events, so until the deploy ends the old Worker's intake attach
  and alert events fail, its alert history shows empty, and `seed.py` from before 0016 fails on the computed `kind`)
  needs a person watching the merge (below, "Organizations").
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
policy. `run_worker_first` lists `/api/*` and `/auth/*` only (the login, section "Login"), so every static file comes
from the assets binding with these headers; the login pages set their own (`src/auth/pages.ts`). Check after any change:
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
- Extraction runs: the seed stores the converted `codebridge.extraction/2` runs of NO-010 and NO-S01
  (`fixtures/data/runs/`) byte for byte under R2 `org/<org>/extract/<case>/<run id>.json`, with their `extraction_runs`
  row (`producer` fixture, `seeded` 1, schema `/2`), their fact IDs in `fact_ids` and their alerts in `alert_identities`.
  It stops before writing anything when a run fails `pipeline/extraction_format`'s `validate_run`, reads a document
  that is not the seeded PDF (by SHA-256), names a part that is not a seeded `document_parts.part_id`
  (`<document id>/p<index>`), or when guidance names a run or fact ID that is not in NO-010's run. After seeding it
  reads both run objects back from R2 and compares them with the files, and checks the D1 counts (no `/1` run or
  `alerts` row left). It writes no `/1` run and nothing into `alerts`.
- After changing a fixture, reseed.
- **Production needs a reseed after the `codebridge.extraction/2` stack is merged** (PRs #39, #36 and the seed and app
  PRs, merged together): migration 0016 keeps the deployed `/1` runs, which the API serves as not processed, and the
  old `fixtures/S02/prepared.json`, which the intake refuses as `seed_missing`. A person runs it after the deploy job
  on `main` has finished (the seed applies migrations, so it must run against the new schema), from the repository
  root with wrangler logged in to the team's account:

  ```
  uv run api/seed/seed.py --target remote --reset
  ```

  It wipes and reseeds the shared demo, including its access log, and ends with "verified: ...". CI does not run it.
  Between the deploy and the reseed, case 10 and S01 show as not processed and the S02 intake answers 503
  `seed_missing`, so the reseed follows the deploy at once and before any demo. The reseed leaves the old `/1` run
  objects (`org/demo-a/extract/<case>/seed-<case>-<sha8>.json` and the unprefixed `extract/...`) in R2 with no row
  pointing at them; they hold no identity, and nothing reads them.
- A local wrangler state that applied `0015_extraction_v2.sql` from an earlier `stream-a2-server` checkout fails on
  `0016_extraction_v2.sql` (its tables exist already); delete `api/.wrangler/state` and run `npm run seed:local`.
- Routes that return case content check role and membership
  (`packages/domain/src/access.ts`) and write an `access_log` row before reading the content
  (`src/middleware/audit.ts`); a failed insert answers 500 with no content.
- `DATA_API` (`on`/`off`) switches the data API and `/api/health`'s `features.data`. `DEMO_RESET_ENABLED` (`true` on the
  demo Worker) allows reset-demo.
  `CLINICAL_ACCESS` is `all_roles` (demo default: every role reads clinical content)
  or `doctors_only` (INTEGRATION.md); open question in `docs/agent/OPEN_QUESTIONS.md`.
- Demo mode takes the membership from `X-Demo-User: <membership id>` or the `cb_demo_user` cookie
  (page images cannot send a header); default `d2p1` (demo org A). A person's id still works and means their first
  active membership. OIDC mode ignores the header: the session cookie names the person, the org and the membership
  (section "Login"). See "Organizations" below.
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
  deletes R2 `org/<org>/uploads/`, `audio/`, `jobs/`, `cache/summary/`, `cache/model/`, `runs/` (for demo org A also
  the same prefixes without `org/`, used before orgs). People (`users`) are never deleted: the reset upserts the seeded
  people and memberships and ends any other membership of the org. Row ids are not reset (`sqlite_sequence` is shared
  by all orgs). Step 6 rows and every extraction run the seed did not write (`seeded = 0`, with the fact and alert IDs
  it issued first) go through the trigger `demo_reset_uploads`, which also makes the seeded run of such a case current
  again (`docs/design/DATABASE.md`, "Extraction runs"); the runs' R2 objects are under `runs/`.
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
  `content_stored: false` in the answer) and nothing in R2. `UPLOAD_STORE_ORGS` (the team's switch, empty when deployed;
  set to `demo-b` to test on the team's synthetic files, never `demo-a`) keeps unknown PDFs and JPEG/PNG photos for the
  listed orgs; a photo is stored as it came (`.jpg`/`.png`, its own media type), and the pipeline converts it to a PDF
  first (`/v1/convert`). Office files and HEIC stay listed only. A repeat (same bytes or same name) answers 200 with the
  document already there. Files live under R2 `org/<org>/uploads/<case>/`, which reset-demo and the intake
  discard delete. Rules in `src/domain/documents.ts`; the fixture's patient (`fixture_patients`, D1 only) is compared
  with the case's patient and only the result (`matches`, `conflicts`, `cannot_verify`) leaves the server.
- Case merge: every document run ends by writing `fragment-pipeline.json` and starting `ProcessCaseWorkflow` (binding
  `PROCESS_CASE`), which composes the case's fragments into a stored run with producer `pipeline` (`store/case-merge.ts`,
  `packages/domain/src/fragments.ts`; step-6.md, "The case merge"). Only for orgs in `PIPELINE_ORGS`; a case with a
  fixture or NIS run is left alone. Its steps: compose (with stream E's case rules and composed views), brief (where the
  model runs, `MODEL_ORGS`), store (with the drafted question when the brief step ran). Workflow tests: the vitest binding sets `PIPELINE_ORGS` to `demo-b`.
- Withdraw: `POST /documents/:id/withdraw` (`wrong_patient`) takes a processed upload of another patient out of the case
  with migration 0013's lifecycle columns: a neutral row and its runs stay; file, outputs, pages, parts, name and hash go.
- Intake: `src/routes/intake.ts`, `src/store/intake.ts`, rules in `src/domain/intake.ts` and `packages/domain/src/fhir.ts`. An
  open intake (`cases.intake_open = 1`) is hidden from lists and the workflow, takes uploads only, and is 404 to anyone
  but its creator; the cron sweep removes it after 24 hours. Keep every new list or write route consistent with that
  rule (`caseFor`, `openCase`, `listCases`, `visibleCaseIds`).
- The attach reads `fixtures/<id>/prepared.json` (schema `codebridge.prepared/2`), written by `seed.py`
  `prepared_fixture()` from `fixtures/data/runs/NO-S02.json`. That run numbers pages across the combined PDF
  `S02_pacient.pdf` (parts `S02_pacient/p<k>`, the index in the fixture's `documents`); the seed re-points every
  source, check and alert at the uploaded file of that part, with the page inside the file (combined pages `[1, 2]` of
  the first document become pages 1 and 2 of its file, combined page 3 becomes page 1 of the next), and writes the
  uploaded documents' IDs as `@upload:<file name>` and their one part as `@upload-part:<file name>`. The seed stops
  when a reference cannot be mapped, a quote is not on its page, or the finished run would fail the validator (it
  finishes the run itself with stand-in IDs to check). On completion the Worker swaps in the uploaded documents' IDs
  and parts (`<document id>/p0`, the part row it inserts), derives the source IDs again, assigns the case's fact IDs
  through `matchInputs` and `prepareRun`, and stores the run with `storeRun` (`producer` fixture, `seeded` 0, under
  R2 `runs/`, so the demo reset removes it). An invalid or old prepared file answers 503 `seed_missing`.
- Reset: rows added by uploads, intakes and pipeline runs are removed by the trigger `demo_reset_uploads` (it fires on
- Reset: `document_alerts` (migration 0017) is emptied per org by its own trigger `demo_reset_document_alerts` on the
  same update.
  reset batch's `reset_in_progress = 1` update of that org, and deletes that org's rows only), so the reset batch stays
  at its size. A new table written by these routes goes into that trigger, not into the batch.
- Pipeline without an LLM: `src/workflows/process-document.ts` (binding `PROCESS_DOCUMENT`), `src/routes/pipeline.ts`,
  `src/services/page-reader.ts`. The page reader is `pipeline/container/server.py`; the Worker reaches it at `PAGE_READER_URL` or
  through the `PAGE_READER` container binding when `PAGE_READER_CONTAINER` is "on" (only the deploy commands set it);
  with neither the pipeline answers 503 `pipeline_off`. The class `PageReader` (`src/services/page-reader-container.ts`)
  lives in its own Worker `codebridge-page-reader` (`page-reader.wrangler.jsonc`, `src/page-reader-worker.ts`), which
  holds the `containers` entry (EU jurisdiction); this Worker binds it by `script_name`, so it keeps its preview alias.
  `PIPELINE_ORGS` lists the orgs the pipeline runs for (deployed: `demo-b`, so demo org A looks as before); `/api/me`
  reports it as `features.pipeline`. Instances are a pool of three named by case (`poolInstance`). The image is built
  only in CI: the `main` deploy job runs `wrangler deploy -c page-reader.wrangler.jsonc` before the D1 migration (the
  token needs "Containers: Edit"), and `.github/workflows/pipeline.yml` builds it on every change to `pipeline/` and runs
  pytest inside it. Never build it locally. Step results hold ids, counts and codes only (`test/pipeline.test.ts`). Runs are
  `pipeline_runs`, never the case's view. A kept upload starts a run at once (`autoStart` in
  `src/routes/pipeline-start.ts`) where the pipeline runs for the org; an open intake starts its runs when it ends.
- Local end to end with the real files:

  ```
  cd pipeline && uv run python container/server.py --port 8080      # the page reader (needs tesseract with ces)
  cd api && npm run seed:local && npx wrangler dev --port 8799 --var PAGE_READER_URL:http://localhost:8080 --var PIPELINE_ORGS:*
  node api/scripts/e2e-intake.mjs http://localhost:8799 --pipeline --reset
  ```
- Python tests of the pipeline: `cd pipeline && uv run pytest -q` (CI runs them inside the container image).

## Model interface (issue #20, stream D phase 1)

Every call that sends case content to an external model goes through `callModel` in `src/services/model.ts`; the
privacy side is in `docs/design/DATA-PROTECTION.md`, "Text sent to a model", and the gateway's measured behaviour in
`docs/research/2026-10-19-azure-gateway-check.md`.

- **Configuration:** `MODEL_PROVIDER` (`azure-openai` reads the `AZURE_OPENAI_KEY` secret, `openai-compatible` reads
  `MODEL_API_KEY`), `MODEL_BASE`, `MODEL_NAME`, `MODEL_REASONING_EFFORT`, timeouts, input caps and the `MODEL_BUDGET_*`
  values in `wrangler.jsonc`. No key: `model_off`. The summary route (`/api/summarize`) still uses its own
  `AZURE_OPENAI_*` vars.
- **Prompts** live in `src/prompts/`, registered by ID with a version in `src/prompts/index.ts`; bump the version on
  any change of text or schema. The prompt's SHA-256 is in the cache key and the call's metadata anyway.
- **Inside a Workflow step:** run the call under `MODEL_STEP` and rethrow `forStep(e)`, which makes a final error a
  `NonRetryableError` and leaves `busy`, `network` and `upstream_error` to the step's retries. The in-process retries
  (429 and 503, honouring `retry-after-ms` and `Retry-After`) stop at `MODEL_DEADLINE_MS`. Step results hold IDs,
  counts and codes only: write the model output to R2 inside the step and return its key, never the text, and never
  the pseudonymization mapping.
- **Identity:** `loadCaseIdentity` (`src/store/identity.ts`) reads the patient and the org's staff (every membership,
  also ended ones) inside the step. `callModel` pseudonymizes the text itself and refuses (`identifier_remains`) when
  any identifier is left in the payload, so callers never pass already pseudonymized text.
- **Images:** only `RedactedPage` objects from `redactPages` or `redactStoredPage` (`src/services/redaction.ts`),
  which call the page reader's `/v1/redact` with the case's name forms; `redactStoredPage` stores
  `p<n>.redacted.png` and `p<n>.redactions.json` next to the run's page.
- **Audit and budget:** one `model.call` access-log row per page (document and page, provider, model, purpose,
  prompt), written in one D1 batch with the budget guards and a `model_calls` row (migration 0014) before the first
  attempt; the attempts and outcome are then written to `model_calls`. A cache hit sends nothing and writes nothing.
  Reset-demo deletes `model_calls` (trigger `demo_reset_model_calls`) and the org's `cache/model/`.
  Answers sit under `cache/model/<case>/<document>/` (`<case>/multi-...` for several documents, `src/services/model-cache.ts`);
  `deleteDocumentObjects` (withdraw and its cron retry) deletes a document's folder and the case's `multi-` ones.
- **Cache lifecycle,** once per demo org (the same as `cache/summary/`):

  ```
  npx wrangler r2 bucket lifecycle add codebridge-mdt model-cache-30d-demo-a org/demo-a/cache/model/ --expire-days 30 -J eu -y
  ```
- **Tests:** `test/model.test.ts` (mocked model and page reader) and `test/pseudonymize.test.ts`; pytest
  `pipeline/tests/test_server.py` for `/v1/redact`.

## Fact extraction (issue #20, stream D phase 2)

The model answer and its checks are pure code in `src/domain/extract/`: `schema.ts` (the strict JSON schema the model
answers in), `build.ts` (quote found in the part, mapped back to the original page text and anchored; dates, codes,
numbers, negation, status and readability checked; identity quarantine; request-without-result alert; fact IDs through
`assignFactIds`), `identity.ts` (whose page is it), `dates.ts`. The prompt is `src/prompts/extract-facts-cs.ts`. The
request body comes from `src/services/model-payload.ts`, shared with `callModel`, so pseudonymization and the gate are
the same everywhere. No Workflow calls it yet.

- **Measure every prompt or check change** with the offline harness and the evaluation (synthetic data only):

  ```
  cd api && npm run extract:eval -- --out /tmp/runs-ai --dev-vars <path to a .dev.vars with AZURE_OPENAI_KEY>
  cd pipeline && uv run python eval.py --ai-runs /tmp/runs-ai
  ```
  With `--vision auto` (default) the harness reads every page not judged good, or without a text layer, with the vision model from its redacted image (`pipeline/harness_tools.py` runs the container's redaction and comparison locally; `/v1/compare` is the container's endpoint for the Workflow later); `--vision off` uses the text layer or Tesseract, `--stored-vision` the committed `p<n>.vision.md` (for S01, S02, S04 the sample's own source text). The harness calls the model page by page (`--whole` for one call per document) and caches answers in
  `api/.cache/extract/` (gitignored), keyed by prompt version, prompt hash and payload hash; `--cache-only` reruns the
  checks without a call. Results: `docs/research/2026-10-19-extraction-eval.md`.
- **The case steps after extraction.** `extract:eval` also applies the case rules (`applyCaseRules`). With `--brief` it
  also composes the views and the brief with the drafted question. The brief goes through prompt `compose-brief-cs`,
  cached like the extraction. The Worker's step is `src/domain/brief.ts` (`composeBrief`), and
  `src/store/runs.ts` `queueQuestionDraft` copies a drafted question onto the case row.

## ExtractDocumentWorkflow (issue #20)

`src/workflows/extract-document.ts`, binding `EXTRACT_DOCUMENT`. It is the AI part of a document after its pipeline run
and writes `<output_prefix>fragment-ai.json` for the case merge (contract: `docs/research/2026-10-20-case-merge-contract.md`).
- **Off by default:** `MODEL_ORGS` lists the orgs it runs for (`"*"` all, `""` none), and the model must be configured
  (`modelOn`). `startExtraction(env, {org, caseId, docId, runId})` is for the pipeline run's end to call (stream B wires it with ProcessCase; nothing calls it yet). It ends by
  starting `PROCESS_CASE` when that binding exists.
- **Steps:**
  - `plan`;
  - `read p<n>` for each page that needs vision (`domain/extract/plan.ts`): redact, model, `/v1/compare`, then
    `p<n>.vision.json`;
  - `extract <part>` for each part: model, then `ai-part-<ordinal>.json`, the pseudonymized answer;
  - `fragment`;
  - `case`.

  Each model step runs under `MODEL_STEP`. A refusal that waiting will not change (budget, content filter) leaves the
  page or part unread, and a busy provider is retried by the step. Step results hold IDs, counts and codes only.
- **The pseudonymization mapping is never stored:** the fragment step rebuilds it with `pseudonymizeParts` from the same
  texts.
- **Identity comes from the pipeline's `identity.json` per page,** not from the model's reading. It fails closed: no page
  is sent when `documents.identity` is `conflicts` or `identity.json` is missing, and a page the file does not list
  or lists as conflicting is not sent (the pseudonymization knows only the case's identifiers). Withheld pages are
  listed as unread; the pipeline's fragment keeps their facts quarantined.
- **A step whose retries run out** (busy endpoint, page reader down) leaves its page or part unread with code `busy`;
  the fragment is still written. A newer pipeline run of the document stops this one (`run_not_current`).
- **Tests:** `test/extract-document.test.ts`.

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
  `user_identities` and `auth_sessions` (migration 0012) hold the login (section "Login"). Every org table has `org_id NOT
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
  `AZURE_OPENAI_KEY`, `OIDC_CLIENT_SECRET`, `SESSION_KEY`, optionally
  `AI_GATEWAY_TOKEN`. Locally in `.dev.vars`.
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

## Login (AUTH.md steps 3 and 4)

Design and what was built: `docs/design/AUTH.md`, "How login works" and "As implemented (steps 3-4)". The Worker is an
OIDC client (OpenID Connect, the login protocol) of Zitadel Cloud in the EU region; the IdP (identity provider) only
proves who someone is, and orgs, memberships and roles stay in D1.

- **Modes.** `AUTH_MODE=oidc` in `wrangler.jsonc`, so production and the `backend` preview log in. `npm run dev`, the
  tests (`test/helpers.ts`, `vitest.config.ts`) and the browser suite (`e2e/run-parallel.mjs`) set `AUTH_MODE=demo`,
  the user picker without a login. Any other value answers 500 `misconfigured`.
- **Configuration.** Vars `OIDC_ISSUER` (`https://glide-mdt--dev-dybk0r.eu1.zitadel.cloud`) and `OIDC_CLIENT_ID`
  (`395716705399111846`, the web app of project "GLIDE MDT", CODE with PKCE). Secrets `OIDC_CLIENT_SECRET` (from the
  Zitadel app; in the team's password manager) and `SESSION_KEY` (32 random bytes, base64, the key of the
  login-transaction cookies; a new one only logs out logins in progress). Set them without printing them:
  `openssl rand -base64 32 | npx wrangler secret put SESSION_KEY`. Locally, `api/.dev.vars` holds both for
  `npm run dev:oidc` (`.dev.vars.example`); use your own `SESSION_KEY`.
- **Zitadel settings** (issue #15). Redirect URIs: `/auth/callback` on the production host, on the `backend` preview
  host and on `http://localhost:8787` (Zitadel takes no wildcards, so a new host needs its own entry); post-logout URIs:
  the same origins with a trailing `/`. Self-registration off. Development mode is on for localhost; before a hospital
  uses the instance, localhost moves to a separate development app. Turning on "User Info inside ID Token" for the app
  saves the Worker one userinfo call per login (`src/auth/oidc.ts`).
- **Demo accounts.** `node api/scripts/zitadel-demo-accounts.mjs` creates the eight accounts (`lekar1.a`, `lekar2.a`,
  `koordinator.a`, `admin.a` `@codebridge.demo`, and the same with `.b`) with verified e-mails through Zitadel's user
  API. It reads a service user's token from `~/.config/zitadel/glide-mdt.pat` (`ZITADEL_PAT_FILE`) and writes the
  passwords only to `~/.config/zitadel/glide-mdt-demo-accounts.txt` (`ZITADEL_ACCOUNTS_FILE`, mode 600), both outside
  the repository; move them to the password manager and delete the file. Existing accounts are skipped. The seed gives
  the matching people the same e-mails (`seed/seed.py`, `EMAILS`), and the first login links them. Never use these
  passwords in automated tests: the browser suite logs in at its mock IdP (`e2e/mock-oidc.mjs`).
- **Deploying the login.** The deployed hosts ask for a login from the moment `main` deploys, so before merging:
  register the redirect and post-logout addresses of both hosts in Zitadel (above); create the demo accounts and hand
  out their passwords (below the list, `zitadel-demo-accounts.mjs`); set `SESSION_KEY`; check with
  `npx wrangler secret list` that `OIDC_CLIENT_SECRET` is there, and if not, `npx wrangler secret put
  OIDC_CLIENT_SECRET` from the password manager. It also needs migration 0012 (`auth_sessions` with the membership
  acted as, `created_by_actor`) before the code runs; CI applies it on `main` right before the deploy ("Migrations in
  CI"; 0011 and 0012 go together when #14 and this merge at once, so follow "Migrating a deployed database" above).
  Then check by hand against the real Zitadel instance: `/api/health` shows `auth_mode: "oidc"`; the app at `/`
  goes to Zitadel's Czech login page; `admin.a` logs in and lands where it started; "Přepnout roli" to a doctor and
  back; Administrace shows "Ing. Kovář (jako MUDr. ...)"; "Odhlásit" ends at Zitadel and back on the login page; repeat
  on the `backend` preview host. The phone upload (`/u`) needs no login: its routes answer before the session check.
- **Logs.** Failed logins appear in Workers Logs as `{route, auth, reason}` with a short code (`no_person`,
  `no_membership`, `unverified_email`, `nonce`, `jwks`, `token_refused`); tokens, e-mails and subjects are never
  logged. Check that invocation logs do not record request headers: the session cookie is a bearer credential.
- **When the IdP is down,** discovery keeps serving its last copy (fresh for an hour, stale after that), but `jose`
  fetches the key set again after about ten minutes and the token endpoint is called every time, so a login that
  cannot reach them shows "Přihlašovací služba je nedostupná" (503) instead of starting again, so nobody is
  sent round a login loop. Sessions already running are not affected: the Worker calls the IdP only during a login and
  a logout.
- **Removing someone.** Ending the membership on the staff screen stops their session at the next request. Disabling
  the account in Zitadel takes effect at their next login (up to 12 hours; AUTH.md, "Session rules").

## AI Gateway (off)

Before setting `AI_GATEWAY_BASE`, check on a scratch gateway that (a) it
accepts the APIM host and the `/openai/v1/chat/completions` path, (b)
whether it retries 429 itself (then lower `LLM_MAX_ATTEMPTS`), and (c) its
logging is off.

## NIS over FHIR (issue #22, phase 1)

The NIS is the hospital information system; the Worker reads it over FHIR R4, never writes to it
(`docs/design/INTEGRATION.md`). Phase 1 finds the case's patient there and links one record; importing documents and
structured data comes next. Test server and test data: [`fhir/nis/README.md`](../fhir/nis/README.md).

- **Configuration.** The var `NIS_CONFIG` is a JSON object keyed by org id; `"{}"` (the default in `wrangler.jsonc`)
  means no org has a NIS, `/api/me` answers `nis: null`, and the page shows no "Import z NIS". An entry:
  `{"base_url": "https://...", "label_cs": "...", "auth": {...}, "mtls_binding": "NIS_MTLS"}`. `src/services/fhir.ts`
  (`nisConfig`) checks it and fails closed (500 `misconfigured`, logged with a fixed reason code, never the value):
  https only (plain http for `localhost`, `127.0.0.1` or a `.test` host), no credentials, query or fragment in the URL.
  Auth modes:
  - `{"mode": "backend_services", "token_url", "client_id", "scope", "key_secret", "alg": "RS384"|"ES384", "kid"?}`:
    SMART Backend Services, a client_credentials grant with a signed JWT assertion (five minutes, a new `jti` each
    time, sent once). The private key (PKCS#8 PEM) is a Worker secret whose name must start with `NIS_`
    (`npx wrangler secret put NIS_FNO_KEY`), so a typo cannot hand the login's or the LLM's key to the NIS. Tokens are
    cached per isolate, per org and client, until a minute before they expire; a 401 drops the cached token and the
    request goes once more with a new one. The NIS then sees the app, not the user, so our access log is the record of
    who pulled what (INTEGRATION.md).
  - `{"mode": "smart_user"}`: the user's own token from a SMART on FHIR launch. The launch is not built; a configured org
    answers 503 `nis_launch_missing`.
  - `{"mode": "none"}`: the local test server only; refused for any other host.
  - `mtls_binding` names a Workers mTLS certificate binding (`mtls_certificates` in `wrangler.jsonc`, added when FNO
    issues the certificate; the name must start with `NIS_`); its `fetch` then carries every NIS call. Not tested
    against a real binding.
- **Connector** (`src/services/fhir.ts`). Search is `POST <base>/Patient/_search` with a form body
  (`identifier=https://ncez.mzcr.cz/fhir/sid/rcis|<rc with slash>,...|<rc digits>`, both stored forms, `_count=50`) and
  `Prefer: handling=strict`, so a server that does not know the parameter refuses instead of answering with everyone.
  The birth number is never in a URL we send: a `next` link that carries it (some servers copy the search parameters
  into it) is not followed, nor is one outside the base URL (compared as parsed URLs, so `/fhir/../x` and `/fhirx` do
  not pass); paging stops at 5 pages or 50 records and the answer says `truncated`. Redirects are not followed (a 307
  would resend the body elsewhere); a 3xx is an upstream error. 429 and 503 back off (3 attempts, Retry-After
  honoured; `services/retry.ts`). Each request has at most 15 s, and one operation (token, search and its pages, or a
  read) 30 s in all. Logs: operation, upstream status, attempts, duration, counts; never a URL, body or token. Before
  each search and each read, the route's `onPull` writes an access-log row (`nis.search` "hledal(a) pacienta v NIS",
  `nis.read` "otevřel(a) záznam pacienta v NIS"; no patient text). It records the attempt, so it is written even if
  the NIS then fails; the pages and the token call of that operation have no rows of their own. If the row cannot be
  written, nothing is pulled.
- **Routes** (`src/routes/nis.ts`, action `nis.link`: doctors on the case's team or holding a break-the-glass grant,
  whose reason every row then names, and the coordinator; like uploads): `GET /cases/:id/nis` (the stored link, no NIS
  call), `POST /cases/:id/nis/search` (body `birth_number` only when the patient row has none; a typed number that
  differs from the row's is refused, and so is a row number that does not parse), `POST /cases/:id/nis/link`
  (`nis_patient_id`, and `confirm_unverified: true` when the row has no birth number or the name differs),
  `DELETE /cases/:id/nis/link` (works without a configured NIS, so a link can always be removed). `GET /cases/:id/nis/record?resource=<Type>/<id>` is the
  "záznam z NIS" source panel, a clinical read under the case's read rules (`openCase(..., "clinical")`: role, team,
  break-the-glass grant, `CLINICAL_ACCESS`). It reads one record of a type the import reads (`RECORD_TYPES`), only when
  the case's patient is linked (else 404 `nis_not_linked`), the cited system (`system`) is the configured NIS and the
  record is about the linked patient (else 404 `nis_record_not_found`, so the route cannot browse the NIS); a wrong
  type or ID answers 422 `invalid_input`. The access-log row (`nis.view`) names the record. It answers the record's
  own fields (`packages/domain/src/nis-record.ts`) and the record without `contained` and `text`. Search answers only
  the records that carry the searched birth number; any other record the NIS sent is counted in `other_records_hidden`
  and never shown. Link reads the Patient again from the NIS and refuses a different birth number, an inactive record
  and one the NIS merged into another (`Patient.link` `replaced-by`; the answer names the survivor). Candidates carry
  name, birth date, gender, NIS id, version and the match results (`packages/domain/src/nis.ts`), never the birth
  number. The answers include the national register as a visible stub (`national_register.status: "stub"`).
- **Table** `patient_nis_links` (migration 0015): one link per patient row and one patient row per
  NIS record in an org, with who linked it, when, the NIS base URL and version, and `identity_check` (`matches`,
  `matches_name_differs` or `cannot_verify`; the last two only after the person confirmed). It is its own table
  because the app never changes a seeded patient row; the trigger `demo_reset_nis_links` removes an org's links on
  reset-demo.
- **Record pull** (phase 2, `patientRecord`): the clinical record of a linked patient, one GET search per resource type
  (`Condition`, `Observation`, `Procedure`, `MedicationStatement`, `ServiceRequest`, `DiagnosticReport`, `Encounter`,
  `DocumentReference`) by the NIS patient ID, with `_lastUpdated=ge<instant>` (the newest `meta.lastUpdated` seen) to
  ask what changed; up to 40 pages and 2000 records per type, a truncated type is reported, 120 s per pull. Records
  that are not about this patient are dropped and counted (`foreign`), duplicates once. One access-log row per pull
  ("načítal(a) zdravotní záznam pacienta z NIS"), written by the caller's `onPull`; the import route below calls it.
  `packages/domain/src/nis-map.ts` turns the resources into a codebridge.extraction/2 run with producer `nis`
  (EXTRACTION-FORMAT.md, "The NIS producer"); the case merge stores it (next item).
- **Import into the case run** (phase 2b): `POST /cases/:id/nis/import` (action `nis.link`; orgs in `PIPELINE_ORGS`
  only, else 409 `nis_merge_off`; not on a closed or approved case, 409 `case_locked`) maps the linked patient's record
  into the case's NIS import, one R2 object holding the fragment and its state (`org/<org>/nis/<case>/import.json`,
  `src/store/nis.ts`), and starts ProcessCase, which composes it with the documents (`src/store/case-merge.ts`;
  docs/research/2026-10-20-case-merge-contract.md, "The NIS fragment"). Called again it refreshes (it pulls everything
  only when the NIS shows an unread record version, a pull was cut off, or the last full pull is a day old) and always
  starts the merge. Unlinking deletes the import of every case of the patient and recomposes each; until then
  `GET /cases/:id/extraction` already leaves out NIS facts of a patient no longer linked to their record
  (`withoutNis`). A merge that leaves an import out logs `nis_excluded` with a code. reset-demo deletes `nis/` with the
  org's other transient objects. The Workflows see org B's test NIS through `api/vitest.config.ts`; routes take theirs
  from `testEnv`.
- **Tests.** `test/nis.test.ts` runs the connector and the routes against `fhir/nis/memory-server.ts` loaded with the
  test Bundles (no PDF bytes); `test/nis-map.test.ts` pulls S01, S02, case 10 and F01-F04 and checks the runs, with
  S01's and S02's lab values against their prepared fixtures; `test/nis-merge.test.ts` imports, refreshes and unlinks through the case merge; `test/orgs.test.ts` probes the NIS
  routes from org B.
