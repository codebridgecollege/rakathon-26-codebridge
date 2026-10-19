# Database architecture

Status: design, 2026-10-18. Organizations (`org_id`, [`AUTH.md`](AUTH.md)
steps 1 and 2) are built, 2026-10-19; see "As implemented (steps 1-2)" at
the end.

How CodeBridge stores its data, how organizations are kept apart, and how
that changes when a hospital needs stronger separation.

Terms used below:
- **Organization (org)**: a hospital or other customer; every patient, case and document belongs to exactly one.
- **D1**: Cloudflare's SQLite database. **R2**: Cloudflare's file storage.
- **Tenancy**: how the data of several orgs shares, or does not share, storage.
- **`sessions`** are MDT seminar days. **`auth_sessions`** are logins; the two are unrelated.

## Summary

1. **One D1 database and one R2 bucket, both in Cloudflare's EU
   jurisdiction,** hold all orgs' data in the cloud MVP.
2. **Shared tables with an `org_id` on every row that holds org data**
   (decided 2026-10-18). Separation rests on three things:
   - foreign keys and unique keys that include the org;
   - store functions that take the org first;
   - tests proving one org cannot reach another's data.
3. **Upgrade paths, in order of effort:**
   1. a database per org;
   2. a per-org SQLite database inside a Durable Object;
   3. Postgres with row-level security;
   4. a separate deployment per hospital, which is what a hospital pilot on its own servers already is.

   The store interface stays, so routes and screens do not change; the store implementation is rewritten for options 2 and 3.

## Where data lives today

The account is on the Workers Paid plan.

| Store | What | Location and limits |
|---|---|---|
| D1 `codebridge-mdt` | Cases, people, decisions, tasks, alerts, document metadata, transcripts, jobs, the access log | EU jurisdiction (checked with `wrangler d1 info`). Paid plan: 10 GB per database, up to 50,000 databases per account; Time Travel restores the whole database to any minute of the last 30 days (Free: 500 MB, 10 databases, 7 days) |
| R2 `codebridge-mdt` | Documents, page images and text, extraction outputs, temporary audio, the audit archive, caches | EU jurisdiction; prefixes and lifecycle below |
| The IdP (Zitadel, EU region) | Name, e-mail and login data only (`AUTH.md`) | Outside our database |

Clinical data is stored only in D1 and R2. Nothing clinical is stored in
the browser (beyond the page shown) or in logs.

**The schema** is built by numbered migrations in `api/migrations/`
(`wrangler d1 migrations apply`; CI applies them to the deployed
database on `main` right before the deploy, `api/AGENTS.md`), and
`api/seed/seed.py` loads the synthetic demo data.

**R2 prefixes:**

| Prefix | What | Owner after orgs | Lifecycle |
|---|---|---|---|
| `docs/`, `pages/` | Seeded document text and page images | Demo org A (moves under `org/A/`) | none |
| `uploads/` | Uploaded files | The case's org | none (life of the case) |
| `audio/` | Recording parts | The case's org | deleted after 7 days at most (`audio-backstop-7d`) |
| `jobs/` | Pipeline and job outputs | The case's org | none |
| `cache/summary/` | Cached AI summaries | The case's org | 30 days (`summary-cache-30d`) |
| `audit-archive/` | The demo access log, archived at each demo reset | The org reset | 30 days (`audit-archive-30d`), demo data only; a hospital org's archive follows FNO's retention and gets no lifecycle delete |
| `seed/reset.json` | The demo reset's source data | Global, with one section per demo org | none |
| `fixtures/`, `guidance/` | Synthetic fixtures and guideline data | Global | none |

## The data model

The tables fall into groups (the full list is in `api/migrations/`):

| Group | Tables | Notes |
|---|---|---|
| People | `users` (the person, with e-mail and active), `orgs`, `memberships`, `user_identities`, `auth_sessions` | See `AUTH.md` |
| Staff | `departments`, `dept_members`, `roles` | Departments become per org |
| Patients and cases | `patients` (identity only), `cases`, `case_members`, `case_access_grants` (break-the-glass), `status_history` | Identity is kept apart from case data, so case data can be pseudonymous |
| Planning | `slots`, `sessions`, `attendance`, `attendance_sets` | One slot per day and time |
| The MDT record | `protocols` (drafts), `decisions`, `tasks`, `task_suggestions`, `question_confirmations`, `fact_edits`, `edit_log`, `alerts`, `alert_events` | Decisions, confirmations and events are append-only |
| Documents | `documents`, `document_parts`, `pages`, `extraction_runs`, `pipeline_runs`, `upload_sessions` | The files themselves are in R2 |
| Recording | `recordings`, `transcript_lines`, `transcript_passes`, `transcript_summaries`, `audio_uploads`, `audio_parts`, `audio_segments`, `jobs` | Audio is temporary |
| Audit and plumbing | `access_log`, `idempotency_keys`, `write_guards`, `notifications`, `demo_state` | The access log is append-only |
| Global demo data | `fixture_files`, `fixture_patients`, `seed_meta` | The synthetic fixtures; not org data |

**Rules that hold across the model:**
- **Append-only history.**
  - Decisions, question confirmations, status history, the edit log, alert events and the access log refuse UPDATE and DELETE through triggers.
  - A new decision supersedes an earlier one of the same case (a trigger checks that); it never edits it (CLAUDE.md).
  - A document leaves the case's current set without being deleted (migration 0013): `documents.lifecycle` is `current`, `superseded` (a better scan replaces it; `superseded_by` names another current document of the same case) or `withdrawn` (it was another patient's). The change records a reason (`lifecycle_reason_cs`), when, and which member of the org made it. Triggers refuse a document that starts non-current, a replacement from another case, and any way back or switch between the two; only the demo reset makes the seeded documents current again. `lifecycle` is separate from `state`, which is the processing state of an upload. An extraction run reads only current documents (`docs/design/EXTRACTION-FORMAT.md`).
  - Triggers stop the app, not someone with database console access. That is one reason the access log is also archived to R2.
- **Foreign keys are enforced.** D1 checks them on every write, as if `PRAGMA foreign_keys = ON` were always set. The demo reset defers them inside its batch.
- **One guarded batch per write.** A write runs as one D1 batch. Guard rows re-check the conditions the route read, so a stale or concurrent change rolls the whole batch back (see `api/AGENTS.md`).
- **Timestamps** are ISO 8601 UTC. Dates as written in documents ("03/2024") are kept as text.
- **Identity apart from case data.** Names and birth numbers live only in `patients`. The stored extraction refers to the case ID.

## Organizations: shared tables

**Decision (2026-10-18): shared tables for the cloud MVP; upgrade later
when a hospital needs it.**

**How orgs are kept apart:**
1. **`org_id` on every table that holds org data,** with no default value. A forgotten org is an error, not a row that silently lands in some org.
2. **Foreign keys include the org.**
   - **Parents:** every parent table gets a unique key `(org_id, id)`, and references use it: `(org_id, case_id) REFERENCES cases(org_id, id)`. SQLite needs that unique key; without it, writes fail with "foreign key mismatch".
   - **People:** references to people go through `memberships(org_id, user_id)`, not the global `users` table. Otherwise a case member, a booking or an approver could name someone from another org. This covers about 20 columns today: case members, slot bookings, approvers, assignees and others.
   - **Nullable columns:** a composite key with a NULL column is not checked. Nullable person or department columns therefore get an explicit check in the store function.
   - **Columns with no foreign key on purpose:** `access_log.case_id` (the audit must outlive the row), `notifications.case_id` and `idempotency_keys`. For these, the store functions are the only guard, and the isolation tests cover them.
3. **Unique keys start with `org_id`.** Today several span all orgs:
   - `slots(day, time)`;
   - `sessions` keyed by day;
   - `idempotency_keys.key`;
   - the document per-case hash and the intake fixture keys;
   - department names.

   Shared, they would stop org B from booking 08:00 when org A holds it, and the refusal would reveal A's booking.
4. **Org-first store functions.** Routes, workflows and the cron job read and write only through store functions whose first argument is the org. Routes get the org from the session; workflows and the cron job get it as a parameter.
5. **Not found, not forbidden.** A record from another org answers 404, the same as an unknown ID, so its existence is never confirmed.
6. **Isolation tests.** For every route, a test acts in org B with org A's IDs, and every answer must be 404 or empty, with nothing in org A changed. This is the proof; the foreign keys are a second line.
7. **Files** sit under `org/<org_id>/…` in R2 (see the prefix table). Keys stored in D1 before the move keep working until their rows are rewritten or archived.
8. **IDs.** Internal IDs are unique across orgs. Numbers people see (`NO-010`) count per org.
9. **Per-org demo state.** The demo reset and its data epoch are per org, so a reset in one org never disturbs another.

**Why shared tables, and why this is acceptable:**
- **Common practice.** It is the most common pattern in SaaS, healthcare SaaS included.
- **GDPR** asks for appropriate technical measures, not physical separation. The measures above (org-scoped keys, one access path, tests and the access log) are those.
- **Cloudflare specifics.** A database per org is easy to create on Cloudflare, but a Worker's database bindings are set in its configuration. Each new org would need a configuration change and a redeploy, which buys nothing for a handful of demo orgs. Whether dynamic D1 bindings exist by now is to be verified when an upgrade comes up.

**Known gap: no restore per org.** Time Travel restores the whole
database, so restoring one org's data rolls back every org. A per-org
restore needs one of the upgrades below, or a per-org export.

## When to upgrade, and to what

**Move an org to stronger separation when any of these apply:**
- **Contracts:** a contract or a data protection officer requires physical separation of a hospital's data.
- **Backups and deletion:** a hospital needs its own backup and restore, or a full deletion at contract end that leaves no copy in shared backups.
- **Location and keys:** a hospital needs its own region, or its own encryption key.
- **Size or load:** one org's data or traffic grows past what one D1 database serves well (10 GB; one writer at a time).

**The options:**

| Option | What changes | Cost | Fits when |
|---|---|---|---|
| **A D1 database per org** | The store layer picks the database by org from a routing table | Low to medium. Each new org adds a binding and a redeploy (or a Worker per org with Workers for Platforms). Each database gets the EU jurisdiction at creation. Migrations run on every database. The global fixtures need their own database or a copy, since queries cannot span databases | A few large orgs that each want their own database |
| **A SQLite database per org in a Durable Object** | Each org's data lives in its own Durable Object (an isolated SQLite instance, created on demand, EU jurisdiction, about 10 GB, 30-day point-in-time recovery) | Medium to high. The store layer becomes calls into the object. Migrations run in code when an object wakes, since `wrangler d1 migrations` does not apply. Workflows and the cron job call through the object. Real transactions replace the guard-row batches | Many orgs, created without redeploys |
| **Postgres with row-level security** (through Hyperdrive) | The database enforces `org_id` itself | Medium to high. Queries move from SQLite to Postgres. It adds a new data processor outside Cloudflare (contract and an EU region). Row-level security needs the org set per transaction (`SET LOCAL`), because Hyperdrive pools connections. The app's role must not own the tables, or `FORCE ROW LEVEL SECURITY` is set. Hyperdrive's query cache is off for patient data | Strong in-database separation with shared tables, or when SQLite's limits bind |
| **A deployment per hospital** | The hospital runs its own copy: Worker or Node service, its own database, inside its network | Configuration, plus the hospital's operations | The pilot design in `INTEGRATION.md`; any hospital that keeps data on site |

All four keep the same store interface and the same `org_id` columns, so
routes and screens do not change. The store implementation is rewritten
for the Durable Object and Postgres options, and the demo reset, which is
built on a D1 batch, with it.

## Backups, retention and deletion

- **Backups:**
  - D1 Time Travel restores the whole database to any minute of the last 30 days;
  - the access log is also archived to R2 at each demo reset;
  - R2 has no backups of its own. Documents can be uploaded again, but a hospital's audit archive is a record to protect, so a second copy (another bucket or region) comes before the first hospital org.
- **Retention:**
  - audio for at most 7 days;
  - cached summaries and the demo audit archive for 30 days;
  - login sessions for 30 days after they expire;
  - document copies for the life of the case plus a period FNO sets;
  - the access log of a hospital org as FNO's record-keeping rules say.
- **Deleting an org** is its own audited maintenance task, not the demo reset:
  1. archive the org's access log for its retention period;
  2. delete the org's rows in dependency order;
  3. delete the org's R2 objects, by `org/<id>/` and by the keys stored in its D1 rows, since some predate the move;
  4. record the deletion.

  The demo reset's exception to the append-only triggers must not exist in a hospital database (`api/AGENTS.md`), so deletion uses a separate, logged path. Time Travel keeps deleted rows for 30 days, so a deletion is complete only after that; a contract needing immediate deletion is an upgrade trigger.

## Open points

- **The second copy of the audit archive,** before the first hospital org.
- **The retention periods** FNO sets.
- **Which hospital, if any, first needs physical separation,** and which option it wants.
- **Whether D1 offers dynamic bindings by then;** verify before choosing option 1.

## As implemented (steps 1-2)

Built 2026-10-19 (migration `0011_orgs.sql`; the runbook is in
`api/AGENTS.md`, section "Organizations"). Everything in "Organizations:
shared tables" above holds, with these details:

- **Tables with `org_id`:** every table in the groups above except
  `users`, `roles`, `orgs`, `user_identities` and the global demo data
  (`fixture_files`, `fixture_patients`, `seed_meta`). `auth_sessions` has
  one: the org the login session acts in (migration 0012 adds the
  membership acted as after a role switch, with a foreign key into the same
  org; `AUTH.md`, "As implemented (steps 3-4)"). `demo_state` is keyed
  by `org_id`.
- **Unique keys per org:** `slots (org_id, day, time)` and `(org_id,
  case_id)`, `sessions (org_id, day)`, attendance sets and rows by `(org_id,
  set_key, ...)`, `idempotency_keys (org_id, user_id, key)`, documents
  `(org_id, case_id, file_name)` and `(org_id, case_id, sha256)`, the intake
  fixture `(org_id, intake_fixture)`, departments `(org_id, name)`, cases
  `(org_id, case_no)` and `(org_id, source_file)`. Keys on globally unique
  IDs (a decision's version per case, a transcript line's client id per
  case, one active pipeline run per document) stay as they were: the ID
  already fixes the org.
- **Keys across orgs on purpose:** `users.email` (a person),
  `upload_sessions.token_hash` (the phone finds its session by the token,
  then acts in the session's org) and `audio_uploads.r2_key`.
- **Columns without a foreign key**, guarded by the store functions and the
  isolation tests: `access_log.org_id` and `case_id`, `notifications.case_id`
  and `to_user_id`, `idempotency_keys`, `upload_sessions.case_id`, and the
  person columns that had no foreign key before either: `created_by` of
  cases, jobs, pipeline runs, transcript lines, audio uploads, upload
  sessions and notifications, `case_members.added_by`,
  `attendance_sets.updated_by` and `tasks.confirmed_by`.
- **AUTOINCREMENT IDs** (tasks, drafted tasks, the edit log) count across
  all orgs, so their gaps show how much other orgs write; a known leak
  (AUTH.md).
- **Case numbers:** `cases.case_no` counts per org (`NO-100`, ...);
  `cases.id` is `orgs.case_id_prefix` plus the number (no prefix in demo
  org A, `B-` in org B), so it is unique across orgs.
- **Demo org B is empty:** the seed writes only its org row, demo state,
  departments, people and memberships, and no R2 object; `seed.py` stops
  otherwise. Its reset section restores just those.
- **R2:** the seed writes org A's objects under `org/demo-a/`; org B's own
  data goes under `org/demo-b/` once someone creates it (guideline and prognosis data stay global, keyed by
  the case ID, which is unique across orgs); new uploads, audio, pipeline outputs, extraction
  outputs, summary caches and audit archives go under the org. Rows
  written before keep their keys (`docs/`, `pages/`, `uploads/`, `audio/`,
  `extract/`), which stay readable; demo org A's reset also clears the old
  `uploads/`, `audio/`, `jobs/` and `cache/summary/` prefixes. R2 lifecycle
  rules match a prefix, so each org needs its own rules (`api/AGENTS.md`).
- **The demo reset** is one D1 batch for one org, 45 statements for org A
  with today's seed: the org's rows are deleted with `WHERE org_id`, the
  triggers delete that org's uploaded rows and make its superseded or
  withdrawn seeded documents current again, and the append-only triggers let
  a row go only while its own org's reset runs.

