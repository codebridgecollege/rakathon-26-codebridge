# API Worker (`api/`)

A Cloudflare Worker named `codebridge-mdt` (a Worker is a script on
Cloudflare's runtime). It serves the built mock v3 as static files and the
API under `/api`. Design: `docs/research/backend-steps/step-0-1.md`,
section "Issue: Step 1".

## Run, test, deploy

```
npm ci
cp .dev.vars.example .dev.vars   # local keys, gitignored; agents never read it
npm run dev                      # stage-assets.sh copies mocks/ into .assets, then wrangler dev
npm run typecheck
npm test                         # Vitest in workerd with local D1/R2 and the migrations; outbound fetch is mocked
npm run types                    # after any wrangler.jsonc change; CI fails on a stale file
```

CI (`.github/workflows/deploy-worker.yml`) deploys `main` to production and
`backend` to the `backend` preview alias. A manual deploy is `npm run deploy`.

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
  (`src/domain/access.ts`) and write an `access_log` row before reading the content
  (`src/middleware/audit.ts`); a failed insert answers 500 with no content.
- `DATA_API` (`on`/`off`) switches the data API and `/api/health`'s `features.data`.
  `CLINICAL_ACCESS` is `all_roles` (demo default: every role reads clinical content)
  or `doctors_only` (INTEGRATION.md); open question in `docs/agent/OPEN_QUESTIONS.md`.
- Demo mode takes the user from `X-Demo-User: <staff id>` or the `cb_demo_user` cookie
  (page images cannot send a header); default `d2p1`. Access mode maps the verified
  e-mail to `users.email`.
- D1 limits: GLOB/LIKE patterns at most 50 bytes, 100 KB per SQL statement, and an
  unused bound value is an error.

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
- The rate limiter namespace ids (26101 to 26103) must stay unique in the account.

## Access runbook (when the team switches on login)

1. In Zero Trust, protect `codebridge-mdt.<subdomain>.workers.dev` and the
   preview URLs (`*-codebridge-mdt.<subdomain>.workers.dev`): the Workers
   settings "Cloudflare Access" toggle, or a self-hosted application.
2. Policy: team e-mails, mentors and jury, by one-time PIN or GitHub.
3. Copy the application's AUD tag.
4. In `wrangler.jsonc` set `ACCESS_TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`),
   `ACCESS_AUD`, `AUTH_MODE=access`, and `assets.run_worker_first: true`
   (so the Worker checks every request, not only `/api`). Run `npm run types`.
5. Redeploy, then check that both the production and the preview URL ask
   for login and that `/api/health` shows `auth_mode: "access"`.
6. Check in Workers Logs that invocation logs do not record request
   headers; the `Cf-Access-Jwt-Assertion` header is a bearer credential
   that carries the user's e-mail.

Access service tokens carry no e-mail and are refused (401); the app has
no machine clients. If the team's key set cannot be fetched, the API
answers 503 `upstream_busy` instead of 401, so users are not sent into a
login loop by our outage.

## AI Gateway (off)

Before setting `AI_GATEWAY_BASE`, check on a scratch gateway that (a) it
accepts the APIM host and the `/openai/v1/chat/completions` path, (b)
whether it retries 429 itself (then lower `LLM_MAX_ATTEMPTS`), and (c) its
logging is off.
