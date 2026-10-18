# Demo fixtures

The demo data the app shows, prepared in advance from the synthetic challenge data (`data/rakathon-26/`) and our own
synthetic patients (`samples/`). A fixture is a JSON file of extracted facts, each with its source quote, that the
seed loads into the Worker's database. All patient data here is FNO's fictitious challenge data or synthetic
patients the team invented ([`samples/README.md`](../samples/README.md)); nothing is real.

## What is here

| Path | What it is | Read by |
|---|---|---|
| `data/mock-case-10.json` | Patient `10_pacient.pdf` structured into sections, timeline, labs, flags and the OCR text of each page; every fact has a source quote. `mdt_question` holds the MDT question with its basis. | `api/seed/seed.py`, `prognosis/service.py`, app tests (report, FHIR export), `scripts/redact_pages.py` |
| `data/mock-case-10-extra.json` | Case 10's anamnesis, MDT brief and detailed summary with numbered references, timeline cards, documents inside the PDF, diagnosis headline, status praesens, and short facts about the other nine patients. `document_history` is invented example data and the UI labels it so. Case 10 has no lab series: its documents hold one undated panel. | seed, `prognosis/service.py`, app tests |
| `data/mock-patient-list.json` | One entry per other FNO patient. A drafted MDT question has `question_draft_cs`, `question_kind` (`document_purpose` or `assistant_inference`) and `question_basis` (`{role, quote, source}` items). | seed, `scripts/redact_pages.py`, pipeline tests |
| `data/mock-case-S01.json`, `data/mock-case-S02.json` | Our synthetic patients: a patient-list entry, the documents, the data gaps and `labs_series` (dated lab values with page and verbatim quote). S02 has `intake_demo: true`: she joins the database only through the "Nový pacient" demo. | seed, `prognosis/service.py` (S01), app tests (S02), pipeline tests |
| `data/guidelines-case-10*.json`, `data/guideline-fact-refs-case-10.json`, `data/literature-case-10.json`, `data/deviations-case-10.json` | The guideline layer for case 10: verbatim guideline statements, the editions valid at past decisions, the facts each statement rests on, PubMed literature, and the curated deviation observations. | seed (through `prepare.py`'s `guidance()`) |
| `data/prognosis-case-10.json` | The saved synthetic prognosis search for case 10 (six result rows, MDT date 2026-10-22). | seed |
| `data/ocr.json` | The raw text layer of all ten FNO patient PDFs. | the builders in `extract/` |
| `extract/` | The scripts that built the fixtures: `build10.py`, `build10extra.py`, `buildlist.py` (FNO patients), `build_case_s01.py`, `build_case_s02.py` (synthetic patients), `guidelines_case_10.py` (guideline quotes, each checked against the PDF), `ocr_confidence.py` (the "!" reading marks), `ocr_pdfs.py` (`ocr.json`). | run by hand |
| `prepare.py` | `page_index()` and `guidance()`, which the seed imports to merge the fixture JSON with `data/derived/page-index.json`; run on its own, it writes the S02 ZIP. | `api/seed/seed.py` |
| `ukazka/S02-dokumenty.zip` | S02's upload documents as one ZIP, linked from the "Nový pacient" dialog. | `api/scripts/stage-assets.sh` (served at `/ukazka/`) |

## How to rebuild

- **FNO patients (case 10 and the patient list).** The JSON was corrected by hand after two reviews (OCR misreads, a
  planned dose shown as done, negation tags), so re-running `build10.py`, `build10extra.py` or `buildlist.py` would
  undo those fixes. Edit the JSON instead.
- **Synthetic patients.** After `scripts/render_samples.py` and `scripts/ocr_pages.py`, run
  `python3 fixtures/extract/build_case_s01.py` (or `build_case_s02.py`). Each fails if a quote is not verbatim in
  the page text. See [`samples/README.md`](../samples/README.md).
- **Guideline quotes.** `fixtures/extract/guidelines_case_10.py` rebuilds `guidelines-case-10.json` from the
  downloaded guideline PDFs and checks every quote.
- **Reading marks.** After changing an `ocr_note_cs`, run `python3 fixtures/extract/ocr_confidence.py --write`.
- **S02 ZIP.** `uv run fixtures/prepare.py` after changing `samples/S02_pacient/upload/`.

After any change, reseed the Worker (see [`api/AGENTS.md`](../api/AGENTS.md)).
