# Login, organizations and users

Status: steps 1 and 2 (organizations, people and memberships, org
scoping, the per-org demo reset) are built, 2026-10-19; see "As
implemented (steps 1-2)" at the end. Steps 3 to 5 (the login) are not.
When the login is built, `CLAUDE.md` ("skip login and OAuth"; "the demo
has no login") and [`INTEGRATION.md`](INTEGRATION.md) (the user picker as
a stand-in for login) are updated in the same change.

The app has no real login today. The demo picks a user from a list, and
all data belongs to one shared demo. For the MVP the app needs:
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
   - two demo orgs: "Ukázková nemocnice A" (today's data) and "Ukázková nemocnice B" (one synthetic patient);
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
- **To verify before choosing:** a Czech and Slovak login page, and the exact free-tier and Pro limits.

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
   - The key cache, the "IdP keys unreachable gives 503" behaviour and the 30 s clock tolerance are reused from `api/src/auth/access.ts`.
   - A failed callback shows a fixed page with "Zkusit znovu" instead of redirecting again, so it cannot loop.
5. **Linking the person, never auto-creating one:**
   - The first login links issuer and subject to the provisioned person with the same verified e-mail.
   - Later logins use issuer and subject.
   - A login with no person or no active membership shows a fixed "Nemáte přístup" page. Nothing is created.
6. **Session:**
   - A new session ID is issued at every login (no session fixation). It is stored in D1 only as a hash, with the person, the active org, and the acting membership.
   - The browser gets `__Host-cb_session`: HttpOnly, Secure, SameSite=Lax, path `/`, no domain.
   - No IdP access or refresh tokens are kept: the Worker calls no IdP API. The ID token is kept only as long as the logout hint needs it.
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

The `access` mode (Cloudflare Access) is removed once OIDC works, and the
access runbook in `api/AGENTS.md` is replaced.

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
  user_id)`, unique keys that start with `org_id`, and re-creates the
  append-only and demo-reset triggers scoped to the row's org. Today's
  data goes to demo org A (`demo-a`). `access_log.auth_mode` accepts
  `'oidc'`, and a new column `acted_as_membership` names the membership
  acted as.
- **Two demo orgs** in the seed: "Ukázková nemocnice A" (`demo-a`, the
  hackathon demo) and "Ukázková nemocnice B" (`demo-b`, the synthetic
  patient S01 with its own case, document, departments and people). Each
  has two doctors with e-mails, a coordinator and an administrator
  (`lekar1.a@codebridge.demo`, `lekar2.a@...`, `koordinator.a@...`,
  `admin.a@...`, and the same with `.b`); org A keeps its other ten demo
  doctors. `seed/reset.json` has a section per org.
- **The org reaches every query.** SQL names the org as `?org`, bound by
  one function (`orgStmt`, `src/store/sql.ts`) that the org-bound stores,
  the write batch (`Tx`) and the route helper `orgQuery` use. Routes take
  the org from the viewer's membership, workflows from their parameters,
  the cron job loops over the orgs. A record of another org answers 404.
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
  test fixture, and the browser suite's `specs/orgs.spec.ts`.

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
  internal ID, so org B's case reads `B-NO-S01`; showing `case_no` belongs
  to the frontend step.
- **Names are the person's.** Renaming someone on one org's staff screen
  renames them in every org they belong to; their function is per org.
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

