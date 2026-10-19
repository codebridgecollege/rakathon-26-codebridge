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
| Source IDs | `sourceIdFor` (hash of document, part, page, quote) | the same, so one passage has one ID across producers and reruns |
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

For each current upload it takes the newest done pipeline run that has `fragment-pipeline.json`, and that run's
`fragment-ai.json` if present (D writes under the output prefix of the run it read, and stops when a newer one is
done). A check says `nothing_found` in the run only when every current document's fragments said so for that kind; a
document without its AI fragment makes it `not_run`. Alerts are deduplicated per rule and subject across producers.
The merge is started with `startCaseMerge(env, {org, caseId, by, byActor})` (`api/src/workflows/process-case.ts`). A missing AI fragment is simply absent, so the no-AI view appears first. It retries on `run_stale`. It only
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

## The NIS fragment (stream F, #22; built, for stream B to confirm)

The NIS import (stream F) joins the same merge instead of storing a run of its own, so the documents and the NIS
records of one case end up in one run, and confirmations carry over across both.

- **One import per case, not per document.** `org/<org>/nis/<case>/import.json`, one object with the fragment and its
  state, so two imports at once cannot leave a state naming one import next to the other's fragment. The fragment:
  schema `codebridge.fragment/1`, `producer: "nis"`, `document_id: "nis"` (no document), `pipeline_run` the import's
  ID, `parts: []`, no alerts, only "found" checks. A fact's `draft_id` is `nis:<Type>/<id>`, one per NIS record, so it
  is stable across imports; sources are `nis` sources, facts have `origin: "nis"`. The state names the NIS record
  (system, patient ID, the link's time), the newest `meta.lastUpdated`, every record version read (type, ID, version,
  last update) and the types the pull cut off. Written by `POST /api/cases/:id/nis/import` from `nisFragment`
  (packages/domain/src/nis-map.ts).
- **When it counts.** `publishCaseRun` composes it only while the case's patient is linked (`patient_nis_links`) to the
  record the state names, by the same link (its time), in the NIS configured now. Otherwise it is left out and the
  merge logs `nis_excluded` with a code (`not_linked`, `other_record`, `other_nis`, `no_nis_config`, `bad_import`):
  removing the org's NIS config or changing its URL takes the NIS facts out at the next merge.
- **Compose, brief, store.** `composeCaseRun` adds the NIS fragment and records in the draft which import it used
  (`nis_import`) and by which link (`nis_link`: NIS patient ID and the link's time). `stillFits` (before the brief)
  calls `nisFragmentFor` again and treats a different import or an excluded one as stale; `storeCaseRun` adds a guard
  to its batch that the patient is still linked by that very link, so an unlink or relink at any point before the
  commit never stores the old record's facts. The stored run records the link in `input_hashes_json` (`"nis":
  "<NIS patient id>|<link time>"`).
- **Unlinking.** The link is the patient's, the import is per case: unlinking deletes the import of every case of the
  patient and starts the merge for each. Until a merge has run, `GET /cases/:id/extraction` already leaves out the NIS
  facts of a run whose recorded link is no longer the patient's (`withoutNis`), so a wrong record's values leave the
  screen at once; the earlier-run fact route judges an older run by its own recorded link the same way.
- **Checks.** A kind the NIS holds facts of is found, from the facts themselves (also when its pull of that kind was
  cut off, so "nothing found" never sits next to a NIS value). Otherwise the kind is left to the documents: the NIS is
  no document, so it neither makes "nothing found in every document" into "not run" nor the reverse, and a run of the
  NIS alone never says "nothing found" (EXTRACTION-FORMAT.md, "Decisions" 7).
- **Documents and the run's producer.** The NIS fragment adds no entry to `run.documents`. The run's producer is
  `pipeline` when any document fragment is in it, `nis` when only the NIS fragment is; the run ID starts with that
  producer. `publishCaseRun` stores when the case's current run is absent or has producer `pipeline` or `nis`; a case
  with a prepared fixture run is still left alone (combining with fixtures is not built).
- **Gates.** The import runs only for orgs in `PIPELINE_ORGS` (the merge's own gate; 409 `nis_merge_off` elsewhere)
  and not on a closed case or one with an approved conclusion (409 `case_locked`, as uploads).
- **Refresh.** The same route asks the NIS for records changed at or after the newest update it saw (`ge`, the NIS's own
  clock). It pulls the whole record again when a record version it did not read comes back, when the last pull or this
  one was cut off, or when the last full pull is a day old: a record deleted in the NIS never comes back from a change
  query, so it drops out at the latest with the next day's full pull. The merge is started on every call (it is
  idempotent), so a merge whose start failed is retried by the next click.
- **Known overlap.** A lab value both on an uploaded lab sheet and in the NIS is two facts (different sources, so
  different keys), and the case view shows both points. Merging them needs a rule over facts (stream E) and is not
  built.
- **Documents.** The NIS import's documents are not part of the NIS fragment: each current DocumentReference's file is
  stored as an upload (`storeFile`, origin `upload`, provenance in `nis_documents`), so it goes through B's pipeline and
  its own fragments like any upload. A replaced version is retired as `superseded` by the new one when the new one's
  content is kept; a document the case withdrew or deleted is never taken over again.
