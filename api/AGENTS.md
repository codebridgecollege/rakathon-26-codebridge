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
npm test                         # Vitest in workerd; outbound fetch is mocked, no real calls
npm run types                    # after any wrangler.jsonc change; CI fails on a stale file
```

CI (`.github/workflows/deploy-worker.yml`) deploys `main` to production and
`backend` to the `backend` preview alias. A manual deploy is `npm run deploy`.

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
