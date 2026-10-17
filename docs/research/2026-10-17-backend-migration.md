# Moving the demo to a backend on Cloudflare Workers

Status: analysis and proposal, 2026-10-17. Nothing here is built yet. The
target design for a hospital pilot is in
[`docs/design/INTEGRATION.md`](../design/INTEGRATION.md); this note is about
the step from today's static demo to a real backend, hosted on Cloudflare.

Terms used below:
- **Worker**: a Cloudflare Workers script, the backend that serves the API and the static files.
- **D1**: Cloudflare's SQLite database.
- **R2**: Cloudflare's object storage, similar to S3.
- **Durable Object (DO)**: a single-instance Worker with its own storage, used where one place must order events.
- **Workflow**: a durable multi-step job with retries.

## Summary

- **Today nothing is stored and nothing is processed.** The app is one
  2.1 MB HTML page. Every data set is inlined at build time, and all state
  lives in browser memory (the staff list in localStorage). All case data
  (facts, summaries, flags, guideline quotes) was written in advance by
  development agents and checked by scripts. No code turns an upload into
  facts.
- **The backend itself is mostly plumbing, and Cloudflare covers it:**
  - one Worker that serves the app and an `/api` under it;
  - D1 for cases, decisions, tasks and the audit log;
  - R2 for documents and page images;
  - a Workflow for the jobs that run longer than a request: the speaker pass, the summary, the prognosis search and, later, document processing.
  
  KV and Durable Objects are not needed at first.
- **The real work is elsewhere.** Two parts take more effort than the
  backend:
  - turning the case-10-only patient view into views for any case, loaded on demand;
  - building the document pipeline that does not exist yet.
- **Hosting limit:** Cloudflare is fine for synthetic data, which is all we
  have. The pilot design says the app runs on FNO's servers. So the code
  must stay portable, with plain request/response handlers and storage
  behind small interfaces. Then the same code can run on Node with Postgres
  and S3-compatible storage inside the hospital.
- **First, today:** revoke the ElevenLabs key embedded in the published
  page (`STT_DEMO_KEY`, `mocks/src/v3-template.html`). Deleting it from
  the code is not enough: it is in the public git history. Code part done
  on 2026-10-17 (issue #2): the key left the page, and Pages Functions
  mint the single-use token and forward the speaker pass. Revoking the old
  key is a dashboard task for the key's owner.

## What we have today

**The page.**
- `mocks/build.py` inlines these into `mocks/v3.html`:
  - case 10 (`mock-case-10.json`, 67 KB; `mock-case-10-extra.json`, 122 KB);
  - FNO's other nine patients (`mock-patient-list.json`, 11 KB);
  - our synthetic S01/S02 (50 KB);
  - the page index with OCR text and word boxes for all 35 pages (606 KB, names included);
  - the guideline layer (79 KB after merging its 7 files);
  - the saved prognosis (66 KB);
  - jsPDF with fonts (734 KB).
- Page images (63 PNGs, 11 MB) sit next to the page in `mocks/pages/`.
- `deploy.sh` also publishes the S02 upload documents (`ukazka/S02-dokumenty.zip`) without login.
- The same data is built into the committed, unpublished v1 and v2 pages.
- Every visitor downloads every patient's identity and OCR text. That is
  the opposite of the data-minimization rule in CLAUDE.md, even though
  the data is synthetic.

**Server parts that exist.**
- `mocks/functions/api/summarize.js`: a Pages Function that calls Azure OpenAI with the secret `AZURE_OPENAI_KEY`.
  - The endpoint and model are hard-coded; CLAUDE.md wants them from configuration.
  - It has no retry on 429, no cache, and no authentication, so anyone can spend the quota.
  - It passes the upstream HTTP status back to the caller.
- `prognosis/service.py`: a standard-library Python service, run only locally by `mocks/serve.py`.
  - It calls OpenRouter with `OPENROUTER_API_KEY` from `.env`.
  - One search takes up to about 5 minutes.
  - The deployed page falls back to the saved result.

**Calls made straight from the browser.**
- ElevenLabs realtime transcription: the browser streams to ElevenLabs' socket with a single-use token from `POST /api/stt/token` (since 2026-10-17; the token and the speaker pass go through our server).

**Stubs already shaped as API calls.**
- `api.guidance()` is meant as `GET /api/cases/:id/guidance`.
- `srcApi` covers `document`, `page` and `locate`, meant as `GET /api/documents/:file`, `GET .../pages/:n` and `POST .../pages/:n/locate`.
  - The locate call is a POST because a quote may contain a name.

**Rules that only the browser enforces.**
- Approval needs a doctor, a conclusion, and a case that is not closed.
- Decisions are append-only.
- Uploads and the conclusion lock after approval.
- The status machine limits which moves are allowed.
- Duplicate birth numbers need an explicit override.
- The access log is written by client code.
- Several handlers do not check the role at all; only the button is hidden:
  - fact edits;
  - protocol step edits;
  - marking a task done;
  - acknowledging an alert;
  - attendance;
  - starting and ending a session.
- Marking a task done is also not written to the access log.

**Gaps a backend should close.**
- Retrospective deviation assessments (`S.retro`, `pr.dev`) are read but have no writer. CLAUDE.md wants doctors to record whether a deviation is intended and why.
- Alerts are keyed by position (`f.<index>` or `gap:<index>`), so re-extraction would mix up acknowledgements. They need stable IDs.

## Target architecture

```
Browser (the current app, split into modules)
   │  HTTPS, session cookie
   ▼
Worker (TypeScript, Hono router) ── static assets: index.html, JS, fonts
   ├── /api/*  role checks, case rules, audit log written by the server
   ├── D1 (EU)  relational data: cases, decisions, tasks, audit, users
   ├── R2 (EU)  document copies, page images, extraction outputs, temporary audio
   ├── Workflows  long jobs: speaker pass, summary, prognosis, later document processing
   └── outbound (keys only here): ElevenLabs, Azure OpenAI (through AI Gateway), OpenRouter
Later: Container (EU placement) for Tesseract, PyMuPDF and redaction
```

**Hosting.**
- Move from Pages to a Worker with static assets. A Pages project can bind to some of these, but it cannot define Workflows, Queue consumers, Durable Objects or cron triggers itself.
- Migration guide: <https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/>.
- `summarize.js` moves over almost unchanged.
- Access (see "Login and roles") is the main gate. The Worker also checks the session before serving anything (`run_worker_first`), as a second line.
- Keep `codebridge-mdt.pages.dev` live until the Worker URL is proven, so `main` stays demo-ready.

**Code layout** (proposal):
- `app/`: the frontend.
- `api/src/routes/*`: thin HTTP handlers.
- `api/src/domain/*`: the case rules, as plain TypeScript with no Cloudflare imports.
- `api/src/store/*`: storage behind interfaces. A D1/R2 implementation now, and a Postgres/S3 one later for the hospital.
- `api/migrations/*.sql`.
- `api/seed/`: loads the synthetic fixtures.

This layout is what keeps the pilot path open.

## Do we need a database? Yes: D1, plus R2 for files

Not KV, because it has no jurisdiction control and patient data must stay
out of it. A Durable Object is not needed for storage, since D1 handles the
concurrency we have.

**D1 tables** (first cut; all timestamps ISO 8601 UTC):

| Table | Holds | Notes |
|---|---|---|
| `users`, `roles`, `departments`, `dept_members` | Staff directory, replaces `defaultStaff()` and localStorage | Role comes from the table, not from "MUDr." in a name |
| `patients` | Identity: name, birth number, birth date, insurer | Kept apart from case data, so case data can be pseudonymous (case ID only) |
| `cases` | One MDT case: patient, question (explicit or draft with its basis), status, owner, referring department | |
| `case_members` | Who may open a case | INTEGRATION.md: role plus case membership |
| `status_history` | from, to, by, when, how | Append-only |
| `slots` | day, time, case | `UNIQUE(day, time)`, so two users cannot book one slot |
| `sessions`, `attendance` | Seminar day, who attended | Approval freezes a copy into the decision |
| `protocols` | Draft notes, conclusion, steps, mode | One open draft per case; autosave |
| `decisions` | Approved conclusion, approver, time, frozen report snapshot and attendance, `supersedes` | Append-only; a new version is a new row pointing to the one it replaces, with its own doctor and time |
| `tasks`, `task_suggestions` | Tasks and drafted tasks (state, quote, confirmed by) | IDs assigned by the server |
| `question_confirmations`, `fact_edits`, `edit_log` | Doctor confirmations and overrides; source values never change | `edit_log` is append-only |
| `alerts`, `alert_events` | Stable alert IDs per extraction; ack, resolve, reopen | Fixes the array-index keying |
| `deviation_assessments` | Doctor's severity, "intended", reason | The missing writer |
| `documents`, `pages` | Metadata: case, title, type, date, readability, R2 keys | |
| `extraction_runs` | Which model, prompt version and input hashes produced a case's facts | CLAUDE.md: reproducible extraction |
| `transcript_lines`, `transcript_passes` | Per case: time, text, speaker, pass state | Audio is not stored here |
| `jobs` | Workflow instance per job, state, error | For polling from the UI |
| `access_log` | actor, role acted as (impersonation), case, what, when, break-the-glass reason | Append-only, written by the server; read by admin and DPO |

**Append-only and backups.**
- Every append-only table (`decisions`, `status_history`, `edit_log`, `alert_events`, `access_log`) gets triggers that refuse UPDATE and DELETE.
- Triggers stop the app, not someone with D1 console access. So the audit log is also exported daily to an R2 bucket with a retention lock (to verify: R2 bucket locks).
- D1 Time Travel restores any minute of the last 30 days. R2 has no backup by default; the export covers the audit log.

**R2 objects**, in an EU-jurisdiction bucket, private and read only through
the Worker after the role check:
- `docs/<case>/<doc>.pdf`: uploaded originals.
- `pages/<doc>/p<n>.png` and `p<n>.redacted.png`: page images.
- `pages/<doc>/p<n>.json`: per-page vision text, word boxes and "ověřit" marks. This is the page index split per page, so the viewer loads only the page it opens.
- `extract/<case>/<run>.json`: the case data as the app shows it, meaning the current `mock-case-*.json` shapes. One file per run; the D1 row points to it.
- `audio/<case>/<session>.*`: temporary and compressed.
  - Raw 16 kHz 16-bit audio is about 1.9 MB a minute. An hour would pass the 100 MB request limit and a Worker's 128 MB memory, so the browser uploads it in parts.
  - The speaker pass deletes it in a step that also runs when the job fails. A lifecycle rule is the backstop.
  - The backstop period goes into DATA-PROTECTION.md, which today says audio is deleted as soon as the pass is done.

**Why case data goes to R2 as JSON, not into tables yet.** The extracted
facts already have a rich, nested shape:
- sections, timeline, labs with sources, flags, refs;
- quotes with page offsets.

The UI reads that shape directly. Normalizing it into tables now would be
weeks of work for no visible gain. The parts people change (alerts,
edits, confirmations) are tables keyed by stable IDs inside that JSON. If
we later query across cases (for example, all patients with rising CEA),
the labs move into a table.

**This split is not pseudonymization yet.** Today's case JSON holds the
patient's name (`patient.name`, `name_as_written`), and the page text holds
names too. For the split to mean anything:
- identity fields stay only in `patients`, and the stored extraction refers to the case ID;
- anything sent to a cloud model first goes through the redaction and pseudonymization step of DATA-PROTECTION.md option B.

**Residency.**
- Create D1 and R2 with `--jurisdiction=eu`. It can only be set at creation.
- One older Cloudflare compatibility page says D1 jurisdictions are not supported; the D1 docs say they are. Check on the created database.
- Without the Enterprise-only Data Localization Suite, the Worker itself may run in any data centre. Storage stays in the EU, processing may not. That is acceptable for synthetic data and one more reason the pilot runs on FNO's servers.

## API

All under `/api`, JSON. Every route checks the session and the user's
role and case membership, and writes its own audit entry.

**Reads** (they replace the inlined data):
- `GET /me`: user, role, department. Replaces the role picker.
- `GET /staff`.
- `GET /patients?q&status&dept&from&to&page`: list rows only, no case data.
- `GET /cases/:id`: header, question, status, slot, processing level (full, partial, none).
- `GET /cases/:id/brief`: summary with refs, diagnosis headline, MDT reason.
- `GET /cases/:id/record`: sections, anamnesis, status praesens, timeline.
- `GET /cases/:id/labs`.
- `GET /cases/:id/alerts`: flags and gaps, with stable IDs and their event history.
- `GET /cases/:id/documents`.
- `GET /documents/:id/pages/:n`.
- `GET /documents/:id/pages/:n/image?redacted=1`.
- `POST /documents/:id/pages/:n/locate`.
- `GET /cases/:id/guidance`.
- `GET /cases/:id/prognosis`.
- `GET /cases/:id/decisions`, `GET /cases/:id/history`.
- `GET /calendar?week`, `GET /tasks?scope`.
- `GET /admin/access-log`: admin only.

**Writes** (each enforces the rule the browser enforces today):
- `POST /cases`: new referral. The duplicate birth-number check runs in the same transaction; an override needs a reason and is logged.
- `POST /fhir/referral`: parses a FHIR Bundle into the referral form on the server (today `fhirToForm` in the browser).
- `POST /cases/:id/documents`: upload, see below.
- `PUT /cases/:id/slot`, `DELETE /cases/:id/slot`.
- `POST /cases/:id/status`: only the allowed moves.
- `PUT /cases/:id/protocol`: refused after approval.
- `POST /cases/:id/decisions`: approve. Doctor only, non-empty conclusion, case not closed. It freezes the report and the attendance, and creates the tasks.
- `POST /cases/:id/decisions/new-version`: supersedes the earlier decision, never edits it.
- `POST /tasks`, `PATCH /tasks/:id` (logged).
- `POST /suggestions/:id/confirm` and `/dismiss`.
- `POST /cases/:id/question/confirm`.
- `PUT /cases/:id/edits/:key`: an override. Source values never change, and re-extraction never silently changes a fact a doctor confirmed.
- `POST /alerts/:id/events`: informational only. Alerts never block approval, and missing-document alerts stay on.
- `POST /cases/:id/break-glass`: opening a case outside one's membership, with a reason (INTEGRATION.md).
- `PUT /deviations/:id/assessment`.
- `PUT /sessions/:day/attendance`.
- `POST /sessions`, `DELETE /sessions/:day`.
- `PUT /staff/...`: coordinator or admin.

**Services** (the keys never leave the Worker):
- `POST /stt/token`: returns an ElevenLabs single-use token.
  - The browser keeps streaming straight to ElevenLabs with that token. A WebSocket proxy is not needed for the demo.
- `POST /cases/:id/transcript/lines`: batched live lines.
  - The server checks that the case is open and not approved. The binding of words to a case stays the doctor's choice.
- `POST /cases/:id/transcript/audio`: on approval, the browser uploads that case's audio.
  - This starts a Workflow: speaker separation (ElevenLabs batch), replace the live lines, delete the audio, write the summary (Azure OpenAI).
  - The UI polls `GET /jobs/:id`.
- `POST /cases/:id/prognosis`: starts the search as a Workflow and returns a job ID.
  - The 5-minute model call no longer has to fit in one request.
  - The cache moves from memory to R2, keyed by its hash.
- `GET /cases/:id/fhir`: FHIR export, built on the server from the same data. Today it is built in the browser.

**Other parts.**
- **Notifications:** a cron trigger sends the coordinator's digest (a count and a link, no medical data) through an outbound mail service; in a pilot, FNO's mail server.
- **PDF report:** stays in the browser (jsPDF). On approval the server stores the frozen report snapshot with the decision, so a later PDF of an approved case is built from it.
- **Guideline layer:** served from stored, verified data as today. Any PubMed search runs on the server with clinical terms only, never patient data.
- **CSRF:** every POST with the session cookie needs protection (SameSite=Strict cookie plus an origin check).
- **Rate limits:** per user on the model and speech routes.

## Secrets and configuration

- **Secrets**, set with `wrangler secret put`, locally in `.dev.vars` (gitignored):
  - `ELEVENLABS_API_KEY`;
  - `AZURE_OPENAI_KEY`;
  - `OPENROUTER_API_KEY`;
  - later the OIDC client secret and the session signing key.
- **Plain variables** in `wrangler.jsonc`: endpoints, model IDs, deployment names, reasoning effort.
- Keep `.env.example` in step, as CLAUDE.md asks.
- The account-level Secrets Store is still in beta; per-Worker secrets are enough.
- **AI Gateway** could add retries and caching for Azure OpenAI and OpenRouter. Verify on a scratch gateway:
  - whether it retries on 429;
  - whether its Azure provider fits our APIM host (`apim-rakathon-q7146n.azure-api.net`) rather than a plain Azure resource.
  
  Its cache only hits byte-identical requests. So keep our own 429 backoff and an R2 cache keyed by input hash either way, and turn gateway logging off (its logs have no EU control).
- The CI deploy job (`.github/workflows/deploy-mock.yml`) keeps `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and runs `wrangler deploy` plus `wrangler d1 migrations apply`.

## Login and roles

**Demo and staging: Cloudflare Access** (Zero Trust, free up to 50 users).
- It sits in front of the Worker and lets in the team, mentors and the jury, by one-time e-mail code or GitHub.
- The Worker verifies the `Cf-Access-Jwt-Assertion` header with `jose`: the signature against the team's certificate URL, plus issuer and audience.
- It maps the e-mail address to a row in `users`, which holds the role. The role picker goes away.
- The demo's "show as coordinator" switch can stay as an admin-only feature labeled as impersonation. The audit row keeps both the real user and the role acted as.

**Pilot.** The design in INTEGRATION.md still holds: the app is an OIDC
client of FNO's identity provider, with roles from Entra app roles. Access
could front it, but it is not that design. The `users` and role check code
is the same either way.

**One decision first: a shared demo or one per visitor.** Once state
persists, every visitor's clicks land in the same database. A jury member's
typed conclusion or approval is seen by everyone, and an uploaded file
becomes stored third-party data with no clearance.
- **Recommended:** a shared demo behind Access, with a visible "ukázková data" banner.
  - The upload route accepts only the known synthetic fixtures (matched by file hash) and refuses other files.
  - A "reset demo" admin action reloads the fixtures and clears the D1 rows, R2 uploads and demo audit log.
- **Alternative**, if the demo is opened to the public: per-visitor workspaces (a `workspace_id` on every row, seeded on first visit).

## Uploads and the document pipeline

**Storage path, buildable now.**
- `POST /cases/:id/documents` streams the file to R2.
  - The Worker accepts up to 100 MB per request on the Free and Pro plans.
  - Presigned PUT URLs are possible later. Whether they work on the EU endpoint is unverified.
- It writes the `documents` row, the audit entry and a `jobs` row.

**Processing, which does not exist as code yet.**
- A Workflow runs the 14 stages in
  [`2026-10-16-summary-pipeline-review.md`](2026-10-16-summary-pipeline-review.md) section 5.
- Page render, Tesseract and redaction need native binaries (PyMuPDF, Tesseract `ces`, Pillow). These run in a **Cloudflare Container** placed in the EU.
  - Containers have been GA since April 2026, with no GPU.
  - EU placement needs `constraints.jurisdiction: "eu"` in the wrangler config.
  - The first start after a deploy takes minutes, so warm it before a demo.
- Vision reading and fact extraction call an LLM. This needs:
  - prompts stored in the repo;
  - a pinned model;
  - temperature fixed where the model accepts it;
  - outputs cached per input hash;
  - every quote checked against the page text before a fact is kept.
  
  None of these exist today.
- Until the pipeline is built, a known fixture like S02 attaches its
  prepared extraction, and any other file is listed as "nezpracováno" (not
  processed). This is what the demo does today, now with real storage.

**Order of building the pipeline:**
1. Render, OCR and the readability check (deterministic, testable against `data/derived`).
2. The lab parser (deterministic for FNO's printout format).
3. LLM extraction with source checks.
4. The cross-document rules: missing reports, referral without a result, contradictions.

Each step is checked against the failure cases listed in CLAUDE.md.

## Frontend changes

1. **Split the template.**
   - `v3-template.html` (3,900 lines) becomes ES modules: state, render per view, overlays, recorder, FHIR, API client.
   - Build them with Vite (the Cloudflare Vite plugin runs the Worker locally too).
   - No framework rewrite: the `render()` plus `innerHTML` model can stay.
2. **Load data before the first render.** One loader fetches `/me`, `/staff` and `/patients`, then calls `render()`.
3. **Per-case data, loaded on demand.** Done in step 3 (issue #4; design `docs/research/backend-steps/step-3.md`).
   - The patient view reads a per-case store (`caseStore`, keyed by the case file) instead of the `CASE` and `EXTRA` globals, which only the embedded seed and list builder read now.
   - One data-driven `viewPatient` shows each section the case's data holds, so any case with extraction data renders fully.
   - In API mode a case loads from `/api/cases/:id/extraction` when opened; late replies for a case no longer open are kept but do not re-render, and replies older than the latest request are dropped.
4. **Write through the API.**
   - Each action that mutates `S` calls its endpoint and renders the server's answer.
   - On a refusal, it shows the server's reason (for example "case approved, uploads locked").
   - Remove the client-side `logAccess` calls as the server takes over each one.
5. **Remove data embedding from `build.py`.**
   - Fixtures move to `api/seed/`, which writes D1 rows and R2 objects from the same JSON files.
   - Static files are then only code, CSS, fonts and the logo.

## Migration plan

Effort is a rough estimate for one developer with agents.

| Step | What | Rough effort | Demo stays working |
|---|---|---|---|
| 0 | Revoke the ElevenLabs key, then move token minting and batch STT to a Worker route | 2-3 h | yes |
| 1 | Worker with static assets replaces Pages; summary route moves; Access in front; config from variables; AI Gateway | 0.5-1 day | yes |
| 2 | D1 schema, seed from fixtures, read API; frontend loader; page index per page from R2 | 2-3 days | yes, behind a flag until done |
| 3 | Per-case data cache in the frontend (lifts the case-10-only limit); done, issue #4 | 2-3 days | yes |
| 4 | Write API with server-side rules and audit, action by action; reset-demo action | 3-5 days | yes |
| 5 | Workflows: speaker pass, summary, prognosis port to TypeScript | 2-3 days | yes |
| 6 | Uploads to R2; then the document pipeline (Container plus LLM extraction) | upload 1 day; pipeline weeks | yes; unprocessed files are labeled |

Steps 0 and 1 are worth doing even if the rest waits.

- **Branches:** each step goes in on a branch and merges only when the demo path works. The Pages site stays until the Worker replaces it.
- **Tests:** the domain rules (approval, append-only, status moves, upload locks, duplicate check) get unit tests in the Workers Vitest integration. Every pipeline step is checked against the failure cases under `samples/`.
- **Retention:** deletion jobs (document copies after the case, the audit log per FNO's rules) become a cron trigger once FNO sets the periods.
- **Docs:** new tools (Workers, D1, R2, Workflows, Access, AI Gateway, Hono, Vite, `jose`) go into `docs/agent/HACKATHON.md` and `docs/design/TECHNOLOGIES.md` when adopted.

## Decisions (2026-10-17)

- **Shared demo**, as recommended in "Login and roles". Organizations or
  accounts (a tenant ID on every row) may come later; the schema keeps
  every table scoped through `cases` so that a tenant column can be added
  in one migration.
- **Prognosis: TypeScript port or Python Workers** is decided when the
  backend reaches it, after reading the code.
- The other points below are open questions, tracked in
  [`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).

## Foundations every step builds on

- **Branch:** work happens on `backend`, merged into `main` per step once
  the demo path works. The Pages site (`codebridge-mdt.pages.dev`) stays
  live and unchanged until the Worker replaces it.
- **Folder:** `api/`, one Wrangler project: `wrangler.jsonc`, `src/`
  (`index.ts` with the Hono app, `routes/`, `domain/`, `store/`,
  `services/`), `migrations/`, `seed/`, `test/`, `package.json` with a
  lockfile. TypeScript, strict.
- **Pinned tools:** Wrangler 4.147.0, Hono 4.13.13, `jose` 6.2.12 (not 5:
  v6 is WebCrypto-only ESM, which suits Workers), Vitest 4.1.11 with
  `@cloudflare/vitest-plugin` 1.3.6. Exact versions are in
  `api/package.json` and `TECHNOLOGIES.md`. Step 1 (the Worker with the
  API foundation) is implemented on branch `backend-step1` (issue #3).
- **Worker:** named `codebridge-mdt`, served at
  `codebridge-mdt.<account>.workers.dev` until it replaces Pages. Static
  assets are the built mock, staged by a script into `api/.assets/`
  (gitignored), so `mocks/build.py` stays the one build of the page.
- **Auth modes:** `AUTH_MODE=demo` keeps the role picker (labeled as a
  stand-in) and trusts no client claim beyond the picked user's name;
  `AUTH_MODE=access` verifies the Cloudflare Access JWT. The Worker ships
  in demo mode until Access is configured.
- **Frontend switch:** the page asks `GET /api/health`; when it answers
  with `features.data: true`, the page uses the data API, otherwise it
  keeps its embedded data. Health also answers on Pages (with
  `features.data: false`), so the switch keys on that flag, not on health
  answering at all. So the same build works on Pages and on the Worker
  during the migration.
- **Errors:** JSON `{ error: { code, message_cs } }` with the HTTP status;
  the Czech message is what the UI shows.

## Open points to decide or verify

- **D1 EU jurisdiction**: check on the created database (see "Residency").
- **Presigned R2 URLs on the EU endpoint**: unverified.
- **Which hosted LLM for extraction, if FNO approves cloud use**: still open in [`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md) ("Which tech stack and which LLM deployment").
- **Whether FNO would ever accept Cloudflare for real data**: the docs say on-premises. Ask early, because it decides whether the portability layer is insurance or the main path.
