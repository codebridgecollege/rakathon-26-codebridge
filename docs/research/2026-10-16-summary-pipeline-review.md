# Review of how the patient summary is produced (2026-10-16)

Backlog item 1 ([`docs/design/BACKLOG.md`](../design/BACKLOG.md)): how the
patient summary in the mocks was made, whether it was made correctly, and
what a compliant production pipeline looks like. Scope is patient 10
(`10_pacient.pdf`), the only patient worked through.

Terms used below:

- **MDT**: the multidisciplinary team meeting where specialists decide on
  one patient's next steps.
- **Text layer**: the text stored inside the PDF, read with `pypdf`. On
  FNO's files it is poor OCR with broken font maps
  ([OCR evaluation](2026-10-16-ocr-evaluation.md)).
- **Vision transcription**: a vision language model's transcription of the
  rendered page, in `data/derived/pages/10_pacient/p<n>.vision.md`. It is
  the better reading of the page.
- **Brief / summary block**: the text above the tabs in mock v3 and v4
  (`onco_summary_v3_cs` and its neighbours), plus the older brief keys.
- **Soňa's summary model**: the six fields she asked for (oncological
  summary, reason for the MDT, question, proposed management, MDT
  conclusion, gaps), recorded in [`PRODUCT.md`](../design/PRODUCT.md),
  feedback round 6.

## Short answer

- There is no extraction pipeline. Every fact, sentence, flag and date in
  the mock was written by a development agent (Claude Opus in Claude Code
  and in a claude.ai/code session) reading the PDF text layer, then
  patched by hand after reviews. The Python scripts in
  `mocks/src/extract/` hold the facts as string literals; they only check
  that each quote is a substring of the text layer and write the JSON.
- The content is mostly correct. A spot-check of 14 facts and 6 sentences
  against the vision transcription found no wrong value, date, stage or
  negation, but found one false alarm, one fact whose "uncertain exam"
  framing comes from the text layer's jumbled layout, an inconsistency
  between views on planned versus done (everolimus 10 mg), unlabelled
  interpretations in two sentences, and 13 lab values left out without
  saying so.
- Traceability is partial: all 402 quotes match the text layer exactly,
  but a quote anchors a place, not a claim. Several facts cite only part
  of what they state, timeline events cite only the exam header, and the
  displayed summary is one free string whose clauses carry `[n]` markers
  but no certainty or negation tags.
- Nothing is reproducible beyond the quote check: no prompt in the repo,
  no pinned model ID, no temperature, and re-running the scripts would
  undo 31 hand-fixed entries. The `samples/` folder with the known failure cases
  does not exist.
- The data is fictitious and cleared for cloud models, so what was sent to
  Anthropic during development is allowed. A production pipeline must
  read pages locally or after local redaction (DATA-PROTECTION.md options
  A and B), never through coding agents.
- The design below keeps LLMs to two narrow jobs (reading pages, turning
  page text into facts with quotes) and one optional job (wording the
  summary from validated facts, labelled; templates in the demo). Labs,
  identity, dates and every check are deterministic code, including a
  coverage pass that lists what no fact covers, because nothing else
  catches an omission.

## 1. Method: how each part was produced

| Part | Keys | Produced by | Input | Reproducible? |
|---|---|---|---|---|
| Raw text | `mocks/src/data/ocr.json` | `mocks/src/extract/ocr_pdfs.py`, `pypdf==5.1.0` | The ten PDFs | Yes, deterministic |
| Structured case | `mock-case-10.json`: `patient`, `mdt_question`, `diagnosis`, `summary`, `sections`, `timeline`, `labs`, `flags` | A Claude Opus sub-agent wrote `build10.py`, in which every fact, date, certainty and negation is a literal it typed; the script checks quotes against `ocr.json` and writes the JSON | Text layer of patient 10 | Only the quote check. The facts are the agent's judgement, not computed |
| Hand fixes to the case | same file | The lead agent, Python one-off edits after two adversarial reviews; all in commit `4ae82da`, file unchanged since | Review findings | No script; see the diff below |
| Extra case data | `mock-case-10-extra.json`: `anamnesis`, `onco_brief_cs`, `onco_detailed`, `refs`, `timeline_cards`, `documents`, `others` | A second Claude sub-agent, `build10extra.py`, same pattern, with a quote check that also limits quotes to 160 characters | Text layer | Same as above |
| Mock v3 keys | `onco_brief_v3_cs`, `diagnosis_headline`, `onco_detailed_v3`, `anamnesis_v3`, `status_praesens`, `onco_summary_v3_cs`, `mdt_reason_v3_cs`, `data_gaps_v3`, `timeline_cards_v3` | A teammate's Claude Opus session on claude.ai/code (`session_01LgCnsRmqvY6iBYyenve3Mi`), editing the JSON directly, no script: commits `f351d98`, `c989140`, `5172d88`, `c445c47`, `39a87a2`, `fab6453`, `3029f2a`, `e33c66d`, `52096e2`, `53e51e2`, `48da8b7`. Each rewrite was followed by a "fix review findings" commit | Text layer quotes (all v3 refs match `ocr.json`), the existing JSON, and Soňa's feedback | No. The commit messages are the only record of why each sentence changed |
| Invented example data | `labs_series_synthetic`, `document_history` | Same session, labelled `synthetic: true` / "Ukázková data" and labelled in the UI | None | Not applicable |
| Vision transcriptions | `data/derived/pages/*/p<n>.vision.md` | Claude Sonnet run as a Claude Code sub-agent (commit `351ca45`); the instruction is described in the OCR evaluation but not stored as a prompt file | Unredacted 300 dpi page renders | No prompt file, no model ID |

What re-running `build10.py` shows (run in a scratch copy, not in the
repo): 31 changed entries (38 changed fields) against the committed
`mock-case-10.json`: 12 labs, 7 flags, 5 section facts, 5 summary
sentences, 1 timeline event and `labs_note_cs`. They are the hand fixes
the lead agent described:

- 12 lab values and 2 facts changed from `documented` to `unclear_ocr`
  (for example `histology[0]` "MO", `past_treatment[2]` "lmg/kg");
- 2 negation tags set (`clinical_finding[5]` "uzliny nehmatné",
  `imaging[10]` "Bez plicní embolie");
- "dekompenzované" corrected to "dekorigované" (`comorbidities[2]`);
- `timeline[31]` changed from "Everolimus navýšen" to "Plánováno navýšení"
  with `status: planned`;
- a guessed lab date removed from `labs_note_cs`, together with the
  sentence that listed the lab values left out (see section 2);
- `summary[4]` extended with the negated dizziness and the visual
  symptom, with a third source;
- flag wording changed to the fixed gap phrase (and `flags[4]` reworded
  from "končí neúplně" to the "J-" wording), `flags[5]` note and sources
  changed, a `relevant` field and a summary `level` added.

`mocks/README.md` already warns that re-running the scripts would undo
these fixes. In effect the JSON is hand-curated reference data, not
pipeline output.

## 2. Traceability and spot-check

### What holds

- All 402 `{file, page, quote}` objects in both JSON files (383 for
  patient 10, 234 distinct overall) are exact substrings of the text
  layer after whitespace folding (checked on 2026-10-16, after commit
  `48da8b7`). The v4 source view finds every one in the vision
  transcription with tolerant matching (`mocks/README.md`).
- `mock-case-10.json` gives every fact `date`, `certainty`
  (`documented`, `unclear_ocr`, `inferred`) and `negated`. Inferences use
  `inferred` and the note "Pozorování asistenta"; every flag says so and
  lists `based_on` sources.
- Partial dates stay as written ("6/2023", "9/23", "11/2023 až 6/2025").
- "neguje" appears only where the document says it; gaps use
  "neuvedeno v dostupné dokumentaci".
- The suspected cerebellar metastasis is always a suspicion, and its
  missing histology is a flag. The NCH (neurosurgical) seminar referral
  without a result is a gap, which covers the "referral with no result"
  case.

### Structural gaps

1. **A quote anchors a place, not the claim.** The check proves the quote
   exists, not that it supports the fact. Examples:
   `past_treatment[7]` states "sunitinib 50 mg denně, režim 4/2, start
   27.1.2026" but cites only "2. pal, linie léčby sunitinib - start
   27.1.2026"; the dose and schedule come from page 2, uncited.
   `past_treatment[5]` states "240 mg q2w", which is not in its quote.
   Timeline events cite only the exam header, for example
   `timeline[28]` "CT: progrese ... (PD)" cites "CT hrudník, břicho, malá
   pánev 26.8.2026".
2. **Quotes are text-layer strings with misreads** ("MR yyš, mozku",
   "lmg/kg", "MO"). They have no character offsets, so the viewer must
   match them fuzzily.
3. **The displayed summary is one string** (`onco_summary_v3_cs`) with
   `[n]` markers. Certainty and negation do not travel with its clauses;
   the "MO" reading problem appears only in `data_gaps_v3`, not next to the
   clause that states M0.
4. **Unlabelled interpretation in prose.** `summary[2]` in
   `mock-case-10.json` says "imunitně podmíněná toxicita" (the document
   writes "GIT toxicity" and "IPP"); `onco_summary_v3_cs` turns iUPD/iCPD
   into "nepotvrzená/potvrzená" progression (a correct reading, but the
   assistant's); the summary block header hard-codes "typ MDT: recidiva /
   progrese" (`mocks/src/v3-template.html` and `v4-template.html`, the "Onkologický souhrn" card), a classification no document
   states.
5. **No confirmation state** on facts in the data. Doctor edits exist
   only in the mock's server as overrides.

### Spot-check against the vision transcription

Facts (`mock-case-10.json` unless noted):

| # | Fact (key) | Result |
|---|---|---|
| 1 | `histology[0]` pT2a pN1(3+/5) M0, 2.6.2022 | Correct; vision reads M0. The date is the operation date, and the note says so |
| 2 | `past_treatment[2]` nivolumab 3 mg/kg + ipilimumab 1 mg/kg, 27.3.2023 | Correct; vision confirms 1mg/kg; marked `unclear_ocr` |
| 3 | `past_treatment[5]` maintenance nivolumab 240 mg q2w, 27.6.2023 to 29.12.2025 | Correct; the dose is on page 2 and not in the cited quote |
| 4 | `past_treatment[7]` sunitinib 50 mg, 4/2, from 27.1.2026 | Correct; quote covers only the start |
| 5 | `past_treatment[9]` "Redukce sunitinibu o 1 stupeň na 37,5 mg (hepatopatie G2)", 25.2.2026 | Values and date correct. The parentheses read as the cause of the dose cut; the source lists "hepatopatie G2" after the dose without saying it caused the reduction |
| 6 | `imaging[5]`, `imaging[6]` CT 6/2023 iPR; CT "9/23" cystic mass | Correct, partial dates kept as written |
| 7 | `imaging[10]` CT AG 10.2.2026 "Bez plicní embolie", `negated: true` | Correct |
| 8 | `imaging[13]` CT 28.4.2026, regression about 24 %, iSD | Correct |
| 9 | `labs` S_CREAE 107 µmol/l [59 ... 104] high; eGFR 1,01 low; Hb 123 low | Values, units, ranges and codes correct; date null is right (the lab block on page 3 gives no collection date, and the visit header on page 4 is blacked out). Many values are `unclear_ocr` although the vision reading is clean |
| 10 | `sections.medication[0]` everolimus 5 mg 1-0-0, to 2-0-0 from 19.9.2026 | Correct. But `current_state[1]` says "everolimus navyšován na 10 mg denně" with no planned marker, while `anamnesis_v3.FA` says "plánováno, zda proběhlo, ověřit". Page 3 itself says both "navyšuji" and "Při dobré toleranci navýšíme"; `flags[8]` catches that, but the views disagree with each other |
| 11 | `medication` Spiriva 1-0-1 (p2) versus 2-0-0 (p4, p5), `inferred` | Correct observation, correctly labelled |
| 12 | `comorbidities[5]` right PDK stenosis, not severe | Correct |
| 13 | `flags[4]` "Text CT 26.8.2026 končí znaky „J-“" | **False alarm.** "J-" is the text layer's reading of a handwritten page number ("[rukopis: číslice, vpravo dole]") |
| 14 | `imaging[11]` and `data_gaps_v3[4]` Th/L osteoplastic lesions, "z kterého vyšetření, nejisté" | In the text layer the sentence is split from its context by a table cell ("ano"); the vision transcription and page image show it as the last line of the CT AG 10.2.2026 conclusion. Keep "verify", but the uncertainty is mostly a text-layer artefact |

Sentences:

| # | Sentence (key) | Result |
|---|---|---|
| A | `onco_summary_v3_cs` 1: RCC G2, nephrectomy 6/2022, pT2a pN1 (3 of 5 nodes), M0 | Correct; "dle vstupní dokumentace" is the assistant's wording |
| B | `onco_summary_v3_cs` 3: 1st line nivolumab + ipilimumab, maintenance to 12/2025, progression unconfirmed 11/2025 and confirmed 1/2026, sunitinib from 1/2026, stopped for progression on CT 8/2026 | Correct; page 1 also calls 11/2025 "PD", which `flags[6]` explains |
| C | `onco_summary_v3_cs` 5: MR 14.9.2026, solitary enhancing lesion up to 3 mm, suspected metastasis, no other lesions | Correct, suspicion kept |
| D | `mdt_reason_v3_cs` | Correct; "při probíhající léčbě everolimem" is supported by page 4 ("nově předepsaný everolimus toleruje") |
| E | `summary[2]` (mock-case-10) nivolumab + ipilimumab "(2 cykly, imunitně podmíněná toxicita)" | Facts correct; "imunitně podmíněná" is an unlabelled expansion |
| F | `onco_brief_v3_cs` spine lesions sentence | Correct wording, but see fact 14; markers run [9] before [8] |

Other findings:

- **Lab omission not disclosed.** Page 3 has 39 numeric results;
  `labs` holds 26. The 13 left out (MCHC, RDW, PCDW, MPV, PDW-SD, five
  relative differential counts, absolute monocytes, eosinophils,
  basophils) are all within range, but `labs_note_cs` does not say a
  subset is shown. The note `build10.py` writes did list them; the hand
  fix that removed the guessed date removed that sentence too.
- **Page order.** Handwritten page numbers ("1" on page 4, "3" on page 1)
  and the sentence that runs from page 2 ("Cabozantinib na") to page 3
  ("par. 16") suggest the PDF holds one report in the order 4, 5, 1, 2, 3.
  The mock treats the date of the last visit as unknown, which is right
  (the header is blacked out), but a pipeline must decide document
  boundaries and reading order explicitly, not assume page order.

## 3. Rules compliance (`CLAUDE.md`)

| Rule | Status | Evidence |
|---|---|---|
| Every fact carries source, date, certainty | Partly | All facts in `mock-case-10.json`; v3 prose carries `[n]` only; quotes may not cover the whole fact (section 2) |
| Say "not found", never guess | Met in the data | Age, birth number, question for the MDT, visit date shown as missing; the guessed lab date was removed by hand |
| Alerts inform, never block | Met | UI text "Upozornění neblokují projednání" |
| "Not documented" is not "absent"; negations | Met in the spot-check | Two negation tags were wrong in the agent output and fixed by hand, which shows the risk |
| Fixed Czech gap wording | Met | `data_gaps_v3`, `flags` |
| Documents versus inferences separated | Mostly | Flags and `inferred` facts labelled; unlabelled interpretations in `summary[2]`, `onco_summary_v3_cs`, and the hard-coded MDT type |
| Compare like with like | Met | TNM labelled "stadium při diagnóze (ne aktuální stav)"; 3/2022 versus 6.3.2023 flagged as a date conflict, not a stage conflict |
| A suspicion is not a diagnosis | Met | Cerebellar lesion always "suspekce" |
| Do not merge patients silently | Not tested | One name in the file; no identity check exists |
| Preserve original values | Mostly | Units, ranges, codes, partial dates kept; but quotes keep text-layer misreads, and lab subset not disclosed |
| Intervals as facts | Met | No verdicts found |
| The assistant prepares, the doctor decides | Met | Proposal and conclusion are doctor fields; question left empty (`PRODUCT.md` round 6) |
| A draft is never shown as approved | Met in the UI | `návrh lékaře, ne rozhodnutí MDT` tag |
| Check readability before use | Not met for the mock data | The mock data was built from the text layer that the OCR evaluation later rejected; v4 adds verify marks from Tesseract and vision disagreement, but the facts were not re-read |
| Prompts in the repo, pinned model, fixed temperature | Not met | None exist for extraction or transcription |
| Test against the known failure cases, `samples/` | Not met | `samples/` does not exist |

Known failure cases, as patient 10 covers them:

| Case | Covered by patient 10? | State |
|---|---|---|
| Critical fact left out of the summary | Partly | Reviews put back HBsAg, the NCH referral, the visual symptom; no checklist defines "critical" per MDT type |
| Wrong or outdated date | Yes | Correct in the spot-check; the 3/2022 typo in the source is flagged |
| Negated finding read as positive | Yes | Two tags were wrong before the hand fix |
| Two patients mixed up | No | No test data |
| Exam done, report missing | Yes | Full MR report and images flagged missing |
| Referral with no result | Yes | NCH seminar result flagged missing |
| Poor scan changes a value or negation | Yes | "MO", "lmg/kg" caught by hand; the "J-" false alarm and the spine-lesion framing show the opposite error |

## 4. Data protection: what each step saw

| Step | Data it saw | Where it went |
|---|---|---|
| `ocr_pdfs.py` | All ten PDFs | Local; output `ocr.json` committed to git |
| Extraction sub-agents (Claude Opus via Claude Code) | Full text layer of patient 10 incl. the patient's name, and of the other nine for `others` and `mock-patient-list.json` | Anthropic API (US processing by default) |
| Reviews and hand fixes (Claude Code) | The JSON and the text layer | Anthropic API |
| v3 rewrite (claude.ai/code session) | The whole repository incl. `data/` | Anthropic's cloud environment |
| Vision transcription (Claude Sonnet sub-agent) | Unredacted page renders (the redaction prototype came later, commit `8c7036c`) | Anthropic API |
| Published mocks | Embedded patient data | Private claude.ai artifacts |

All of this is allowed: FNO states the data is fictitious, recorded in
[`HACKATHON.md`](../agent/HACKATHON.md) on 16 October, in the same commit
that added the extracted data (`4ae82da`), so git cannot show which came
first. With real data none of these steps would be acceptable as is:

- Coding agents never see patient documents. The production pipeline is
  application code calling a configured endpoint, never a development
  agent.
- Page reading follows [`DATA-PROTECTION.md`](../design/DATA-PROTECTION.md):
  option A (Tesseract plus a local vision model on FNO's server) by
  default; option B (local redaction, then an EU enterprise endpoint)
  only with FNO's approval, a processing agreement and an impact
  assessment.
- Fact extraction gets pseudonymized text: name, birth number, insurer,
  addresses and doctors' names replaced with placeholders before the text
  leaves the hospital, mapping kept locally. Dates and findings stay,
  so the result is still personal data.
- Send only the pages a step needs (for example only page 3 for labs).
- Derived files (`ocr.json`, transcriptions, JSON) stay out of git for
  real data.

## 5. Design of a production pipeline

### Stages

| # | Stage | Who does it | Output |
|---|---|---|---|
| 1 | Intake: split the upload into documents, decide reading order, classify each document (type such as CT report, histology, outpatient letter, lab sheet, referral; date; author; department), record hash and upload metadata | Deterministic code; an LLM may propose boundaries and type, a person confirms when unsure | Document records with page lists, type, date (or "date not readable") |
| 2 | Page reading: render each page; Tesseract (local) for words, boxes, confidence; vision model for the transcription | Tesseract plus vision LLM (local or after redaction) | Transcription per page, word boxes, tokens marked `disagree`, `only_vision` or low confidence (exists: `scripts/ocr_pages.py`, `scripts/build_page_index.py`) |
| 3 | Readability gate | Deterministic: share of low-confidence words, disagreement rate, empty pages | Reading certainty per page; warning and request for a better copy |
| 4 | Identity check, per document, locally | Deterministic: compare name, birth number, birth date in each document's header with the case | "matches", "conflicts" (shown, never merged), or "cannot verify identity" (header blacked out or missing, as on every page of patient 10) |
| 5 | Pseudonymization of text | Deterministic patterns plus local name recognizer (extends `scripts/redact_pages.py`) | Text with placeholders that keep roles apart (`[PACIENT]`, `[LÉKAŘ_1]`, `[OSOBA_1]`), and an offset map from pseudonymized to original text; mapping stays local |
| 6 | Deterministic parsers | Code | Lab results from lab blocks (`CODE: value unit [low ... high]`, for example `S_CREAE: 107 µmol/l [59 ... 104]`), vital signs, explicit dates. Labs never go through the LLM |
| 7 | Fact extraction | LLM, one call per document or section, structured JSON output | Candidate facts, each with kind, value as written, date as written, status, negation, and one or more verbatim quote spans |
| 8 | Anchoring and validation | Deterministic | Facts with character offsets and image boxes, marked accepted, "verify", or rejected with the rule that rejected them |
| 9 | Coverage pass | Deterministic | Every date, drug name, TNM token, dose and lab code in the transcription that no accepted fact covers, listed per page |
| 10 | Cross-document rules | Deterministic | Missing reports, referrals without result, like-with-like contradictions, planned versus done, superseded values, interval facts |
| 11 | Summary composition | Templates from validated fact IDs; LLM wording optional and labelled | Sentences, each listing the fact IDs it rests on |
| 12 | Summary validation | Deterministic | Sentences accepted, or dropped and replaced with the template sentence |
| 13 | UI with sources | Code | Every clause links to page, highlighted quote, verify marks; rejected and uncovered items shown in their own list |
| 14 | Doctor confirmation and edits | Doctor | Overrides, confirmations, rejections, append-only log |

Identity runs before pseudonymization on purpose: once names are
placeholders, two patients in one upload can no longer be told apart.
The identity check stays on the hospital's side.

### The fact record

Each fact holds:

- a stable key: document hash, the quote spans (start and end offsets in
  the transcription), and the kind. An LLM gives no stable IDs between
  runs, so this key is what lets a re-extraction find "the same fact" and
  keep a doctor's edit or rejection attached to it;
- kind (diagnosis, stage, histology, treatment line, dose change, imaging
  result, lab, comorbidity, medication, referral, plan);
- the value as written and a normalized value for display;
- the date as written, its precision (day, month, year, range), and how
  it was resolved (stated, taken from the document date, relative such
  as "dnes" or "minulé CT", or two-digit year such as "9/23");
- status (documented, planned, requested, done, unclear) and
  `superseded_by` when a later document gives a newer value of the same
  kind;
- `negated`, scoped to the clause it comes from;
- certainty and its reason (engine disagreement, `only_vision` token,
  page failed the readability gate, low Tesseract confidence, model
  unsure, rule mismatch);
- one or more source spans: document ID, page, character offsets, image
  boxes, the engine that read the page, and both readings where the
  engines disagree;
- codes as given (MKN-10, NČLP), with codes the assistant assigned
  marked as such;
- extractor version (prompt file and hash, model ID, temperature) or
  parser version;
- confirmation or rejection by a doctor (who, when).

Map to FHIR R4 only where data leaves (Condition, Observation,
MedicationStatement, Procedure, DiagnosticReport, Provenance), per
`docs/agent/INDEX.md`.

### Validation rules (stages 8, 9, 10 and 12)

Quotes and values:

- Each quote span must occur in the transcription, exact after
  whitespace folding; otherwise the fact is rejected, not fuzzily
  accepted. A fact may have several spans: patient 10 shows one span is
  not enough (`past_treatment[7]` takes the start from page 1 and the
  dose and schedule from page 2; `timeline[28]` needs the header for the
  date and the conclusion for "PD"; `comorbidities[5]` cites only
  "Sledování vhodné." while stating the stenosis).
- Every number, date, dose, unit and stage token in the value must occur
  in one of its spans, compared through a documented normalization map
  (O/0 as in "MO"/"M0", l/1 as in "lmg"/"1mg", decimal comma, spaces in
  "10 mg"). A mismatch rejects the fact; a match that needed the map
  makes it "verify".

Engine disagreement:

- Quotes are checked against the vision text, so a vision misreading
  would pass that check. A fact whose span touches a `disagree` or
  `only_vision` token, a low-confidence Tesseract word, or a page that
  failed the readability gate becomes "verify", and the UI shows both
  readings next to the image crop.

Negation, scoped by clause:

- Split the span into clauses (comma, semicolon, "jen", "ale",
  "jinak") and tag each clause. "Bez plicní embolie, jen drobná cysta v
  HL vpravo" is a negative finding and a positive one, which become two
  facts.
- Negative cues include "bez", "neguje", "nehmatné", "nezvětšená",
  "volné", "vyloučena", "negativní", "nepřibyla", "není". A mismatch with
  `negated` makes the fact "verify", not rejected, because the cue list
  will never be complete.
- "nevyšetřen" and "neprovedeno" mean not examined: a gap, never a
  negative finding.
- Lab index lines such as "S_IDXLIPK: NEGAT" are sample-quality
  indices, handled by the lab parser, not by the negation rule.

Planned versus done:

- Future or conditional wording in the span ("plánováno", "bude",
  "při dobré toleranci", "navýšíme", "doporučeno", "zadávám", a date after
  the document date) forces status `planned` or `requested`, never
  `done`. When the same document says both (page 3: "navyšuji" and "Při
  dobré toleranci navýšíme"), the fact is "verify" with both spans.

Dates:

- Partial dates stay partial; "9/23" is stored as written with month
  precision and the year resolved as 2023 only for sorting, marked as
  resolved.
- Relative dates ("dnes", "minulé CT", "baseline") resolve only against
  a known document or exam date; otherwise they stay unresolved and the
  fact says so.
- "After the document date" is checked only when the document date is
  known. On patient 10 the visit headers are blacked out, so the check
  cannot run, and the fact shows the document date as not readable.
- A value of the same kind in a later document marks the earlier fact
  `superseded_by`, so the summary uses the current value and an outdated
  one is never shown as current.

Coverage (stage 9):

- Nothing in stage 8 notices a fact the extractor left out; in the mock
  13 lab values were dropped silently. The coverage pass lists every
  date, drug name, TNM token, dose and lab code that no accepted fact
  covers. The lab parser alone would have caught the 13 values.
- Rejected facts do not vanish: they and the uncovered items appear in a
  "Nezpracováno / k ověření" list the doctor can open.

Cross-document rules (stage 10):

- Exam done, report missing: an exam named in a letter ("MR vyš. mozku
  14.9.2026", "CT hrudník, břicho 28.4.2026") is linked to an uploaded
  report of the same type and date (within a few days); no match gives
  "zpráva nenalezena v podkladech".
- Referral without result: a referral or request ("zadávám k projednání
  na NCH semináři", "kontrolní CT ... bude") is linked to a later
  document of the matching type; no match is a gap, never "neprovedeno".
- Identity conflicts from stage 4 are shown on the case, never resolved
  silently.

Summary sentences (stage 12):

- Each sentence lists at least one fact ID; every number and date in it
  occurs in its cited facts; every drug and procedure name occurs in its
  cited facts.
- That check alone does not block a treatment proposal: "next step
  cabozantinib" would pass, because page 2 documents cabozantinib
  ("ponecháme do 4. linie"). So the assistant's own text must also contain
  no recommending or modal wording ("doporučit", "doporučujeme",
  "zvážit", "indikovat", "indikován" outside a quoted fact, "vhodné",
  "nutné", "měl by", "navrhujeme", "další krok"). Such a sentence is
  dropped.
- Clinical terms in a sentence that do not occur in its cited facts are
  flagged ("imunitně podmíněná", "nepotvrzená/potvrzená progrese", "1.
  paliativní linie" when the fact says "1. cyklus") and shown as the
  assistant's wording with the "i" mark, or the template wording is used.
- Negation and "suspekce" carry over from the facts.
- Every sentence the LLM worded is labelled as the assistant's wording in
  the UI. The demo uses templates only.

### Where LLMs are used, and how

- Stages 2 and 7, optionally 1 and 11. Labs, vital signs, identity,
  dates, coverage and every rule are code.
- Prompts live in the repo (for example `pipeline/prompts/extract_facts.md`
  and `compose_summary.md`), each with a version; the output JSON schema
  lives next to them.
- Model deployment name, endpoint and key from `.env`; the exact model
  version pinned in `.env.example` and recorded on every fact; temperature
  0 where the model accepts it.
- Retry HTTP 429 with exponential backoff.
- The provider must not keep prompts and outputs: an EU deployment with
  abuse-monitoring storage turned off (or the provider's equivalent) is a
  requirement for real data, not an option
  ([`DATA-PROTECTION.md`](../design/DATA-PROTECTION.md)).

### Caching, logging and derived data

- Cache LLM outputs by hash of (input text or image, prompt version,
  model ID). The cache holds patient text, so for real data it lives on
  the hospital's server next to the case, readable only by the pipeline
  service, and is deleted with the case under the hospital's retention
  rule. For the fictitious demo patients the cache is committed so the
  demo runs without the endpoint.
- Logging by default: document ID, page, stage, prompt version, model,
  token counts, latency, and on validation failures only the rule ID and
  the fact key. No quotes, values or prompts.
- HTTP client libraries can log request bodies in debug or retry mode;
  their log level is pinned to warnings in production, and this is
  checked once with a test request.
- Debug logging of prompts and outputs is opt-in and writes to a
  gitignored folder.
- Quotes are found in pseudonymized text; the offset map from stage 5
  turns them back into offsets in the original transcription, so the
  source view highlights the original text, not the placeholder version.

### Evaluation

- Create `samples/` with one small synthetic case per known failure
  case, each with the expected facts and expected flags as JSON, and a
  script that runs the pipeline and reports per case: missing critical
  facts, wrong dates, wrong negation, wrong status (planned versus done),
  missed gaps, false alarms, uncovered items.
- Turn patient 10 into a reference case: take `mock-case-10.json`,
  apply the corrections in section 2, re-anchor the quotes to the vision
  transcription with multiple spans where needed, and have a clinician
  check it once. It is the best reference we have, and it is honest to
  say it was curated by agents and reviewed by people.
- Define "critical facts" per MDT type (new diagnosis, adjuvant,
  recurrence or progression, as in `PRODUCT.md` round 6), so "a critical
  fact left out of the summary" can be tested.
- Run the evaluation on every prompt or model change; store the report.

### Doctor edits and history

- Overrides attach to the fact key (document hash, spans, kind) or to a
  summary field. The mock stores edits per display field as
  `{key, text, orig}` (`/api/patients/:id/edits` in mock v4), which is
  enough for a demo but cannot survive re-extraction; the production
  store keys them on facts.
- The log is append-only, with who, when, the original value and the
  source kept.
- Confirming a fact marks it confirmed without changing it. Rejecting a
  fact keeps it suppressed on every later run until the doctor restores
  it.
- Re-processing (a new document, a new prompt version) creates a new
  extraction version. If a new extraction changes a fact a doctor edited
  or confirmed, the app shows both and asks; it never overwrites.
- The summary is recomposed from facts, but a sentence the doctor edited
  stays pinned. A pinned sentence that cites a fact overridden or
  superseded since gets a "stale" mark until the doctor looks at it.
- Approving an MDT conclusion freezes a snapshot: the fact keys and
  versions and the summary text as shown. A later MDT adds a new
  snapshot; it never edits the old one.

### Soňa's summary model mapped onto the pipeline

| Field | Source | Who writes it | Limit |
|---|---|---|---|
| Oncological summary | Validated facts chosen by the MDT type's checklist, in date order, current values only | Assistant drafts from templates (stage 11), doctor may edit | Facts only; no recommending wording; terms not in cited facts flagged |
| Reason for the MDT | The newest finding plus the referring doctor's own words if present (here "zadávám k projednání na NCH semináři") | Assistant drafts one sentence, labelled as a draft | Reason, not a recommendation |
| Question for the MDT | The referral form, if it has one | Doctor. Whether the assistant may draft a neutral question is open (`OPEN_QUESTIONS.md`) | Never names a treatment option |
| Proposed management | The referring doctor | Doctor only, labelled "návrh lékaře, ne rozhodnutí MDT" | Soňa's example ("stereotaktická radioterapie") crosses into treatment recommendation. Outside the guideline layer the assistant does not recommend; inside it, `CLAUDE.md` allows only guideline passages tied to documented facts until the team decides, and the layer is not in the demo build |
| MDT conclusion | The meeting | Doctor; append-only | The assistant never drafts it as a decision |
| Gaps | Stage 10 rules, uncovered items, "unclear" and "verify" facts, identity that cannot be verified | Deterministic, each labelled as the assistant's observation with the facts it rests on | Fixed gap wording. What counts as "missing" beyond named-but-absent reports depends on the open question of how to define it (from guidelines, from the MDT question, or from possible diagnoses; `OPEN_QUESTIONS.md`) |

The MDT type ("recidiva / progrese" for patient 10) should be a field the
doctor sets or confirms, not a hard-coded label, because it chooses which
facts the summary includes.

### A thin slice for the hackathon

1. Use the existing vision transcriptions as input (stage 2 is done for
   all 20 pages).
2. Write the lab parser and the coverage pass first; they are plain code
   and catch the silent omissions.
3. Write the extraction prompt and schema with multiple spans per fact,
   run it on patient 10 through the hackathon's Azure endpoint
   (fictitious data, allowed), cache the output.
4. Write the anchoring and validation rules (stage 8), which are the part
   that makes the result trustworthy.
5. Compose the summary from validated facts with templates.
6. Compare the output with the curated patient 10 reference and show the
   difference honestly, including the rejected and uncovered lists.

## Decisions needed

1. **What the demo shows for patient 10**: the curated JSON, labelled as
   prepared by development agents and reviewed by people, or a real
   pipeline run (thin slice above), or both side by side.
2. **The curated JSON: freeze or edit now.** Freeze it as reference data
   (fixes go into a separate reference file and the mock keeps showing
   the reviewed version), or apply the fixes below to the mock data now.
3. **Time box for the thin slice**, and what is cut if it runs over.
4. **Model and settings for extraction**: which Azure EU deployment, the
   pinned version, temperature 0.
5. **Text of record for quotes**: the vision transcription (proposed),
   with Tesseract disagreement as the verify signal, or keep the text
   layer for the mock until the pipeline exists.
6. **Labs by parser or by LLM**: the proposal is a deterministic parser
   for lab blocks, with the LLM only for labs written in free text.
7. **One quote span per fact or several**: several is proposed; it
   changes the data shape, the viewer highlight and the edits key.
8. **Show or hide rejected facts and uncovered items** for the doctor
   (proposed: shown in a separate list, never mixed with accepted facts).
9. **Summary wording**: templates only in the demo (proposed), or an LLM
   constrained and labelled as the assistant's wording.
10. **Definition of "missing"** (already open in `OPEN_QUESTIONS.md`),
    which the gaps field depends on.
11. **Who sets the MDT type**: the referring doctor, the coordinator, or
    the assistant with confirmation.
12. **Critical facts per MDT type**, which the summary checklist and the
    evaluation depend on (needs Soňa).
13. **Retention of caches and derived data** (transcriptions, LLM
    outputs, page images) for real data: where, who can read them, how
    long.
14. **Which clinician reviews the patient 10 reference** before it is
    used to score the pipeline.
15. **May the assistant draft the question for the MDT** (already open in
    `OPEN_QUESTIONS.md`); the proposal stays the doctor's in any case.

### Tasks once decided

- Build `samples/` with the seven failure cases and expected outputs
  (needs an owner).
- Fixes to the mock data, after the agent editing `mocks/` finishes
  (only if decision 2 says edit now):
  - drop the "J-" flag (`flags[4]`);
  - reword the spine-lesion note (`imaging[11]`, `data_gaps_v3[4]`);
  - make everolimus 10 mg consistently "plánováno, ověřit" in
    `current_state[1]`;
  - say in `labs_note_cs` that 26 of 39 values are shown;
  - drop the causal reading of "(hepatopatie G2)" in `past_treatment[9]`;
  - label "imunitně podmíněná" and the iRECIST reading as the
    assistant's;
  - make the MDT type a doctor-confirmed field;
  - update the "209 distinct references" count in `mocks/README.md`
    (215 now).
