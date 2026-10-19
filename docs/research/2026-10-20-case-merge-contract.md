# One case run from two producers: proposal for streams B and D

Status: proposal from stream D (#20) to stream B (#18), 2026-10-20, for agreement before either side builds the merge.

**The goal:** one codebridge.extraction/2 run per case, stored through `prepareRun` and `storeRun`
(`api/src/store/runs.ts`, stream A's #46), so doctor confirmations, edits and alert acknowledgements carry over. Two
producers feed it:
- **B, the document pipeline without AI:** pages, readability, parts, identity per page, lab values from lab sheets,
  poor-copy and identity alerts (today in `document_alerts`).
- **D, the AI extraction:** the vision reading of pages that need it, and the facts with quotes
  (`api/src/domain/extract/`).

## Proposal

1. **Each producer writes a fragment per document, never a run.** A fragment is a run's content for one document,
   with facts drafted (no `key` or `id`, a `draft_id` instead) and alerts without IDs, exactly the `DraftRun` parts
   `prepareRun` takes:

   ```json
   {
     "schema": "codebridge.fragment/1",
     "producer": "pipeline" | "ai",
     "document_id": "up-…", "document_sha256": "…", "pipeline_run": "pl-…",
     "stages": [ { "name": "extract_facts", "model": "…", "prompt": "extract-facts-cs@7", "prompt_sha256": "…" } ],
     "sources": [ … ], "facts": [ { "draft_id": "ai:up-…:d12", … } ], "checks": [ … ], "alerts": [ … ]
   }
   ```
   - `draft_id`s are prefixed with the producer and the document, so fragments never collide.
   - Stored in R2 under the document's pipeline run prefix (`org/<org>/uploads/<case>/<doc>/<run>/fragment-<producer>.json`),
     so a withdraw deletes it with the rest (`deleteDocumentObjects`).
2. **D runs after B, on B's outputs.** D's step needs B's page images, readings, readability, parts and identity
   per page, and reads them from B's run outputs in R2. D does not compute identity itself: it takes B's
   `/v1/identity` result per page for `source.identity` and quarantine, so there is one identity check.
   (D's own `pageIdentity` stays only in the offline harness until the evaluation reads B's.) D extracts per part
   (`document_parts`), so `source.part` is B's stable part ID.
3. **One merge step, in B's ProcessCase:**
   1. read the latest fragment of every producer for every current document;
   2. concatenate sources, facts and alerts;
   3. merge checks per `looks_for`: `covered` and `unreadable` are unions, and `found` wins over `nothing_found`;
   4. run the case rules over all drafted facts: request without result, the same-date contradiction, and later the
      cross-document ones;
   5. `matchInputs`, `prepareRun`, then `storeRun` in one Tx, which also retires the document's `document_alerts`
      once the run carries them.

   The two producers do not overlap by design: D does not extract lab sheet values, and B extracts nothing but labs.
   So no fact is deduplicated across producers.
4. **Triggers.** B's document run ends by starting the merge. When the model is on for the org (`MODEL_*` set and the
   org keeps content), B's run instead starts D's `ExtractDocument` workflow, and that ends by starting the merge.
   The merge is idempotent: it always composes the latest fragments, and a stale `storeRun` (`run_stale`) is retried.
5. **What goes where in the run:**
   - `run.producer`: `pipeline`;
   - `run.stages`: B's engines and D's model stages;
   - `documents`: each document with its parts.

## What D builds now, independent of the merge

- `ExtractDocumentWorkflow`: B's run outputs in, `fragment-ai.json` out. Its steps:
  - vision reading of the pages that need it: redaction, then the model, then `/v1/compare`;
  - extraction per part;
  - the checks.

  Step results hold IDs and counts only; texts and answers stay in R2.
- A pure `composeFragments(fragments) -> DraftRun` in `packages/domain` (or `api/src/domain`), with the check merge
  and the case rules. B's ProcessCase calls it, and D's tests cover it.

## Questions for B

- Is the fragment shape acceptable, and does B write `fragment-pipeline.json` from its `write` step?
- Where does B keep page identity per page (the R2 key), and does it stay per page or per part?
- Is ProcessCase a workflow that B starts, and can it take "D's fragment is pending" as "compose what exists"?
  That way a document without an AI fragment yet shows its no-AI facts.
