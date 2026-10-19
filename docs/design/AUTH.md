# Login, organizations and users

Status: steps 1 and 2 (organizations, people and memberships, org
scoping, the per-org demo reset) are built, 2026-10-19; see "As
implemented (steps 1-2)". Steps 3 and 4 (the login in the Worker and the
frontend) are built on branch `auth-login`, 2026-10-19; see "As
implemented (steps 3-4)" at the end. Of step 5, the Zitadel instance, the
web app and the demo accounts exist (GitHub issue #15); the manual check
against the real instance is still to do.

Before the login, the demo picked a user from a list, and all data
belonged to one shared demo. For the MVP the app needs:
- real accounts, with identity data stored in the EU;
- a few demo accounts;
- organizations (hospitals), each with its own users and its own data.

Later, each hospital plugs in its own identity provider. The pilot design
is in `INTEGRATION.md`; this document is the cloud MVP that leads there.

Terms used below:
- **IdP** (identity provider): the service that logs people in and tells the app who they are.
- **OIDC**: OpenID Connect, the standard login protocol between the IdP and the app.
- **Organization (org)**: a hospital or other customer; every patient, case and document belongs to exactly one.
- **Person**: a human known to the app (`users`).
- **Membership**: a person's role, function and department in one org. A membership without a login is a staff entry (someone listed for attendance only).

## Summary

1. **IdP: Zitadel Cloud in its EU region** (recommended), with self-hosted
   Keycloak on an EU server as the fallback.
2. **The Worker is the OIDC client.** It runs the standard login flow,
   keeps nothing but the session on the server, and gives the browser only
   a session cookie. Switching to a hospital's own IdP later is
   configuration, not new code.
3. **Our database is the source of truth for orgs, memberships and roles.**
   The IdP only proves who someone is. One person can belong to several
   orgs with different roles.
4. **Shared tables with an `org_id` on every row that holds org data.**
   The database itself refuses cross-org references (composite foreign
   keys), and tests sign in as one org and try another's IDs.
5. **Demo:**
   - two demo orgs: "Ukázková nemocnice A" (today's data) and "Ukázková nemocnice B" (no patient data: its departments and people only, for the team's own test data);
   - after one real login, a demo org keeps a role switcher, so the presenter changes roles without logging in again.
6. **The user picker remains for local development and the browser test
   suite** (`AUTH_MODE=demo`). One browser spec runs the real login flow
   against a mock IdP.

## Choosing the IdP

Compared on 2026-10-18 from the vendors' public pages. Points not
confirmed there are marked "to verify". The research covered WorkOS,
Auth0, Microsoft Entra External ID, Clerk, Zitadel, Ory, Logto, Kinde,
Keycloak, Authentik, Stytch, FusionAuth and Cloudflare Access.

| | Zitadel Cloud (EU) | Keycloak, self-hosted | Auth0 (EU tenant) | WorkOS |
|---|---|---|---|---|
| Where identity data lives | EU region chosen at creation; contract with CAOS AG (Swiss law); runs on Google Cloud | Our EU server and database | EU locality chosen at creation; US company | US only; no EU region |
| A hospital's own IdP later | Per-org Entra ID, OIDC or SAML connections | Brokering to Entra ID, ADFS, Keycloak | Per-org enterprise connections | Admin portal for the hospital's IT |
| Price for the MVP | Free: unlimited users, 100 daily active users, 3 IdP connections; Pro $100 a month (to verify) | Server and database, about €10-30 a month, plus running it | Free: 5 orgs, 1 enterprise connection; B2B from $150 a month | Free AuthKit; SSO $125 per connection a month |
| Certifications | ISO 27001, SOC 2 Type II | ours to manage | ISO 27001/27017/27018, SOC 2 | SOC 2 |
| Lock-in | Low: open source, can move to self-hosted at a hospital | None | Medium | Medium |

**Why Zitadel:**
- **EU storage with a European contracting party.**
- **Free for an MVP.**
- **Can later broker a hospital's own IdP.**
- **Open source,** so the same software can run inside a hospital.

**Why not WorkOS,** despite Juro's experience with it: it has no EU
region. If its `identity-workos` adapter is ever reused here, it is
declared as pre-existing code in `docs/agent/HACKATHON.md`.

**Zitadel caveats:**
- **US cloud underneath.** Its infrastructure is Google Cloud (a US-parent sub-processor), so US access laws still reach it.
- **The free tier allows 100 daily active users.**
- **Login page languages:** Czech is available (`ui_locales=cs`), Slovak is not; a Slovak user gets the Czech page. The exact free-tier and Pro limits are still to verify.

The identity store holds only name, e-mail and login data, never health
data, which keeps the risk small.

**Only one Zitadel org in the MVP.** The demo accounts live in one Zitadel
organization; our D1 database holds the orgs and memberships. A hospital
gets its own Zitadel org only when it connects its own IdP, so the MVP
has one admin console for identities, not two for orgs.

**Fallback.** Keycloak on a small EU server, not a Cloudflare Container,
which has no EU placement guarantee and no persistent disk.

## How login works

1. **Routing.** The Worker handles `/auth/*` itself (added to `run_worker_first`, next to `/api/*`). The app's static files stay public: they hold no data.
2. **`GET /auth/login?to=<path>`:**
   - It creates a login transaction (state, nonce, PKCE verifier, the return path) in an encrypted, short-lived cookie named after the state, so two tabs logging in at once do not overwrite each other.
   - The return path is accepted only if it starts with `/` followed by a character other than `/` or `\`. Anything else becomes `/`, which prevents open redirects.
   - It redirects to the IdP: code flow, PKCE with S256 only, query response mode (a cross-site form post would drop SameSite=Lax cookies).
3. **Login at the IdP.** Self-registration is off; only provisioned accounts can log in.
4. **`GET /auth/callback`:**
   - It reads and deletes the transaction cookie (one use), checks the state, exchanges the code as a confidential client, and verifies the ID token with `jose`: issuer, audience, nonce, expiry and `email_verified`.
   - The key cache, the "IdP keys unreachable gives 503" behaviour and the 30 s clock tolerance come from `api/src/auth/jwks.ts`.
   - A failed callback shows a fixed page with "Zkusit znovu" instead of redirecting again, so it cannot loop.
5. **Linking the person, never auto-creating one:**
   - The first login links issuer and subject to the provisioned person with the same verified e-mail.
   - Later logins use issuer and subject.
   - A login with no person or no active membership shows a fixed "Nemáte přístup" page. Nothing is created.
6. **Session:**
   - A new session ID is issued at every login (no session fixation). It is stored in D1 only as a hash, with the person, the active org, and the acting membership.
   - The browser gets `__Host-cb_session`: HttpOnly, Secure, SameSite=Lax, path `/`, no domain.
   - No IdP access or refresh tokens are kept, and outside the login and the logout the Worker calls no IdP API. The ID token is kept only as long as the logout hint needs it.
7. **`POST /auth/logout`:** covered by the existing same-origin check. It deletes the session and redirects to the IdP's end-session endpoint with `id_token_hint` and a registered post-logout address.

**Session rules:**
- **Lifetime:**
  - a session ends after 12 hours at most;
  - in a hospital org it ends after 1 hour without use;
  - in a demo org it lasts the full 12 hours, so a laptop left open before a talk still works.
- **Last-used time** is written at most every 5 minutes.
- **Removed access:** a membership deactivated in the app takes effect at the next request. An account disabled at the IdP takes effect at the next login. Re-checking with the IdP within minutes, as `INTEGRATION.md` asks for a pilot, is a later step with refresh tokens.
- **Each host registers its own addresses.** Zitadel takes no wildcards, so the production host and the preview host (`backend-codebridge-mdt...`) each register a callback and a post-logout address.

**Cross-site requests.** SameSite=Lax still sends the cookie on a
top-level GET from another site. GETs that write audit rows (`case.open`
and the source views) therefore also require the request to come from
our page (the `Sec-Fetch-Site` header, as the existing same-origin
check reads it). Otherwise another site could create fake access-log
entries.

## Organizations and roles

- **One active org per session.** A person with one membership lands in it. A person with several picks one, and can switch in the account menu (`POST /api/session/org`, which issues a new session ID).
- **Role switching in demo orgs.**
  - After one real login, the account menu of a demo org offers "Přepnout roli": a list of that org's demo memberships (doctor 1, doctor 2, coordinator, administrator).
  - A switch changes the acting membership in the session. Every access-log row then records the real person and the membership acted as (`impersonating = 1`; the column exists and is always 0 today).
  - The switch runs today's switch protocol (`session.ts`): unsaved drafts are saved, and the recording stops.
  - Hospital orgs have no role switcher.
- **Losing the session mid-work.** A 401 while something is unsaved (a draft, a running recording) does not navigate away. A "Přihlášení vypršelo" dialog opens the login in a new window; after it, the page retries the save. With nothing unsaved, the page goes to `/auth/login?to=<current path>`.
- **Roles:**
  - `doctor`, `coordinator` and `admin`, as the database calls them today;
  - `staff` for a membership with no login.
  
  Roles stay ours. A hospital IdP's role or group claims can be mapped onto memberships later, as `INTEGRATION.md` describes for Entra app roles.

## Data model

**People and memberships:**
- **`users`** stays the person: name, title fields, e-mail (already unique), active. Role, function, department and per-org active move out of it into `memberships`.
- **`memberships`:** org, person, role, function, department, active from/until. A person without an identity is a staff entry.
- **`user_identities`:** issuer + subject for a person. There can be two during a move from one IdP to another.
- **`auth_sessions`:** session hash, person, active org, acting membership, ID token for logout, created, last used, expires.
- **`orgs`:** id, name, short name, demo flag, session idle limit; later the org's own IdP settings.

**`org_id` on every table that holds org data,** with no default value:
- **Staff:** departments (names unique per org), department members, memberships.
- **Patients and cases:** patients, cases, case members, case access grants (break-the-glass), status history, slots, sessions, attendance and attendance sets.
- **The MDT record:** protocols, decisions, tasks and drafted tasks, question confirmations, fact edits and the edit log, alerts and alert events.
- **Documents:** documents, document parts, pages, extraction and pipeline runs.
- **Recording:** recordings, transcript lines, passes and summaries; audio uploads, parts and segments.
- **Jobs and plumbing:** jobs, upload sessions, notifications, idempotency keys, write guards, demo state.
- **Audit:** the access log.

**Cross-org references are refused by the database, where a foreign key exists.**
- Every reference from an org table carries the org: `(org_id, case_id) REFERENCES cases(org_id, id)`, backed by a unique key `(org_id, id)` on the parent. References to people go through `memberships(org_id, user_id)`.
- Unique keys start with `org_id` (slots, seminar days, idempotency keys, document hashes, department names).
- D1 has no row-level security, so this is the database-level guarantee. The columns without a foreign key are listed in [`DATABASE.md`](DATABASE.md); for those, the store functions and the isolation tests are the guard.

**IDs:**
- Internal IDs are unique across all orgs.
- The case number a person sees (`NO-010`) counts per org. Today the next number is the highest number across all data, which would collide between orgs and reveal whether another org's case exists.

**Global data, named as such** (no `org_id`):
- the synthetic fixtures used by the demo (`fixture_files`, `fixture_patients`, `seed_meta`);
- R2 `guidance/` and `fixtures/`.

**Files:**
- Org files move under `org/<org_id>/…` in R2: documents, uploads, audio, page images and the audit archive.
- R2 keys that are already stored in D1 rows, including append-only ones, keep their old value. A one-off copy keeps the old keys readable until every row points at a new key.

**The migration:**
- Each org table is rebuilt so that `org_id` has no default; a default would quietly put forgotten rows into demo org A. Today's data goes to demo org A.
- `access_log.auth_mode` gains `'oidc'`. The table is append-only, so it is rebuilt with its triggers.

**Retention:**
- Sessions are deleted 30 days after they expire.
- Identities are deleted with the person's last membership, after the access-log retention FNO sets.

## Keeping orgs apart

- **The org reaches every query.**
  - Routes get the org from the session.
  - Workflows and the cron job get it explicitly in their parameters, since they run without a session.
  - Raw SQL in routes and workflows (about 110 statements today) moves behind store functions that take the org first.
- **Records from another org look missing:** they answer 404, the same as an unknown ID, never a 403 that confirms the record exists.
- **The real proof is the isolation test suite:**
  - for every route, a test signs in as org B and uses org A's IDs, and every answer must be 404 or empty, with nothing in org A changed;
  - a helper flags store SQL without `org_id` as a reminder, but it is not the guarantee: joins and subqueries escape it.
- **Specific places to scope:**
  - idempotency keys are looked up by org, user and key, so a person in two orgs cannot replay org A's answer in org B;
  - break-the-glass checks (case membership, grants) filter by org, and the reviewer is per org;
  - phone upload takes the creator's role from the membership in the upload session's org, not from a global role.
- **Demo reset is per org:**
  - `demo_state` gets one row per org, and so does the data epoch, so a reset in org A never reloads a demo running in org B;
  - every delete and trigger in the reset is scoped by org;
  - people and identities are never deleted;
  - the access log is archived to `org/<id>/audit-archive/`.
- **The browser suite** gets a cross-org spec: an org B doctor sees none of org A's patients, cases, tasks or calendar.

## Separate tables, databases or shared tables

Three patterns are in use:

1. **Shared tables with an `org_id` on every row.** The most common
   pattern in SaaS, healthcare SaaS included. It is acceptable under GDPR
   provided the separation is enforced reliably and tested. Postgres can
   enforce it with row-level security. D1 (SQLite) cannot, so we use
   composite foreign keys, org-first store functions and isolation tests.
2. **A schema or database per org.**
   - **Benefits:** stronger isolation, its own backups and restores, deleting a whole customer at contract end, a key or region per customer. Hospitals sometimes ask for this in contracts.
   - **Costs:** a migration runs on every database, and every request is routed to the right one.
3. **A separate deployment per hospital.** Usual for hospital systems in
   the Czech Republic and Slovakia, and what the pilot design assumes
   (CodeBridge on FNO's own servers).

**For the cloud MVP: shared tables.** One D1 database per org is easy to
create on Cloudflare, but a Worker's database bindings are fixed in its
configuration, so each new org would need a configuration change and a
redeploy. With every query behind org-first store functions, a hospital
that demands physical separation can later get its own database or its
own deployment without rewriting the app.

## The frontend

- **Account menu.** In login mode, the header's user picker becomes an account menu: name, org, role, org switch (if several), "Přepnout roli" (demo orgs) and "Odhlásit".
- **Demo mode** keeps today's picker, grouped by org, so local development and the browser suite can act in both demo orgs.
- **Strings** go into the Fluent catalogs (cs, sk, en).

## Demo accounts

- **Zitadel:**
  - one project ("GLIDE MDT") and one confidential web app (the Worker), with the production and preview callback addresses;
  - self-registration off;
  - for each demo org: two doctors, a coordinator and an administrator, with verified e-mails such as `lekar1.a@…`.
- **Passwords** are never in the repository; they go to the team through a password manager.
- **The seed** creates the matching people and memberships in D1 with the same e-mails. The first login links them.
- **Presenters** log in once as the demo org's administrator or a doctor, then switch roles from the account menu.

## Configuration and secrets

| Name | Kind | What |
|---|---|---|
| `AUTH_MODE` | variable | `demo` (picker; local and tests) or `oidc` (deployed) |
| `OIDC_ISSUER` | variable | The Zitadel instance URL (EU region) |
| `OIDC_CLIENT_ID` | variable | The web app's client ID |
| `OIDC_CLIENT_SECRET` | secret | Wrangler secret, never in the repository |
| `SESSION_KEY` | secret | Encrypts the login-transaction cookies |

The `access` mode (Cloudflare Access) and its runbook are removed; the
login runbook in `api/AGENTS.md` replaces it.

## Privacy

- **The IdP holds name, e-mail and login data only.** Orgs, memberships, roles and everything clinical stay in our EU D1 database.
- **Records to update:** the DPA with CAOS AG (Zitadel), the EU region and its sub-processors go into [`DATA-PROTECTION.md`](DATA-PROTECTION.md), with the tool in [`TECHNOLOGIES.md`](TECHNOLOGIES.md) and `docs/agent/HACKATHON.md`.
- **Session IDs** are stored only as hashes. Logs keep the person's ID, never the e-mail.

## Tests

- **Login flow (Vitest in the Worker):** a fake IdP with generated keys covers:
  - success and linking by verified e-mail;
  - a wrong issuer, audience or nonce, and an expired token;
  - an unverified e-mail, and a replayed code or state;
  - two parallel logins and an open-redirect attempt;
  - no person or no membership;
  - session expiry, logout, the org switch and the role switch.
- **Isolation tests** for every route, as above.
- **Browser suite:**
  - most specs in demo mode;
  - the cross-org spec;
  - one spec that runs the real login, return path and logout against a mock OIDC server started with the local Workers, so the OIDC path also runs in CI.
- **One manual check** against the real Zitadel instance after setup.

## Steps

| Step | What | Effort |
|---|---|---|
| 1 | Orgs, people and memberships split; `org_id` on every org table (rebuilt, no default, composite foreign keys); per-org case numbers; raw SQL behind org-first store functions; R2 keys under the org; isolation tests | 4-6 days |
| 2 | Per-org demo reset: `demo_state` and epoch per org, scoped deletes and triggers, per-org audit archive | 1 day |
| 3 | OIDC login in the Worker: `/auth/*`, transaction cookies, callback, linking, sessions, logout, `/api/me` with memberships, org and role switch; Vitest with a fake IdP | 1.5-2 days |
| 4 | Frontend: account menu, role switcher, session-expired dialog, login redirect; mock OIDC spec and cross-org spec in the browser suite | 1-1.5 days |
| 5 | Zitadel: EU instance, project, web app, demo accounts; secrets in the Worker; seed with two demo orgs; docs (CLAUDE.md, INTEGRATION.md, DATA-PROTECTION, TECHNOLOGIES, HACKATHON, api/AGENTS.md) | 1 day (needs Juro's Zitadel account) |

## Decisions (2026-10-18)

- **IdP: Zitadel Cloud in its EU region.** Keycloak self-hosted stays the fallback.
- **Juro creates the Zitadel account** and gives the team the issuer, client ID and client secret (the secret only as a Wrangler secret).
- **Two demo orgs:** "Ukázková nemocnice A" and "Ukázková nemocnice B".
- **Session lifetimes:** 12 hours at most; 1 hour idle in hospital orgs, the full 12 hours in demo orgs.
- **Shared tables for the MVP,** with the upgrade paths in [`DATABASE.md`](DATABASE.md).

## As implemented (steps 1-2)

Built 2026-10-19 on branch `auth-orgs`. The runbook is in `api/AGENTS.md`,
section "Organizations".

**What exists:**
- **Migration 0011** creates `orgs`, `memberships`, `user_identities` and
  `auth_sessions` (the last two unused until step 3), rebuilds every org
  table with `org_id NOT NULL` and no default, composite foreign keys
  `(org_id, x_id)`, references to people through `memberships(org_id,
  user_id)`, unique keys that start with `org_id` wherever orgs could share
  a value (keys on IDs that are unique across orgs, such as a decision's
  version per case, stay as they were), and re-creates the
  append-only and demo-reset triggers scoped to the row's org. Today's
  data goes to demo org A (`demo-a`). `access_log.auth_mode` accepts
  `'oidc'`, and a new column `acted_as_membership` names the membership
  acted as.
- **Two demo orgs** in the seed: "Ukázková nemocnice A" (`demo-a`, the
  hackathon demo) and "Ukázková nemocnice B" (`demo-b`). Org B holds no
  patient data (user decision 2026-10-19): the seed gives it only its two
  departments and four people with their memberships, and its demo reset
  returns it to that empty setup. The team puts its own test data there;
  a patient created in org B stays in org B. Each org has two doctors with
  e-mails, a coordinator and an administrator (`lekar1.a@codebridge.demo`,
  `lekar2.a@...`, `koordinator.a@...`, `admin.a@...`, and the same with
  `.b`); org A keeps its other ten demo doctors. `seed/reset.json` has a
  section per org, and `seed.py` stops if a clinical or case row, or an R2
  object, is seeded into org B.
- **The org reaches every query.** SQL names the org as `?org`, bound by
  one function (`orgStmt`, `src/store/sql.ts`) that the org-bound stores,
  the write batch (`Tx`) and the route helper `orgQuery` use. Routes take
  the org from the viewer's membership, workflows from their parameters,
  the cron job loops over the orgs. A record of another org answers as if
  it did not exist (404, or the route's own "not found" refusal).
- **Scoped places:** idempotency keys by org, person and key;
  break-the-glass and team checks by org; the phone upload acts with the
  membership of the upload session's org; the duplicate birth-number
  check, the slot calendar and seminar days are per org; case numbers
  count per org.
- **Per-org demo reset:** scoped deletes and triggers, the org's own data
  epoch, an archive under `org/<id>/audit-archive/`, people never
  deleted.
- **R2:** new org files go under `org/<org_id>/` (documents, uploads,
  audio, page images, extraction outputs, summary cache, the audit
  archive); keys already stored keep working.
- **API:** `/api/me` returns the person, the acting membership, all of the
  person's memberships, the active org and its data epoch;
  `/api/demo/memberships` (demo mode only) lists the picker's entries by
  org; the picker shows one group per org.
- **Tests:** isolation tests for every route (`api/test/orgs.test.ts`), a
  migration test on the pre-org schema, a reminder test that flags SQL
  without `org_id`, per-org reset tests, a look-alike org B in the shared
  test fixture (a test-only case, since the seeded org B is empty), and
  the browser suite's `specs/orgs.spec.ts` (every screen of the empty org
  B, none of org A in it, and a patient created there staying there).

**Deviations from this design:**
- **Write SQL stays in the route handlers.** Reads moved behind the
  org-bound stores or `orgQuery`, and every write statement runs through
  `Tx`, which is bound to the viewer's org; the statements themselves were
  not moved into one named store function each. The single binding
  function and the scan test take the place of that move; a store rewrite
  for another database (DATABASE.md, upgrade paths) would move them.
- **No `department` column on memberships.** A person's departments in an
  org stay in `dept_members` (now per org and referencing the
  membership), because one person can sit in several departments, with an
  order on the staff screen.
- **Activity.** A membership is active while `active_until` is empty; the
  staff screen's "remove" ends the membership instead of deactivating the
  person, so a person removed in one org still acts in another.
  `active_from` is recorded but not enforced, and an end date in the future
  is not supported yet.
- **Case IDs.** The internal ID is the org's prefix plus the case number
  (no prefix in demo org A, so its IDs are unchanged; `B-` in org B), and
  `cases.case_no` holds the per-org number. The app still shows the
  internal ID, so a case created in org B reads `B-NO-100`; showing
  `case_no` belongs to the frontend step.
- **Names are the person's.** Renaming someone on one org's staff screen
  would rename them in every org they belong to, and the name check sees
  only the acting org; their function is per org. Nothing can give a
  person a second membership yet (every writer uses the person's id as the
  membership id), so this and "acts in another org" below only apply once
  step 3 provisions memberships; fix the rename then (check names across
  the person's orgs, or keep the name per membership).
- **The data epoch on `/api/health`** is the picked demo user's org (demo
  mode) or demo org A, since that route answers before any login; the app
  takes the epoch of its own org from `/api/me` and every answer.
- **Reset details.** Row IDs are not reset (`sqlite_sequence` is shared by
  all orgs), a membership added after the seed is ended rather than
  deleted (so a login session acting with it would stay valid), and
  `seed.py --reset` upserts people, orgs and their demo state instead of
  deleting them.
- **Workflows started before the deploy** carry no org; they mean demo org
  A, which held all data at the time.
- **The upload session's token hash** stays a key across orgs: the phone
  is not logged in, so the token picks the session and the session names
  its org.
- **The access log's `org_id`** has no foreign key, like its other IDs: the
  audit must outlive the rows it names.
- **Known leak: shared counters.** Task, drafted-task and edit-log IDs are
  AUTOINCREMENT numbers shared by all orgs and reach the browser, so a user
  who writes twice can count another org's writes in between. Opaque or
  per-org IDs would close it.
- **Guideline and prognosis data** stay global R2 keys by case ID
  (`guidance/`, `prognosis/`): the case ID is unique across orgs and the
  case is opened (with its org check) before they are read.
- **Deploying needs a watched merge.** CI applies the D1 migrations on
  `main` right before the deploy (`api/AGENTS.md`, "Migrations in CI"),
  but old and new code do not run on each other's schema, so merging needs
  the steps in `api/AGENTS.md` ("Migrating a deployed database"): nothing
  queued before, the reseed after.

## As implemented (steps 3-4)

Built 2026-10-19 on branch `auth-login` (draft PR #16, stacked on #14).
The runbook is in `api/AGENTS.md`, section "Login".

**The Worker (step 3):**
- **Configuration.** `wrangler.jsonc` sets `AUTH_MODE=oidc` (production
  and the `backend` preview deploy from it), `OIDC_ISSUER` (the Zitadel
  instance) and `OIDC_CLIENT_ID`; `OIDC_CLIENT_SECRET` and `SESSION_KEY`
  are Worker secrets. `npm run dev`, the Vitest suite and the browser
  suite pass `AUTH_MODE=demo`; `npm run dev:oidc` runs the login locally
  with the secrets from `api/.dev.vars`. A missing secret or a malformed
  issuer fails closed (the login pages say "Přihlášení není nastavené").
  `run_worker_first` lists `/api/*` and `/auth/*`.
- **Routes.** `GET /auth/login?to=`, `GET /auth/callback` and
  `POST /auth/logout` (`src/routes/auth.ts`), on a Hono app of their own
  beside `/api`. `src/auth/oidc.ts` holds discovery (cached an hour per
  isolate, a stale copy serves while the IdP is down, every endpoint must
  be on the issuer's origin, S256 must be announced), the authorization
  URL (code flow, S256, `response_mode=query`, scopes `openid email`,
  `ui_locales` cs or en, `prompt=login` on request), the code exchange
  with `client_secret_basic`, and the ID token check with `jose` (RS256
  only, issuer from discovery, audience, `azp` when several audiences,
  nonce, `exp`/`iat`/`sub`/`nonce` required, 30 s tolerance) on the key-set
  cache of `src/auth/jwks.ts`.
- **Transactions** (`src/auth/session.ts`): state, nonce and verifier are
  32 random bytes each; the transaction is a JWE (`dir`, A256GCM with
  `SESSION_KEY`, 10 minutes) in `__Host-cb_tx_<state>`, opened only for
  the state in the query and deleted by every callback answer;
  `/auth/login` clears abandoned ones once five have piled up. The return
  path rule above, plus printable ASCII only and no backslash, at
  most 2000 characters, and nothing under `/auth`.
- **Linking.** Issuer and subject first; otherwise the provisioned person
  whose `users.email` matches the verified e-mail case-insensitively,
  unless that person is already linked to another subject of the same
  issuer. A login needs `email_verified = true` every time. No person or
  no active membership: "Nemáte přístup" (403) with "Přihlásit jiným
  účtem" (`prompt=login`); the identity is linked only once a membership
  exists. Nothing is ever created.
- **Sessions.** Migration 0012 rebuilds the unused `auth_sessions`: the
  hash, the person, the org, the person's own membership, the membership
  acted as (`acting_membership_id`, NULL unless a role switch) and the ID
  token; a unique index `memberships(id, org_id)` backs the acted-as
  foreign key, which keeps it in the session's org. The cookie
  `__Host-cb_session` (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 12
  hours); a login deletes the browser's previous session. The auth
  middleware reads the session on every `/api` request after the public
  routes (health, the phone upload): unknown, expired or idle answers 401
  `unauthenticated`; `last_used_at` is written when older than 5 minutes,
  so the idle limit can end a session up to 5 minutes early. The viewer
  middleware reads the memberships again on every request, and the auth
  middleware the person's own one (for the speech and summary routes,
  which have no viewer), so an ended membership counts at once (401
  `unknown_user`). The cron sweep clears
  the ID token of sessions that ended (12 hours, or the idle limit) and
  deletes rows 30 days after expiry.
- **Switches.** `POST /api/session/org {org_id}` (only into an active
  membership of the person) and `POST /api/session/role {membership_id}`
  (demo orgs only: the org's demo accounts, which are its memberships
  whose person has an e-mail, or back to oneself). Both write the new
  session row and delete the old one in one D1 batch, keep `created_at`
  and `expires_at`, set a new cookie, and write an access-log row
  (`session.org`, `session.role`).
- **The access log after a role switch.** The `Viewer` gets `actor` (the
  person logged in); both insert paths (`D1Audit.append`,
  `auditStatement`) write `actor_user_id` and `actor_name` from it,
  `acted_as_role` and `acted_as_membership` from the membership acted as,
  and `impersonating = 1`. Administrace shows "Ing. Kovář (jako MUDr.
  Svobodová)". The login itself writes `session.login`.
- **Cross-site reads.** `audit()` (`src/middleware/audit.ts`), which every
  audit-writing GET goes through, refuses `Sec-Fetch-Site: cross-site` and
  `same-site` with 403 before writing; a request without the header (not
  a browser) passes, as in the same-origin check of writes.
- **Pages.** `src/auth/pages.ts` serves "Nemáte přístup", "Přihlášení se
  nepodařilo" (with "Zkusit znovu" to the same return path), "Přihlašovací
  služba je nedostupná" (503), "Přihlášení není nastavené" (500) and
  "Přihlášení obnoveno" (the end of a login in a second window), with no
  script, `default-src 'none'`, no framing and no caching. Text comes from
  `i18n/<lang>/auth.ftl` (cs, sk, en), imported as text by the Worker; the
  language is the one the app passed to `/auth/login` (`lang`).
- **Removed:** the Cloudflare Access mode (`AUTH_MODE=access`, its token
  check, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and its runbook).

**The frontend (step 4):**
- `stores/session.ts` knows the mode from `/api/health`. With a login it
  sends no `X-Demo-User`; the header shows `AccountMenu.vue` (name, role,
  org, the person's other orgs, "Přepnout roli" in a demo org with the
  current entry pressed, "Odhlásit"). Org and role switches run the same
  switch protocol as the picker: drafts stored first (a refusal stops the
  switch), the recording stopped, then the server switch and a reload of
  everything the new user may see. "Odhlásit" does the same, then
  `POST /auth/logout` with `fetch` (the app's policy has `form-action
  'self'`, which would stop a form post that redirects to the IdP) and
  goes to the end-session address it returns.
- **A lost session.** The API client (`packages/api-client/src/core.ts`)
  hands a 401 `unauthenticated` or `unknown_user` to the app and sends the
  request again (at most twice) when the app says so; the request was
  refused before anything ran, and an idempotency key is kept. The app:
  a read that left before an org or role switch took effect is sent
  again at once, a write is not (it belongs to the identity that made
  it); with nothing unsaved (no dirty, in-flight or approving
  draft, no running recording or unsent recording parts) the page goes to
  `/auth/login?to=<path>`; otherwise `SessionExpiredDialog.vue`
  ("Přihlášení vypršelo") opens the login in a second window
  (`?popup=1`, which ends on "Přihlášení obnoveno"), and "Zkusit znovu"
  (or the window getting focus back) checks `/api/me`. A new login lands
  in the person's first org as themselves, so the store first switches
  the same person back to the org and role the unsaved work belongs to
  (the account menu's switches, with their server checks). The waiting
  requests go out again only when the same person acts as the same
  membership; another login shows "Načíst stránku znovu" instead.
- **One session, several tabs.** The cookie serves every tab of the
  browser, so each request names whom its tab shows (`X-Acting-As:
  <membership>:<person>`, from `/api/me`, which is sent without it; page
  images loaded by `<img>` cannot send it and are not compared, nor are
  requests during a switch). After
  a switch or another login in a second tab, the viewer middleware answers
  409 `session_changed` before the request reads or writes anything, and
  the tab says so and reloads (not while the lost-login dialog waits).
- Strings in `i18n/*/shell.ftl` and `lists.ftl`; tests in
  `app/test/login.test.ts` and `packages/api-client/test/client.test.ts`.

**Tests:**
- `api/test/oidc.test.ts`: a fake IdP (generated RS256 keys; it checks the
  client secret, the redirect address and the PKCE verifier and gives
  every code out once) for every case listed in "Tests" above, plus the
  503 on unreachable keys, the userinfo fallback, the second account with
  a linked person's e-mail, the cross-site read, the sweep and the pages'
  catalogs.
- The browser suite: `run-parallel.mjs` starts a fifth Worker with
  `AUTH_MODE=oidc` and `e2e/mock-oidc.mjs`, a mock IdP with the same
  checks as a real one, single sign-on and logout; `specs/login.spec.ts`
  covers login and return path, no access, logout, the role switch and its
  log row, a lost session with and without unsaved work, and org B's
  isolation when logged in. The demo-mode cross-org spec
  (`specs/orgs.spec.ts`) stays.

**Deviations from this design:**
- **No org picker at login.** A person with several memberships lands in
  the oldest org and switches in the account menu.
- **The ID token is kept with the session** (12 hours at most) as the
  logout hint, and cleared by the sweep once the session ended.
- **Userinfo fallback.** If the Zitadel app does not put the e-mail into
  the ID token ("User Info inside ID Token" off), the Worker calls the
  userinfo endpoint once per login with that login's access token, then
  drops it. Turning the setting on avoids that call.
- **Steps that finish later.** Work a request starts and a Workflow, the
  cron sweep or the phone of an upload session finishes acts for its
  `created_by` (after a role switch, the person acted as). Migration 0012
  adds `created_by_actor` to `jobs`, `pipeline_runs`, `audio_uploads`,
  `upload_sessions` and `cases`, and `actorFor` builds the real person and
  `impersonating = 1` from it, so those rows name the person logged in too.
- **Trust in the IdP's verified e-mail.** The first login links by the
  e-mail the IdP marks verified. In Zitadel an organization or instance
  administrator can create an account with any e-mail marked verified, so
  whoever administers the Zitadel instance can take over a provisioned
  person who has not logged in yet. A unique index allows one identity per
  person and IdP, so a second account cannot link once the person has
  logged in. Requiring Zitadel's resource-owner claim or a project role is
  a later step.
- **Hospital orgs** exist only in tests; both seeded orgs are demo orgs.

