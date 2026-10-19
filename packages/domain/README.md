# @codebridge/domain

The pure case rules that both the API Worker (`api/`) and the Nuxt app (`app/`) use, so a clinical rule exists once
instead of being copied by hand between the page and the server. Design: `docs/design/FRONTEND.md`, "Language:
TypeScript".

The server stays the authority: the browser uses these rules only to show the right buttons and messages before a
request; the Worker checks every write again.

## What is here

| File | Rules |
|---|---|
| `status.ts` | case statuses, allowed manual moves, automatic moves on booking, freeing, approval and a new version |
| `slots.ts` | the MDT slot grid, booking, freeing, locked slots |
| `approve.ts` | approval blockers and the approval plan (frozen report, attendance, tasks, drafts) |
| `protocol.ts` | the discussion record (notes, conclusion draft, steps), autosave with versions |
| `suggest.ts` | task drafts from an approved conclusion, due dates |
| `fhir.ts` | the FHIR R4 referral read into the "Nový pacient" form |
| `referral.ts` | the referral form's required fields, the birth number format and the duplicate birth number lookup |
| `edits.ts` | a doctor's correction of an extracted fact (edit keys, save, revert) |
| `roles.ts`, `access.ts`, `config.ts` | the permission matrix, read rules and the undecided role constants |
| `errors.ts` | `DomainError` and the refusal factories `D` |
| `calendar.ts` | the calendar grid: seminar hours, slot rows shown, week and month steps, the mini month, the agenda |
| `patient-list.ts` | the patient list: search, column filters (as codes), date range, order, paging, age |
| `task-list.ts` | "Moje úlohy", the coordinator's "Úlohy po MDT" groups and the digest count |
| `staff-edit.ts` | the staff screen's checks before a request (taken names, empty surname, the role of a new person) |
| `time.ts`, `names.ts` | ISO day arithmetic, the Prague calendar day, the display name of a person, a patient's name surname first |
| `wire.ts` | types of the JSON the API sends (health, me, staff, patients, tasks, workflow, the write envelope, documents, intake, upload sessions) |
| `case-data.ts` | the case data in the patient view's shape (full extraction, synthetic patient, unprocessed), which parts and tabs a case shows, document titles of references |
| `run-view.ts` | the case data of a codebridge.extraction/2 run: every view part computed from facts, composed views when the run has them, checks per section, alerts by ID, edit keys by fact or line ID |
| `case-view.ts` | the patient view's trust rules: alert states and archive, the missing-document signal, the MDT question (explicit, draft, confirmed, edited), certainty marks, timeline order and categories, prose linked to sources, source numbering |
| `quote-match.ts`, `page-text.ts` | finding a quote on the page image and in the transcription despite OCR errors; the transcription split into lines, tables and marked spans for the source viewer |
| `labs.ts` | lab values as written, reference ranges, the points of a series and the trend chart's geometry |
| `guideline.ts` | the guideline layer's strength scale (tiers from each society's grade), sorting and quote clamping |
| `prognosis.ts` | the prognosis tab's safe links, reference numbering and similarity details |
| `fhir-export.ts` | the case as a FHIR R4 Bundle with provenance per fact; labels come in through a translate function |

The patient-view files hold no interface text: they return codes, or take a translate function `t(id, args)` whose
IDs live in `i18n/cs/patient.ftl`.

What stays in `api/src/domain`: rules that are server-only by design (upload-session tokens, break-the-glass, audit,
intake, documents, transcripts, database row mapping, and the system clock in `clock.ts`, because
`crypto.randomUUID` is a runtime global), and pure rules that were not part of the first split (staff validation,
alerts, questions, suggestions, tasks, sessions, attendance, the report snapshot, the pipeline rules). The latter move
here when a ported screen needs them.

## Rules for code here

- **No runtime globals.** `tsconfig.json` has no DOM and no Workers types, so `fetch`, `crypto`, `window` or a
  Cloudflare binding fail the type check. Clocks and ID sources are injected (`Clock` in `time.ts`).
- **No server imports.** Nothing here imports from `api/`. The Worker imports from here (`@codebridge/domain/<file>`).
- **Wire types are checked against the Worker, in part.** `api/src/wire-check.ts` fails `npm run typecheck` in `api/`
  when the patient row, staff list, task, case state, attendance set or session the Worker builds no longer fits
  `wire.ts`. The envelopes the routes build inline (health, me, the lists, the workflow, the write answer) are not
  checked yet.

## Commands

```
npm test -w @codebridge/domain        # Vitest in Node
npm run typecheck -w @codebridge/domain
```

## Czech text still inside (moves to the catalogs in the I18N.md server phase)

Moving these out is phase 3 of `docs/design/I18N.md` (message keys and codes), not part of the package split:

- [ ] `errors.ts`: every `message_cs` of the `D` factories (about 60 refusals), including the ones built from a name
      (`protocolConflict`, `suggestionDecided`, `questionConfirmed`, `editConflict`, `staffNameTaken`, `deptNameTaken`).
- [ ] `status.ts`: `STATUS_CS` (status labels), the `how` texts of every status change and `statusLine` (an
      access-log sentence).
- [ ] `fhir.ts`: `LABEL_CS` (the `missing_cs` field names) and the `fhir_invalid` messages.
- [ ] `protocol.ts`, `edits.ts`, `approve.ts`: the `fields` messages of `invalidInput`; `approve.ts` also the
      assignee fallback `"neurčeno"`.
- [ ] `slots.ts`: the seminar warning text, and `WD` and `slotText` (Czech weekday abbreviations and the date format
      that go into access-log sentences).
- [ ] `suggest.ts`: the draft task verbs (`"Objednat"`, `"Domluvit radioterapii"`, ...). The Czech month names and
      phrase patterns that parse a conclusion are content rules, not interface text, and stay (I18N.md, "What stays
      Czech-only on purpose").
