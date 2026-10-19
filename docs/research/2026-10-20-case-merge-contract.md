# One case run from two producers: the contract between streams B and D

Status: agreed 2026-10-20 by stream B (#18) and stream D (#20), with stream E's (#21) rule placement. Both build
against it. When the code is merged, the settled parts move to EXTRACTION-FORMAT.md and api/AGENTS.md, and this note
keeps a pointer.

**The goal:** one codebridge.extraction/2 run per case, stored through `prepareRun` and `storeRun`
(`api/src/store/runs.ts`), so doctor confirmations, edits and alert acknowledgements carry over. Two producers feed
it:
- **B, the document pipeline without AI:** pages, readability, parts, identity per page, lab values from lab sheets,
  poor-copy and identity alerts.
- **D, the AI extraction:** the vision reading of pages that need it, and the facts with quotes.

## Fragments

Each producer writes one fragment per document, never a run. A fragment is a run's content for one document, with
facts drafted (no `key` or `id`) and alerts without IDs: the `DraftRun` parts that `prepareRun` takes. The type is
`Fragment` in `packages/domain/src/fragments.ts` (B), schema `"codebridge.fragment/1"`.

| | B, the pipeline | D, the AI extraction |
|---|---|---|
| File | `<output_prefix>fragment-pipeline.json` | `<output_prefix>fragment-ai.json` |
| Written by | ProcessDocumentWorkflow, `write` step | ExtractDocumentWorkflow, last step |
| `producer` | `pipeline` | `ai` |
| `draft_id` | `pipeline:<doc>:<n>` | `ai:<doc>:<n>` |
| Source IDs | `src-pl-<doc>-<n>` | `src-ai-<doc>-<n>` |
| Facts | `lab_result` from lab sheets | every other kind (`api/src/domain/extract/schema.ts`), never lab sheet values |
| Checks | `lab_result`: found, or `not_run` (the parser reads FNO lab sheets only, so it never claims nothing found) | each kind it looks for: found or nothing_found; `unreadable` holds the pages the model was not allowed to read (content filter, budget) |
| Alerts | `poor_copy` (subject: document), `identity_conflict` (subject: document, args `{document, page}`) | none; the same-date contradiction is a mark on the facts, not an alert |

`output_prefix` is `pipeline_runs.output_prefix`, which is `org/<org>/uploads/<case>/<doc>/<pl-run>/`. A withdraw
therefore deletes both fragments with the rest of the document. The alert subjects equal today's `document_alerts`
IDs (`alertId(rule|subject)`), so acknowledgements carry over.

## Identity and parts

- **Identity per page** is in `<output_prefix>identity.json`: `{"result": "matches"|"conflicts"|"cannot_verify",
  "pages": [{"n", "result"}]}`, codes only.
  - A page missing from the file counts as `cannot_verify`.
  - A conflict, once found, is never downgraded by a later reading.
  - D does not check identity itself. Each fact sets `quarantined` and `source.identity` from this result for its
    page.
  - D never sends a page with result `conflicts` to the model, neither as text nor as an image: the pseudonymization
    knows only the case's identifiers, not the other patient's. Such a page is listed as unread in D's checks. Its lab
    values stay in B's fragment, quarantined.
- **Parts** are D1 `document_parts` (`part_id "<doc>/p<ordinal>"`, `pages_json`), also in `<output_prefix>parts.json`.
  D extracts per part, so `source.part` is that ID.

## ProcessCase

`ProcessCaseWorkflow` (binding `PROCESS_CASE`, instance `case-<case>-<time>`) is B's. Three things start it:
- B's document run, at its end;
- a withdraw;
- D's ExtractDocumentWorkflow, at its end.

For each current document (lifecycle current, with a done pipeline run), it composes the latest fragment of each
producer. A missing AI fragment is simply absent, so the no-AI view appears first. It retries on `run_stale`. It only
stores when the case's current run is absent or has producer `pipeline`, and only for orgs in `PIPELINE_ORGS`.

The steps:
1. **`composeFragments(caseId, fragments, opts) -> DraftRun`** (B, pure, in `packages/domain`):
   - concatenates sources, facts and alerts;
   - merges checks per `looks_for`: `covered` and `unreadable` are unions, and `found` wins over `nothing_found`,
     which wins over `not_run`; every fact kind gets a check;
   - adds to each document's `identity_conflict` alert the quarantined draft_ids of every producer, not only B's;
   - carries each fragment's `stages` into `run.stages`.
2. **`prepareRun`**, against the case's previous run.
3. **The case rules** (stream E, `packages/domain/src/extraction/rules.ts` `applyCaseRules`), run on the prepared run
   with final IDs. Request without result, a report that is only cited, and contradictions live here. Their subjects
   hold "|", which `prepareRun`'s pair rewrite would sort.
4. **`storeRun`**, in one Tx with the retirement of the documents' `document_alerts`. The `model` and `promptVersion`
   options come from the AI fragment's stages.

## Triggers

B's document run starts ProcessCase. When the model is on for the org, B's document run also starts D's
`ExtractDocumentWorkflow` (`startExtraction`), which ends by starting ProcessCase again. The model is on when
`MODEL_*` is configured and `MODEL_ORGS` lists the org (`modelOn`). `MODEL_ORGS` is empty by default; real patients
need FNO's clearance for any cloud model first. The first ProcessCase shows the no-AI view; the second adds the
AI facts.
