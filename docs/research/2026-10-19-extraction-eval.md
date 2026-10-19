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

| Failure kind | v1, whole document | v2, whole document | v2, page by page | v3 | v4 | v5 |
|---|---|---|---|---|---|---|
| critical fact left out | 3 / 3 / 1 | 6 / 0 / 1 | 6 / 0 / 1 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 |
| wrong date | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| negation read as positive | 3 / 5 / 0 | 7 / 1 / 0 | 7 / 1 / 0 (8 / 0 after the regex fix below) | 8 / 0 / 0 | 7 / 1 / 0 | 8 / 0 / 0 |
| patients mixed up | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 | 7 / 0 / 1 |
| report missing | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 | 1 / 0 / 5 |
| request without result | 3 / 4 / 0 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 |
| poor scan | 13 / 0 / 3 (+1 known) | same | same | same | same | same |

v3 to v5 are page by page. The v4 failure: the misread liver sentence of S03 came out as a "verify" imaging fact, not
as a metastasis fact, so the expectation that looks for a liver metastasis fact found none; v5 asks for a separate
metastasis fact wherever a finding mentions metastases. In no version was the misread a clear fact.

"Report missing" stayed not run in v1 to v5 because it needs the cross-document rule for cited reports. With the case
rules (issue #21, `packages/domain/src/extraction/rules.ts`, applied by `extract-eval.ts` as the case merge will) over
the cached v5 answers: report missing 6 / 0 / 0 plus one known failure (case 10's brain MR, quoted in the outpatient
report, comes out of the extraction as `reported_as: original`); patients mixed up 8 / 0 / 0 (no contradiction across
S04's two patients); reference 164 / 0 / 0 (no stage contradiction in S02 for "cT3b cN1" next to "cT3b cN1 M0"). The
poor-scan items not run need medication (bisoprolol), which this step does not extract yet.

Facts kept with v3 and v5 (clear / verify / quarantined):

| Case | v3 | v5 |
|---|---|---|
| 10 | 126: 86 / 40 / 0 | 112: 71 / 41 / 0 |
| S01 | 64: 49 / 15 / 0 | 59: 46 / 13 / 0 |
| S02 | 64: 53 / 11 / 0 | 70: 53 / 17 / 0 |
| S03 (poor scan) | 29: 0 / 29 / 0 | 33: 6 / 27 / 0 (the six clear ones are on the readable CT page) |
| S04 (two patients) | 41: 20 / 21 / 4 | 46: 37 / 9 / 5 (every fact from the other woman's page) |

The count moves by 10-20 % between runs of the same prompt (temperature fixed at 1), so a difference of that size
between versions is not an effect.

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

A second audit (v3) found the four patterns fixed or marked, but new clear errors (sunitinib without its stop date,
an outdated performance status shown clear, "HER2 1+ (negativní)" as a negation, a specimen description as a
histology result) and over-flagging: a date in the report header and a negation elsewhere in the quote made most core
facts "verify". v4 and v5 answer both (see "Checks added after the reviews"). The audit of v5 is below.

## Checks added after the reviews

A separate code review and the clinical audits added: a quote found twice on the page is anchored where the fact's
date or words are, or marked (`quote_ambiguous`); a date counts as near when it is on the quote's lines or in the page
header (`date_outside_quote` otherwise); negation is judged on the clause that holds the fact; a code not in the quote
on a page with several codes is marked (`code_outside_quote`); joined TNM ("cT3bN1M0") is split, an unrecognised
category ("MO") is marked (`tnm_unrecognised`), and the stage kind comes from the written prefix; a plan for something
the documents show as done is marked (`done_elsewhere`); an undated performance status next to a dated one is marked
(`undated`); a request is linked to a result only by the same modality and region; "RČ" in a header is a label, not
another patient; facts are never merged across quarantine; a day and month without a year get no sort form.

## A test hole found on the way

Both S03 expectations about the planted misread "prokázáno" (for "neprokázáno") matched the liver by
`(?i)jat|liver|hepat`, which does not match "játra". The "absent" expectation (no clear liver metastasis) therefore
passed whatever the run held. The regex is now `(?i)j[aá]t|liver|hepat`, and `pipeline/tests/test_eval.py` checks
that a clear confirmed liver metastasis fails it.

## The audit of v5: what is still wrong while shown as clear

Clear, non-quarantined facts checked against the documents (WRONG / OVERREACH / MISKIND): case 10, 71 facts: 1 / 3 / 3;
S01, 46: 3 / 1 / 2; S02, 53: 0 / 0 / 1; S03, 6: 0 / 0 / 0; S04, 32: 0 / 0 / 0. Over-flagging improved in S02, S03 and
S04 (diagnosis, stages, histology and receptors clear and correct).

What remains needs rules across facts, not per-fact checks, and is the reason these facts must not drive the case view
yet:
- **A therapy line without its stop date** when the stop is written in another sentence (case 10 sunitinib: "léčbu
  sunitinibem ukončuji" on page 2). Needs merging the line's facts (start, dose changes, stop) into one line.
- **Two results for one exam that disagree** (11/2025: PD and iUPD) and **a finding that disagrees with the same
  report's conclusion** (S03: the misread "prokázáno" liver metastasis, verify, next to "bez známek vzdálených
  metastáz"). Needs the contradiction rule (like with like).
- **An older finding next to a newer one of the same kind** (S01: "bez fatické poruchy" 8.1.2026 and "lehká
  expresivní fatická porucha" 6.10.2026, both clear). Needs "superseded by a later fact".
- **Miskinds:** dose changes as separate therapy lines, blood-count toxicity as histology, a specimen description as
  histology.
- **Plans already done** that `done_elsewhere` misses (radiotherapy given 1-2/2026 still "planned").

After the audit: "Histol." now counts as histology (the check missed the abbreviation and marked the S01 diagnosis),
and a report's header date no longer counts as near for a plan or a request ("Sledování vhodné" took the header date).
These two were not re-audited.

## Medication (v6, v7)

v6 added `medication` and `contraindication`. Medication facts (clear / all): case 10 7/12, S01 12/12, S02 4/4, S03 0/2,
S04 1/1. A separate audit of every clear medication fact found the values right except one wrong status (prednison
"documented" although stopped on 26.7.2023), an anticancer drug as medication, and the whole "Chron. medikace" block of
case 10 missing; its code review found that a strength or a dosing from another entry of a list line passed as clear
(the check compared digits anywhere in the quote) and that a one-word drug name was not checked. v7 (prompt: every drug
of every list, the entry as the quote) and new checks (`dose_not_with_drug`: strength and dosing written in the drug's
own entry, unit included; `drug_not_in_quote`; `not_stated_as_contraindication`) answer them. With v7, case 10 has 21
medication facts (16 clear), the chronic medication list included.

The S03 planted misread (bisoprolol 1,25 mg read as 4,25 mg) is "verify" in every run, but only because the page is
judged poor: the quote really says 4,25, so no quote check can catch it. On a page judged readable it would be clear.
That is what the vision reading (next slice) has to answer.

Evaluation with v7 (pass / fail / not run): critical fact left out 7/0/0, wrong date 4/0/0, negation read as positive
7/1/0, patients mixed up 7/0/1, report missing 1/0/5, request without result 7/0/0, poor scan 16/0/0 (+1 known; the
medication expectations now run). The one failure is the S03 liver expectation of v4 again: the misread liver sentence
came out as a "verify" imaging fact without a separate metastasis fact, although prompt rule 26 asks for one. It
passed with v5 and v6 and failed with v4 and v7: prompt compliance varies between runs (temperature fixed at 1). In
no run was it a clear fact.

Open from the medication audit: medication facts without a start date from two visits share a key
(`medication|drug|start:undated`, packages/domain keys) and merge or get "#2"; a stop date of a medication has no
field (the format's medication value has none); the format document models everolimus as a medication while the
prompt sends anticancer drugs to `systemic_therapy`. These are format questions for stream A.

## Page reading with the vision model

A correction first. Until this slice, the harness gave the extraction the stored `p<n>.vision.md` wherever one
existed. For S01, S02 and S04 that file is the Markdown we wrote the sample from (scripts/render_samples.py), and for
case 10 a transcription a development sub-agent made with no prompt in the repository. So the measurements above for
those cases measure the extraction on an ideal reading, not the reading the pipeline would have. Now the harness gives
the extraction the PDF text layer, or Tesseract when there is none, and the stored files only with `--stored-vision`.

The vision reading (prompt `read-page-cs@1`) reads a page from its image after redaction (the redaction of
`/v1/redact`, run locally by `pipeline/harness_tools.py`: the case's names, birth number and birth date, the org's
staff names, up to two words after a title, signatures and stamps blacked out; the review found that only the first
word after "MUDr." was blacked out, so doctors' surnames reached the model in the first runs, which is fixed). Its text
is compared with Tesseract's words (`/v1/compare`, the page index's disagreement rules): a word the two read
differently is an "ověřit" range, and a fact whose quote overlaps one is marked (`ocr_check`). The comparison does not
mark what the vision reading leaves out; a reading with fewer than 85 % of Tesseract's word count is therefore marked
as a whole. The pages it reads (`--vision auto`): every
page not judged "good", whose readings disagree on three or more tokens, or with no text layer. Two rules came from the
first S03 run:

- **The page's readability stays when the vision model reads it.** The planted D2 misread ("prokázáno" for
  "neprokázáno") is in the scan's image itself; the vision model read it as cleanly as the rest, and both readings
  agreed. With readability dropped for vision pages, the liver metastasis came out clear: a clear-but-wrong fact.
- **Whose page it is comes from the local, unredacted reading.** The vision model sees the names blacked out, so its
  text cannot say whose page it is.

And one rule in the checks: metastases stated and denied for the same date (the misread sentence and the same CT's
conclusion "bez známek vzdálených metastáz") are both marked (`contradicts_same_date`), a like-with-like contradiction
within one report.

Same prompt (v7), same cases, with and without the vision reading (pass / fail / not run):

| Failure kind | vision off | vision auto |
|---|---|---|
| critical fact left out | 7 / 0 / 0 | 7 / 0 / 0 |
| wrong date | 4 / 0 / 0 | 4 / 0 / 0 |
| negation read as positive | 7 / 1 / 0 | 8 / 0 / 0 |
| patients mixed up | 7 / 0 / 1 | 7 / 0 / 1 |
| report missing | 1 / 0 / 5 | 1 / 0 / 5 |
| request without result | 7 / 0 / 0 | 7 / 0 / 0 |
| poor scan | 16 / 0 / 0 (+1 known) | 16 / 0 / 0 (+1 known) |

Pages read by vision (`--stored-vision` gives the committed `p<n>.vision.md` only to pages the vision model does not
read live, so to every page with `--vision off`): case 10 5 of 5, S01 5 of 7, S02 7 of 8, S03 3 of 3, S04 1 of 5. Facts (clear / verify), off
and auto: case 10 78/50 and 90/48, S01 66/13 and 58/16, S02 53/16 and 45/23, S03 7/33 and 7/35, S04 37/6 and 35/13.

S03's planted misreads:

| Defect | Without vision | With vision |
|---|---|---|
| D1 bisoprolol 1,25 mg (OCR 4,25) | fact "4,25 mg", verify (poor page) | first run "1,25 mg", the right value; second run (new redacted image) "2,5 mg", a new misread; verify both times (poor page; the readings disagree there) |
| D2 liver metastases "neprokázáno" (image shows "prokázáno") | a verify imaging fact, no metastasis fact (the failure above) | a metastasis fact "prokázáno", verify (`contradicts_same_date`) |
| D3, D4 draw date, D5 potassium | lab parser, unchanged | unchanged |

In no run did a planted misread become a clear fact. The vision reading read D1 right once and wrong once (a
different wrong value), and could not fix D2, which the image itself carries and only the report's own conclusion
contradicts. So on a poor scan the vision reading does not make a value trustworthy; the page's readability mark and
the disagreement marks do the work. The second run (after the review's fixes) gave the same pass / fail table as the
first.

## Open

- Medication extraction (the S03 bisoprolol dose misread needs it).
- Page reading with the vision model for scans and pages whose readings disagree (`read-page-cs`), with its "ověřit"
  marks feeding the `ocr_check` doubt.
- The Workflow step that runs this for a case and writes the run to R2.
