# Step 4: write API with server-side rules and audit, plus reset-demo

Status: implementation design, 2026-10-17. Read-only research; nothing is
built. Builds on Steps 1-3 of
`docs/research/2026-10-17-backend-migration.md` (repo path).

Terms: **Worker** is the Cloudflare Workers backend (Hono, TypeScript).
**D1** is Cloudflare's SQLite database; a **D1 batch** runs a list of
statements in one implicit transaction (all commit or none). **R2** is
object storage. **Domain layer** is `api/src/domain/*`, plain TypeScript
with no Cloudflare imports. **Embedded mode** is the static Pages build
that keeps all state in browser memory; **API mode** is the same page
when `GET /api/health` answers.

Line numbers below refer to `mocks/src/v3-template.html` at commit
`04968a4`.

## Goal

Every action that changes state in the demo goes through the Worker,
which enforces the rule, writes the change and its audit row in one D1
batch, and returns the canonical result. The browser stops being the
only place where rules live, and the shared demo can be restored to its
seeded state with one admin action, under a visible "ukázková data"
banner.

## Scope

In scope:
- Domain layer for every rule the mock enforces today, plus the rules it
  is missing (handlers without role or state checks, listed below).
- Write endpoints for: status and closing, slots, protocol draft
  (notes, conclusion, steps), approval and new version, tasks done,
  task suggestions, question confirmation, fact edits and reverts, alert
  events, MDT sessions and attendance, staff list, new case with the
  duplicate birth-number check, break-the-glass, coordinator digest
  (outbox row only), client view events for the audit log, reset-demo.
- Server-written audit log; client `logAccess` removed in API mode.
- Concurrency: slot `UNIQUE`, optimistic version on protocols and
  attendance, idempotency keys on approve (and on case creation).
- Frontend: each action calls its endpoint in API mode and applies the
  server answer; embedded mode keeps today's in-memory behavior.
- Domain unit tests and route tests; a recorded browser check.

Out of scope (later steps or never):
- **Retrospective deviation assessments stay read-only** (user decision
  2026-10-17, CLAUDE.md guideline-layer bullet, PRODUCT.md F-27). There
  is no `PUT /deviations/:id/assessment`. Seeded `deviation_assessments`
  rows are only read (Step 2 read API). The deviations table under the
  proposed management is a passive comparison and needs no writer
  either. Reset-demo restores the seeded rows unchanged.
- File uploads to R2 (`POST /cases/:id/documents`) and the "Dokumenty"
  upload tab in the discussion card: Step 6. Step 4 ships only the
  domain rule `canUpload` with tests, so Step 6 can call it. In API mode
  the tab keeps today's browser-only behavior and its existing label
  ("soubory zůstávají jen v prohlížeči").
- AI recording, transcript lines, speaker pass, recording purge on close
  or end of session: Step 5. Step 4 leaves named hooks
  (`onCaseClosed`, `onApproved`, `onSessionEnded`) that are no-ops now.
- Server-side FHIR import parsing (`POST /fhir/referral`) and FHIR
  export: read-only transforms, not rules; separate PR.
- Real e-mail sending (cron and mail service). Step 4 writes an outbox
  row only.
- Free-standing task creation (`POST /tasks`): the mock has no such
  action; tasks come from approval or a confirmed suggestion.
- Per-visitor workspaces, tenants, OIDC.

## Design

### 1. What the browser does today, action by action

| Action (mock) | Where | Rule checked in handler | Missing in handler |
|---|---|---|---|
| Manual status move `data-setst` | 3504-3511, `manualMoves` 1235 | role (`canSetStatus`) and allowed move | none, but status history and log are client-written |
| Close case `closecase` | 3730 | role, status `done` | slot release decided client-side |
| Schedule `data-free`, drag-drop | `scheduleAt` 3799, drop 3826 | `slotLocked` | **role** (admin can book), **closed case** can be booked, no slot uniqueness across users |
| Unschedule `data-unsched`, drag back | `unschedule` 3791 | `slotLocked` | **role** |
| Notes, conclusion, steps, mode | input 3767-3770, change 3873, `syncConcl` 3776, `addstep` 3721, `delstep` 3583 | `syncConcl` checks approved/closed | **role** on notes, steps, add/delete step (inputs render for every user); `syncConcl` does not check doctor |
| Approve `approve` | 3731-3761 | doctor, non-empty conclusion, not closed | **already approved** not checked in handler (button hidden only); double click can create two decisions |
| New conclusion `newversion` | 3724-3729 | not closed | **role**; **does not check the protocol is approved**, so it can wipe an unapproved draft |
| Task done `data-done` | 3585 | none | **role**, **no audit entry** |
| Suggestion confirm/dismiss, field edit | `confirmSugg` 3590, change 3874-3877 | doctor, state draft | none |
| Confirm drafted question `confirmq` | 3704-3711 | doctor, draft exists | does not bind the confirmation to the exact draft text |
| Fact edit / revert `saveedit`/`revertedit` | 3712-3720 | none | **role** (pencil rendered only for doctors) |
| Alert ack/resolve/reopen `data-alact` | `alertAct` 1728 | valid action | **role**; alerts keyed by array position (`f.<i>`, `gap:<n>`) |
| Attendance `data-att`, `addatt`, `delatt` | 3526-3529, 3870 | none | **role**; duplicates prevented only by disabled options |
| Start / end MDT `startgo`, `endsession` | 3531-3536, 3694 | none | **role** |
| New patient `newdone`, duplicate override `newdupok` | 3621-3669 | format of name and birth number, consent, duplicate prompt | **role**; override has **no reason**; "once" rule for the S02 intake fixture is client-side |
| Coordinator digest `maildigest` | 3670 | none | **role**, no audit entry, no rate limit |
| Staff edits `commitStaff` and friends | 2148-2207 | coordinator or admin, name uniqueness | role derives "doctor" from "MUDr." in the name |
| Client `logAccess` | 1302 and ~40 call sites | n/a | written by the client; time is local, no actor identity beyond the picked name |

The bold items are the rules the server must add, not just move.

### 2. Roles and case access

Roles come from `users.role` (Step 2), never from the title in a name:
`doctor`, `coordinator`, `admin`. `AUTH_MODE=demo` takes the picked user
from the Step 1 demo header; `AUTH_MODE=access` maps the Access e-mail to
a user. The admin-only "act as" switch sets `acting_as_user_id`; every
rule checks the **acting** user's role, and every audit row stores both.

Permission matrix (domain `can(actor, action, ctx)`):

| Action | doctor (member or break-glass grant) | coordinator | admin |
|---|---|---|---|
| status move, close, reopen | yes | yes | no |
| schedule, unschedule | yes | yes | no |
| protocol notes, conclusion, steps | yes | no (see open point 1) | no |
| approve, new version | yes | no | no |
| question confirm, fact edit/revert | yes | no | no |
| suggestion edit/confirm/dismiss | yes | no | no |
| task done/undone | yes | yes | no |
| alert ack/resolve/reopen | yes | yes (see open point 2) | no |
| session start/end, attendance | yes | yes | no |
| create case (incl. duplicate override) | yes | yes | no |
| digest | yes | yes | no |
| staff writes | no | yes | yes |
| break-glass | yes, when not a member | no (coordinator sees all cases) | no |
| reset-demo | no | no | yes, and only when `DEMO_RESET_ENABLED=true` |
| view events (`POST /audit/events`) | any user who may read the case | same | non-case codes only |

Case membership (INTEGRATION.md "Who may see which patient"): a doctor
may write to a case when a `case_members` row names the user or one of
the user's departments, or when an unexpired break-the-glass grant
exists. Seed: the six MDT departments are members of every seeded case,
so every seeded doctor works on every case and the demo path never hits
a refusal; a doctor added through the staff screen to a new department
is the way to show break-the-glass. A new case gets the creator, the
owner and the six MDT departments as members. Coordinator: all cases.
Admin: no case content (only staff, access log, reset).

### 3. Domain layer (`api/src/domain/*.ts`)

Pure functions. Inputs are plain snapshots loaded by the route; the clock
and ID generator are injected (`ctx.now()`, `ctx.id()`), so tests are
deterministic. Each command returns a **Plan**:

```ts
type Plan = {
  guards: Guard[];        // preconditions re-checked inside the batch
  changes: Change[];      // inserts and updates, in order
  audit: AuditEntry[];    // at least one per successful command
  result: unknown;        // what the route returns
  hooks?: HookCall[];     // onCaseClosed, onApproved, ... (no-ops until Step 5)
};
```

A refusal throws `DomainError(code)`; `errors.ts` maps the code to an HTTP
status and the Czech message.

Files and the rules in each:

- `roles.ts`: `Actor`, `can(actor, action, ctx)`, `isMember(actor, case, members, grants, now)`.
- `status.ts`: `STATUS` (`new`, `scheduled`, `ready`, `attention`, `done`, `closed`); `manualMoves(case, history)`, a straight port of `manualMoves` (1235) including "reopen to the status it was closed from, or `new` when closing freed the slot"; `moveStatus(case, to, how)` returns the status change and the history row; `autoOnSchedule`, `autoOnUnschedule`, `autoOnApprove`, `autoOnNewVersion`. `scheduled` and `done` are never manual targets.
- `close.ts`: `closeCase(case, slot, decisions)` returns status change plus slot release when `!slotLocked`, plus hook `onCaseClosed`.
- `slots.ts`: `slotLocked(slot, decisions)` (a decision stored this exact slot; holds after close and after a new version); `validateSlot(day, time)` (10-minute grid, ISO day, range 2024-2028 as the calendar allows); `seminarWarning(day, time)` (outside seminar time is allowed, returned as a warning, as the mock's toast does); `schedule(case, newSlot, currentSlot, decisions)`; `unschedule(...)`. New rule: a closed case cannot be booked (`CASE_CLOSED`).
- `protocol.ts`: `canEditProtocol(actor, case, proto)` (doctor; protocol state `draft`; case not closed); `patchProtocol(proto, patch, expectedVersion)`; step validation (text up to 500 chars, `who` an active user ID, `due` an ISO date or empty); `newDraft(case, protos, decisions)` (only when the latest protocol is `approved` and the case is not closed; it never touches a draft, which fixes the wipe in 3724).
- `approve.ts`: `approvalBlockers(actor, case, proto)` returns the list of Czech reasons (not a doctor, empty conclusion, case closed, already approved) and **ignores alerts**, so alerts never block; `approve(input)` returns: protocol to `approved` with approver and time; decision row (`supersedes` = previous latest decision ID, frozen conclusion, slot, attendance snapshot, picked report sections, report snapshot HTML and its SHA-256); attendance insert for the approver when absent (audit "doplněn(a) mezi přítomné při schválení závěru"); tasks from non-empty steps (server IDs); suggestions from `suggestTasks(conclusion, approvalDate)`; notification outbox row (case ID and task count only, no text); status change to `done`; hook `onApproved`.
- `suggest.ts`: port of `SUGG_RULES`, `NEG_RE`, `TIMING_RE`, `dueFrom`, `addMonths`, `suggestTasks` (2771-2830). Change: due dates count from the **approval date** passed in, not the mock's constant `TODAY` (1121).
- `suggestions.ts`: `editSuggestion` (draft only; editing `due` sets `due_src=manual`, `due_by`), `confirm` (creates a task with `confirmed_by`, `from_suggestion`, carries `due_src`, `timing`), `dismiss`.
- `tasks.ts`: `setDone(actor, task, done)`; assignee may also mark done.
- `question.ts`: `confirmDraft(actor, case, draftSha)`: refused with `QUESTION_CHANGED` when the stored draft's hash differs from what the doctor saw, so a re-extracted draft is never confirmed silently. Writes `question_confirmations` and an `edit_log` row (`confirmed: true`).
- `edits.ts`: `saveEdit(actor, case, key, text, orig, expectedEditId)`, `revertEdit(...)`. Key format `^[a-z0-9_.:-]{1,120}$`, text 1-4000 chars; empty or equal to `orig` means revert (as 3716). `fact_edits` holds the current override per `(case_id, key)` with `extraction_run_id`; `edit_log` only grows (a revert is a new row). Source values are never changed.
- `alerts.ts`: `alertState(events)` (latest event; `reopen` means open); allowed transitions open->ack, open->resolved, ack->resolved, ack->reopen, resolved->reopen; `expected_state` guard. `missingSignal(alerts)`: the brief's missing-document signal counts every `missing` alert that is not resolved, and there is no event or setting that switches the kind off (CLAUDE.md: always on, never part of the guideline layer).
- `attendance.ts`: `setAttendance(actor, sessionKey, byDept, expectedVersion, staff)`: each user active and in that department, no person twice, departments known. `sessionKey` is the slot day, or `case:<id>` for a case without a slot (mock `attDay`, 2384). Frozen copies live in decisions, so later edits never change an approved report.
- `sessions.ts`: `startSession(actor, day, agenda)` (day has at least one booked case; one open session per day), `endSession`, hook `onSessionEnded`.
- `intake.ts`: `validateReferral(form)` with the mock's messages (2 fields required, birth number `^\d{6}\/?\d{3,4}$`, consent); `normalizeRc`; `duplicateDecision(rc, existing, override)`: a match needs `override.birth_number` equal to the normalized number **and** a reason of at least 10 characters (new rule, from the research note); `intakeFixtureAllowed(fixtureId, existingCases)` (S02 once).
- `staff.ts`: `displayName`, `nameTaken` (includes the admin), add/rename/function/remove person (soft delete, `active=0`; history keeps names because history rows store `name_snapshot`), add/remove department (only when empty), role on add/edit is an explicit field (`doctor` or `staff`); the UI may prefill `doctor` when the title contains "MUDr." but the server stores the choice.
- `breakglass.ts`: `grant(actor, case, reason, now)`: doctor, not already a member, reason 10-500 chars, 12-hour grant.
- `audit.ts`: action codes and Czech templates. Templates carry no patient text: no names, no conclusion, no file names (the mock logs file names at 3582; Step 6 must use a document ID). Allowed details: status names, slot day and time, edit key, alert kind, counts.
- `demo.ts`: `resetPlan(seedVersion)` (see section 8).
- `errors.ts`: codes, HTTP status, `message_cs`.

### 4. Store interface and how a write commits

`api/src/store/types.ts` defines read methods per aggregate (`getCase`,
`getProtocol`, `listDecisions`, `getSlot`, `getAttendance`, ...) and one
`commit(plan, opts)`. `api/src/store/d1.ts` compiles a plan into **one
`db.batch([...])`**:

1. Guard statements. D1 has no interactive transactions, so a value read
   before the batch may be stale. Each guard is an
   `INSERT INTO write_guards(batch_id, code, ok) VALUES (?, ?, (SELECT <condition>))`
   into a table with `CHECK (ok = 1)`. A false condition fails the CHECK
   and rolls back the whole batch. The last statement deletes the batch's
   guard rows. On a CHECK failure the store re-runs the guard selects
   read-only to name the failed guard and throws its `DomainError` (409).
2. Idempotency row (when the route uses a key), see below.
3. Changes in order.
4. Audit rows (`access_log`), so an audit row exists exactly when the
   change committed.

D1 serializes writes per database, so a batch is atomic and isolated;
guards close the gap between the read and the batch. A Postgres store
later runs the same plan inside `BEGIN ... COMMIT` with the guards as
`SELECT ... FOR UPDATE` checks; the domain does not change.

Constraint failures map to codes: `UNIQUE slots(day,time)` ->
`SLOT_TAKEN`; `UNIQUE protocols(case_id) WHERE state='draft'` ->
`DRAFT_EXISTS`; idempotency primary key -> replay.

New migration `0004_write_api.sql` (Step 4 owns it):
- `write_guards(batch_id, code, ok CHECK (ok = 1))`.
- `idempotency_keys(key PRIMARY KEY, user_id, route, body_sha, response_json, status, created_at)`; rows older than 24 h are ignored and removed by reset.
- `case_access_grants(id, case_id, user_id, reason, granted_at, expires_at)`.
- `notifications(id, kind, to_user_id, case_id NULL, count, link, created_by, created_at, sent_at NULL)`: outbox, no medical data.
- `decision_reports` is not needed: the report snapshot is a column of the decision row, written in the same insert.
- `protocols.version INTEGER NOT NULL DEFAULT 0`, `attendance_sets.version`, `fact_edits.id`, if Step 2 did not add them.
- `demo_state(id = 1, seed_version, data_epoch, reset_at, reset_by, reset_in_progress)`.
- Append-only triggers (from Step 2) on `decisions`, `status_history`, `edit_log`, `alert_events`, `access_log` get the condition `WHEN (SELECT reset_in_progress FROM demo_state WHERE id = 1) = 0`, so only the reset batch may clear them. The pilot build ships triggers without that condition (separate migration file, selected by environment); recorded as a risk.

### 5. Request handling common to every write route

Middleware `writeGuard` on `POST/PUT/PATCH/DELETE /api/*`:
- Session from Step 1 auth; 401 `NOT_SIGNED_IN` otherwise.
- `Content-Type: application/json`; body size limit 256 KB (approve with report HTML) else 64 KB.
- CSRF: `Origin` must equal the Worker origin; cookie `SameSite=Strict` (Step 1).
- `X-Data-Epoch` header must equal `demo_state.data_epoch`; otherwise 409 `DATA_RESET`, so a tab opened before a reset cannot write into the new data.
- Validation with `zod` (pinned; via `@hono/zod-validator`); a validation failure returns 422 `INVALID_INPUT` with `fields: { name: message_cs }` for form fields.
- Role and membership check before any write; a refusal returns 403 and writes one `access_log` row `odmítnuto: <action>` (no case content), so break-glass review also sees refused attempts.
- Every response body carries `{ data, audit_id, data_epoch }`; errors are `{ error: { code, message_cs, current? } }`, where `current` is the server state on a 409 so the client can redraw without a second call.

Audit row columns (`access_log`): `id, at (ISO UTC), actor_user_id,
actor_name_snapshot, acting_as_user_id, acting_as_role, case_id NULL,
action_code, detail_cs, target_type, target_id, break_glass (0/1),
request_id, data_epoch`. Reads (Step 2) and these writes share it.

### 6. Endpoints

All paths under `/api`. "Member" means doctor with membership or grant.
"Batch" lists what one D1 batch contains, guards first, audit last.

#### Status, closing, slots

**`POST /cases/:id/status`** `{ to, expected_status }`
- Who: doctor member, coordinator.
- Rule: `to` in `manualMoves`; `expected_status` equals current. `to = closed` runs `closeCase`.
- Batch: guard status = expected; `UPDATE cases SET status`; `INSERT status_history (from, to, by, at, how = 'ručně' | 'ručně, znovu otevřeno')`; on close and unlocked slot `DELETE FROM slots WHERE case_id` (guard: no decision on that slot); audit `změnil(a) stav případu: A -> B (ručně)` and, when freed, `uvolnil(a) termín MDT při uzavření případu (den čas)`.
- Response: case header (status, slot, last history row), `slot_released: bool`.
- Errors: 409 `STATUS_MOVE_NOT_ALLOWED` "Tuto změnu stavu nelze provést.", 409 `STATUS_CHANGED` "Stav případu mezitím změnil jiný uživatel."

**`PUT /cases/:id/slot`** `{ day, time }` (also used for moving)
- Who: doctor member, coordinator.
- Rule: `validateSlot`; case not closed; current slot not locked.
- Batch: guard not closed; guard current slot not locked; `DELETE` the case's current slot; `INSERT slots (day, time, case_id)` (UNIQUE); `new -> scheduled` with history `automaticky při rezervaci termínu`; audit `naplánoval(a) na MDT (den čas)`.
- Response: case header, `warning_cs` when outside seminar time ("mimo čas semináře").
- Errors: 409 `SLOT_TAKEN` "Termín mezitím obsadil jiný případ. Vyberte jiný.", 409 `SLOT_LOCKED` (mock text `LOCK_WHY`, 1536), 409 `CASE_CLOSED` "Uzavřený případ nelze naplánovat; nejdřív ho znovu otevřete."

**`DELETE /cases/:id/slot`**
- Same roles; guard not locked; `scheduled -> new` with history `automaticky po uvolnění termínu`; audit `uvolnil(a) termín MDT (...)`.

#### Protocol, approval, new version

**`PUT /cases/:id/protocol`** `{ version, notes?, conclusion?, steps?: [{ id?, text, who_user_id, due }] }` (partial; `mode` stays client view state)
- Who: doctor member.
- Rule: `canEditProtocol`; `version` equals stored.
- Batch: guard version and `state='draft'` and case not closed; `UPDATE protocols SET ..., version = version + 1, updated_by, updated_at`; audit `upravil(a) koncept protokolu MDT` **at most once per user, case and 10 minutes** (autosave would otherwise flood the log; the route checks the last row before adding one).
- Response: `{ version, updated_at, updated_by }`. The client does not redraw the conclusion field from the answer (the mock's IME rule at 3772-3776).
- Errors: 409 `PROTOCOL_CONFLICT` "Koncept mezitím upravil(a) <jméno>." with `current`; 409 `PROTOCOL_LOCKED` "Závěr je schválen; koncept nelze měnit."; 409 `CASE_CLOSED`.

**`POST /cases/:id/decisions`** (approve) `{ protocol_version, conclusion, picked_sections: string[], report_html, attendance_expected: userId[] }`, header `Idempotency-Key: <uuid>`
- Who: doctor member.
- Rule: `approvalBlockers` empty; `conclusion` equals the stored conclusion after the client's last autosave, or the route first applies it as part of the same batch (the mock reads the field itself at 3733 for the same reason); `attendance_expected` equals the server's attendance plus the approver, otherwise 409 `ATTENDANCE_CHANGED` so the frozen report matches the frozen list.
- Batch: idempotency insert; guards (protocol version, state draft, case not closed, attendance version); protocol update to `approved`; decision insert with `supersedes`; approver attendance insert when needed; task inserts; suggestion inserts; notification insert when tasks > 0; case status `-> done` with history `automaticky při schválení závěru`; audit rows `schválil(a) závěr MDT`, optional `doplněn(a) mezi přítomné při schválení závěru`.
- Response: decision (ID, number, approver, time, slot, attendance snapshot), protocol, created tasks, created suggestions, case header.
- Errors: 403 `NOT_DOCTOR` "Závěr schvaluje lékař.", 422 `CONCLUSION_EMPTY` "Závěr zatím není zapsán.", 409 `ALREADY_APPROVED` "Závěr už je schválen.", 409 `CASE_CLOSED` "Uzavřený případ nelze projednat; nejdřív ho znovu otevřete.", 409 `PROTOCOL_CONFLICT`, 409 `ATTENDANCE_CHANGED` "Seznam přítomných se mezitím změnil; zkontrolujte ho a schvalte znovu.", 422 `IDEMPOTENCY_MISMATCH`.
- Report snapshot: the browser still renders `reportHtml` (jsPDF stays in the browser). The server stores it with its hash as sent by the approving doctor, and stores the structured frozen inputs next to it. It does not render it itself; recorded as a risk.

**`POST /cases/:id/decisions/new-version`** `{ expected_decision_id }`
- Who: doctor member.
- Rule: `newDraft`: latest protocol approved, case not closed, `expected_decision_id` is the latest decision.
- Batch: guard; insert a new `protocols` row (state draft, empty, version 0; partial UNIQUE prevents two drafts); status `done -> scheduled | new` with history `automaticky při novém závěru`; audit `začal(a) nový koncept závěru`.
- The previous decision is never touched; the next approval sets `supersedes`.
- Errors: 409 `NOT_APPROVED_YET` "Nový závěr lze začít až po schválení platného.", 409 `DRAFT_EXISTS`, 409 `CASE_CLOSED`.

#### Tasks and suggestions

**`PATCH /tasks/:id`** `{ done: boolean, expected_done: boolean }`
- Who: doctor member of the task's case, coordinator, or the assignee.
- Batch: guard `done = expected_done`; update with `done_by`, `done_at`; audit `označil(a) úlohu jako hotovou` / `vrátil(a) úlohu mezi otevřené` (new: the mock writes none).

**`PATCH /suggestions/:id`** `{ text?, who_user_id?, due? }`; **`POST /suggestions/:id/confirm`** `{}`; **`POST /suggestions/:id/dismiss`** `{}`
- Who: doctor member.
- Batch: guard `state='draft'`; update; confirm also inserts the task (`from_suggestion`, `confirmed_by`, `due_src`, `timing`); audit `potvrdil(a) návrh úlohy` / `zamítl(a) návrh úlohy` / `upravil(a) návrh úlohy`.
- Errors: 409 `SUGGESTION_DECIDED` "O návrhu už rozhodl(a) <jméno>.", 403 `NOT_DOCTOR` "Návrh úlohy potvrzuje lékař."

**`POST /notifications/digest`** `{}`
- Who: doctor, coordinator. Rate limit: one per user per minute (409 `DIGEST_TOO_SOON`).
- Batch: notification row `{ kind: 'digest', to: coordinator, count, link }`; audit `odeslal(a) přehled úloh e-mailem (N)`.

#### Question, fact edits, alerts

**`POST /cases/:id/question/confirm`** `{ draft_sha }`
- Who: doctor member. Rule: `confirmDraft`.
- Batch: guard draft hash; insert `question_confirmations`; insert `edit_log (confirmed)`; audit `potvrdil(a) návrh otázky pro MDT`.
- Errors: 409 `QUESTION_CHANGED` "Návrh otázky se mezitím změnil; přečtěte si ho a potvrďte znovu.", 409 `NO_DRAFT_QUESTION`.

**`PUT /cases/:id/edits/:key`** `{ text, orig, expected_edit_id | null }`; **`DELETE /cases/:id/edits/:key`** `{ expected_edit_id }`
- Who: doctor member.
- Batch: guard current edit ID; upsert or delete `fact_edits`; insert `edit_log`; audit `upravil(a) údaj (<key>)` / `vrátil(a) původní údaj (<key>)`.
- `orig` is what the client showed; the server stores it with the current `extraction_run_id`, so a later re-extraction can detect that the source changed under a confirmed edit (Step 6 uses it).
- Errors: 409 `EDIT_CONFLICT` "Údaj mezitím upravil(a) <jméno>.", 403 `NOT_DOCTOR` "Údaje upravuje lékař."

**`POST /alerts/:id/events`** `{ action: 'ack' | 'resolved' | 'reopen', expected_state }`
- `:id` is the stable alert ID from Step 2 (not the mock's array index).
- Who: doctor member, coordinator.
- Batch: guard latest event state; insert `alert_events`; audit `<ALERT_ACT text>: <kind label>`.
- Response: the alert with its event history. Never changes approval or case status.
- Errors: 409 `ALERT_STATE_CHANGED`, 422 `ALERT_ACTION_NOT_ALLOWED`.

#### Sessions and attendance

**`POST /sessions`** `{ day, start_case_id? }`; **`DELETE /sessions/:day`**
- Who: doctor, coordinator.
- Batch: guard no open session for the day and at least one booked case (start); insert or set `ended_at`; audit `zahájil(a) MDT` / `ukončil(a) MDT` on the first case of the day (the mock logs on the open case). Hook `onSessionEnded`.
- Errors: 409 `SESSION_RUNNING`, 409 `NO_CASES_THAT_DAY` "Na tento den není naplánován žádný případ."

**`PUT /sessions/:key/attendance`** `{ version, by_dept: { dept_id: user_id[] } }`
- Who: doctor, coordinator. `:key` is a day or `case:<id>`.
- Batch: guard version; replace the set's rows; version + 1; audit `upravil(a) přítomné na MDT (N)`.
- Errors: 409 `ATTENDANCE_CONFLICT` with `current`; 422 `ATTENDEE_INVALID` "Osoba není v seznamu personálu tohoto pracoviště."

#### Case creation and break-the-glass

**`POST /cases`** `{ first_name, last_name, birth_number, consent: true, question?, owner_user_id?, dept?, intake_fixture?, duplicate_override?: { birth_number, reason } }`, header `Idempotency-Key`
- Who: doctor, coordinator.
- Rule: `validateReferral`; `duplicateDecision`; `intakeFixtureAllowed`.
- Batch: idempotency insert; guard "no patient with this normalized birth number" unless override; insert `patients` (identity only), `cases` (question explicit or empty; the drafted question for an empty one comes from extraction, never typed by the server), `case_members`, `status_history (null -> new)`; audit `vytvořil(a) případ` and, with override, `vytvořil(a) nový záznam, přestože rodné číslo už v databázi je: <reason>` (the reason is staff text, length-limited).
- Response: case header and list row.
- Errors: 422 `INVALID_INPUT` with field messages from the mock (3628-3634); 409 `DUPLICATE_BIRTH_NUMBER` "Rodné číslo už v databázi je." with `current: { case_id }` (for the "Otevřít" link); 422 `OVERRIDE_REASON_REQUIRED` "Uveďte důvod, proč zakládáte druhý záznam."; 409 `FIXTURE_USED`.

**`POST /cases/:id/break-glass`** `{ reason }`
- Who: doctor who is not a member.
- Batch: insert `case_access_grants`; audit with `break_glass = 1` and the reason.
- Admin's access-log view shows that it happened, not the clinical content (INTEGRATION.md).

#### Staff

`POST /staff/departments` `{ name }`; `DELETE /staff/departments/:id`;
`POST /staff/departments/:id/people` `{ pre, sur, post, fn, role }`;
`PATCH /staff/people/:id` `{ field, value, expected }`;
`DELETE /staff/people/:id`; `POST /staff/reset`.
- Who: coordinator, admin.
- Rules from `staff.ts`; removing a person also removes them from attendance sets that no decision froze (as 2166); open tasks and steps keep the user ID, so a rename follows automatically and history keeps `name_snapshot`.
- Audit texts as the mock (`přidal(a) do personálu: ...`), with no case ID.
- Errors: 409 `STAFF_NAME_TAKEN` "<jméno> už v seznamu je", 422 `SURNAME_REQUIRED` "Příjmení nelze smazat; osobu odeberte tlačítkem ✕", 409 `DEPT_NOT_EMPTY`, 409 `CANNOT_REMOVE_SELF`.
- `POST /staff/reset` restores the fictional default staff only; refused while any case refers to a non-default user in an open task (409 `STAFF_IN_USE`), otherwise reset-demo is the tool.

#### Audit view events

**`POST /audit/events`** `{ case_id?, code, target? }`
- For views the server cannot see because the data is already loaded: `case_opened`, `source_viewed` (document ID and page), `guide_opened`, `prognosis_source_opened`, `slot_detail_viewed`, `fhir_exported`, `report_downloaded`.
- `code` from an allowlist; no free text. Read access to the case is checked.

#### Reset demo

**`POST /admin/reset-demo`** `{ confirm: "OBNOVIT" }`. Section 8.

### 7. Frontend change pattern

A small client in the page:

```js
const API = { on: false, epoch: null };            // set from GET /api/health
async function write(method, path, body, { idem } = {}) { ... }  // adds X-Data-Epoch, Idempotency-Key; returns data or throws ApiError
function refused(err) { toast(err.message_cs); }    // the Czech message from the server
```

Each mutating action is split into one `apply*` function that updates `S`
from a server-shaped object, used in both modes:

```js
async function doSchedule(file, slot) {
  if (!API.on) return scheduleAtLocal(file, slot);   // embedded mode: today's code, unchanged
  setPending(file);
  try { applyCase(await write("PUT", `/cases/${id(file)}/slot`, slotBody(slot))); }
  catch (e) { refused(e); if (e.current) applyCase(e.current); }
  finally { clearPending(file); render(); }
}
```

Optimistic or pessimistic per action:

| Action | Mode | Why |
|---|---|---|
| Notes, conclusion, steps | optimistic, debounced autosave (800 ms, plus on blur and before approve) | typing must never wait; the conclusion field is not redrawn from the answer; on conflict a bar shows the other version and the doctor picks, nothing is overwritten |
| Attendance, task done, staff field edit | optimistic with rollback on error | small, reversible, frequent |
| Alert events | optimistic with rollback | one click, reversible |
| Status, close, reopen, schedule, unschedule, drag-drop | pessimistic with a pending state on the slot | conflicts (`SLOT_TAKEN`) are likely between users; the calendar must show the truth |
| Approve, new version | pessimistic, button disabled while pending, same idempotency key on retry | clinical record; a double click must make one decision |
| Question confirm, fact edit and revert, suggestion confirm and dismiss | pessimistic | doctor confirmations must reflect the stored state |
| Create case, break-glass, digest, sessions, reset | pessimistic | rare; server decides |

`logAccess` in API mode becomes a no-op for actions whose route writes
the audit row, and calls `POST /audit/events` for the view events listed
above. The admin access-log view reads `GET /admin/access-log` (Step 2).
Embedded mode keeps today's `logAccess`.

On 409 `DATA_RESET` the page shows "Ukázková data byla obnovena, stránka
se znovu načte." and reloads all data.

The "ukázková data" banner: shown in API mode on every view, from
`GET /api/health` (`demo: { seed_version, reset_at, data_epoch }`):
"Ukázková data: všechny osoby a případy jsou smyšlené. Změny vidí všichni
návštěvníci; správce je může obnovit (naposledy <čas>)." The embedded
build keeps its existing synthetic labels.

### 8. Reset-demo

`POST /admin/reset-demo` `{ confirm: "OBNOVIT" }`
- Who: admin. Enabled only when `DEMO_RESET_ENABLED=true` (set on the demo Worker, absent in a pilot). In `AUTH_MODE=demo` anyone can pick the admin in the role picker; acceptable for synthetic data, stated in the UI ("v ukázce může obnovit kdokoli, kdo zvolí roli správce").
- Steps:
  1. Archive: stream all `access_log`, `decisions`, `edit_log`, `alert_events`, `status_history` rows since the last reset to R2 `audit-archive/<reset-at>.jsonl` (synthetic data only; the research note's audit export uses the same prefix). If the archive fails, nothing is deleted (500 `RESET_ARCHIVE_FAILED`).
  2. One D1 batch: `UPDATE demo_state SET reset_in_progress = 1`; `DELETE` from every mutable table (cases, patients, case_members, status_history, slots, sessions, attendance, protocols, decisions, tasks, task_suggestions, question_confirmations, fact_edits, edit_log, alert_events, notifications, case_access_grants, idempotency_keys, write_guards, access_log, users, departments and memberships); re-insert the seed rows (generated by `api/seed` at build time into `api/seed/seed.sql` and imported as text, so Step 2's seed and the reset use the same file; `alerts`, `documents`, `pages`, `deviation_assessments` seed rows are part of it); `UPDATE demo_state SET reset_in_progress = 0, data_epoch = data_epoch + 1, reset_at, reset_by`; insert one `access_log` row `obnovil(a) ukázková data (seed <version>)` with the actor.
  3. R2: delete objects under `uploads/`, `audio/` and `jobs/` (Steps 5 and 6 prefixes). Seed objects live under `seed/` and are never touched. Done after the batch; a failure here is reported in the response (`r2_left: n`) and retried by the next reset.
- Response: `{ data_epoch, reset_at, seed_version }`. Every open tab gets `DATA_RESET` on its next write and reloads.
- If the seed is larger than one batch allows (see Risks), the reset uses a staging pattern: write the seed into the tables while `reset_in_progress = 1` across several batches, and every other write route refuses with 503 `RESETTING` "Ukázková data se právě obnovují, zkuste to za chvíli." until the flag clears.

## Implementation order

Each line is one PR-sized commit on `backend`, merged when the demo path
works in both modes.

1. **4a Foundations** (0.5 day): `domain/errors.ts`, `roles.ts`, `audit.ts`; `Plan` type; D1 `commit` with guards, idempotency and audit; `writeGuard` middleware (CSRF, epoch, validation, refusal audit); migration `0004_write_api.sql`; `POST /audit/events`; frontend `write()`, error toast, `DATA_RESET` reload, banner; `logAccess` routed to `/audit/events` in API mode.
2. **4b Reset-demo** (0.5 day): seed SQL as a build artifact, `demo_state`, trigger condition, archive, R2 cleanup, admin button in Administrace. First, because every later PR dirties the shared demo database during testing.
3. **4c Status, close, slots** (0.5 day): `status.ts`, `close.ts`, `slots.ts`; three routes; calendar and status menu in API mode, including drag-drop.
4. **4d Protocol, approve, new version** (1-1.5 days): `protocol.ts`, `approve.ts`, `suggest.ts` port; autosave; approval with idempotency and attendance check; new version. The demo's core path; the cut line for a minimum demo is after 4e.
5. **4e Question, edits, alerts** (0.5 day): three domain modules, four routes, UI wiring.
6. **4f Tasks, suggestions, digest** (0.5 day).
7. **4g Sessions and attendance** (0.5 day).
8. **4h Case creation and break-the-glass** (0.5 day): intake form against `POST /cases`, duplicate prompt with reason field, S02 fixture once; break-glass dialog.
9. **4i Staff writes** (0.5 day): staff screen against the API; role field on add.
10. **4j Docs** (0.25 day, can ride with each PR): `docs/design/PRODUCT.md` (F-02 override reason, F-12 closed case not bookable, F-38/F-39 roles), `docs/design/INTEGRATION.md` "What the demo shows" (server rules, banner), `docs/design/TECHNOLOGIES.md` (`zod`), `README.md` (reset), `.env.example` / `wrangler.jsonc` (`DEMO_RESET_ENABLED`). Mechanism 3: every shape change updates its consumers in the same PR.

## Tests

**Domain unit tests** (`api/test/domain/*.test.ts`, plain Vitest, no
Workers runtime), one file per module, table-driven where possible:

- `status`: every row of the move table for each status; `scheduled` and `done` never manual; reopen returns to the closed-from status; reopen of a case closed from `scheduled` whose slot was freed goes to `new`; admin gets no moves.
- `close`: frees an unlocked slot; keeps a locked one; hook called.
- `slots`: grid and range validation; locked after approval, after close, after new version; outside-seminar returns a warning, not an error; closed case refused.
- `protocol`: coordinator and admin refused; approved protocol refused; stale version refused with current; `newDraft` refuses when the latest protocol is a draft (the 3724 wipe bug) and when closed.
- `approve`: blockers for each reason; **open alerts of every kind, including missing documents, do not block**; approver added to attendance when absent and not duplicated when present; steps with blank text dropped; `supersedes` points at the previous decision; status goes to `done`; one notification only when tasks > 0 and it carries no conclusion text.
- `suggest` (CLAUDE.md "negated finding read as positive"): "radioterapie není indikována" gives no draft; "bez nutnosti doplnit" gives none; "nefrektomie", "neurochirurg" are not negations; "kontrolní MR za 3 měsíce" gives a computed date from the approval date (31 January plus one month is end of February); "za 2-3 měsíce", "1/2027", "v lednu 2027" give no date and keep the wording ("03/2024" stays a month, never a made-up day); no clause gets a default date.
- `suggestions`: confirm creates a task with `confirmed_by`; a decided suggestion cannot be confirmed again; coordinator refused (a draft is never shown as approved).
- `question`: confirm with a stale hash refused (confirmed content never changes silently); no draft refused; coordinator refused.
- `edits`: save, revert, re-save keep a growing log; empty or unchanged text is a revert; stale edit ID refused; source value untouched.
- `alerts`: every transition; state from events; `missingSignal` stays on after ack and only drops a resolved item from the count; no action can disable the kind.
- `attendance`, `sessions`, `staff`, `breakglass`, `intake`: role cases; duplicate birth number with and without slash; override without reason refused; override for a different number refused (mock 3667 rule); S02 fixture once; staff name uniqueness including the admin; remove person keeps history names; department removal only when empty.
- `roles`: the whole permission matrix in section 2 as one table test, including the acting-as user.

**Route tests** (`api/test/routes/*.test.ts`, Vitest with the Workers
pool and a local D1 from the migrations plus seed):

- For every write route: success writes exactly the expected rows and at least one `access_log` row with actor and acting-as; a refusal writes no data rows and one `odmítnuto` row; a guard failure rolls back everything (assert row counts unchanged).
- Role matrix per route: doctor member, doctor non-member, doctor with break-glass grant, expired grant, coordinator, admin, acting-as.
- Concurrency: two `PUT /slot` to the same slot in parallel, exactly one wins; two approvals with the same idempotency key, one decision and identical responses; two with different keys, one `ALREADY_APPROVED`; stale protocol version returns 409 with `current`.
- Append-only: direct `UPDATE`/`DELETE` on the five append-only tables fails outside reset.
- Reset: after a scripted session of writes, reset restores row counts and contents equal to a fresh seed (table-by-table checksum), bumps `data_epoch`, keeps `seed/` objects, deletes `uploads/`; an old epoch write gets `DATA_RESET`.
- **Privacy test**: after running every route test, no `access_log.detail_cs` contains any seeded patient name, birth number, conclusion text or uploaded file name.
- CSRF: wrong `Origin` refused; non-JSON refused.

**Recorded browser check** (CLAUDE.md "match the evidence to the risk"),
written to the PR description: in API mode on the Worker, as a doctor:
book case 10 to a free slot, try a taken slot in a second tab, write and
approve a conclusion with an open missing-document alert, check the
decision, tasks and drafted tasks, confirm one draft, start a new
version, close the case, reopen it; as coordinator: confirm the
approve button is disabled and the server refuses a forged call (curl);
as admin: read the access log, reset the demo, see the other tab reload.
Repeat the approval path on Pages (embedded mode) to confirm nothing
changed there.

## Acceptance criteria

- [ ] Every action in the table of section 1 calls its endpoint in API mode, and the server enforces the rule even when the request is forged with curl.
- [ ] Each bold "missing" rule in section 1 has a domain test and a route test.
- [ ] No write route exists for retrospective deviation assessments; seeded assessments read back unchanged after any session and after reset.
- [ ] Approving twice (double click, retry, two tabs) produces one decision.
- [ ] Two users cannot book one slot; the loser sees "Termín mezitím obsadil jiný případ".
- [ ] Open alerts, including missing-document alerts, never block approval; the missing-document signal cannot be switched off.
- [ ] Decisions, status history, edit log, alert events and the access log refuse UPDATE and DELETE outside reset.
- [ ] Every committed write has an audit row with actor, acting-as, case and action, in the same batch; no audit row contains patient names, birth numbers, conclusions or file names.
- [ ] A drafted question, task or conclusion stays a draft until a doctor confirms it; a changed draft cannot be confirmed with a stale view.
- [ ] Errors reach the UI as the server's Czech `message_cs`.
- [ ] Reset-demo restores the seeded state (D1, R2 uploads, audit) and every open tab reloads; the "ukázková data" banner shows the last reset time.
- [ ] Embedded mode on Pages behaves exactly as before (manual check of the approval and calendar paths).
- [ ] Formatter, linter, type check and all tests pass; commands recorded in `README.md`.
- [ ] PRODUCT.md, INTEGRATION.md, TECHNOLOGIES.md, README and `.env.example` updated for the new rules and variables.
- [ ] A separate agent reviewed the approve, edits, alerts and audit code adversarially (Mechanism 4), and its findings are folded in.

## Risks

- **No interactive transactions in D1.** The guard-table pattern depends on a CHECK failure aborting the whole batch. Verify on the first day with a two-statement test against local and remote D1; the fallback is one Durable Object per case that serializes writes for that case.
- **D1 limits for reset.** Statements per batch and queries per invocation (lower on the Free plan) may not fit the seed as single-row inserts. Mitigation: multi-row inserts; measure the seed (11 cases, small); staging pattern with `RESETTING` if needed.
- **Trigger bypass flag.** The `reset_in_progress` condition weakens append-only protection on the demo database. The pilot migration must ship triggers without it; add a test that the pilot migration set has no `demo_state` reference.
- **Client-built report snapshot.** The server stores the HTML the approving doctor's browser built; it cannot prove it matches the data. Mitigation: store the structured frozen inputs (conclusion, attendance, picked sections, protocol version) next to it and its hash; move report rendering to the server later.
- **`orig` of a fact edit comes from the client.** Acceptable while the extraction JSON shape is browser-rendered; Step 6 should resolve `orig` from the stored extraction by key.
- **Role decisions not yet confirmed** by the team (open points 1-3 below). Wrong guesses mean a coordinator gets a refusal during the demo; the matrix is one table to change.
- **Shared demo.** A jury member's approval is seen by everyone until reset; the banner says so, and the admin can reset between sessions.
- **Frontend split.** If Step 3 has not split `v3-template.html` into modules, wiring 20 actions into one 3,900-line file is error-prone; keep each action's API branch next to its local branch and test both modes.
- **Autosave flooding.** Debounce plus the 10-minute audit coalescing; watch D1 write counts during a live demo.

## Open points (to add to `docs/agent/OPEN_QUESTIONS.md`)

1. May the coordinator edit the "Další kroky" steps (assignees, due dates) before approval, or only doctors? Design: doctors only, as INTEGRATION.md gives coordinators "no clinical edits".
2. May the coordinator acknowledge or resolve alerts (for example a missing report she has requested)? Design: yes.
3. Membership seeding: all six MDT departments on every case (design) or the referring department plus those named at referral?
4. Is booking a closed case refused (design) or allowed as in the mock?

## Effort

About 5-6 days for one developer with agents (4a-4j above), at the top
of the research note's 3-5 day estimate because the missing rules, the
idempotency and guard pattern and reset-demo add work beyond moving
code. A minimum demo slice (4a-4e: foundations, reset, calendar and
status, protocol and approval, question, edits and alerts) is about
3.5 days and covers everything the jury clicks in the demo path.

## As implemented

Status: built on the `backend` branch, 2026-10-17 (issue #5). This section
records where the build differs from the design above, which was written
before Steps 2 and 3 existed, and the exact API contract the page uses.

### Differences from the design

- **Migration number.** Step 2 shipped `0001_init.sql` and
  `0002_append_only.sql`, so the write API's migration is
  `0003_write_api.sql`.
- **One protocol row per case.** Step 2 made `protocols.case_id` the primary
  key. "Nový závěr" therefore resets that row to an empty draft (guarded by
  `state = 'approved'`) instead of inserting a second row; the approved text
  lives on in its `decisions` row, which is never changed.
- **Attendance sets.** Step 2's `attendance` table was keyed by day only and
  held no rows. It is replaced by `attendance(set_key, dept_id, position,
  user_id, user_name)` plus `attendance_sets(set_key, version)`. A set key
  is a seminar day (`2026-10-22`) or `case:<case id>` for a case without a
  slot.
- **Alerts keep their position key on the wire.** The page still keys
  alerts by position (`3` for a flag, `gap:1` for a data gap). The route
  `POST /cases/:id/alerts/:key/events` takes that key and resolves the
  stable alert ID of the current extraction run on the server;
  `alert_events` stores the stable ID.
- **Plans are built in the route.** The domain functions are pure and
  decide (result or `DomainError`); the route turns the decision into one
  guarded D1 batch through `store/write.ts` (`tx.guard`, `tx.run`,
  `tx.audit`, `tx.commit`). The domain does not emit SQL, so a Postgres
  store reuses the same domain functions.
- **Seed for the reset lives in R2.** `api/seed/out/` is gitignored and CI
  does not run the seed, so the Worker cannot import the seed SQL as a
  module. `seed.py` uploads the data part of the seed as
  `seed/reset.json` (statements grouped into multi-row inserts) next to the
  other seed objects; reset-demo reads it from there.
- **Question confirmation hash.** The server computes `draft_sha` (SHA-256
  of `cases.question_draft`) and sends it with the case state; the page
  echoes it back, so it needs no hashing of its own.
- **A fourth directory role, `staff`.** Department members without a
  doctor's role (the staff screen allows titles other than "MUDr.") need a
  `users` row to appear in attendance. They get role `staff`, which may not
  sign in or act; the role picker lists doctors, the coordinator and the
  administrator only.
- **Fact edit concurrency.** `fact_edits.log_id` names the `edit_log` row
  that set the current override; a write sends it as `expected_edit_id`.
- **No `zod`.** Validation lives in the domain functions, which return the
  Czech field messages the form shows; it avoided a new dependency.
- **Idempotency stores `data` only.** A replay answers the stored `data`
  with a freshly read `state`, because the state is read after the batch
  commits. Keys are refused (422) when missing on approve and new case.
- **Reset touches only what the app writes.** Documents, pages, extraction
  runs, alerts and roles change only through `seed.py`, so reset-demo
  leaves them; it empties the mutable tables and reinserts their seed rows
  with foreign keys deferred to the commit. Seeded patient rows stay
  (identity is never copied to R2); patients created later are deleted.
  `sqlite_sequence` is reset for those tables, so a reset database equals
  a fresh seed (`test/write.test.ts`).
- **`seed.py --reset` uses the same flag** instead of dropping and
  recreating the triggers, and bumps `data_epoch` too.
- **Duplicate-override reason stays with the case** (`cases.duplicate_override_reason`):
  it is staff free text that may name the patient, so the access-log line
  only says that a second record was created.
- **New cases** get IDs `NO-100` and up (`<n>_novy.pdf`), processing
  `none`; the S02 intake fixture gets `NO-S02` once.
- **Hooks** `onCaseClosed`, `onApproved`, `onSessionEnded` are no-ops in
  `api/src/routes/hooks.ts` for Step 5.

### Contract (what the page sends and receives)

Every write sends `Content-Type: application/json`, the demo user header
`X-Demo-User`, and `X-Data-Epoch` (from `GET /api/health` `demo.data_epoch`
or `GET /api/workflow` `data_epoch`). Approve and new case also send
`Idempotency-Key` (a UUID kept for the retry of the same click).

Success: `200 { data, data_epoch, state }`. `state` holds any of
`cases: { <case id>: CaseState }`, `att: { <set key>: AttSet }`,
`sessions: Session[]`, `mails: Mail[]`, `patient: <patient row as
GET /api/patients>`, `staff: <as GET /api/staff>`; the page replaces the
named parts and keeps the rest.

Error: `{ error: { code, message_cs, current?, fields? } }`. The page shows
`message_cs`. `409 data_reset` makes the page say "Ukázková data byla
obnovena, stránka se znovu načte." and reload; `503 resetting` is shown as
is.

`GET /api/workflow` (one audit row "načetl(a) stav projednání") returns
`{ data_epoch, cases, att, sessions, mails }` for every case the viewer may
read.

`CaseState`:

```
{ case_id, file, status, slot: {day, time} | null, updated,
  statusHist: [{ from, to, by, when, how }],
  protocol: { notes, concl, steps: [{ text, who, due }], state: "draft" | "approved",
              version, updated_by, updated_at, approver, approved_at },
  decisions: [{ id, version, text, by, when, slot, attSnap, pickSnap, reportSnap, supersedes }],
  tasks: [<as GET /api/tasks>],
  sugg: [{ id, pid, case_id, decision, text, quote, who, due, dueSrc, dueBy, timing, state, by, when }],
  edits: { <key>: { id, text, orig, by, when } },
  editLog: [{ key, orig, text, by, when, reverted, confirmed }],
  qConfirm: { text, by, when } | null, draft_sha: <hex> | null,
  alertHist: [{ i, action, who, when }],
  clinical: true | false }
```

Times (`when`, `*_at`) are ISO 8601 UTC; the page formats them. `edits`
keys are the page's keys without the `<file>|` prefix. `clinical: false`
means edits and alert history were withheld for the role
(`CLINICAL_ACCESS=doctors_only`).

`AttSet`: `{ key, version, byName: { <dept name>: [names] }, byId: { <dept id>: [user ids] } }`.
`Session`: `{ day, started_by, started_at, ended_at }`.
`Mail`: `{ kind: "approval", case_id, pid, n, by, when }` or
`{ kind: "digest", to, n, by, when }` (no medical text; the page builds the
"N úloh čeká" line and the link).

| Method and path | Body | Answer `state` |
|---|---|---|
| `POST /audit/events` | `{ case_id?, code, target? }` (codes below) | none |
| `POST /cases/:id/status` | `{ to, expected_status }` | `cases` (`data.slot_released`) |
| `PUT /cases/:id/slot` | `{ day, time }` | `cases` (`data.warning_cs` outside seminar time) |
| `DELETE /cases/:id/slot` | `{}` | `cases` |
| `PUT /cases/:id/protocol` | `{ version, notes?, concl?, steps? }` | none; `data: { version, updated_at, updated_by }`; 409 `protocol_conflict` with `current` = protocol |
| `POST /cases/:id/decisions` | `{ protocol_version, conclusion, picked_sections, report_html, attendance_expected: [names] }` + `Idempotency-Key` | `cases`, `att`, `mails` |
| `POST /cases/:id/decisions/new-version` | `{ expected_decision_id }` | `cases` |
| `PATCH /tasks/:id` | `{ done, expected_done }` | `cases` |
| `PATCH /suggestions/:id` | `{ text?, who?, due? }` | `cases` |
| `POST /suggestions/:id/confirm`, `/dismiss` | `{}` | `cases` |
| `POST /notifications/digest` | `{}` | `mails` |
| `POST /cases/:id/question/confirm` | `{ draft_sha }` | `cases` |
| `PUT /cases/:id/edits/:key` | `{ text, orig, expected_edit_id }` | `cases` |
| `DELETE /cases/:id/edits/:key` | `{ expected_edit_id }` | `cases` |
| `POST /cases/:id/alerts/:key/events` | `{ action: "ack" \| "resolved" \| "reopen", expected_state }` | `cases` |
| `POST /sessions` | `{ day }` | `sessions` |
| `DELETE /sessions/:day` | `{}` | `sessions` |
| `PUT /attendance/:key` | `{ version, by_dept: { <dept id>: [user ids] } }` | `att` |
| `POST /cases` | `{ first_name, last_name, birth_number, consent, question?, owner?, dept?, intake_fixture?, duplicate_override?: { birth_number, reason } }` + `Idempotency-Key` | `patient`, `cases` |
| `POST /cases/:id/break-glass` | `{ reason }` | none; `data.expires_at` |
| `POST /staff/departments` | `{ name }` | `staff` |
| `DELETE /staff/departments/:id` | `{}` | `staff` |
| `POST /staff/departments/:id/people` | `{ pre, sur, post, fn, role: "doctor" \| "staff" }` | `staff` |
| `PATCH /staff/people/:id` | `{ field: "pre" \| "sur" \| "post" \| "fn", value, expected }` | `staff` |
| `DELETE /staff/people/:id` | `{}` | `staff` |
| `POST /staff/reset` | `{}` | `staff` |
| `POST /admin/reset-demo` | `{ confirm: "OBNOVIT" }` | none; `data: { data_epoch, reset_at, seed_version, r2_left }` |

View events for `POST /audit/events` (the server writes fixed Czech text;
the page sends no free text): `slot_detail_viewed`, `guide_opened`,
`prognosis_source_opened`, `prognosis_sources_opened`, `source_viewed`
(`target`: page number), `fhir_exported`, `fhir_imported` (no case),
`report_downloaded`, `recording_on`, `recording_off`,
`recording_stopped_all_approved`, `recording_speaker_pass`,
`recording_summary`, `recording_audio_deleted`, `upload_added` (`target`:
count), `upload_removed`.

`GET /api/health` adds `demo: { data_epoch, reset_at, seed_version,
reset_enabled }`.

### Verification of the guard approach

- **Local D1 in workerd (Vitest).** `test/write.test.ts` builds a batch
  whose first statement passes, second guard fails, then an `UPDATE` and an
  audit row: nothing persists, no audit row, no guard row left.
- **Local D1 under `wrangler dev`** (2026-10-17, seeded with
  `npm run seed:local`): moving case 10 onto a taken slot answers
  `slot_taken`, and its own slot, deleted earlier in the same batch, is
  still there (the batch rolled back); 20 parallel `PUT /attendance` with
  version 0 gave one 200 and 19 `attendance_conflict`, the Worker log
  showed `{"store":"guard_failed","guard":"version"}` for a batch that had
  passed the read check, and the database held one set, version 1, one
  audit row, no guard rows; 6 parallel approvals with different keys made
  one decision.
- **Reset size.** The seed's mutable rows group into 7 multi-row inserts;
  the reset batch is about 40 statements (`data.statements` in the
  answer), under the 50 queries per invocation of the Workers Free plan.
