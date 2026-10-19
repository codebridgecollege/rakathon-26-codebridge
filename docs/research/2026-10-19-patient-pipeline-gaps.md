# From new patient to a full case view: gaps and plan

Status: analysis and proposal, 2026-10-19, against `main` at 8fd5bf5
(organizations merged). Nothing here is built yet.

**The goal:** a hospital user creates a patient, uploads documents or
imports them from the hospital system (NIS), and gets a case view as rich
as case 10 today (https://codebridge-mdt.juraj-oravec-josefson.workers.dev/patient/10/overview),
built from their own documents and data.

Terms used below:
- **Extraction:** the JSON the case view is built from, one per run, stored in R2 and pointed to by a D1 `extraction_runs` row.
- **PageKit:** our Python service that renders pages, runs Tesseract OCR, rates readability and parses lab sheets (`pipeline/`).
- **Fixture:** demo data prepared in advance (`fixtures/`, `samples/`).
- **NIS:** the hospital information system. **FHIR:** the HL7 standard it would speak.

## Summary

- **Today every rich case view is prepared by hand.**
  - Case 10's extraction was written by Claude agents and corrected by hand. S01 and S02 were written by us.
  - A new patient's uploads are kept only if they are a registered demo file (matched by hash). Any other file keeps only its name and size.
  - The document pipeline runs locally, but its output never reaches the case view, and its container is not deployed.
  - There is no NIS import beyond pasting a FHIR referral into the form.
  - So a real new patient shows a header, "Nezpracováno" and an empty prognosis tab.
- **The transport layer is done:** creating a case, duplicate checks, desktop and phone uploads, organizations, the source viewer and its quote matching. **The missing parts are what turns documents and data into an extraction:**
  - deploying PageKit;
  - keeping real uploads;
  - an extraction format the pipeline can write;
  - the AI reading and fact extraction;
  - cross-document rules;
  - case merging;
  - the NIS import.
- **Structured NIS data needs no AI.** Labs with their NČLP codes, diagnoses with MKN-10 codes, procedures and requests can fill the labs, diagnosis, timeline and part of the alerts deterministically. So the NIS import is worth building early, in parallel with the AI extraction.
- **Proposed order:**
  1. The extraction format and the first evaluation cases.
  2. Deploy PageKit and publish what it already produces (documents, pages, readability, labs), so a new patient gets a useful view with no AI.
  3. The AI extraction (facts with verbatim quotes), then the case rules and the brief.
  4. The FHIR import with a local test server: after step 3 for one developer, or in parallel with a second person.
- **Rough effort:** about 11 to 14.5 weeks for one developer with agents to reach case-10 quality for new patients, NIS import included (about 9 to 11 weeks with a second person on the NIS import). A useful no-AI slice (milestones 1 and 2) takes about 2.5 to 3.5 weeks.

## What works today

| Area | State |
|---|---|
| New patient: FNO form, FHIR referral paste, duplicate birth number with override, hidden intake case | Works (`app/app/stores/intake.ts`, `api/src/routes/intake.ts`, `write-work.ts`) |
| Uploads from desktop and phone (QR) | Work: transport, limits, audit (`api/src/routes/documents.ts`, `upload-sessions.ts`) |
| Organizations | Every org table carries `org_id`; demo org A (the hackathon demo) and demo org B (empty, for the team's own test data). OIDC login is designed (`docs/design/AUTH.md`), not built. |
| Source viewer | Works for any document with `pages` rows: page image, Tesseract words and boxes, tolerant quote matching in the browser (`SourceViewer.vue`, `packages/domain/src/quote-match.ts`) |
| PageKit (render, OCR, page index with "ověřit" marks, readability, FNO lab parser, image redaction) | Written and tested (39 pytest tests); runs locally; **not deployed** (`PAGEKIT_URL` empty, no container binding) |
| `ProcessDocumentWorkflow` | Writes `pipeline_runs`, page images, `labs.json`, a diff against prepared data; **never the case view** |
| S02 intake | Attaches a prepared extraction when all seven files match by hash and the name and birth number match |
| Everything a doctor reads about a patient | Prepared by hand or by agents in development; no extraction runs live |

## What the case view needs (the contract)

The app builds the view from one current extraction per case
(`GET /api/cases/:id/extraction`, adapter in
`packages/domain/src/case-data.ts`). Three shapes exist today:
- **full** (`{case, extra}`, case 10): every tab;
- **partial** (`{syn}`, S01 and S02): documents, labs as a trend, data gaps;
- **none:** header and "Nezpracováno".

What each part of the view reads, and who can produce it:

| View part | Fields (main ones) | Producible today by |
|---|---|---|
| Header, MDT question | D1 `cases`, `patients`: name, birth number, age, referring department, explicit question or a draft with its basis | Intake form and FHIR referral; the drafted question needs AI |
| Brief prose with `[n]` sources | `extra.onco_summary_v3_cs` + `_refs` | Only by hand or agent |
| Diagnosis headline, oncology lines | `extra.diagnosis_headline`, `onco_compact_v3.lines[]` | By hand or agent; partly from NIS `Condition` with MKN-10 and stage observations |
| Current state (status praesens) | `extra.status_praesens.items[]`, matched by fixed Czech labels ("Vitální funkce", "ECOG PS") | By hand; brittle for new patients |
| Timeline | `extra.timeline_cards_v3[]`, each with a `source` | By hand or agent; partly from NIS `Procedure`, `Encounter`, `ServiceRequest`, `MedicationStatement` |
| Alerts: missing documents, contradictions, chronology, unclear | `case.flags[]`, `extra.data_gaps_v3[]` + D1 `alerts` rows (for acknowledge and resolve) | By hand or agent; partly by deterministic rules |
| Anamnesis | `extra.anamnesis_v3` (OA, RA, PA, FA with drugs, AA, abusus) | By hand or agent; medication partly from NIS |
| Documents tab | `extra.documents[]` or `syn.documents[]`: title, type, date, pages, readability, reason | Readability and pages: PageKit. Title, type, date and splitting of multi-document PDFs: missing |
| Labs | `case.labs[]` (table, full shape) or `syn.labs_series` (trend, partial shape only) | PageKit's lab parser for FNO lab sheets; NIS `Observation` with NČLP codes |
| Next steps, deviations | R2 `guidance/<case>.json`, with indexes into `extra.refs` | By hand or agent; guideline matching is a separate later project |
| Prognosis | Saved result in R2, or the local search (cases 10 and S01 only) | Later |
| Source for every fact | `{file, page, quote}` where `file` is `<documents.id>.pdf`; page JSON and images in R2 | PageKit (pages); quotes from the extraction |

**Problems in the contract itself:**
- **Two incompatible shapes.** A partial case cannot show guidance, and a full case cannot show a lab trend (`fromFullExtraction` hard-codes `series: null`).
- **Brittle content keys.** Field names carry the version of the hand-written fixture (`_v3`), and the status card depends on exact Czech label strings and regular expressions.
- **No-run versus nothing-found.** An empty `flags` list reads as "nothing missing". A pipeline must be able to say "not checked" for a section it did not run.
- **The guidance file indexes into one specific `extra.refs` array,** so it cannot be built separately from the extraction.
- **Two places say how processed a case is.** D1 `processing_level` and the JSON shape must agree; `none` hides an existing run.

## Gaps

State: **done**, **partial** or **missing**. Effort is rough, for one
developer with agents. "Pilot" means needed before real patients.

### A. Getting documents and data in

| Gap | State | Effort | Notes |
|---|---|---|---|
| Keep real uploads | partial | 0.5 day | `UPLOAD_POLICY=fixtures_only` keeps only name and size for unknown files; `store_unprocessed` keeps PDFs only. A new policy keeps content in non-demo orgs (org B for the team now, hospital orgs later). |
| Keep images (phone photos), DOCX, ODT; convert to PDF | missing | 1-2 days | Today the R2 key and content type are hard-coded to PDF, and PageKit has no conversion. Images to PDF with PyMuPDF is small; office files need LibreOffice, which makes the container image several hundred MB larger, so office files may be better converted in a separate container or refused with a request for a PDF. |
| Login before real data | designed | 3-4 days (AUTH.md steps 3-5) | Without login anyone can act as an org B user, and org B's demo reset wipes it. Keeping uploaded content in org B before login is for the team's synthetic test files only, so it needs a gate (a team-only switch) until login exists. |
| Document retention | missing | 0.5 day | "Life of the case plus a period FNO sets" (DATABASE.md); a cron deletion once FNO sets the period. |
| Identity check on any document | missing | 1-2 days | Today it comes only from the fixture registry. Read the name and birth number from the page text and compare with the case; a mismatch is an alert, never a silent merge. |
| Remove or move a processed document | missing | 1-2 days | `DELETE /documents/:id` refuses anything past state `stored`. A file uploaded to the wrong patient (one of the CLAUDE.md failure cases, and a GDPR concern) needs: mark it wrong-patient or superseded, start a new case run without it, keep the history, delete its R2 objects and pages. |
| Org scoping of new outputs | partial | 0.5 day | Uploads and extractions are already under the org. `guidance/<case>.json` and `prognosis/<case>/` are global R2 keys today; once derived from an org's patient, they move under the org. Any model-output cache is keyed by org plus input hash, never shared across orgs. |
| NIS import: connector, patient match, documents, structured data | missing | 1.5-2 weeks | See section D. |

### B. Per-document processing (PageKit)

| Gap | State | Effort | Notes |
|---|---|---|---|
| Deploy PageKit in the EU | missing | 0.5-1 day | `@cloudflare/containers`, a `PageKit` class, `containers` config with `constraints.jurisdiction: "eu"`. CI builds the image (GitHub runners have Docker), so local Docker is not needed. Name instances by case or a small pool, not by document, so a seven-file intake does not hit `max_instances`. |
| Measure the container's Tesseract (5.3.0) against the local one (5.5.3) | missing | 0.5 day | Every acceptance figure so far was measured locally; verify marks and readability thresholds may shift. |
| Run the pytest suite in CI | missing | 0.5 day | Today only the Worker and browser suites run in CI. |
| Process automatically on upload | missing | 0.5 day | Today someone has to press "Přečíst bez AI". |
| Split multi-document PDFs, classify each part (lab sheet, histology, discharge report…), title and date | partial | 1-2 days deterministic (headers, layouts), more with AI | The `document_parts` table and its reader exist; only a pipeline producer is missing. FNO's referral PDFs hold several documents, sometimes out of order. |
| Handwriting and unreadable parts | missing | 1 day | Tesseract cannot read handwriting. Such regions are marked unreadable and never filled in by guessing (CLAUDE.md); the vision reading may read them, but its result is marked "ověřit" (verify). |
| Readability of the text itself | partial | 1 day | Agreement between the text layer and Tesseract does not prove a correct reading; both can carry the same misread ("1112023", "MO"). The check also looks at broken dates, l/1 and O/0 swaps and words that are not Czech or medical (the Czech word-list rule is off today). |
| NIS documents with a reliable text layer (PDF/A) or structure (CDA) | missing | 1-2 days | They skip OCR or are parsed structurally, still checked for readability. |
| Readability per logical document, poor-copy alert as an `alerts` row | partial | 0.5 day | Today per page and per file, and the alert lives only in the pipeline panel. |
| Lab parsing beyond FNO lab sheets | partial | 1-2 days per new layout | Lab values written inside letters need the AI extraction. |
| Redaction of page images through PageKit | partial | 1 day | `redact.py` exists, takes names from fixture files, has no endpoint. |

### C. From documents to an extraction (the AI part)

| Gap | State | Effort | Notes |
|---|---|---|---|
| A versioned extraction format the pipeline writes | missing | 2-3 days | See "Extraction format" below. |
| Evaluation set and script | missing | 2-3 days | S03 (degraded scan), S04 (two patients mixed), expected outputs for the CLAUDE.md failure cases, `pipeline/eval.py`. Built before the extraction, so every prompt change is measured. |
| Text pseudonymization before any cloud model | missing | 2-4 days | Name, birth number, address, phone replaced by placeholders with the mapping kept server-side; a check that refuses a cloud call when an identifier remains. Images: the redaction above. |
| Reading (vision transcription) | missing | 2-3 days | Today's transcriptions came from a sub-agent in development, no prompt or model stored. Needed where the page is a scan or the readings disagree. Prompt in the repo, pinned model, cache by org and input hash. Page images also show doctors' names, signatures and stamps; redaction takes names from the case record and the org's staff, not from fixture files. |
| Audit and budget for model calls | missing | 1-2 days | One access-log row per external model call (which pages, which provider). The hackathon endpoint is shared by about 70 teams, answers 429, and our own `RL_LLM` limit is 20 per minute; a seven-file intake of 30 pages can mean 30 or more reading calls. So calls run inside Workflow steps with 429 backoff, and a budget per page and per case decides what is read by the model and what by Tesseract alone. |
| Fact extraction with verbatim quotes | missing | 1-2 weeks | Diagnosis, stage (clinical versus pathological, with dates), histology, treatment, imaging findings, negations, planned versus done, referrals, medication, history. Every fact carries document, page, verbatim quote, date as written, certainty. |
| Server-side quote anchoring and checks | missing | 3-4 days | Every quote is found in its page text before a fact is kept; negation checked within its clause; numbers in the fact must appear in the quote; partial dates kept as written. The quote is anchored against the same stored word layer the source viewer highlights, and the source stores the character range and word boxes; otherwise a quote taken from a vision transcription may not highlight, or highlight the wrong place. |
| Structured mapping into the view (diagnosis headline, oncology lines, anamnesis, status) | missing | 3-5 days | From facts, in code, not free text. Replaces the brittle label matching of the status card. |
| Timeline from facts | missing | 2-3 days | Ordered by date as written, undated events grouped, each with its source. |
| Case-level merge across documents | missing | 3-4 days | A `ProcessCase` step after every document run: latest output of each current document, de-duplicated facts, one new extraction run, the old one kept (append-only). |
| Cross-document rules | missing | about 1 week | Missing reports (an exam mentioned without its report), a referral without a result, contradictions only between like and like (same kind, same time), superseded values, chronology problems. Each alert lists the facts it rests on and is labelled as the assistant's observation. |
| Stable alert IDs | partial | 2-3 days | Today the ID hashes the Czech alert text, `alerts.id` belongs to one run (`UNIQUE (run_id, origin, position)`), events point at that row, and the UI addresses alerts by position (`f.<i>`, `gap:<i>`). Needs an alert identity (rule ID plus fact IDs) that events attach to, with per-run instances, and UI keys by that identity. |
| Brief with `[n]` sources and the drafted MDT question | missing | 3-5 days | Composed from verified facts only; each sentence validated against its references. |
| Re-extraction without silently changing confirmed content | missing | 2-3 days | Doctor edits today attach to display fields; key them to facts, and when a new run changes a confirmed fact, show both and ask. |
| Reproducibility | partial | 1-2 days | `extraction_runs` has model, prompt version and temperature columns, but `producer` allows only `'prepared-fixture'` and a second column `kind` (`seed_fixture`, `pipeline`) overlaps it; settle on one, add the prompt hash, stages per run, and the model-output cache. |
| Which model, where | open | decision | See "Decisions needed". |

### D. NIS import over FHIR

Structured resources fill large parts of the view without AI, keep the
source codes, and carry their own provenance. Design basis:
`docs/design/INTEGRATION.md`.

| Gap | State | Effort | Notes |
|---|---|---|---|
| Local FHIR test server with synthetic Czech-core bundles | missing | 1 day | HAPI FHIR in Docker (pinned), seeded with S01, S02 and case 10 as Bundles (Patient with `rcis` identifier, Observation with NČLP codes, Condition with MKN-10, DocumentReference + Binary for the PDFs), plus failure cases: a ServiceRequest without a result, a duplicate Patient with `link`, an amended document (`relatesTo: replaces`), a conflicting stage. Never our data on a public server. |
| FHIR connector | missing | 2-3 days | Base URL and auth mode from configuration: SMART on FHIR (user token) or backend services over mutual TLS (needs a Workers mTLS binding); 429 backoff; an access-log row per pull. |
| Patient search and match | missing | 1-2 days | Search by the birth number with the Czech core identifier system (`https://ncez.mzcr.cz/fhir/sid/rcis`), preferably as a POST search so the birth number stays out of URLs and logs; candidates shown to the user, never merged automatically; NIS patient ID stored; the national register lookup as a visible stub. |
| Documents from the NIS | missing | 1-2 days | `DocumentReference` (or MHD) → attachments into R2 → the same path as an upload, with origin `nis`. |
| Structured mapping | missing | 3-5 days | Observation → labs (original unit and range, NČLP code); Condition → diagnosis (MKN-10, clinical and pathological stage kept apart); Procedure, Encounter, MedicationStatement → timeline and anamnesis; ServiceRequest without a result → "requested, no result". Source is the NIS record (resource, version, time), shown in a "record from NIS" source viewer. |
| Refresh | missing | 2 days | `_lastUpdated` per case on open and before an MDT; changes update drafts only, confirmed facts are flagged. |
| Structured data versus documents | missing | 2-3 days | Same analyte, date and unit, or same stage kind and time: a disagreement is a contradiction alert listing both sources. Depends on the fact extraction. |
| FNO answers (auth mode, endpoints, test access) | open | - | `INTEGRATION.md` questions for FNO. |

## Extraction format

The case view should read one versioned format that every producer writes:
the hand-made fixtures (converted once), the document pipeline and the NIS
import. Proposal, `codebridge.extraction/2`:

- **Facts as the base layer.** A flat list of facts, each with:
  - a **stable fact ID** (kind plus the identifying values, for example analyte and draw time), which confirmations, re-extraction and alerts refer to;
  - kind, value as written, **codes** (NČLP, MKN-10, SNOMED CT as the source gives them, or marked as assigned by the assistant), and for labs the original unit and reference range;
  - date as written (partial dates stay partial), certainty, negation;
  - status: documented, planned, requested, done; for disease status the documents' own label (suspicion, confirmed by histology, remission, recurrence);
  - for stages: the kind (clinical or pathological), TNM edition and the time it refers to, so contradictions compare like with like;
  - **origin:** stated in a document, from the NIS, or the assistant's observation (a trend, an interval), which the UI labels as such;
  - the **patient identity** each source shows, so a mixed-up document is caught;
  - one or more sources: a document quote (`{doc, part, page, quote, char range, word boxes}`) or a NIS record (`{system, resource, version}`);
  - unreadable spans, recorded as unreadable, never filled in.
- **Sections computed from facts in code:** diagnosis headline, oncology lines, status, anamnesis, timeline, labs (always as a series, so every case can show a trend), documents. The tabs then follow from what exists, not from which shape the file has.
- **Each check says what it covered:** which documents it ran over, which were unreadable, and its results. A section that was checked and found nothing shows "-" with the fixed wording "neuvedeno v dostupné dokumentaci"; a section not checked keeps today's "nezkontrolováno" signal. "Nothing found" and "not looked at" stay apart.
- **Documents and their parts** stay in D1 (`documents`, `document_parts`); the extraction refers to them by ID instead of holding a third copy.
- **Doctor confirmations and edits** live outside the run (runs are immutable), keyed by fact ID, so a new run can carry them over or show a conflict.
- **Alerts with stable IDs** from rule ID plus fact keys, each listing its facts.
- **Brief prose** with `[n]` markers pointing to facts, not to an array position.
- **Run metadata:** producer (`fixture`, `pipeline`, `nis`), model and prompt versions per stage, input hashes.

The app keeps one adapter from this format; `{case, extra}` and `{syn}`
become one-time conversions of the existing fixtures. The guidance layer
then refers to fact IDs and can be built separately.

## Decisions needed

1. **Where the AI models run. Decided 2026-10-19:** the hackathon's Azure gateway (`gpt-6-luna-dz-eu`, EU) for now, moving to another EU cloud model later.
   - The pipeline calls models through one configured interface, so the move is a configuration change.
   - Its vision and JSON-schema support is unverified, so the first step of the AI work checks them. Its key expires, so the move should be planned, not forced.
   - Real patients still need FNO's clearance for any cloud model (CLAUDE.md, DATA-PROTECTION.md).
2. **Real uploads in the demo.** Proposed:
   - org A (the hackathon demo) keeps "metadata only" for unknown files;
   - org B and hospital orgs keep content;
   - real patient documents wait for OIDC login (AUTH.md steps 3-5) and FNO's clearance.
3. **What happens to case 10 and S01/S02.** Proposed: converted once to the new format and kept as prepared reference cases. The pipeline output for the same documents is compared against them by the evaluation script, which is the regression test.
4. **Auto-process on upload, or on request.** Proposed: on upload, with the view showing "zpracovává se" (processing) until the run finishes.
5. **NIS auth mode** (SMART on FHIR or backend services), pending FNO.

## Plan

| Milestone | Contents | Effort | Result a user sees |
|---|---|---|---|
| 1. Format and first evaluation cases | `codebridge.extraction/2` with the app adapter; case 10, S01 and S02 converted to it; stable fact and alert IDs; expected outputs, in the new format, for the parts milestone 2 touches: dates, document splitting, readability (S03, a degraded scan), labs; `pipeline/eval.py` and pytest in CI | 1-1.5 weeks | Nothing changes for the demo cases |
| 2. No-AI view for new patients | Deploy PageKit (EU, built in CI); keep uploads of the team's synthetic files in org B behind a gate; image conversion; auto-process; deterministic splitting and classification; handwriting marked unreadable; a case merge that publishes documents, pages, readability, poor-copy alerts and lab series as a `pipeline` run; remove or move a processed document | 1.5-2 weeks | A new patient shows its documents with readability, page images and text, lab trends from lab sheets and poor-copy alerts; everything else says "nezkontrolováno" |
| 3. AI extraction | Model interface and audit, pseudonymization and redaction, reading, fact extraction with quotes, server-side anchoring, sections and timeline from facts; S04 (two patients mixed) and the remaining failure cases added to the evaluation | 4-5 weeks | Diagnosis, oncology lines, timeline, anamnesis and status for new patients, every fact with its quote |
| 4. Case rules and composition | Cross-document rules, the brief with `[n]`, the drafted MDT question, re-extraction that keeps confirmed facts | 2.5-3 weeks | Alerts (missing reports, referrals without result, contradictions), the brief and the drafted question: case-10 parity |
| 5. NIS import | Test FHIR server and bundles, connector, patient match, documents and structured mapping, refresh, structured data against documents | 2-3 weeks | "Import z NIS": labs, diagnosis and timeline straight from structured data, documents through the pipeline |
| Later | Guideline layer and deviations for new cases; prognosis profile for any case | - | - |

That is about 11 to 14.5 weeks for one developer with agents. Milestone 5
can run in parallel with milestones 3 and 4 if a second person takes it,
which brings the total to about 9 to 11 weeks. Login (AUTH.md steps 3-5,
3-4 days) comes before any real patient data, whichever milestone that is.

## Stale docs found on the way

- `api/wrangler.jsonc` says `fixtures_only` "refuses it and stores nothing"; the code accepts the file and lists it.
- `docs/design/INTEGRATION.md` says the demo "runs as one static HTML page"; it is the Nuxt app on the Worker.
- `docs/research/backend-steps/step-6.md` places `fhirToForm` in `api/src/domain/fhir.ts`; it is in `packages/domain/src/fhir.ts`.
- `docs/design/TECHNOLOGIES.md` says the recording summary goes through `/api/summarize`; it runs inside the speaker-pass Workflow, and `/api/summarize` and `/api/stt/diarize` are deployed but unused.
