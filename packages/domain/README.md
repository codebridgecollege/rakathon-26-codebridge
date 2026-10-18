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
| `edits.ts` | a doctor's correction of an extracted fact (edit keys, save, revert) |
| `roles.ts`, `access.ts`, `config.ts` | the permission matrix, read rules and the undecided role constants |
| `errors.ts` | `DomainError` and the refusal factories `D` |
| `time.ts`, `names.ts` | ISO day arithmetic, the Prague calendar day, the display name of a person |
| `wire.ts` | types of the JSON the API sends (health, me, staff, patients, tasks, workflow, the write envelope) |

What stays in `api/src/domain`: sessions, attendance, upload-session tokens, break-the-glass, audit, alerts, intake,
documents, transcripts, database row mapping, and the system clock (`clock.ts`, because `crypto.randomUUID` is a
runtime global). Those either need server state or have no browser use yet.

## Rules for code here

- **No runtime globals.** `tsconfig.json` has no DOM and no Workers types, so `fetch`, `crypto`, `window` or a
  Cloudflare binding fail the type check. Clocks and ID sources are injected (`Clock` in `time.ts`).
- **No server imports.** Nothing here imports from `api/`. The Worker imports from here (`@codebridge/domain/<file>`).
- **Wire types are checked against the Worker.** `api/src/wire-check.ts` fails `npm run typecheck` in `api/` when a
  route builds an object that no longer fits `wire.ts`.

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
- [ ] `slots.ts`: the seminar warning text.
- [ ] `suggest.ts`: the draft task verbs (`"Objednat"`, `"Domluvit radioterapii"`, ...). The Czech month names and
      phrase patterns that parse a conclusion are content rules, not interface text, and stay (I18N.md, "What stays
      Czech-only on purpose").
