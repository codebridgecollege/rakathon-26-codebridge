# Fact extraction: measurements (issue #20, stream D phase 2)

Status: working notes, 2026-10-19. Synthetic data only (cases 10, S01-S04). Model: the hackathon Azure gateway,
`gpt-6-luna-dz-eu` (`gpt-6-luna-2026-09-22`), `reasoning_effort: low`, default temperature (the only one it accepts).

**Fact extraction** turns the pages of a document into codebridge.extraction/2 facts with verbatim quotes
(`api/src/domain/extract/`, prompt `api/src/prompts/extract-facts-cs.ts`). **The evaluation** is
`pipeline/eval.py` with the expected outputs in `samples/expected/`; `--ai-runs` adds the extraction's runs, which
`api/scripts/extract-eval.ts` writes. How to rerun: `api/AGENTS.md`, "Fact extraction".

## Results per prompt version

Expectations of `samples/expected/*.json` per failure kind, with the AI runs added (pass / fail / not run). Before
the AI runs, every expectation that needs a diagnosis, request, identity or similar check was "not run".

| Failure kind | v1, whole document | v2, whole document | v2, page by page | v3, page by page |
|---|---|---|---|---|
| critical fact left out | 3 / 3 / 1 | 6 / 0 / 1 | 6 / 0 / 1 | 7 / 0 / 0 |
| wrong date | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| negation read as positive | 3 / 5 / 0 | 7 / 1 / 0 | 7 / 1 / 0 (8 / 0 after the regex fix below) | 8 / 0 / 0 |
| patients mixed up | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 |
| report missing | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 |
| request without result | 3 / 4 / 0 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 |
| poor scan | 13 / 0 / 3 (+1 known) | same | same | same |

"Report missing" stays not run: it needs the cross-document rule for cited reports (milestone 4). One "patients mixed
up" expectation needs the contradiction rule. The poor-scan items not run need medication (bisoprolol), which this step
does not extract yet.

Facts kept (clear / verify / quarantined) with v3, page by page:

| Case | Facts | Clear | Verify | Quarantined |
|---|---|---|---|---|
| 10 | 126 | 86 | 40 | 0 |
| S01 | 64 | 49 | 15 | 0 |
| S02 | 64 | 53 | 11 | 0 |
| S03 (poor scan) | 29 | 0 | 29 | 0 |
| S04 (two patients) | 41 | 20 | 21 | 4 (every fact from the other woman's page) |

## Decisions the measurements made

- **Page by page, not one call per document.** On case 10 one call over the five pages returned 49 facts with v1 and
  21 with v2 (same pages, temperature fixed at 1); page by page returned 105, with v3 126. Page by page costs about
  three times the time (case 10: 160-230 s in five calls, which a Workflow runs as separate steps) and loses a date in
  a previous page's header, which the date checks then mark.
- **`reasoning_effort: low` holds for now.** `medium` on case 10, one call: 39 facts in 67 s, versus 21-49 with `low`;
  the spread between runs was larger than the effect, and page by page with `low` gave more than either.
- **The content filter refused S01 once** (whole document, `finish_reason: content_filter`) and passed it on the next
  run. The harness, and the Workflow later, fall back to page by page and list a still refused page as not read, never
  as "nothing found".

## What the audit of clear facts found

A separate agent checked every clear, non-quarantined fact of the v2 page-by-page runs (211) against the source
documents. Errors that would mislead a doctor were in four patterns, each fixed in v3 by a prompt rule and, where it
can be checked in code, by a "verify" mark:

| Pattern | Example | Fix |
|---|---|---|
| A date from a neighbouring clause | corticotherapy "start 26.7.2023", the stop date | prompt rule 15; `date_outside_quote`, `start_equals_stop` |
| "Indikován" read as planned although the drug started | sunitinib line 2 "planned" | prompt rule 16 |
| Negation over a whole fact that also holds a positive finding | "bez plicní embolie; drobná cysta" negated | prompt rule 14; `mixed_negation` |
| A diagnosis whose quote is only the code line | C50.4 line quoted for a histology-confirmed claim | prompt rule 17; `text_not_in_quote` |

It also found whole kinds missing (allergy, smoking, spirometry): v3 adds `allergy`, `risk_factor` and
`exam_finding`. Lab values come from the deterministic lab parser; medication is not extracted yet.

The audit of v3 is recorded below when it is done.

## A test hole found on the way

Both S03 expectations about the planted misread "prokázáno" (for "neprokázáno") matched the liver by
`(?i)jat|liver|hepat`, which does not match "játra". The "absent" expectation (no clear liver metastasis) therefore
passed whatever the run held. The regex is now `(?i)j[aá]t|liver|hepat`, and `pipeline/tests/test_eval.py` checks
that a clear confirmed liver metastasis fails it.

## Open

- Medication extraction (the S03 bisoprolol dose misread needs it).
- Page reading with the vision model for scans and pages whose readings disagree (`read-page-cs`), with its "ověřit"
  marks feeding the `ocr_check` doubt.
- The Workflow step that runs this for a case and writes the run to R2.
- The cross-document rules (cited report without its original, contradictions like with like).
