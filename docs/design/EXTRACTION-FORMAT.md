# Extraction format (codebridge.extraction/2)

Status: approved for implementation, 2026-10-19 (issue #17). Decisions
are at the end.

This is the one format the case view reads and every producer writes:
the converted demo fixtures, the document pipeline and the NIS import.
The plan it belongs to is in
[`../research/2026-10-19-patient-pipeline-gaps.md`](../research/2026-10-19-patient-pipeline-gaps.md).

Terms used below:
- **Run:** one extraction of one case, stored as one JSON file in R2 with a D1 `extraction_runs` row pointing to it. Never changed after it is written.
- **Fact:** one statement about the patient (one lab value, one diagnosis, one planned exam) with its sources.
- **Source:** where a fact comes from: a passage in a document page, or a record in the NIS (the hospital system).
- **Check:** one step of the pipeline that looked for something. It records which documents it read and what it found.
- **Producer:** what wrote the run: `fixture` (prepared by hand), `pipeline` (documents) or `nis` (the FHIR import).

## Why a new format

Today's extraction JSON grew from hand-written fixtures. Its problems,
found in case 10's data:

- **One fact lives in up to six places,** worded differently: the compact oncology lines, the detailed lines, the timeline, the sections, the brief. A pipeline would have to write all of them consistently.
- **Some items bundle several facts:**
  - one "plan" line holds five planned items;
  - the vital signs are one string;
  - "ECOG PS 1, bez známek mozkových metastáz" mixes a value with a negation.
- **Three different ways to point at a source,** and the same passage appears as several differently trimmed quotes (171 distinct inline quotes, only 58 identical to the shared array).
- **Doctor edits and alert history are keyed by position** (`oc:0`, `sp:3:t`) or by a hash of the Czech alert text. A re-extraction that reorders items or rewords one alert moves an edit onto another fact or drops an acknowledgement.
- **Nothing says what was checked.** An empty allergy list may mean "no allergy stated" or "no one looked".
- **Two alert lists overlap,** so one problem shows twice.
- **Whether something is the assistant's inference** is written in free text ("Pozorování asistenta") in some places, a `certainty` field in others, and nowhere for lab out-of-range flags.

## The idea in one paragraph

A run is a list of **facts**, each pointing to entries in a list of
**sources**. Everything the doctor sees is computed from the facts in code:
- the headline;
- the oncology lines;
- the timeline;
- the labs;
- the anamnesis;
- the status.

The list of **checks** says what was looked at, so "nothing found" and "not
looked at" stay apart. **Alerts** come from rules over facts. The **brief**
is a list of sentences, each pointing at the facts it states. Facts and
alerts keep their IDs from run to run, so a doctor's confirmation, edit or
acknowledgement (kept in D1, outside the run) follows them into the next
run, and one that cannot follow is shown, never dropped.

## Top level

```json
{
  "schema": "codebridge.extraction/2",
  "case_id": "NO-010",
  "content_language": "cs",
  "run": { },
  "documents": [ ],
  "sources": [ ],
  "facts": [ ],
  "checks": [ ],
  "alerts": [ ],
  "brief": { },
  "question_draft": { },
  "views": { }
}
```

`views` is optional (see "Composed views").

- **`content_language`** is the language of the documents. Assistant text in the run stays in that language (I18N decision, 2026-10-18), with one exception: alert texts, which are Fluent messages and follow the UI language (see "Alerts").
- **No patient identity in the run.** Name, birth number and birth date live only in D1 `patients` (DATA-PROTECTION.md). The run refers to the case by ID. Quotes are the exception: they are verbatim, and if a quote happens to contain a name, it stays as written, as today.

### `run`

```json
{
  "id": "run-2026-10-19T10:04:11Z-a1b2",
  "producer": "pipeline",
  "created_at": "2026-10-19T10:04:11Z",
  "stages": [
    { "name": "ocr", "engine": "tesseract 5.3.0 ces 4.1.0" },
    { "name": "extract_facts", "model": "gpt-6-luna-dz-eu", "prompt": "extract-facts@3", "prompt_sha256": "…", "temperature": null },
    { "name": "rules", "engine": "codebridge rules@12" }
  ],
  "supersedes": "run-2026-10-18T16:20:03Z-9f8e"
}
```

A run never changes. A new run supersedes the old one, and both stay
(append-only, like MDT decisions).

### `documents`

Which document versions the run read. The documents themselves live in D1:
- `documents`, including the state `superseded` when a better scan replaces one, or `withdrawn` when it was the wrong patient's;
- `document_parts`, the clinical documents inside one PDF, with title, type, date and readability;
- the identity check result per document.

The run only refers to them:

```json
{ "document_id": "10_pacient", "sha256": "…", "parts": ["10_pacient/p0", "10_pacient/p1"] }
```

Parts get stable IDs instead of positions. A run reads only documents that
are current when it starts. Facts from a superseded or withdrawn document
are not in the next run; confirmations attached to them show up as
orphaned (see "Doctor confirmations and edits").

## Sources

Every passage is stored once, with an ID, and facts refer to it. A fact may
have several sources only when they say the same thing. Statements that
disagree become separate facts plus a contradiction alert.

**A passage in a document page:**

```json
{
  "id": "src-7c1e",
  "type": "document",
  "document_id": "10_pacient",
  "part": "10_pacient/p2",
  "page": 3,
  "quote": "S_HSCRP: 9,5 mg/1 [O ... 5]",
  "quote_text": "tesseract",
  "anchor": {
    "page_text_sha256": "…",
    "engine": "tesseract 5.3.0 ces 4.1.0",
    "char_range": [1412, 1439],
    "boxes": [[812, 1630, 410, 38]]
  },
  "reported_as": "original",
  "identity": "matches",
  "reading_check": {
    "mark": true,
    "tokens": [ { "pdf_text": "mg/1", "tesseract": "mg/1", "vision": "mg/l", "rule": "differ" } ]
  }
}
```

- **`quote` is verbatim** against the page text named in `quote_text`: `pdf_text` (the PDF's own text layer), `tesseract` or `vision` (the AI reading). Misreadings stay ("mg/1", "O"). A correction goes into the fact, never into the quote.
- **`anchor`** places the quote in the stored page text and word boxes, the same ones the source viewer highlights. It records the hash and engine of that page text. If the page is read again (a newer Tesseract, a better scan), the anchor no longer matches its hash, and the viewer falls back to tolerant quote matching as today.
- **`reported_as`:** `original` when the page is the report itself, `cited` when another document quotes it ("MR mozku 14.9.2026 (popis z NIS)" in an outpatient report). A cited result with no original report is the failure case "an exam happened but its report is missing", and a rule raises it.
- **`identity`:** the result of comparing the identity printed on the page with the case's patient: `matches`, `conflicts`, or `cannot_verify` (nothing printed). Only the result is stored, never the identity itself.
- **`reading_check`:** the per-token comparison of the readings that produces the "ověřit" mark. Kept structured, as today's `ocr_check`.

**A record in the NIS:**

```json
{
  "id": "src-nis-41",
  "type": "nis",
  "system": "https://nis.fno.example/fhir",
  "resource": "Observation/8812",
  "version": "3",
  "last_updated": "2026-09-17T08:12:00+02:00"
}
```

A NIS record has no page or quote. It is its own evidence: the source
viewer shows the record ("záznam z NIS").

## Facts

Every fact has the same frame, plus a `value` whose shape depends on its
`kind`:

```json
{
  "id": "f-8d41c2",
  "key": "lab_result|S_HSCRP|draw:undated|doc:10_pacient",
  "kind": "lab_result",
  "subject": "patient",
  "value": { },
  "date": { "as_written": null, "precision": null, "sort": null },
  "status": "documented",
  "negated": false,
  "not_stated": [],
  "origin": "document",
  "certainty": "verify",
  "certainty_reason": { "code": "ocr_char_swap", "text": "V textu „mg/1“ a „O“, čteno jako mg/l a 0." },
  "codes": [ { "system": "fno-local-lab", "code": "S_HSCRP", "assigned_by": "source" } ],
  "note": null,
  "quarantined": false,
  "sources": ["src-7c1e"]
}
```

The fields:

- **`id` and `key`:** see "Fact identity" below.
- **`subject`:** `patient`, or `relative` (with the relation, for family history). A mother's breast cancer never becomes the patient's diagnosis.
- **`date`:**
  - `as_written` is kept exactly ("4/2022", "2.6.2022", "base line CT z 03/2023");
  - `precision` is minute, day, month, year or `null`;
  - `sort` is only for ordering.

  A partial date never gets a made-up day.
- **`status`:**
  - `documented`: stated, no action involved;
  - `planned`;
  - `requested`: a request was sent;
  - `done`: performed;
  - `stopped` / `interrupted`: a therapy ended or was paused, for example "přerušena pacientem" after 2 of 4 cycles.

  A sent request is not a done exam.
- **`negated`:** the document states the opposite ("bez plicní embolie"). A negated fact is a finding, not a gap.
- **`not_stated`:** fields of this fact that the documents leave open, for example `["reason_stopped"]` or `["pack_years"]`. The view shows "-" with "neuvedeno v dostupné dokumentaci". A field that is simply missing means it was not looked for.
- **`origin`:**
  - `document`: stated in a document;
  - `nis`: from the NIS;
  - `assistant`: the assistant's own inference, such as an interval, a trend, or sex inferred from "Pacient po nefrektomii".

  An `assistant` fact may have sources (the quote it inferred from) and `based_on` (the facts it was computed from). The view labels it as the assistant's observation.
- **`certainty`:**
  - `clear`;
  - `verify`: the "ověřit" mark;
  - `conflicting`: the sources disagree. Used only for a fact whose disagreement cannot be split into separate facts; normally the facts are split.
  - `inferred`: an `assistant` fact resting on a single statement;
  - `unreadable`: the passage could not be read, so the fact has no value and the view shows it as unreadable.

  `certainty_reason` carries a code plus a text in the content language, shown to the doctor in a tooltip.
- **`codes`:** codes as the source gives them (NČLP, MKN-10, SNOMED CT, FNO's local lab codes), each with `assigned_by: "source"`, or `"assistant"` when we assigned it. A code is never invented and never dropped.
- **`note`:** a free-text note by the assistant about this fact, in the content language (today's `note_cs` on oncology lines), shown as the assistant's note.
- **`quarantined`:** set when the fact's source page shows another patient (`identity: conflicts`). The fact is kept but left out of the view's sections, the brief and the rules until a doctor resolves the identity alert. Patients are never merged silently.
- **`sources`:** one or more source IDs, all saying the same thing.

### Fact identity

The ID is what doctor confirmations, edits and alerts attach to. If it
changes between runs, their link breaks.

1. **`key`.** Every fact gets a deterministic `key` from its kind and the values that identify it, as defined per kind in the table below. The key never contains a page number or a position.
2. **Matching against the previous run.** The run reuses the previous run's `id` for the fact with the same key. If no key matches, a matcher looks for the previous fact of the same kind with the most similar value and sources, and reuses its ID when it is clearly the same fact. Otherwise the fact gets a new ID. Three guards keep a confirmation from moving onto a different finding:
   - **Same frame.** An ID is reused only when `negated`, `subject`, `status` and the date (as a key segment) are unchanged. These sit outside `value`, so the view's "same ID, different value" check would not see them change; "no headache" confirmed must never become "headache" confirmed, and a sent request never a done exam. A change gives a new ID, and the earlier confirmation shows as missing from the new processing.
   - **Retired documents.** A previous fact resting only on a document marked superseded or withdrawn since that run is not matched, even when another document says the same; its confirmation shows as missing.
   - **No reuse of retired IDs.** A new ID is never one issued before for the case (the caller passes every ID issued so far).
3. **Collisions.** Two facts with the same key in one run (two draws of the same test on one day without a time) get a suffix (`#2`, `#3`) in order of their content (value, then quoted passages), never of their position. The validator rejects a run with duplicate IDs.

| Kind | Key |
|---|---|
| `lab_result` | code (or name as written), draw date and time as written, requisition number if any, document |
| `diagnosis` | code or normalised text, disease status, date |
| `medication` | drug, period start (a dose change starts a new medication fact with its own start, so "Prednison 1 mg/kg/den" and "Prednison 0,5 mg/kg od 12.5.2023" are two facts); for an entry with no start, also the sorted set of document parts it is quoted from (`part:10_pacient/p0`; a source without a part counts as its document, a NIS source as its record), so the same drug listed undated in two reports gives two facts instead of a merge or a "#2". A part ID (`<document>/p<n>`) is stable only while the file is split into parts the same way: a re-split, or a source gaining a part or a further part (an identical entry repeated at a later visit, kept as a further source), changes the key, and the fact keeps its ID only through the matcher's similarity step, which refuses an ambiguous match |
| `systemic_therapy` | drug or regimen, line, start; for an entry with no start (an anticancer drug in a medication list), also the document part it is listed in, as for `medication` |
| `stage` | stage kind, date |
| `imaging`, `procedure`, `histology` | type and region, date |
| `request`, `plan` | what, date as written |
| `metastasis` | site, date |
| `radiotherapy` | target, date |
| `vital_sign` | what was measured (`blood_pressure`, or the label as written for `other`), date; not the reading, so a corrected reading keeps the ID and the view shows both values |
| `performance_status`, `prognostic_score` | scale or score name, date |
| `risk_factor` | type, date |
| `allergy` | substance, date |
| `family_history` | relation, condition, date |
| `decision` | body (MDT, KOC, ...), date |
| `contraindication` | what, date |
| `comorbidity` | code or normalised text, date |
| `exam_finding` | region, normalised text, date |
| `symptom`, `adverse_event` | normalised text, date |
| `visit` | visit type, date |
| `interval` | the IDs of its two ends |

Normalised text is NFC, without invisible format characters (soft hyphen, zero-width space), lower case, with whitespace collapsed and trailing punctuation dropped; diacritics stay.

### Fact kinds

The vocabulary comes from what case 10, S01 and S02 contain, plus what the
CLAUDE.md failure cases need. Each kind has a fixed `value` shape (the
JSON Schema defines them exactly).

| Kind | `value` (main fields) | In case 10 |
|---|---|---|
| `diagnosis` | text as written, disease status as the document says: `suspected`, `confirmed_histology`, `progression`, `stable`, `remission`, `suspected_recurrence`, `recurrence` | 1 primary + 10 others |
| `histology` | specimen, result text, tumour type, grade | 5 |
| `stage` | TNM as written and normalised, stage kind (`clinical`, `pathological`, `post_neoadjuvant`), TNM edition if stated, `as_of` (the date it describes), `at_diagnosis` (true or false) | 1 |
| `metastasis` | site, status (`suspected`, `confirmed`, `excluded`) | 5 |
| `procedure` | name (surgery, implant, biopsy) | 4 |
| `systemic_therapy` | drug or regimen, line, start, stop, reason for stopping | 6 (4 lines, plus the everolimus entry and its planned dose increase from the medication list) |
| `radiotherapy` | target, dose, fractions | 0 |
| `imaging` | modality, region, finding text, response category (iRECIST, RECIST) if stated | 16 |
| `lab_result` | name as written, value as written, `value_numeric`, `unit_as_written`, `unit`, reference range as written with `reference_low` and `reference_high`, out of range (`high`, `low`) with `out_of_range_origin` (`document` when the lab printed it, `assistant` when computed from the range), draw (date and time as written, requisition number, specimen) | 26 |
| `vital_sign` | one measurement: what (blood pressure, pulse, temperature, weight, BMI), value, unit | about 6 |
| `performance_status` | scale (ECOG, Karnofsky), value | 1 |
| `exam_finding` | body region, finding text | 13 |
| `symptom` | text | 5 (2 negated) |
| `comorbidity` | text, MKN-10 code if given | 11 |
| `medication` | drug, strength, dosing, change, indication, `stop_as_written` (when the document says the drug was stopped, as written; the fact then has `status: stopped` or `interrupted`, which the validator checks); not for anticancer drugs, see below | 14 |
| `contraindication` | what (a drug interaction, for example an ACE inhibitor with everolimus), stated by the document or inferred by the assistant | 1 |
| `allergy` | substance, reaction | 0 |
| `adverse_event` | text, grade if stated, related therapy | about 4 |
| `prognostic_score` | score (IMDC…), value, risk group | 2 |
| `risk_factor` | type (`smoking`, `alcohol`, `social`, `epidemiology`), text, pack-years | 2 |
| `family_history` | relation, condition (with `subject: relative`) | 0 |
| `request` | what was requested (exam, consultation, MDT), sent date, `result_fact` pointing to the result if one exists | 1 (NCH seminar, no result) |
| `decision` | body (MDT, KOC committee, consultation), decision text, date | 3 |
| `plan` | one planned item: what, when | about 5 (today in 2 bundled lines) |
| `visit` | one visit or hospital stay: type (`outpatient`, `admission`, `consultation`, `emergency`, `other`), its name as written, department as written, reason as written, the end of a stay as written | 2, plus 1 planned |
| `interval` | from fact, to fact, length as computed, both dates' precision (always `origin: assistant`, shown as a fact, never a verdict) | (computed) |

**Anticancer drugs in documents are `systemic_therapy`, never `medication`.** Everolimus,
sunitinib, nivolumab and the like are `systemic_therapy` facts even where a
medication list names them. The list entry is a further source of an
existing therapy fact only when it states nothing beyond that fact; an
entry with its own brand, strength or dosing is its own `systemic_therapy`
fact (undated, keyed by its document part), and a dose change stated there (for
example "od 19.9.2026 navýšení na 10 mg") is its own `systemic_therapy`
fact with its own start, as for `medication`. Supportive drugs given with
the therapy (antiemetics, corticosteroids) stay `medication`. Which drugs
count as anticancer (an ATC-based list or a clinician's call) is open in
[`OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md); until it is settled,
document producers follow the drug's role in the document, and the NIS
producer keeps every drug `medication` (see "The NIS producer"). The case
view's medication list ("Farmakologická anamnéza") shows a current
anticancer drug quoted from that list next to the other drugs, so the
list stays complete while the oncology lines show the therapy line.

A key rule change (here, undated medication and therapy entries gaining
their parts) re-keys facts of runs stored earlier. The matcher's
similarity step carries their IDs over when the match is unambiguous; two
identical entries in one run (same drug, dosing and quote) do not match
unambiguously, get new IDs, and their confirmations show as "potvrzeno
dříve, v novém zpracování chybí".

**One fact per statement.** The bundled items of today split up:
- the plan line becomes `plan` facts, one per item; a planned visit or check-up in it ("kontrola 9.10.2026") is a `visit` with status `planned`, not a `plan`, so it shows once on the timeline;
- the vital-signs string becomes one `vital_sign` fact per measurement;
- "ECOG PS 1, bez klinických známek mozkových metastáz" becomes a `performance_status` fact (1) and a negated `metastasis` fact (brain, clinical), both pointing to the same source.

**Not facts:**
- **Other patients' cases** (today's `extra.others`) are their own cases.
- **The document history** (today's `document_history`) is D1's audit log of uploads and replacements.

### Doctor confirmations and edits

They live in D1, keyed by fact ID, never in the run (`docs/design/DATABASE.md`, "Extraction runs"):
- **`fact_confirmations`:** append-only (case, fact ID, confirm or withdraw, the SHA-256 of the fact's frame and value, the run, who, when). The server computes the hash from the current run, so the page cannot confirm a value the run does not hold; a quarantined fact is never confirmed.
- **`fact_edits`:** the current override per edit key. A fact's key is `f:<fact id>` with an optional part (`:t`, `:c`, `:e`, `:line`, `:note`), and the row records the fact ID; a composed line's key is `v:<line id>` with the same optional parts (see "Composed views"), saved only for a line of the current run and recording no fact ID; fields that are not facts keep their names (`brief`, `reason`, `proposal`, `q`, `dx`, `assess`, `sev`). Rows under the old positional keys stay and can only be reverted.
- **`edit_log`:** stays the append-only history of edits.

The view overlays them on the current run:
- **Same ID, same value:** the confirmation stands.
- **Same ID, different value:** the view shows both values and asks the doctor. Confirmed content is never changed silently. For a confirmation the earlier value comes from the run the doctor confirmed (`GET /cases/:id/runs/:runId/facts/:factId`, read and logged like the case data); for an edit, from the text the page showed when the doctor edited it (the row's `orig`), so an edited line whose source was reworded says "zdroj se změnil" with both texts.
- **ID missing from the new run** (its document was withdrawn, or the matcher found no match), and every edit under an old positional key: the confirmation or edit is shown in a visible "potvrzeno dříve, v novém zpracování chybí" list with who and when. It is never dropped; a doctor may revert an orphaned edit there.

PRODUCT.md names no subset of critical facts, so the case view offers the confirmation on every line of the oncology summary; a line is confirmed when each of its facts is.

**A re-extraction** goes through the same steps as the first run, so all of the above holds for it:
1. `matchInputs`;
2. `prepareRun`, which carries the IDs over;
3. `withCaseRulesAndViews` (the case rules, then the composed views);
4. the brief;
5. `storeRun`.

`api/test/reextract.test.ts` checks this end to end:
- a confirmed value read again keeps its confirmation;
- a value read differently under the same ID is "changed" and asks again;
- a fact gone from the documents, or one whose date changed (a new ID), is listed under "potvrzeno dříve, v novém zpracování chybí".

`confirmedFactIds` (`api/src/store/runs.ts`) gives the facts whose confirmation stands for the current value. The brief treats them as verified, even when the extraction marked them "verify".

## Checks

Each check says what it looked for, over which documents, and what came
out:

```json
{
  "id": "chk-allergy",
  "looks_for": "allergy",
  "expected": null,
  "covered": [ { "document_id": "10_pacient", "part": "10_pacient/p0" }, { "document_id": "10_pacient", "part": "10_pacient/p1" } ],
  "unreadable": [ { "document_id": "10_pacient", "part": "10_pacient/p2", "page": 4 } ],
  "result": "nothing_found"
}
```

`result` is one of three values:
- **`found`:** facts exist.
- **`nothing_found`:** the check ran over the listed parts and the documents say nothing. The view shows "-" with "neuvedeno v dostupné dokumentaci" in the tooltip.
- **`not_run`:** this producer does not look for it. For example, the no-AI pipeline does not look for allergies. The view keeps today's "nezkontrolováno" (not checked).

So an empty section always says which of the three it is, and "nothing
found, but page 4 was unreadable" is visible.

Checks for documents name what they **expect**:

```json
{ "id": "chk-report-mr-brain-2026-09-14", "looks_for": "original_report", "expected": { "of_fact": "f-1a77e0" }, "covered": [ { "document_id": "10_pacient", "part": null } ], "unreadable": [], "result": "nothing_found" }
```

This says an original radiology report for a cited MR was looked for and
not found. The missing-document alert rests on it.

## Alerts

Alerts are the results of rules. Every alert points at the facts it rests
on, is the assistant's observation, and never blocks anything.

```json
{
  "id": "al-5f02aa",
  "rule": "request_without_result",
  "subject": "f-3c90de",
  "kind": "missing",
  "facts": ["f-3c90de"],
  "message": { "id": "alert-request-without-result", "args": { "fact": "f-3c90de" } },
  "note": null
}
```

- **Identity:** the rule plus a `subject` the rule defines:
  - the fact a rule is about (a request with no result);
  - the expected document (an original report for a cited exam);
  - the pair of facts compared (a contradiction);
  - the field (missing age or MDT question).

  A further fact joining the alert does not change its ID, and two different missing items under one rule never share one.
- **Where alerts live:** the run holds the alert instances. D1 holds one row per alert ID (`alert_identities`) with the acknowledgement history (`alert_events`), so an acknowledgement carries over to the next run.
- **Relevance to the MDT question** is computed in the view, because the doctor can change the question after the run.
- **`kind`:** one of `missing`, `contradiction`, `chronology`, `unclear`, `poor_copy`, `identity`.
- **`message`:** a Fluent message ID (I18N.md), so the interface text of an alert follows the UI language. Its arguments are fact IDs or plain values the view formats, never Czech words that would need grammatical case. Messages are written as "label: value" where an argument is text. The model's free-text explanation goes into `note`, in the content language.
- **Contradictions** are raised only between facts of the same kind about the same time (same analyte and draw; same stage kind and `as_of`). A pathological stage after surgery against a clinical stage at diagnosis is not a contradiction.
- **One list.** Today's two overlapping lists become one.

### The case rules

The rules that need every fact of the case (`packages/domain/src/extraction/rules.ts`) run when a run is published,
after `prepareRun` and before `storeRun` (`applyCaseRules`). They see final fact IDs, skip quarantined facts, and
replace the alerts and checks of their own rules, leaving every other alert alone. The run's stages record
`codebridge case-rules@<n>`.

| Rule | Kind | Subject | Raised when |
|---|---|---|---|
| `original_report_missing` | missing | the expected report, `report\|<kind>\|<modality>\|<region stems>\|<date>` (the fact ID when undated) | an imaging, histology, procedure, MDT decision or radiotherapy fact is only cited (`reported_as: cited`), and no fact of the same kind and exam has an original or NIS source. Same exam: the same date, or a cited month containing the original's day (a year alone never links, and an original dated less precisely than the citation is a summary line, not the report); for a histology also an original up to 21 days apart (the report date against the sampling date); a modality and region that do not differ, where an unstated region or specimen does not differ. A negated imaging or histology fact is a negative finding and needs its report; a negated procedure was not done and does not. The facts of one report (a histology with its receptors) form one alert; facts of different kinds never do, so a found biopsy protocol does not hide a missing histology report. |
| `original_reports_missing` | missing | `cited_exams\|<hash of the missing reports' subjects>` | more than 3 reports are missing: one grouped alert with the count (issue #49 proposal, pending expert review). Its identity is the set of missing reports, so a newly missing report is a new alert, never hidden by an earlier acknowledgement. |
| `request_without_result` | missing | the request (the lowest fact ID when one request is mentioned twice) | a `requested` request has no `result_fact` and no done exam of the same modality and region anywhere in the case on the same day or later (a result dated only by the request's month does not count); never for the MDT referral itself |
| `lab_value_differs`, `stage_differs`, `dosing_differs`, `performance_status_differs`, `metastasis_status_differs`, `histology_grade_differs` | contradiction | the pair | two facts of the same kind about the same thing and time disagree: same analyte, specimen, draw time or requisition and unit; same stage kind and fact date (only TNM categories both state); same drug and start (undated pairs are `unclear`); same scale and date; one site and date stated and excluded; one named specimen and date with two grades in one grading system |
| `response_assessment_differs` | contradiction or unclear | the pair | two response categories for what may be one exam (same day, or a month containing the day; modality and region that do not differ); `unclear` when one date is a month or the response systems differ |
| `therapy_stop_before_start`, `date_after_processing`, `result_before_request` | chronology | the fact, or the pair | the dates cannot be in this order, compared at the coarser precision; a written range counts from its first date as a start and to its last as a stop; "after processing" means after the run's day in Prague |

Each check of a missing report has `looks_for: original_report` and the report's first fact; `chk-contradiction`
and `chk-chronology` say the rules ran, so "none found" and "not checked" stay apart. `supersededFacts` names, for
the current-state views and the brief, the facts a newer dated fact of the same slot replaces (performance status per
scale, metastasis per site, stage per kind, diagnosis per code, vital sign per measurement); the older one stays in
the run as history.

## The brief

The brief is a list of sentences, each pointing to the facts it states.
The view numbers the references `[1]`, `[2]` when it renders them.

```json
{
  "sentences": [
    {
      "text": "Na MR mozku 14.9.2026 solitární sytící se ložisko pravé mozečkové hemisféry do 3 mm, suspektní z metastázy; jiná sytící se ložiska intrakraniálně nejsou.",
      "facts": ["f-1a77e0", "f-62b0d1", "f-62b0d2"]
    }
  ],
  "made_by": { "model": "gpt-6-luna-dz-eu", "prompt": "brief@2" }
}
```

A brief is kept only if every sentence passes these checks against its
facts:
- every date (compared after normalising "14.9.2026" and "14. 9. 2026") and every number appears in one of its facts;
- every negation in the sentence is backed by a negated fact ("jiná ložiska … nejsou" needs one);
- every side (vpravo, vlevo) and every drug name is backed by a fact.

A sentence that fails, or has no facts, is dropped. The validator checks
the dates, numbers, negations and sides (see "Composed views" for how);
drug names stay the producer's check, because the format has no drug list.
A producer that wrote briefs before this check must pass it now.

**How a pipeline run gets its brief** (`api/src/domain/brief.ts` `composeBrief`, rules in
`packages/domain/src/extraction/brief.ts`, prompt `api/src/prompts/compose-brief-cs.ts`). The model sees only
verified facts:
- certainty `clear`, or confirmed by a doctor;
- of the patient, not quarantined;
- not replaced by a newer fact of the same slot;
- of the kinds diagnosis, histology, stage, metastasis, procedure, therapies, imaging, performance status,
  prognostic score, adverse event, request, decision and plan;
- not an undated plan or planned item: it may come from an older report and be done by now. An undated request
  stays.

It sees them through the one model interface (pseudonymization, the identifier gate, the audit, the budget, the
cache), one part per source document, under short references (`[F1]`) instead of fact IDs. `acceptBrief` checks
every sentence against the facts it names:
- dates, numbers, negations and sides with the backing check;
- each negation word, and each negating verb ("neprokázala", "nepotvrdila"), must be in the cited facts' own words,
  not just in some other negated fact;
- drug names by their INN endings, and abbreviations of three or more capitals (except "MDT");
- no gap wording ("neuvedeno", "neprovedeno", "chybí"): gaps have their own alerts;
- the frame of the facts:
  - a suspected finding says "susp."/"podezření" and is not called confirmed;
  - a sentence over requests or plans says so and does not call them done;
  - a stage keeps its kind (clinical, pathological), and a stage at diagnosis is never called current;
- no unknown reference and no pseudonymization placeholder.

It drops what fails and never repairs it. A brief with no sentence left is `null`. Two alerts (kind `unclear`) keep a
partial brief from reading as complete:
- `brief_unverified_withheld` lists the facts of its kinds that are not verified, findings first;
- `brief_sentences_dropped` gives the count of dropped sentences and the facts they named.

Each alert's subject names its set of facts, so a newly withheld finding is a new alert that no earlier
acknowledgement covers. Without a brief (no model, no verified fact, or a refusal a retry cannot change, such as the
budget), the run is stored with neither alert.

Known limit: a date or dose is checked against all of the sentence's facts together. So a sentence that names two
therapies with their start dates swapped still passes.

## Composed views

A clinician's summary line often states several facts at once: "St. p.
nivolumab + ipilimumab, 2 cykly ze 4 indikovaných, dle IMDC střední
prognóza; po 2. cyklu gastrointestinální toxicita 1. stupně" is a therapy,
a prognostic score and two adverse events. Computed fact by fact, the
oncology summary of case 10 would have about 48 lines instead of 16. A
producer may therefore add composed lines: its own wording for one or more
facts, checked against them like brief sentences.

```json
{
  "onco_lines": [
    {
      "id": "vl-3f0c9a12",
      "text": "St. p. udržovací léčbě nivolumabem do 29.12.2025, dle CT 6/2023 až 6/2025 iPR",
      "title": null,
      "detail": null,
      "date": { "as_written": "27.6.2023", "precision": "day", "sort": "2023-06-27" },
      "category": "systemic",
      "status": "done",
      "facts": ["f-49b84a6d", "f-8425851b", "f-a71c1101"],
      "note": "Důvod ukončení výslovně neuveden; CT 11/2025 hodnoceno jako progrese."
    }
  ],
  "other_diagnoses": [ ],
  "timeline": [ ],
  "made_by": { "model": null, "prompt": null }
}
```

- **Optional.** `views` and each list in it may be absent. A run without a list is shown fact by fact (see "How the case view uses it"), so a new patient's run needs none. Each list present is the whole view, in display order.
- **The lists:** `onco_lines` (the oncology summary), `other_diagnoses` (the line of other diagnoses beside it), `timeline` (the timeline cards; `title` is the card's heading and `detail` its longer text, both null on a summary line).
- **`date`** is the date the line is filed under, as one of its facts writes it; a partial date stays partial. **`category`** is one of the timeline's event categories (`imaging`, `systemic`, `medication`, `mdt`, `surgery`, `pathology`, `radiotherapy`, `laboratory`, `clinical`). **`status`** uses the fact statuses, so a planned or requested line never reads as performed.
- **`id`** is `vl-` and the FNV-1a hash of the view's name and the sorted fact IDs (`viewLineId` in keys.ts). A doctor's edit of a line is keyed by it, so it follows the facts, not the line's position. When a later run composes the line from other facts, the line gets a new ID and the old edit shows in the "potvrzeno dříve, v novém zpracování chybí" list, never on another line.
- **`note`** is the assistant's note on the line, in the content language.
- **The text adds nothing.** The validator rejects a line, in its `text`, `title` and `detail`, that holds:
  - a date none of its facts holds ("6/2022" is backed by a fact dated 2.6.2022; "14.9.2026" is not backed by "9/2026"; "14.9.25", "14.9." and "září 2026" are dates too);
  - a number none of its facts holds ("37,5" and "37.5" are one number; digits glued to a letter, such as "G2" or "pT2a", are a code, not a number). A number with a unit ("5 mg", "3 mm", "24 %", "2 cykly") needs the same number with the same unit, so "3. linie" does not back "3 mg";
  - a negation ("bez", "není", "nejsou", "neguje", "nepřibyla", "neprokázány", "žádná", ...) when none of its facts is negated and none states the same word ("eupnoe, bez cyanózy" in an exam finding); inflected forms count as one word;
  - no negation at all when every one of its facts is a recorded negative ("plicní embolie" over a negated fact);
  - a side (vpravo, vlevo, pravý, levý, oboustranně) none of its facts states.

  What backs a line is what its facts say: their values, codes, dates and quoted passages. A fact's `note` and `certainty_reason` are the assistant's words and back nothing. The same check applies to brief sentences. It guards against invented content; it is not a proof that the wording is right (a negation word or a number may be backed by another statement among the same facts), and drug names are not checked.
- **The line follows its facts.** Its `date` is the date of one of its facts; a `planned` or `requested` line rests on a planned or requested fact, and a line over planned facts only is never `done`.
- **Facts must exist and must not be quarantined**, and a line needs at least one fact. The view shows a line or a brief sentence only when it may show every fact it rests on, so a quarantined fact never shows through a line's wording.
- **Deploying.** A validator from before `views` rejects a run that has them (unknown fields are refused), so the code that validates runs ships before or with the first producer that writes them.

The converted case 10 carries today's 16 oncology lines, the other
diagnoses and the 16 timeline cards this way (`fixtures/convert/case10_v2.py`,
`ONCO_LINES`, `TIMELINE_CARDS`, `OTHER_DX`).

A pipeline run gets its `onco_lines` and `timeline` from `composeViews`
(`packages/domain/src/extraction/compose.ts`). The case merge is meant to call
it after the case rules; until stream B wires it, only the tests and the eval
harness do. It is deterministic and words each line only from its facts' own
values, joined by "od", "do", "dále", "histologie:", "toxicita:" and "důvod
ukončení:". One line per event:
- a treatment line with its later dose changes and its stop: the same drugs
  (drug names recognised by their INN endings), the same combination or
  single drug, the same line number when both give one, dated before the
  line's documented stop. An undated statement that could belong to two lines
  stays on its own;
- the adverse events related to exactly that therapy and dated within it;
- a procedure with the same-day histology whose specimen it names;
- an imaging exam or a procedure with the same-day metastasis findings at a
  site its words name.

A planned or requested fact never shares a line with what was done. Anything
else stands on its own line. Labels keep the documents' status:
- a recorded negative whose words hold no negation reads "(negativní nález)",
  the view's own label;
- a suspected metastasis reads "suspektní metastáza: <site>";
- a suspected diagnosis reads "(podezření)".

A stopped line without a stop date gets the note "Datum ukončení neuvedeno v
dostupné dokumentaci."; an interrupted one does not. A line whose event
`supersededFacts` replaces gets the note "Novější údaj téhož druhu z <date>.",
and the facts' own notes stay in the line's note. `other_diagnoses` is not
composed, so the view lists those diagnoses fact by fact.

## The drafted MDT question

```json
{
  "text": "Jaký postup doporučuje neurochirurgický seminář u solitárního ložiska v pravé mozečkové hemisféře?",
  "question_kind": "document_purpose",
  "basis": [ { "role": "purpose", "facts": ["f-3c90de"] }, { "role": "finding", "facts": ["f-1a77e0"] } ]
}
```

It stays labelled as a draft until a doctor confirms or edits it. The
confirmation is stored in D1 (`question_confirmations`), as today.

`composeBrief` asks the model for a question only when the referral states none (`draftQuestion`). The question
passes the same checks as a brief sentence against its basis facts, except the status and certainty words, since it
asks rather than states. It must end with a question mark. It must not propose an answer or a treatment ("indikován",
"zahájit", "navýšit", "ukončit", "souhlasí", "..., že?"). Its `question_kind` and basis roles must be from their lists. The question
box reads the case row, so the case merge copies the draft there with `queueQuestionDraft` (`api/src/store/runs.ts`):
- only for a case without an explicit question;
- never over a draft a doctor has confirmed, nor under a question a doctor has edited (`fact_edits` key `q`);
- a run without a draft clears the earlier unconfirmed draft;
- with the basis as quotes of the basis facts' first document passages.

## How the case view uses it

The view receives the current run through `GET /cases/:id/extraction`, minus its quarantined content: the server
removes every quarantined fact, every source that only quarantined facts cite, and the quarantined fact IDs from the
alerts' `facts` (`withoutQuarantined` in `api/src/store/runs.ts`). A page that shows another patient never reaches the
browser through the run; the identity alert stays and its message names the document and page. The payload is
therefore not a whole run and need not pass `validateRun`; the stored run does. The same reply carries the case's
stored documents with their parts (`documents`: title, type, date, pages, readability from D1 `document_parts`), since
the run names parts by ID only. `packages/domain/src/run-view.ts` (`fromRun`) computes every view part below, and drops
anything that rests on a fact the payload does not hold.

| View part | Computed from |
|---|---|
| Diagnosis headline | `diagnosis` + `histology` + `stage` facts, the stage shown with its kind and date ("pT2a pN1 M0, patologické stadium při diagnóze, 2.6.2022") |
| Oncology lines | `views.onco_lines` when the run has it; otherwise one line per `procedure`, `systemic_therapy`, `radiotherapy`, `imaging`, `metastasis`, `decision`, `plan` fact, by date, with its `note` |
| Other diagnoses | `views.other_diagnoses` when the run has it; otherwise the non-primary `diagnosis` facts and the `comorbidity` facts |
| Timeline | `views.timeline` when the run has it; otherwise every dated fact of an event kind (the oncology kinds, `histology`, `diagnosis`, `request`, `visit`), by `date.sort`; undated under "Bez data"; `plan` and `request` facts marked as planned or requested; `visit` facts as their own entries (a visit or a stay, with its end when given), marked planned when planned |
| Labs | `lab_result` facts grouped by code into series with `value_numeric`. Every case can show a trend, and a single value shows as a table row. |
| Anamnesis | `comorbidity`, `medication`, `contraindication`, `allergy`, `risk_factor`, `family_history` facts, each section with its check. A check that found facts of its kind none of which the section lists (the risk-factor check behind both abusus and EA) shows that section as nothing found. A negated fact whose text does not say the negation carries a negation label, here and in every other view part. |
| Current state | `vital_sign`, `performance_status`, `exam_finding`, `symptom` facts (and a clinically excluded metastasis) of one exam, grouped by kind; no more matching of Czech label strings. The exam is the document part holding the most undated state findings (the current exam's findings carry no date of their own, an older exam quoted beside them does), else the part of the latest dated ones; that part's `visit` fact names it. Known limit: when a producer dates the current exam, an older part with undated findings wins; a producer-marked current visit would replace this rule (OPEN_QUESTIONS.md). |
| Alerts | `alerts`, with the facts each rests on |
| Brief | `brief.sentences` |
| Source viewer | the fact's sources: a document page with the highlighted passage and its "ověřit" tokens, or the NIS record |
| Guidelines and deviations | They live outside the run. Statements and findings store the run ID and the fact IDs they rest on, and the view flags a reference it cannot resolve in the current run instead of hiding it. |

Quarantined facts are not shown anywhere in the case view. The identity
alert names only the document and page that show another patient, not
what those pages say, until a doctor resolves it.

## Worked example: one lab value

**Today** (`mock-case-10.json`, `labs[0]`):

```json
{"code":"S_HSCRP","name_cs":"hsCRP","value":"9,5","unit":"mg/l","reference_range":"0 ... 5","out_of_range":"high","date":null,
 "source":{"file":"10_pacient.pdf","page":3,"quote":"S_HSCRP: 9,5 mg/1 [O ... 5]"},"certainty":"unclear_ocr","note":"OCR 'mg/1' = mg/l, 'O' = 0"}
```

**New:**

```json
{
  "id": "f-8d41c2",
  "key": "lab_result|S_HSCRP|draw:undated|doc:10_pacient",
  "kind": "lab_result",
  "subject": "patient",
  "value": {
    "name_as_written": "hsCRP",
    "value_as_written": "9,5",
    "value_numeric": 9.5,
    "unit_as_written": "mg/1",
    "unit": "mg/l",
    "reference_range": "0 ... 5",
    "reference_low": 0,
    "reference_high": 5,
    "out_of_range": "high",
    "out_of_range_origin": "assistant",
    "draw": { "as_written": null, "requisition": null, "specimen": null }
  },
  "date": { "as_written": null, "precision": null, "sort": null },
  "status": "documented",
  "negated": false,
  "not_stated": ["draw"],
  "origin": "document",
  "certainty": "verify",
  "certainty_reason": { "code": "ocr_char_swap", "text": "V textu „mg/1“ a „O“, čteno jako mg/l a 0." },
  "codes": [ { "system": "fno-local-lab", "code": "S_HSCRP", "assigned_by": "source" } ],
  "note": null,
  "quarantined": false,
  "sources": ["src-7c1e"]
}
```

What changed from today:
- `out_of_range_origin: "assistant"` says the "high" was computed from the range, not printed by the lab. Today that's only in a note.
- `not_stated: ["draw"]` says the documents give no draw date.
- The quote keeps "mg/1"; the corrected unit is in the fact.

**The view shows:** a table row "hsCRP 9,5 mg/l (0 ... 5) ↑" with the
"ověřit" mark and the reason in its tooltip. The ↑ is labelled as computed.
Clicking it opens page 3 with the passage highlighted.

## Worked example: stage at diagnosis and now

**Today:** one headline object with text fields (`tnm_cs`,
`tnm_context_cs: "patologické stadium z nefrektomie 2.6.2022, stadium při
diagnóze (ne aktuální stav)"`).

**New:** a structured `stage` fact:

```json
{
  "id": "f-0b19e4",
  "key": "stage|pathological|2022-06-02",
  "kind": "stage",
  "subject": "patient",
  "value": {
    "tnm_as_written": "pT2a pN1(3+/5) MO",
    "tnm": "pT2a pN1 M0",
    "stage_kind": "pathological",
    "edition": null,
    "as_of": "2.6.2022",
    "at_diagnosis": true
  },
  "date": { "as_written": "2.6.2022", "precision": "day", "sort": "2022-06-02" },
  "status": "documented",
  "negated": false,
  "not_stated": ["edition"],
  "origin": "document",
  "certainty": "verify",
  "certainty_reason": { "code": "ocr_char_swap", "text": "V textu „MO“, čteno jako M0." },
  "codes": [],
  "note": null,
  "quarantined": false,
  "sources": ["src-0001", "src-0002"]
}
```

A later clinical stage would be a separate fact with
`stage_kind: "clinical"` and its own `as_of`. The contradiction rule
compares only stage facts of the same kind and date, so the two never
conflict.

## Worked example: a referral without a result

**Today:** a free-text gap, "Výsledek neurochirurgického semináře k nálezu
MR neuveden v dostupné dokumentaci."

**New:** a `request` fact, a check and an alert computed by a rule.

```json
{
  "id": "f-3c90de",
  "key": "request|projednání nálezu mr mozku na neurochirurgickém semináři|undated",
  "kind": "request",
  "subject": "patient",
  "value": { "what": "projednání nálezu MR mozku na neurochirurgickém semináři", "request_kind": "consultation", "result_fact": null },
  "date": { "as_written": null, "precision": null, "sort": null },
  "status": "requested",
  "negated": false,
  "not_stated": ["date"],
  "origin": "document",
  "certainty": "clear",
  "codes": [],
  "note": null,
  "quarantined": false,
  "sources": ["src-0041"]
}
```

1. The rule `request_without_result` sees `status: requested` with no `result_fact`.
2. It raises the alert shown under "Alerts" above, with this fact as its `subject`.
3. If a later document holds the seminar's result, its fact fills `result_fact`, and the alert is not raised in the next run.
4. The alert's history (who acknowledged it, when) stays in D1 under its ID.

## Worked example: two sources that disagree

Case 10 states the Spiriva dosing twice: 1-0-1 in one place, 2-0-0 in
another. These become two `medication` facts, each with its own source
and `certainty: "verify"`. A `contradiction` alert has the pair as its
subject. Neither value wins silently.

## The NIS producer

A run with producer `nis` comes from the hospital system (NIS) over FHIR R4
(issue #22). `packages/domain/src/nis-map.ts` maps the resources of one
linked patient; `api/src/services/fhir.ts` (`patientRecord`) pulls them.
Every fact has `origin: "nis"` and one source of type `nis` naming the
record (system, `Type/id`, version, last updated). Codes, units, ranges and
dates are kept as the NIS gives them, and the NIS's statuses are mapped
only as far as the record states them.

| FHIR resource | Fact | Notes |
|---|---|---|
| `Observation`, category `laboratory` | `lab_result` | `value_as_written` is the NIS's number (so neither a decimal comma nor trailing zeros: "0,40" on the sheet is "0.4"), `value_numeric` the same number; a comparator stays in the text ("<0.5") and leaves `value_numeric` empty; unit, first reference range text and limits (several ranges give "verify"); codes as given (FNO's own lab codes as `fno-local-lab`, any other system, NČLP included, under its URI); `out_of_range` only from the record's own interpretation (`out_of_range_origin: document`); the draw is the Prague wall time of the record's instant, so another offset for the same instant keeps the fact's key; a lab without a name is not mapped; a dateless one has `not_stated: ["draw"]` |
| `Observation` stating a stage group | `stage` | `stage_kind` from LOINC 21908-9 (clinical) or 21902-2 (pathological), or the NIS's own label naming one kind only (cTNM, pTNM, ypTNM for `post_neoadjuvant`); a label naming two kinds, disagreeing with the code, or naming ycTNM is skipped as ambiguous; the separate T, N and M observations are skipped, because as facts they would read as several stages of one day; `tnm_as_written` as given, `tnm` left null; `as_of` the effective date |
| `Condition` | `diagnosis` | text and MKN-10 code as given; `disease_status` only from what the record states (`provisional` and the like give `suspected`, clinical status `recurrence` or `remission`); a confirmed diagnosis stays without a status, because the record does not say it was confirmed by histology; `refuted` is a negated fact; `entered-in-error` is not mapped; `resolved`, `inactive` or an abatement give "verify" with the end date in the reason; the date is the onset only (never `recordedDate`, which is when the entry was made) |
| `Procedure` | `procedure` | `completed` is `done`; `in-progress` stays `documented` with "probíhá (dle NIS)" in the text, because the format has no "in progress"; `not-done` is a negated fact |
| `MedicationStatement` | `medication` | drug and dosage text as given; `unknown` and `active` are `documented`; `completed` and `stopped` are both `stopped`, with the text saying which, and the end date as written in `stop_as_written`; every NIS drug stays `medication`, anticancer drugs included, until the classification question (ATC) in OPEN_QUESTIONS.md is settled |
| `ServiceRequest` | `request` | `active` is `requested` (a sent request is not a done exam); `completed` is `done`; `unknown` is `documented`; `result_fact` only when a report of this NIS names the request in `basedOn` (a versioned or absolute reference counts; when several reports do, the final one with the lowest ID) |
| `DiagnosticReport`, category RAD | `imaging` | modality from the start of the report's name, the rest is the region; the conclusion is the finding |
| `DiagnosticReport`, category PAT | `histology` | the report's name as the specimen, the conclusion as the result |
| `Encounter` | `visit` | `type` from the class, in HL7's ActCode system or with no system (`AMB` outpatient; `IMP`, `ACUTE`, `NONAC`, `SS` admission; `EMER` emergency; anything else `other`; `consultation` is not a class, so the NIS never gives it); the encounter's type text as `type_as_written`, `serviceProvider.display` as the department, the first reason as written; `period.end` as the end; a reason given only as a reference (`reasonReference`) is not copied, the referenced Condition is its own fact; `finished` is `done`, `planned` is `planned`, every other status `documented`; `cancelled` and `entered-in-error` are not mapped |
| `DocumentReference` | none | listed for the document import (status, `relatesTo` `replaces`, the attachment), which goes through the upload path |

**One rule of ours: `primary`.** The diagnosis the MDT discusses is marked
`primary` when exactly one non-negated diagnosis has a primary cancer code
(MKN-10 C00-C76, C80-C97 or D00-D09; C77-C79 are secondary). With none or
several, no diagnosis is marked. This is the assistant's rule on the code,
not something the NIS states.

**Not mapped**, and reported by the mapping with a reason: a lab report's
grouping (its Observations are mapped one by one), other Observations, a report
or condition without text, and identity and insurance (`Patient`,
`Coverage`), which stay in D1. A record marked `entered-in-error` or
`cancelled` is left out; a `preliminary` one is mapped with certainty
`verify`.

**Checks.** The NIS answers for its structured records, not for the
documents, so a NIS run's checks say only `found` (the kind has facts and
nothing of its kind was skipped or cut off by the paging limit) or
`not_run` (everything else, every kind listed). It never says
`nothing_found`, which the view shows as "neuvedeno v dostupné
dokumentaci". A done request without a result is visible in the run
(`status: done`, `result_fact: null`); the missing-report check belongs to
the case rules over the merged facts.

**Refresh.** The refresh asks the NIS what changed at or after the newest
`meta.lastUpdated` it saw (`_lastUpdated=ge`, the NIS's own clock, so a
record of the same instant is not missed). When anything changed, it pulls
the whole record again and maps it, matched against the previous NIS run,
so a fact keeps its ID and a doctor's confirmation stays on it; a changed
value shows under the same ID with the record's new version, and a record
deleted in the NIS drops out with the full pull. Storing the runs and the
refresh route come with the run publishing (stream A part 2, stream B).

## Validation and versioning

- **JSON Schema.** The format is defined in `packages/domain`: TypeScript types, a JSON Schema generated from them, and the same schema checked by the Python pipeline. Every run is validated before it is stored. The validator rejects:
  - duplicate fact IDs;
  - a fact without sources (unless `origin: assistant` with `based_on`);
  - unknown source IDs, documents and parts;
  - an alert whose facts do not exist, or whose ID does not follow from its rule and subject;
  - a key that does not follow from the fact;
  - a partial date that gained precision (`sort` must fit `precision`: "2024-03" for a month, never "2024-03-15");
  - a metastasis whose `status: excluded` and `negated` disagree;
  - `subject: relative` outside `family_history`, and `family_history` about the patient;
  - a check for a fact kind that says `nothing_found` while such facts exist, or `found` with none;
  - a quarantined fact used anywhere outside its identity alert (brief, question, other alerts and their subjects, checks, intervals);
  - a contradiction between facts of different kinds;
  - a brief sentence or a composed line whose dates, numbers, negations or sides its facts do not hold, a composed line without facts, and a line ID that does not follow from its view and facts.

  Issue messages name fact IDs and field names, never patient text, so callers may log them; act on the code and the path.
- **Code.** TypeScript: `packages/domain/src/extraction` (types, keys and IDs, the matcher, the validator); the schema is generated into `packages/domain/schema/extraction-2.schema.json` by `npm run schema -w @codebridge/domain`, and a test fails when the checked-in file is stale. Python: `pipeline/extraction_format`, the same functions and issue codes, validating with `jsonschema` against the same file (`CODEBRIDGE_EXTRACTION_SCHEMA` overrides the path where `packages/` is not present, such as the page-reader container). Both sides test against `packages/domain/test/extraction-key-vectors.json`; regenerate it (`npx jiti packages/domain/scripts/extraction-key-vectors.ts`) only on a deliberate change; it also holds matcher scenarios, so the two matchers give the same IDs.
- **Versioning:**
  - Adding an optional field keeps `/2`.
  - A breaking change becomes `/3`, together with a converter from `/2`; old runs stay readable through the converter.
  - An unknown fact kind is shown as a plain fact (its text and sources) instead of breaking the view.
- **D1 for this format** (`docs/design/DATABASE.md`, "Extraction runs"):
  - `extraction_runs.producer` (`fixture`, `pipeline`, `nis`), `seeded`, `schema` and `supersedes` (migration 0016); `kind` remains as a computed column until a later migration drops it;
  - `alert_identities` and `alert_events` keyed by alert ID, with the alert instances in the run file (0016); the `/1` alerts and their events stay read-only in `alerts` and `alert_events_v1`;
  - `fact_ids`, every fact ID ever issued for a case (0016);
  - `fact_confirmations` (0016);
  - `fact_edits.fact_id` for `f:<fact id>` keys (0016);
  - `documents.lifecycle` `superseded` and `withdrawn` (migration 0013, a column apart from the processing `state`);
  - `document_parts.part_id`, the stable part ID (0016).

## Converting the existing fixtures

Case 10, S01 and S02 are converted once, by a script, and kept as
reference cases:
- **Bundled items** are split into single facts.
- **Trimmed quote variants** are merged into one source each.
- **Disagreeing statements** become separate facts with a contradiction alert.
- **The two alert lists** are de-duplicated.
- **Edits and acknowledgements** in the demo database are re-keyed to fact and alert IDs.
- **The guideline and deviation files** are re-keyed from fact text and array positions to fact IDs.

The converted case 10 must render the same view as today: the browser
suite stays green, and any intended difference is listed for review. The
evaluation script (stream C, #19) then compares pipeline output for the
same documents against these reference cases.

## Decisions (2026-10-19, Juro)

1. **Fact keys per kind:** as in the table under "Fact identity".
2. **Stage:** `tnm` normalised is kept next to `tnm_as_written`.
3. **Disease status vocabulary** (`suspected`, `confirmed_histology`, `progression`, `stable`, `remission`, `suspected_recurrence`, `recurrence`): accepted for now. **It needs review by a clinical expert** before real patients.
4. **Facts from a page that shows another patient are not shown** anywhere in the case view (quarantine). Only the identity alert says that such a page exists, until a doctor resolves it.
5. **A fact a doctor confirmed that is missing from a later run is shown** with "potvrzeno dříve, v novém zpracování chybí" (confirmed earlier, missing from the new processing). It is never dropped silently.
6. **Visits are facts** (kind `visit`, key: kind, type, date), so a visit or stay from the NIS or a document goes on the timeline. Accepted risk: two visits of the same type on one day without a time share the key and are told apart by their content (`#2`), so if the NIS later renames one of them, their IDs can swap.
7. **A NIS run says "found" or "not checked", never "neuvedeno v dostupné dokumentaci"** (`nothing_found`): the NIS answers for its structured records, not for the documents ("The NIS producer", "Checks").

The format is approved for implementation (2026-10-19).
