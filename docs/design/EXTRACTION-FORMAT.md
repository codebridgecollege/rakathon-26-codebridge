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
  "question_draft": { }
}
```

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
| `medication` | drug, period start (a dose change starts a new medication fact with its own start, so "5 mg" and "10 mg od 19.9.2026" are two facts) |
| `systemic_therapy` | drug or regimen, line, start |
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
| `systemic_therapy` | drug or regimen, line, start, stop, reason for stopping | 4 lines |
| `radiotherapy` | target, dose, fractions | 0 |
| `imaging` | modality, region, finding text, response category (iRECIST, RECIST) if stated | 16 |
| `lab_result` | name as written, value as written, `value_numeric`, `unit_as_written`, `unit`, reference range as written with `reference_low` and `reference_high`, out of range (`high`, `low`) with `out_of_range_origin` (`document` when the lab printed it, `assistant` when computed from the range), draw (date and time as written, requisition number, specimen) | 26 |
| `vital_sign` | one measurement: what (blood pressure, pulse, temperature, weight, BMI), value, unit | about 6 |
| `performance_status` | scale (ECOG, Karnofsky), value | 1 |
| `exam_finding` | body region, finding text | 13 |
| `symptom` | text | 5 (2 negated) |
| `comorbidity` | text, MKN-10 code if given | 11 |
| `medication` | drug, strength, dosing, change, indication | 13 |
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
- **`fact_edits`:** the current override per edit key. A fact's key is `f:<fact id>` with an optional part (`:t`, `:c`, `:e`, `:line`, `:note`), and the row records the fact ID; fields that are not facts keep their names (`brief`, `reason`, `proposal`, `q`, `dx`, `assess`, `sev`). Rows under the old positional keys stay and can only be reverted.
- **`edit_log`:** stays the append-only history of edits.

The view overlays them on the current run:
- **Same ID, same value:** the confirmation stands.
- **Same ID, different value:** the view shows both values and asks the doctor. Confirmed content is never changed silently.
- **ID missing from the new run** (its document was withdrawn, or the matcher found no match): the confirmation or edit is shown in a visible "potvrzeno dříve, v novém zpracování chybí" list. It is never dropped.

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

A sentence that fails, or has no facts, is dropped.

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

## How the case view uses it

The view receives the current run through `GET /cases/:id/extraction`, minus its quarantined content: the server
removes every quarantined fact, every source that only quarantined facts cite, and the quarantined fact IDs from the
alerts' `facts` (`withoutQuarantined` in `api/src/store/runs.ts`). A page that shows another patient never reaches the
browser through the run; the identity alert stays and its message names the document and page. The payload is
therefore not a whole run and need not pass `validateRun`; the stored run does.

| View part | Computed from |
|---|---|
| Diagnosis headline | `diagnosis` + `histology` + `stage` facts, the stage shown with its kind and date ("pT2a pN1 M0, patologické stadium při diagnóze, 2.6.2022") |
| Oncology lines | `procedure`, `systemic_therapy`, `radiotherapy`, `imaging`, `metastasis`, `decision`, `plan` facts, by date, with their `note` |
| Timeline | every dated fact, by `date.sort`; undated under "Bez data"; `plan` and `request` facts marked as planned or requested; `visit` facts as their own entries (a visit or a stay, with its end when given), marked planned when planned |
| Labs | `lab_result` facts grouped by code into series with `value_numeric`. Every case can show a trend, and a single value shows as a table row. |
| Anamnesis | `comorbidity`, `medication`, `contraindication`, `allergy`, `risk_factor`, `family_history` facts, each section with its check |
| Current state | `vital_sign`, `performance_status`, `exam_finding`, `symptom` facts. No more matching of Czech label strings. |
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
| `MedicationStatement` | `medication` | drug and dosage text as given; `unknown` and `active` are `documented`; `completed` and `stopped` are both `stopped`, with the text saying which, and the end date in the text |
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
  - a contradiction between facts of different kinds.

  Issue messages name fact IDs and field names, never patient text, so callers may log them; act on the code and the path.
- **Code.** TypeScript: `packages/domain/src/extraction` (types, keys and IDs, the matcher, the validator); the schema is generated into `packages/domain/schema/extraction-2.schema.json` by `npm run schema -w @codebridge/domain`, and a test fails when the checked-in file is stale. Python: `pipeline/extraction_format`, the same functions and issue codes, validating with `jsonschema` against the same file (`CODEBRIDGE_EXTRACTION_SCHEMA` overrides the path where `packages/` is not present, such as the page-reader container). Both sides test against `packages/domain/test/extraction-key-vectors.json`; regenerate it (`npx jiti packages/domain/scripts/extraction-key-vectors.ts`) only on a deliberate change; it also holds matcher scenarios, so the two matchers give the same IDs.
- **Versioning:**
  - Adding an optional field keeps `/2`.
  - A breaking change becomes `/3`, together with a converter from `/2`; old runs stay readable through the converter.
  - An unknown fact kind is shown as a plain fact (its text and sources) instead of breaking the view.
- **D1 for this format** (`docs/design/DATABASE.md`, "Extraction runs"):
  - `extraction_runs.producer` (`fixture`, `pipeline`, `nis`), `seeded`, `schema` and `supersedes` (migration 0015); `kind` remains as a computed column until a later migration drops it;
  - `alert_identities` and `alert_events` keyed by alert ID, with the alert instances in the run file (0015); the `/1` alerts and their events stay read-only in `alerts` and `alert_events_v1`;
  - `fact_ids`, every fact ID ever issued for a case (0015);
  - `fact_confirmations` (0015);
  - `fact_edits.fact_id` for `f:<fact id>` keys (0015);
  - `documents.lifecycle` `superseded` and `withdrawn` (migration 0013, a column apart from the processing `state`);
  - `document_parts.part_id`, the stable part ID (0015).

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
