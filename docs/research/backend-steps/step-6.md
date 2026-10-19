# Step 6: uploads to R2 and the document processing pipeline

Status: slices 6a-1, 6a-2 and 6b-1 implemented on 2026-10-17 (issue
#7); the contract as built and every difference from this design are in
"As implemented" at the end. The sections before it are the design as
written before steps 2-5 existed. It assumes Steps 0-5 of
`docs/research/2026-10-17-backend-migration.md`
exist: the Worker `api/` with Hono, D1 tables `documents`, `pages`,
`jobs`, `extraction_runs`, the R2 layout `docs/`, `pages/`, `extract/`,
the write API with server-side audit, and the Workflows infrastructure.

Terms used below:
- **Worker**: the Cloudflare Workers backend (`api/`).
- **R2 / D1**: Cloudflare object storage / SQLite database, both created with EU jurisdiction.
- **Workflow**: a durable multi-step job; each `step.do` is retried on its own and its return value is persisted by Cloudflare.
- **Container**: a Cloudflare Container, a Docker image run behind a Durable Object (DO); only reachable through that DO's binding.
- **Fixture**: a synthetic file we ship (FNO's ten `data/rakathon-26/2_AI asistent MDT/*_pacient.pdf`, `samples/S01_pacient/S01_pacient.pdf`, `samples/S02_pacient/S02_pacient.pdf`, the seven `samples/S02_pacient/upload/*.pdf` and `zadost-fhir.json`).
- **Prepared extraction**: case data written in advance by development agents and checked by scripts (`mocks/src/data/mock-case-*.json`), as opposed to a pipeline run.
- **Text of record**: the page text that quotes must be found in and that the source view highlights.
- **"ověřit" mark**: a span the doctor should verify against the image (engine disagreement, low confidence, vision-only reading).

## Goal

1. A user can upload documents to a case, and they land in R2 with a
   hash, a D1 row, an audit entry, and a visible state. In the shared
   demo only known synthetic fixtures are accepted; anything else is
   refused with a Czech message and never stored.
2. "Nový pacient" works on the server: FHIR referral plus uploads create
   a case; the server recognises the S02 fixture by file hash (not by
   file name, as `intakeOf` in `mocks/src/v3-template.html` does today)
   and attaches its prepared extraction; other documents show as
   "nezpracováno".
3. A document pipeline exists as real code: a Workflow per document that
   calls a Container for the native work (render, Tesseract, page index,
   readability, redaction) and, in later slices, a configured LLM for
   page reading and fact extraction, with every output traceable to
   page and quote and every run recorded in `extraction_runs`.
4. The pipeline's first slice is deterministic (no LLM) and is shown
   honestly next to the prepared extraction, never silently replacing it.

## Scope and out of scope

In scope:
- `POST /api/cases/:id/documents`, `GET /api/cases/:id/documents`,
  `GET /api/documents/:id` (state), `DELETE` of a not-yet-processed
  upload by its uploader (soft delete, logged).
- Intake: `POST /api/cases` with `intake: true`, uploads to the intake
  case, `POST /api/cases/:id/intake/complete`.
- Fixture registry (`api/seed/fixtures.json`) and the prepared-extraction
  attach.
- The Container image and its HTTP API; the shared Python package both
  the scripts and the Container use.
- The `ProcessDocument` and `ProcessCase` Workflows, stage by stage.
- Prompts, schemas, caching, `extraction_runs`, the output shape.
- The evaluation harness against `samples/` and the failure cases.

Out of scope (later steps or never):
- Presigned R2 uploads, resumable uploads, ZIP expansion, DOCX/ODT/XLS
  conversion, photographed reports (JPEG/HEIC). The mock's upload zone
  lists them; the server refuses them with a Czech message for now.
- Per-visitor workspaces (decision 2026-10-17: shared demo).
- A local vision model (DATA-PROTECTION.md option A); the page reader
  interface leaves room for it.
- LLM wording of the summary (stage 11 stays templates, per the review).
- Normalizing facts into D1 tables (case data stays JSON in R2).
- Re-writing the curated case 10 data.

## Design (a): uploads and intake

### Upload policy

One configuration variable decides what the route does with a file that
is not a known fixture:

| `UPLOAD_POLICY` | Unknown file | Used where |
|---|---|---|
| `fixtures_only` | Accepted and listed by name, size, uploader and time; content, hash and identity result never kept (user decision 2026-10-18; the design refused it with 422) | Shared demo behind Access (default in `wrangler.jsonc`) |
| `store_unprocessed` | Stored, listed as "nezpracováno", pipeline not started | Team staging, local `wrangler dev` |
| `process` | Stored and sent to the pipeline | Local dev and evaluation only, once slice 6b-1 exists |

Why refuse rather than store-but-unprocessed in the shared demo: once a
file is stored it is third-party data with no clearance in a database
everyone can read (research doc, "Login and roles"). The research doc's
other sentence ("any other file is listed as nezpracováno") then applies
to fixtures without a prepared extraction (FNO's PDFs, `S01_pacient.pdf`)
and to the non-demo policies. Czech refusal text:

> Ve sdílené ukázce lze nahrát jen připravené syntetické dokumenty (např.
> ze složky samples/S02_pacient/upload). Jiný soubor se neuložil, protože
> by šlo o data bez souhlasu s jejich zpracováním.

### Fixture registry

`api/seed/fixtures.json`, generated by `api/seed/build_fixtures.py`
(run in CI and checked in), one entry per fixture file:

```json
{
  "sha256": "…", "size": 48213, "media_type": "application/pdf",
  "fixture": "S02", "upload_name": "04-laborator-2026-03-10.pdf",
  "patient": { "name": "Věra Lipenská", "rc": "585614/4019" },
  "document": { "title_cs": "…", "type": "laboratorní výsledky", "date": "2026-03-10",
                "combined_pages": [5], "page_count": 1 },
  "prepared": { "case_file": "mock-case-S02.json" },
  "page_assets": "pages/S02_pacient/p5"
}
```

- Matching is by SHA-256 of the bytes only. A renamed copy matches; an
  edited file with the same name does not. The file name is display data.
- The registry knows each fixture's patient, so a fixture uploaded into
  the wrong case gives an immediate identity conflict (failure case "two
  patients mixed up") without any pipeline.
- Hashes are of the committed bytes. `render_samples.py` output is not
  guaranteed byte-identical across machines (PyMuPDF writes timestamps),
  so the demo uses the committed PDFs or the published
  `ukazka/S02-dokumenty.zip`; a CI check asserts the ZIP members hash to
  the registry values.
- `patient` identity lives only in the registry and in `patients`, never
  in the stored extraction (pseudonymization rule in the research doc).

### `POST /api/cases/:id/documents`

One file per request, raw body (not multipart), so the browser loops
over dropped files and each gets its own result.

Request headers: `Content-Type`, `Content-Length` (required),
`X-File-Name` (RFC 5987 encoded). Response `201`:
`{ document: { id, name, size, sha256, type_cs, state, fixture, identity } }`.

Order of checks (each refusal is `{ error: { code, message_cs } }`):

1. Session, role (doctor or coordinator with case membership, same rule
   as the mock's `canUpload`), CSRF origin check, per-user rate limit
   (30 uploads per hour).
2. Case exists, is not closed, has no approved decision (Step 4 rule):
   409 `case_locked`, "Případ je schválený, nahrávání je uzamčeno."
3. `Content-Length` at most `UPLOAD_MAX_BYTES` (20 MB, what the UI
   already promises): 413 `too_large`. Documents per case at most 40.
4. Type: allow `application/pdf` only, verified by the magic bytes
   `%PDF-`, not by the header or extension. ZIP gets its own message
   ("ZIP rozbalte a nahrajte jednotlivé PDF."), others 415
   `type_not_allowed`.
5. Hash:
   - `fixtures_only`: read the body into memory (at most 20 MB, well
     under the 128 MB Worker limit), `crypto.subtle.digest("SHA-256")`,
     look up the registry. Unknown hash: 422 and nothing written. Why
     buffer: the file must not touch storage before we know it is allowed.
   - other policies: stream. `request.body.tee()`, one branch through
     `crypto.DigestStream("SHA-256")`, the other into
     `R2.put("docs/<case>/<doc>.pdf", stream, { httpMetadata })`. A
     size mismatch with `Content-Length` deletes the object.
6. Duplicate in the same case (same `sha256`): 409 `duplicate`,
   "Tento dokument už je u případu nahraný."
7. Write the R2 object (fixture mode: from the buffer), then in one D1
   batch: the `documents` row, the audit entry, and (policy `process`
   only) a `jobs` row; then start `ProcessDocument` after the batch
   commits.
8. Identity: for a fixture, compare the registry patient with the case's
   `patients` row (name in either order, birth number without the
   slash). Result `matches`, `conflicts` or `cannot_verify`. A conflict
   is stored on the document and raised as an always-on alert
   ("Dokument patří jinému pacientovi: jméno nebo rodné číslo se
   neshoduje."); it never blocks and never merges.

`documents` columns this step needs (add in a migration if Step 2 did
not): `id`, `case_id`, `name`, `size`, `sha256`, `media_type`,
`r2_key`, `uploaded_by`, `uploaded_at`, `source` (`upload`, `seed`,
`intake`), `fixture_id` (nullable), `state`, `state_detail_cs`,
`readability` (`good`/`fair`/`poor`/`empty`/null), `readability_reasons`
(JSON, Czech), `identity` (`matches`/`conflicts`/`cannot_verify`/null),
`page_count`, `deleted_at`. `UNIQUE(case_id, sha256)`.

Document `state` and its Czech label:

| state | Label | Meaning |
|---|---|---|
| `stored` | nezpracováno | Stored; no pipeline run and no prepared extraction |
| `prepared` | připraveno předem (ukázková data) | Covered by a fixture's prepared extraction |
| `queued`, `processing` | zpracovává se (fáze: …) | Workflow running; `state_detail_cs` names the stage |
| `processed` | zpracováno | Latest run finished |
| `failed` | zpracování selhalo | Run failed; `state_detail_cs` gives the reason (encrypted PDF, too many pages, service unavailable) |

What is never logged: the body, page text, the file name (it may hold a
patient name). The audit entry records actor, case, document ID, size
and the first 12 hex characters of the hash.

`GET /api/cases/:id/documents` returns the rows above (no R2 keys), and
the case's processing level (`full` when a prepared or processed
extraction covers every document, `partial`, `none`), which the patient
list already shows as "V maketě nezpracováno".

### Intake ("Nový pacient") on the server

Today: the form recognises S02 by birth number and file names
(`intakeOf`, `newUploads`, `newdone` in `v3-template.html`) and pushes a
prepared record into browser state. Server flow, keeping the three-step
dialog the users know:

1. **Step 1, referral.** "Import z FHIR" calls `POST /api/fhir/referral`
   (Step 4) to fill the form. "Pokračovat" calls `POST /api/cases` with
   `{ form, fhir_bundle?, intake: true }`. The server runs the duplicate
   birth-number check (Step 4 rule, override with reason), creates the
   `patients` and `cases` rows with status `intake`, and stores the FHIR
   bundle in R2 (`docs/<case>/referral.fhir.json`) with its hash. A case
   in `intake` is hidden from the patient list and the calendar, and is
   visible only to its creator.
2. **Step 2, documents.** Each file goes through
   `POST /api/cases/:id/documents` exactly as above. The dialog lists
   each file with the server's answer: the fixture's document title, or
   the refusal message. It shows which fixture documents are still
   missing, from `GET /api/cases/:id/intake` (counts and titles only).
3. **Step 3, "Zpracovat" then "Přidat do databáze".** The dialog calls
   `POST /api/cases/:id/intake/complete`. The server:
   - checks that the form identity matches the fixture's patient (the
     same name-and-birth-number rule as `intakeOf`; never join a
     differently named person to the documents);
   - checks that every fixture document of that patient is present by
     hash, and that no other case already holds this fixture's prepared
     extraction (a second copy would share its pages);
   - if all hold: copies the prepared extraction (see below) to
     `extract/<case>/<run>.json`, writes an `extraction_runs` row with
     `producer = "prepared-fixture"`, sets every matching document to
     `prepared`, and moves the case from `intake` to `new`;
   - otherwise: moves the case to `new` with its documents `stored`
     ("nezpracováno") and returns the reason in Czech, the same wording
     the mock shows today;
   - writes the audit entry ("vytvořil(a) pacienta z žádosti FHIR a N
     nahraných dokumentů").
   The progress list in step 3 ("Kontrola čitelnosti", "Pseudonymizace",
   "Extrakce údajů", "Kontrola úplnosti") becomes the real job state when
   the pipeline runs; for a prepared attach it says "připraveno předem"
   instead of animating stages that did not run.
4. Abandoned intake cases (status `intake` older than 24 hours) are
   deleted with their R2 objects by the cron trigger and by "reset demo".

**Prepared extraction, rewritten for per-document storage.** The
prepared S02 data cites the combined PDF (`{file: "S02_pacient.pdf",
page: 5}`), while uploads are one PDF per document with their own page
numbers. At attach time the server rewrites every source reference with
the registry's `combined_pages` map into `{doc_id, page, quote}` and
keeps `file`/`page` as `orig_file`/`orig_page`. The seeded page assets
(`pages/S02_pacient/p5.*` from `data/derived`) are copied to
`pages/<doc>/p1.*`. A seed test asserts every rewritten quote is still
found on the target page's text. This depends on the reference format
Step 2 chose for seeded cases; if Step 2 already uses `doc_id`, only the
page mapping is new.

**Identity stays out of the extraction.** The attach strips
`list_entry.name`, `rc`, `age_or_birth` and `fhir_referral` from the
stored JSON; the API joins identity from `patients` where the screen
needs it.

## Design (b): the document pipeline

### Shape

```
POST /cases/:id/documents ──► ProcessDocument (Workflow, one per document)
                                 │ step: inspect            ──► Container /v1/inspect
                                 │ step: pages 1-5, 6-10 …  ──► Container /v1/pages      (render, Tesseract, text layer)
                                 │ step: readability        ──► Container /v1/readability
                                 │ step: identity           ──► Container /v1/identity
                                 │ step: labs               ──► Container /v1/labs
                                 │ [6b-2] redact            ──► Container /v1/redact
                                 │ [6b-2] vision per page   ──► LLM (Worker, key never leaves it)
                                 │ [6b-2] page index        ──► Container /v1/page-index
                                 │ [6b-3] pseudonymize      ──► Container /v1/pseudonymize
                                 │ [6b-3] extract facts     ──► LLM
                                 │ [6b-3] anchor + coverage ──► Container /v1/anchor, /v1/coverage
                                 └ step: write run          ──► R2 extract/…, D1 extraction_runs
When every document of a case is processed ──► ProcessCase (Workflow)
                                 │ [6b-4] cross-document rules ──► Container /v1/rules
                                 │ [6b-4] summary templates
                                 └ step: write case run
```

Principles:
- **All deterministic text logic lives in one Python package**,
  `pipeline/page_reader/` (render, OCR, page index, readability, identity,
  redaction, labs, pseudonymization, anchoring, coverage, rules). The
  existing scripts become thin CLIs over it, the Container serves it
  over HTTP, and the evaluation runs it locally. One implementation, so
  the CLI output, the demo and the evaluation cannot drift (Mechanism 3).
- **The Worker orchestrates and holds the keys.** LLM calls, R2 and D1
  I/O happen in Workflow steps in TypeScript. The Container has no
  secrets, no storage binding and no outbound network need.
- **Workflow state holds IDs, never patient text.** Cloudflare persists
  every step's return value and the instance parameters, and that store
  has no documented jurisdiction control. Steps write their outputs to
  R2 and return only keys, hashes, counts and stage codes. This also
  keeps returns under the 1 MiB step limit.
- **Every stage is idempotent and keyed by input hash**, so a retried
  step or a re-run of an unchanged document reuses its output.

### Container

`pipeline/container/Dockerfile` (built by `wrangler deploy` from the
`api/wrangler.jsonc` `containers` entry, `image_build_context` = repo
root so it can copy `pipeline/`):

```Dockerfile
# linux/amd64 is the only architecture Cloudflare Containers run.
FROM --platform=linux/amd64 python:3.12-slim-bookworm@sha256:<pinned digest>
# Debian bookworm ships Tesseract 5.3.0 with the Czech model; pin the package versions.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr=5.3.0-2 tesseract-ocr-ces=1:4.1.0-2 hunspell-cs \
    && rm -rf /var/lib/apt/lists/*
COPY pipeline/requirements.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /app/requirements.lock   # pymupdf==1.24.10, pillow==10.4.0
COPY pipeline/page_reader /app/page_reader
COPY pipeline/container/server.py /app/server.py
# One Tesseract thread per request: the instance has half a vCPU and requests run one at a time.
ENV OMP_THREAD_LIMIT=1 PYTHONUNBUFFERED=1
USER 65534
EXPOSE 8080
CMD ["python", "-I", "/app/server.py"]
```

(The exact apt version strings are checked at build time; `hunspell-cs`
gives the Czech word list for the readability check.)

`server.py` is a standard-library `ThreadingHTTPServer` with JSON in and
out (no web framework, fewer pins). It logs only method, path, status,
duration and page counts; never bodies. Endpoints (all `POST` unless
noted, versioned so the Worker and image can be deployed apart):

| Endpoint | Input | Output | Wraps |
|---|---|---|---|
| `GET /healthz` | | `{ok, versions: {page_reader, pymupdf, tesseract, ces_model}}` | new |
| `/v1/inspect` | PDF bytes | `{page_count, encrypted, producer, has_text_layer[]}` | new (PyMuPDF) |
| `/v1/pages?from=&to=` | PDF bytes | per page: 150 dpi PNG (base64), Tesseract TSV and text from a 300 dpi render, text layer | `scripts/ocr_pages.py` `process`/`ocr_page` |
| `/v1/readability` | per page: TSV, Tesseract text, optional vision text | per page `{level, reasons_cs[], metrics}` | new |
| `/v1/identity` | Tesseract text of the document, expected `{name, rc, birth_date}` | `{result, evidence: [{page, start, end, field}]}` (offsets only) | new |
| `/v1/labs` | text of record per page + page metadata | lab draws and points with offsets and certainty | new, generalized from `build_case_s0*.py` |
| `/v1/redact` | PNG, TSV, known names | redacted PNG, boxes with reasons | `scripts/redact_pages.py` `find` |
| `/v1/page-index` | primary text, second reading (TSV words), PNG size | the page JSON: words, `mean_conf`, `low_conf_words`, `verify[]` | `scripts/build_page_index.py` `disagreements` |
| `/v1/pseudonymize` | text, identity values, doctor names | text with placeholders + offset map (no values) | new, extends redaction rules |
| `/v1/anchor` | candidate facts, page texts, page indexes | facts with offsets, boxes, `accepted`/`verify`/`rejected` + rule IDs | new |
| `/v1/coverage` | accepted facts, page texts, lab points | uncovered dates, drugs, TNM tokens, doses, lab codes per page | new |
| `/v1/rules` | all accepted facts and documents of a case | gaps, referrals without result, contradictions, planned versus done | new |

`wrangler.jsonc` additions:

```jsonc
"containers": [{
  "class_name": "PageReader",
  "image": "../pipeline/container/Dockerfile",
  "image_build_context": "..",
  "instance_type": "standard-1",          // 1/2 vCPU, 4 GiB: Tesseract at 300 dpi needs a few hundred MB
  "max_instances": 2,
  "constraints": { "jurisdiction": "eu" } // page images and text are processed in the EU
}],
"durable_objects": { "bindings": [{ "name": "PAGE_READER", "class_name": "PageReader" }] },
"migrations": [{ "tag": "v6", "new_sqlite_classes": ["PageReader"] }]
```

```ts
// api/src/services/page-reader.ts
import { Container } from "@cloudflare/containers";
export class PageReader extends Container {
  defaultPort = 8080;
  sleepAfter = "15m"; // long enough to cover one demo, short enough not to burn credit overnight
}
// From a Workflow step: one named instance per document keeps a document's batches on one warm instance.
const kit = env.PAGE_READER.getByName(`doc-${docId}`);
const res = await kit.fetch("http://page-reader/v1/pages?from=1&to=5", { method: "POST", body: pdfBytes });
```

To verify when building: whether the DO namespace can be restricted with
`env.PAGE_READER.jurisdiction("eu")` together with a Container class; the
current docs document `constraints.jurisdiction` for the container
itself only.

Cold start: the docs say 1-3 s for a warm image, but the first start
after a deploy waits for the image to reach the location (minutes). An
admin route `POST /api/admin/pipeline/warm` calls `/healthz`, and the
demo checklist runs it 10 minutes before presenting.

Pages are sent in batches of 5 per step. Why: one call for a 40-page
document would run for minutes with no partial retry and return tens of
MB; one call per page would resend the whole PDF each time. A batch of
5 returns roughly 2 MB of JSON, which the step writes to R2 at once.

### Stages, what exists and what is new

Numbers refer to the 14 stages in
`docs/research/2026-10-16-summary-pipeline-review.md`
section 5.

| # | Stage | Kind | Existing code | New work | Slice |
|---|---|---|---|---|---|
| 1 | Intake: hash, type, page count; document type and date | Deterministic | none | `inspect`; type and date from header patterns ("Odběr:", "Bioptický", "Ambulantní vyšetření"), else "neurčeno" for the doctor to set | 6a, 6b-1 |
| 2a | Render and Tesseract | Deterministic | `scripts/ocr_pages.py` | move into `page_reader.render`, `page_reader.ocr`; HTTP wrapper | 6b-1 |
| 2b | Vision transcription | LLM | none (transcriptions in `data/derived` were made by a Claude Code sub-agent, no prompt file) | prompt, call, cache, R2 write | 6b-2 |
| 2c | Page index with "ověřit" marks | Deterministic | `scripts/build_page_index.py` | generalize "vision vs Tesseract" to "primary vs second reading" so slice 6b-1 can compare Tesseract with the PDF text layer | 6b-1 / 6b-2 |
| 3 | Readability | Deterministic | metrics only (`mean_conf`, `low_conf_words` in the page index) | the rule set below | 6b-1 |
| 4 | Identity check per document | Deterministic | none (the S02 builder asserts the RC is on every page) | header and pattern search, compare with case | 6b-1 |
| 5 | Pseudonymization of text | Deterministic | redaction rules in `scripts/redact_pages.py` (images only) | text placeholders with offset map | 6b-3 |
| R | Redaction of page images before a cloud vision call | Deterministic | `scripts/redact_pages.py` | names from the case (not from mock files), whole-header blackout option | 6b-2 |
| 6 | Lab parser | Deterministic | the regex and checks inside `build_case_s01.py` / `build_case_s02.py` | a general parser (below) | 6b-1 |
| 7 | Fact extraction | LLM | none | prompt, schema, call, cache | 6b-3 |
| 8 | Anchoring and validation | Deterministic | quote substring check in the builders | the rule set in the review (spans, value tokens, negation by clause, planned versus done, dates) | 6b-3 |
| 9 | Coverage pass | Deterministic | none | token finders and the "Nezpracováno / k ověření" list | 6b-3 |
| 10 | Cross-document rules | Deterministic | none (gaps in the mocks are hand-written) | rules below | 6b-4 |
| 11-12 | Summary from templates, sentence validation | Deterministic | none | templates per MDT type | 6b-4 |
| 13-14 | UI with sources, doctor edits | Code | mock UI; Step 4 edit API | show pipeline runs next to prepared data | each slice |

### Readability check (stage 3), new code

Judged from the text, not from whether a text layer exists (CLAUDE.md).
Per page, from Tesseract (and from the vision text once 6b-2 exists):

- **empty**: fewer than 5 words read.
- **poor** if any: mean word confidence below 75; more than 15 % of
  words below confidence 60; more than 25 % of alphabetic tokens of 4+
  letters neither in the Czech word list (`hunspell-cs`) nor in a
  medical/abbreviation list (`page_reader/data/med_terms.txt`, seeded from
  terms in `data/derived`); more than 10 % of risky tokens (digits,
  stages) marked "ověřit" once there are two readings.
- **fair** if any: 5-15 % low-confidence words; any OCR-damage pattern
  hit: a 6-7 digit run where a date belongs (`1112023`, `212024`),
  `MO`/`NO`/`RO`/`PO` in a TNM or response context, `l`/`I` inside a
  number or dose (`lmg`), `O` inside a number or range (`[O ... 5]`),
  `/1` where a unit ends (`mmol/1`).
- **good** otherwise.

Thresholds are constants with a comment saying where they came from;
they are calibrated once on the 35 pages in `data/derived` (FNO's 20 and
our 15). The hand labels in `mock-case-10-extra.json` (`readability`
per document) are only a rough reference, since they were judged from
the text layer. Every reason is a Czech string naming the page and the
pattern ("s. 4: data ve tvaru 1112023, ověřte v originálu"), never the
surrounding text. The document level is the worst page. A `poor` or
`empty` document raises an immediate alert "Dokument je špatně čitelný,
vyžádejte lepší kopii" with the pages; unreadable parts are marked
unreadable, never filled in.

### Lab parser (stage 6), new code

Generalized from the builders' regex
`^(\S+): (\**)([\d,]+)\** (.+?) \[([\d.]+) \.\.\. ([\d.]+)\]$`, which
only handles our clean synthetic sheets. FNO's printout (patient 10
page 3) adds section headings ("Sérum, plazma - zánět:"), several
results on one line separated by two spaces or commas, sample-quality
indices (`S_IDXLIPK: NEGAT -`), qualitative values, and OCR damage in
units and ranges (`mmol/1`, `[O ... 5]`, `10A9/l`).

- Tokenize per line into `CODE: value unit [low ... high]` records, also
  several per line. Codes match `^[A-Z]{1,4}(\([A-Z]+\))?_[A-Z0-9]+$`
  (NČLP-style: `S_CREAE`, `B_PLT`, `PT(KIDN)_EGFRCKDE`).
- Keep the value, unit and range **as written**; store a parsed number
  (decimal comma) separately. Keep the code as given; the display name
  comes from a lookup table marked as our label, as today.
- `S_IDX*` lines are sample-quality indices: kept as such, never a
  finding and never through the negation rule.
- Draw date and time from `Odběr: d.m.yyyy hh:mm`; without it the draw
  date is "neuvedeno v dostupné dokumentaci" and the document date is
  used only if the document date itself was read, and then marked as
  taken from the document. Never guessed.
- `out_of_range` computed from the printed range; `flagged_in_document`
  from bold where the text of record carries it (vision Markdown), else
  `null` (not determinable from Tesseract text).
- Certainty: `documented` when both readings agree on the value token
  and its confidence is at least 60; `unclear_ocr` ("ověřit") when they
  disagree, when the value needed the confusable map (O/0, l/1), or when
  the page is `poor`. Units differing only by look-alike characters
  (`mmol/1`) are shown as written plus "ověřit" if they contain a digit,
  following `same_unit` in `build_page_index.py`.
- Cross-draw check: a test whose unit or range changes between draws is
  not merged into one trend row; it shows as two rows with a note (the
  builders assert this; the parser reports it instead of failing).
- Output: the existing `labs_series` shape (`draws`, `tests[].points[]`
  with `value`, `out_of_range`, `flagged_in_document`, `date`, `time`,
  `certainty`, `source`), plus `source.doc_id`, `start`, `end`.

Labs never go to an LLM. Free-text lab values in letters ("PLT 97")
are covered by stage 9 and compared with the sheets in stage 10.

### Identity check (stage 4), new code

Searches the Tesseract text of each page for birth-number patterns,
"nar." dates and the case patient's name parts (case- and
diacritic-folded, both orders). Result per document: `matches` (at least
one identifier found and none conflicting), `conflicts` (a different
birth number, or a different full name next to a form label), or
`cannot_verify` (header blacked out or missing, as on every page of
patient 10). Runs before pseudonymization and redaction, on the
hospital side of the line; returns offsets and field kinds only.

### Second reading in slice 6b-1 (before any LLM)

Without the vision model the text of record is Tesseract's text. The
"ověřit" marks need a second reading, and the PDF text layer is one:
untrustworthy on FNO's broken font maps, but independent of Tesseract.
`page-index` gets a `mode` parameter: `vision_vs_tesseract` (today's
logic) or `tesseract_vs_layer`. Where both agree the token is
confirmed; where they disagree the token is "ověřit" and the UI shows
both readings next to the image crop. The text layer is never the text
of record and is never shown alone.

### LLM stages (slices 6b-2 and 6b-3)

**Where prompts live.** `pipeline/prompts/`:
- `transcribe_page.v1.md`: transcribe exactly as printed; keep tables as
  Markdown tables; keep the author's typos; never normalize units or
  numbers; write `[razítko: …]`, `[začerněno]` for blacked-out areas and
  `[?]` for anything not legible; no commentary. Based on the
  instruction described in the OCR evaluation, written down for the
  first time.
- `extract_facts.v1.md` and `extract_facts.v1.schema.json`: one call per
  document (or per section for long ones). Output only what the text
  states: kind, value as written, date as written, status (documented,
  planned, requested, done, unclear), negation, and one or more verbatim
  spans of at most 160 characters. Never output a value that is not in
  a span; omit rather than infer. Placeholders such as `[PACIENT]` stay
  as they are.
- Each prompt has a version in its file name; the Worker imports the
  files as text (Wrangler `rules` with `type: "Text"`) and records the
  SHA-256 of the exact content on every run.

**Model configuration** (plain variables in `wrangler.jsonc`, key as a
secret, mirrored in `.env.example`): `LLM_ENDPOINT`, `LLM_API_VERSION`,
`LLM_VISION_DEPLOYMENT`, `LLM_EXTRACT_DEPLOYMENT`, `LLM_TEMPERATURE=0`,
`LLM_MAX_OUTPUT_TOKENS`, secret `AZURE_OPENAI_KEY`. Default deployment:
the hackathon's EU data-zone deployment (`gpt-6-luna-dz-eu`), if it
accepts images and JSON-schema output; to verify on the portal. If a
model rejects `temperature`, the run records `temperature: null` with
the reason.

**Calls.** `api/src/services/llm.ts`: one client used by every stage,
retry on 429 and 5xx with exponential backoff and jitter (1, 2, 4, 8, 16
s, then fail the step so the Workflow's own retry takes over), honour
`Retry-After`, per-run concurrency of 2 (70 teams share the endpoint).
Structured output with the JSON schema where supported; the response is
validated against the schema in code either way, and an invalid response
is a failed call, not a partial result.

**Cache.** Key = SHA-256 of `(stage, model deployment and version,
prompt SHA-256, temperature, input SHA-256)`, where the input is the
redacted PNG bytes (transcription) or the pseudonymized text
(extraction). Stored at `cache/llm/<key>.json` in the EU bucket. For
the synthetic fixtures the cache is exported to
`api/seed/llm-cache/` and committed, so the demo runs without the
endpoint and survives rate limits. For real data the cache would live
next to the case and be deleted with it (retention open).

**Privacy gates before any cloud call** (enforced in code, not by
convention):
- A page image goes to the vision model only as its redacted version
  (`p<n>.redacted.png`) when `REDACT_BEFORE_CLOUD=true` (default). The
  redaction gets the case's own patient name, birth number and the
  doctors named in the documents from the case, not from mock files.
- Text goes to the extraction model only after `/v1/pseudonymize`.
  Placeholders keep roles apart (`[PACIENT]`, `[RC]`, `[LÉKAŘ_1]`,
  `[OSOBA_1]`). The mapping placeholder to value is stored in D1
  `pseudonym_maps(case_id, placeholder, kind, value)`, readable only by
  the pipeline code path and the identity screens; the offset map (no
  values) is in R2 next to the page.
- Only the pages a stage needs are sent (lab pages are never sent).
- A guard function `assertCloudSafe(payload)` refuses a call whose text
  still matches the birth-number or e-mail patterns or a known name of
  the case; a refused call fails the step with `pseudonymization_leak`.
- Request and response bodies are never logged; AI Gateway logging off.

**Quote verification (stage 8).** `/v1/anchor` applies the review's
rules: each span must occur in the pseudonymized text after whitespace
folding, else the fact is rejected; offsets are mapped back to the
original text of record; every number, date, dose, unit and stage token
in the value must occur in a span (through the documented O/0, l/1,
decimal-comma map; a match needing the map gives "ověřit"); a span
touching an "ověřit" token or a `poor` page gives "ověřit"; negation is
checked by clause against the cue list ("nevyšetřen", "neprovedeno" are
gaps, never negatives); future or conditional wording forces `planned`
or `requested`. Rejected facts are kept with their rule ID and shown in
"Nezpracováno / k ověření", never mixed with accepted ones. The stable
fact key is `(document sha256, span offsets, kind)`.

### Cross-document rules (stage 10, slice 6b-4)

Deterministic, each result labeled "Pozorování asistenta" with the facts
it rests on and fixed Czech wording:
- **Report missing:** an exam named with a date in a letter, or quoted
  as "popis z NIS" / "převzato", with no uploaded document of the same
  type within 3 days: "zpráva nenalezena v podkladech". Missing-document
  alerts are always on.
- **Referral without result:** request cues ("žádanka", "odeslán
  požadavek", "zadávám", "bude", "t.č. výsledek nemáme") with no later
  document of the matching type: a gap, never "neprovedeno".
- **Like-with-like contradictions:** same kind, same stage prefix (c,
  p, yp), same time window, different value. cT3b cN1 (3/2026) against
  ypT2 ypN0 (8/2026) is not a contradiction. Lab values quoted in a
  letter are compared with the sheet of the same draw.
- **Superseded values:** a later value of the same kind marks the
  earlier one `superseded_by`.
- **Identity conflicts** from stage 4 shown on the case, never resolved.
- **Intervals** as facts ("38 dní od biopsie do MDT"), never verdicts.

### Outputs and records

- **Per page in R2** (`pages/<doc>/`): `p<n>.png`, `p<n>.redacted.png`,
  `p<n>.redactions.json`, `p<n>.tess.json` (words, boxes, confidences),
  `p<n>.layer.txt`, `p<n>.vision.md` (6b-2), and `p<n>.json`, the page
  record the viewer loads (Step 2 format: text of record, engine,
  words, `verify[]`, `readability`).
- **Per run** `extract/<case>/<run>.json` in the existing mock-case
  shape: `documents` (with `readability`, `reason_cs`, `identity`,
  `state`), `labs_series`, `data_gaps`, and from 6b-3 on `sections`
  facts with `certainty` (`documented`, `unclear_ocr`, `inferred`),
  `negated`, `status`, `source` (first span, so the current UI keeps
  working) and the additive `sources[]` (all spans), plus `rejected[]`
  and `uncovered[]`. Every object carries `run_id`. No name, birth
  number or address in this file.
- **`extraction_runs` row** per run: `id`, `case_id`, `document_id`
  (null for a case-level run), `producer` (`prepared-fixture`,
  `pipeline`), `pipeline_version` (git SHA and `page_reader` version),
  `container_versions` (from `/healthz`), `stages` (JSON list of stage,
  model deployment, prompt path and SHA-256, temperature, input hashes,
  cache hit, duration, token counts), `output_key`, `status`,
  `error_code`, counts (`facts_accepted`, `facts_verify`,
  `facts_rejected`, `uncovered`, `lab_points`), `started_at`,
  `finished_at`. No patient text.
- **What the case shows.** A prepared extraction stays the case's view
  for fixture cases; a pipeline run on the same documents is shown next
  to it ("Zpracováno pipeline, běh 3: 72 z 72 laboratorních hodnot shodných,
  2 k ověření") with a diff view, never merged into it. For a case with
  no prepared data the latest pipeline run is the view, labeled as the
  assistant's processing. A new run never changes a fact a doctor
  confirmed or edited: Step 4's edits attach to fact keys; a changed
  confirmed fact shows both values and asks.

### Evaluation against `samples/`

`pipeline/eval.py` runs the deterministic stages locally (same package)
and, for LLM stages, drives a local Worker (`wrangler dev`) through the
admin route `POST /api/admin/pipeline/run` and reads its output. Per
case it compares against `samples/<S..>/expected.json` and writes a
report to `samples/reports/<date>-<git sha>.md` (committed for the
synthetic cases).

`expected.json` holds: lab points (code, value as written, unit, range,
draw date, out-of-range), critical facts per MDT type, expected gaps
(missing reports, referrals without result), recorded negatives,
"must not flag" items (the planted non-contradictions), identity
result per document, and readability per page.

| Failure case (CLAUDE.md) | Sample that checks it | Exists? |
|---|---|---|
| Critical fact left out | S01, S02 critical-fact lists; coverage pass | needs `expected.json` |
| Wrong or outdated date | S01/S02 draw dates; superseded stage (cT3b vs ypT2) | needs `expected.json` |
| Negated finding read as positive | S01/S02 "neguje" items, "Lymfovaskulární invaze neprokázána" | needs `expected.json` |
| Two patients mixed up | **new S04**: S02's case plus one S01 lab sheet uploaded into it; expected `conflicts` | new |
| Exam done, report missing | S01 MRI 29.9.2026, S02 MRI 16.3.2026 ("popis z NIS") | yes |
| Referral with no result | S01 PET/CT, S02 CT 7.10.2026 | yes |
| Poor scan changes a value or negation | **new S03**: S02 pages degraded by `scripts/degrade_scan.py` (rasterize at 100 dpi, blur, noise, slight rotation, JPEG) so "M0" reads "MO", a date loses its dots; expected readability `poor`/`fair` and "ověřit" on those tokens, no silent value | new |
| (FNO data) | patient 10 with the curated reference, reported but not scored until a clinician reviews it (review decision 14) | partial |

Metrics per case: lab points exact (value, unit, range, date), missing
critical facts, wrong dates, wrong negation, wrong status, missed gaps,
false alarms (any flag on a "must not flag" item is a failure),
uncovered items, identity results, readability levels. A pipeline
change that affects the doctor's view is merged only with a report that
shows no regression.

## Slices

| Slice | Contents | LLM | Demo value |
|---|---|---|---|
| **6a-1 Uploads** | Upload route with policy, fixture registry, D1 columns, document list with states, audit, identity from registry, frontend upload overlay and patient documents tab wired to the API | no | Real storage; refusal of non-fixtures; "nezpracováno" labels; wrong-patient alert |
| **6a-2 Intake** | `intake` status, `/intake`, `/intake/complete`, prepared-extraction attach with reference rewrite, cron cleanup, reset-demo coverage, "Nový pacient" dialog on the API | no | S02 created through the real server by hash |
| **6b-1 MVP pipeline** | `pipeline/page_reader` refactor of the three scripts; Container image and API; `ProcessDocument` with inspect, pages, readability, identity, page index (`tesseract_vs_layer`), lab parser; `extraction_runs`; run diff view for labs; S03 sample; eval for labs, readability, identity | no | "Zpracovat znovu" on S01/S02 lab sheets reproduces the prepared lab trend from the PDF alone, with "ověřit" marks; poor scan warning |
| **6b-2 Vision reading** | redaction from case identity, `transcribe_page.v1.md`, LLM client with backoff and cache, page index `vision_vs_tesseract`, seeded cache | yes | Vision text with marks on any uploaded page |
| **6b-3 Facts** | pseudonymization with D1 map and leak guard, `extract_facts.v1`, anchoring, coverage, rejected/uncovered list, fact keys | yes | Facts with sources from a pipeline run, beside the prepared ones |
| **6b-4 Case rules** | `ProcessCase`, cross-document rules, summary templates and sentence check | no | Missing documents and referrals computed, not hand-written |

**MVP for the hackathon: 6a-1, 6a-2, then 6b-1.** These need no LLM and
no new prompt, cover four of the seven failure cases with code we can
check, and keep the demo path working if the shared endpoint is slow.
6b-2 onward start only after a time box is agreed.

## Tests

Worker (Vitest with the Workers pool; container calls stubbed by a fake
DO):
- Upload: PDF accepted; non-PDF body with `.pdf` name refused (magic
  bytes); 20 MB + 1 byte refused before reading; ZIP gets its own
  message; unknown hash in `fixtures_only` returns 422 **and** leaves R2
  and D1 unchanged; `store_unprocessed` stores with the right hash;
  duplicate refused; approved case refused; wrong role refused; audit
  row written with hash prefix and no file name; nothing from the body
  in logs (log spy).
- Identity from registry: S02 sheet into S01 case gives `conflicts` and
  an alert; into S02 case gives `matches`.
- Intake: complete with all seven S02 PDFs and matching name attaches
  the prepared run; name in other order matches; different name refuses
  attach; six of seven leaves `stored`; second intake of S02 refuses
  attach; abandoned intake removed by the cron handler; the stored
  extraction JSON contains no name or birth number (string search).
- Reference rewrite: every quote in the attached S02 extraction is found
  on its new `(doc_id, page)` text.
- Workflow: step returns contain only IDs and counts (assert on every
  step's return type and a JSON size bound); a failing container batch
  retries only that batch; document state moves through `queued`,
  `processing`, `processed`/`failed`.
- LLM client (6b-2+): 429 then 200 succeeds with backoff; `Retry-After`
  honoured; cache hit skips the call; schema-invalid output fails the
  step; `assertCloudSafe` blocks text with a birth number.

Python (`pytest` in `pipeline/`, run locally and in the image build):
- Refactor safety: `page_reader` reproduces the committed `data/derived`
  outputs: page index `verify[]` for all 35 pages identical (same
  Tesseract version) or within a documented tolerance (container
  Tesseract 5.3 versus Homebrew); redaction boxes per page equal to the
  committed `p<n>.redactions.json`.
- Lab parser: on S01 and S02 vision text, output equals
  `labs_series` in `mock-case-S01.json` / `mock-case-S02.json` (codes,
  values, units, ranges, dates, out-of-range, bold); on Tesseract text,
  same values with "ověřit" exactly where the unit or value was misread
  (`10"9/|`); on patient 10 page 3, `S_IDX*` parsed as indices, `[O ...
  5]` marked, no draw date invented.
- Readability: S01/S02 pages `good` or `fair` (never `poor`); S03
  degraded pages `poor` or `fair` with the expected reasons; patient 10
  page 4 at least `fair`.
- Identity: S02 pages `matches`; patient 10 pages `cannot_verify`; S04
  mixed sheet `conflicts`.
- Anchoring (6b-3): quote not in text rejected; "MO" for "M0" gives
  "ověřit"; "Bez plicní embolie, jen drobná cysta" gives two facts;
  "Při dobré toleranci navýšíme" gives `planned`; "nevyšetřen" gives a
  gap.

Container contract: `docker run` the image locally, call each endpoint
with an S02 page, compare with the Python results (same code, checks
packaging and pinned binaries).

Evaluation: `pipeline/eval.py` over S01-S04 and patient 10, report
committed.

## Acceptance criteria

Slice 6a-1:
- [ ] Uploading `samples/S02_pacient/upload/04-laborator-2026-03-10.pdf` to a case returns 201, the file is in the EU bucket at `docs/<case>/<doc>.pdf`, and the D1 row has the matching SHA-256.
- [ ] Uploading any other file in the shared demo shows the Czech refusal, and neither R2 nor D1 has a trace of it (checked by listing).
- [ ] Non-PDF, oversized and duplicate uploads and uploads to an approved case are refused with their Czech messages.
- [ ] The documents tab shows each document's state label; fixtures without a prepared extraction show "nezpracováno".
- [ ] A fixture of another patient raises the identity alert; it does not block anything.
- [ ] Audit log has one entry per upload, without file names or content.

Slice 6a-2:
- [ ] The presenter imports `zadost-fhir.json`, uploads the seven S02 PDFs (renamed copies too), and gets case S02 with the same documents, labs and gaps the mock shows today, served from the API.
- [ ] A mismatched name, a missing document or a second intake gives the case with "nezpracováno" documents and the mock's Czech explanation.
- [ ] The stored extraction has no patient name or birth number.
- [ ] An intake case is invisible in the patient list until completed; abandoned ones disappear after 24 hours and on reset.

Slice 6b-1:
- [ ] `scripts/ocr_pages.py`, `build_page_index.py`, `redact_pages.py` run as before from the `page_reader` package and reproduce `data/derived` within the stated tolerance.
- [ ] The Container deploys with `constraints.jurisdiction: "eu"`, `/healthz` reports pinned versions, and the warm route brings it up.
- [ ] Re-processing S02's four lab sheets yields 18 tests x 4 draws with the same values, units, ranges and dates as the prepared data; every difference is an "ověřit" mark, not a silent change.
- [ ] Each processed page has a readability level and Czech reasons; S03 triggers the "vyžádejte lepší kopii" alert.
- [ ] Every run has an `extraction_runs` row with versions and input hashes; Workflow step returns contain no page text.
- [ ] The UI shows the pipeline run beside the prepared data, labeled, with the lab diff.
- [ ] Eval report for S01-S04 committed; no false contradiction on S01/S02.

Slices 6b-2 to 6b-4 (each):
- [ ] Prompts and schemas in `pipeline/prompts/`, model and temperature from configuration, recorded per run.
- [ ] No cloud call without redaction (images) or pseudonymization (text); the leak guard test passes.
- [ ] Every accepted fact's spans are found in the text of record; rejected and uncovered items are listed separately.
- [ ] The demo runs from the committed cache with the endpoint switched off.
- [ ] Eval report shows each of the seven failure cases and no regression against the previous report.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Container cold start after deploy takes minutes | Demo stalls on first "Zpracovat" | Warm route in the demo checklist; prepared data stays the default view, so the demo never depends on the pipeline |
| Container Tesseract 5.3 (Debian) differs from the Homebrew build used for `data/derived` | Refactor tests fail on details; different "ověřit" marks | Regenerate `data/derived` once from the container and commit; tolerance documented |
| Workflow state and DO placement have no documented jurisdiction control | Patient text could be persisted outside the EU | Steps return IDs only; tested; container `constraints.jurisdiction`; real data runs at FNO anyway |
| PyMuPDF output not byte-stable across machines | Fixture hashes miss for regenerated PDFs | Registry hashes committed bytes; CI checks the ZIP |
| Lab parser overfits to our synthetic sheets | FNO printouts mis-parsed | Patient 10 page 3 in the tests; unparsed lab-like lines go to "uncovered", never dropped silently |
| Readability thresholds from 35 pages | Wrong "poor" labels on new scans | Reasons always shown; thresholds as named constants; recalibrate with S03 |
| Hackathon EU deployment lacks vision or JSON-schema output, or is rate-limited during the demo | 6b-2/6b-3 blocked or slow | Committed cache; check deployment capabilities before writing prompts; slices 6a and 6b-1 need no LLM |
| Redaction misses identifiers (known gaps: free-text names, "nar." date rules) | Identifiers reach the cloud model | Synthetic data only; `assertCloudSafe` guard; header blackout option; option B stays a demonstration, as DATA-PROTECTION.md says |
| Pseudonym map in D1 next to case data | Weaker separation than "mapping stays at the hospital" | Separate table, separate code path, stated in DATA-PROTECTION.md as a demo trade-off |
| Presenter or jury confuses a pipeline run with prepared data | Trust issue | Both always labeled; diff view; prepared stays the default |
| Scope creep into 6b-3 during the hackathon | Demo not ready | MVP stops at 6b-1; anything after needs an agreed time box (CLAUDE.md) |

## Effort

One developer with agents, rough:

| Slice | Effort |
|---|---|
| 6a-1 Uploads | 1 day |
| 6a-2 Intake on the server | 0.5-1 day |
| 6b-1 `page_reader` refactor, Container, MVP Workflow, lab parser, readability, identity, S03/S04, eval | 3-5 days |
| 6b-2 Redaction from case data, vision transcription, LLM client, cache | 2-3 days |
| 6b-3 Pseudonymization, extraction prompt, anchoring, coverage, UI lists | 1-2 weeks |
| 6b-4 Cross-document rules, summary templates | 1 week |

Docs to update in the same changes (Mechanism 3): `samples/README.md`
(S03, S04, `expected.json`, eval), `docs/design/DATA-PROTECTION.md`
(redaction and pseudonymization in the pipeline, pseudonym map, Workflow
state rule), `docs/design/TECHNOLOGIES.md` and `docs/agent/HACKATHON.md`
(Containers, Workflows, pinned images and models), `.env.example` and
`wrangler.jsonc` variables, `README.md` (how to run the container and
the eval), `mocks/README.md` (prepared versus pipeline data).

## As implemented

Built on 2026-10-17 in three commits on `backend` (issue #7): uploads
(6a-1), intake on the server (6a-2), and the pipeline without an LLM
(6b-1). Slices 6b-2 to 6b-4 (vision transcription, fact extraction, case
rules) are not built.

### Uploads (6a-1)

- `POST /api/cases/:id/documents` (`api/src/routes/documents.ts`), raw
  body, one file per request; headers `Content-Length` (required),
  `X-File-Name` (`encodeURIComponent`), `X-Data-Epoch`. The write guard
  skips the JSON parse for this path only; the same-origin check, the epoch
  check and the refusal log still apply. Order: role and membership
  (`document.upload`: doctor on the team or coordinator), case not closed
  and no approved conclusion (`case_locked`), at most 40 documents, rate
  limit `RL_UPLOAD` (200 a minute per IP in demo mode, since a venue shares one IP; Cloudflare's limiter has 10 s and 60 s
  periods only, so not "30 an hour"), then the body: not read when the
  declared size is 0 or over `UPLOAD_MAX_BYTES`, else read with the limit
  (declared and actual size equal), magic bytes (`%PDF-` within the first
  1024 bytes), SHA-256 of a PDF, registry lookup. Every file is accepted
  (user decision 2026-10-18, revising the design's refusals above): with
  `UPLOAD_POLICY=fixtures_only` (default) only a registered fixture's
  bytes are stored; any other file (unknown PDF, another format, ZIP,
  empty or oversized) is only listed, with name, size, declared media
  type, uploader and time, and no content, hash, fixture or identity
  result. `store_unprocessed` also stores unknown PDFs and, since issue
  #18, JPEG and PNG photos; `UPLOAD_STORE_ORGS` applies it per org (below,
  "Keeping uploads per org"). A repeat (the same
  bytes, or the same name) answers 200 with the document already listed
  (the step 2 table keeps `UNIQUE(case_id, file_name)`; a new unique index
  adds `(case_id, sha256)`); 409 `duplicate` is left only for two uploads
  racing.
- Stored at `uploads/<case>/<doc>.pdf` (not `docs/`), so reset-demo's
  existing `uploads/` prefix delete and the intake discard clear it. Then
  one guarded batch: the `documents` row (`origin = 'upload'`, `state =
  'stored'`, fixture, identity, title, type and date from the registry),
  the access-log line "nahrál(a) dokument k případu (PDF, 48 kB, otisk
  <12 hex>)" (a listed file: "nahrál(a) soubor k případu (uložen jen název
  a velikost, 48 kB)"), and for a wrong patient a second line naming no
  one. A failed batch deletes the object. The answer carries
  `content_stored`; the pipeline refuses a listed file (`no_file`).
  Since issue #10 the answer also carries `source` (`"phone"` for a file
  sent through an upload session, otherwise null), and the same path
  (`receiveUpload`) serves uploads from a phone
  (`docs/design/PHONE-UPLOAD.md`).
- Registry: `fixture_files` (step 2) gained `kind` (`upload`, `combined`,
  `referral`), size, title, type, date, page count and the pages of the
  combined PDF; a new table `fixture_patients` holds each fixture's
  patient (name, birth number) in D1 only, as `patients` does. The seed
  registers FNO's ten PDFs and S01 (their seeded patients), S02's combined
  PDF, its seven uploads and its referral, 20 rows, and writes
  `api/seed/out/fixtures.json`. There is no separate `build_fixtures.py`
  and no CI check of the ZIP yet.
- Identity: `compareIdentity` (`api/src/domain/documents.ts`): names
  without case and order, diacritics kept; birth number digits only.
  `conflicts` when a known birth number or a known name differs,
  `matches` when one is known and none differs, else `cannot_verify`. A
  conflict is stored on the document and shown as "Dokument patří jinému
  pacientovi: jméno nebo rodné číslo se neshoduje."; it never blocks. The
  answer carries only the result, never the fixture's patient.
- `GET /api/cases/:id/documents` moved here; it keeps the old fields
  (`file`, `page_count`, `processing`, `note`, `parts`) and adds name,
  size, hash, state with its Czech label, identity, readability and
  uploader, plus `processing_level`. No R2 keys.
- `DELETE /api/documents/:id` removes an upload in state `stored` (not
  prepared, processed, or seeded) on an unlocked case: a hard delete of
  the rows and the file, with the access-log line "odebral(a) nahraný
  dokument". The design said soft delete; a removed upload is data nobody
  needs, so it goes.
- Reset: reset-demo's batch was at 48 of 50 statements. Instead of more
  DELETE statements, a trigger on `demo_state` (`demo_reset_uploads`,
  migrations 0005 to 0007) fires on the batch's own `reset_in_progress =
  1` update and removes pipeline runs, intake runs with their alerts and
  alert events, and every non-seed document with its pages and parts. The
  local reset now reports 45 statements. `seed.py` counts triggers without
  it.
- Page ("Projednání", tab "Dokumenty") in API mode: it looks as before the
  server (any file, every row "Nahráno", no refusal or error text). Each
  file is listed at once and goes to the server; the row takes the
  server's answer, and the identity alert shows on the row and on the
  case. A file the server did not take (unreachable, rate limit) stays
  listed in the browser only. The pipeline's states and "Přečíst bez AI"
  show only when `/api/me` reports `features.pipeline` for the acting org
  (issue #18; before, `/api/health`). Embedded mode
  keeps the browser-only list.

### Intake on the server (6a-2)

- `POST /api/fhir/referral` (`api/src/routes/intake.ts`): the bundle is
  read by `fhirToForm` ported to `api/src/domain/fhir.ts`; the answer
  gives the form keys and the page's field names, what was found and
  missing, and the bundle's SHA-256. The bundle is not stored (it holds
  identity); the case keeps its hash (`cases.referral_sha256`).
- `POST /api/cases` with `intake: true` creates the patient and the case
  with `cases.intake_open = 1` (a column: `status` keeps its CHECK). An
  open intake is left out of `/patients`, `/workflow` and every write but
  uploads (`intake_open` 409), and is 404 to anyone but its creator. When
  the referral names a fixture patient (same birth number and name, both
  orders) and `NO-<fixture>` is free, the case gets that ID (`NO-S02`,
  `S02_pacient.pdf`), as the embedded demo shows it; otherwise the next
  number. The ID is cosmetic: the attach decides again. The old
  `intake_fixture` body field is gone.
- `GET /api/cases/:id/intake` gives the verdict (ready, reason in Czech,
  expected, present, missing titles) and the documents;
  `POST /api/cases/:id/intake/complete` closes the intake. The prepared
  data is attached only when all of one fixture's files are present by
  hash, no file of another fixture is, the referral's name and birth
  number both match the fixture's patient, and no other case holds that
  fixture's prepared data (`cases.intake_fixture`, unique among completed
  cases). Listed files (content not kept) are extras, as on the page
  before the server, and stay "nezpracováno". The attach also copies the
  fixture's birth date (`fixture_patients.birth_as_written`, migration
  0008) to the patient, so the age shows as before. The reasons never name the fixture's patient (the
  mock's message did). Otherwise the case is listed with its documents
  "nezpracováno" and the reason.
- Prepared data: the seed writes `fixtures/S02/prepared.json`, the
  stripped S02 extraction with every reference rewritten from
  `{file: "S02_pacient.pdf", page: 5}` to `{file: "@upload:<upload name>",
  page: 1, orig_file, orig_page}`, document entries with their own file
  and local pages, the case-row fields, the gap alerts, and each upload's
  page assets under `fixtures/S02/pages/<upload>/p<n>.*`. The seed checks
  every rewritten quote on its page and scans the file strictly (quotes
  too) for the patient's name, birth number and birth date. The attach
  swaps `@upload:<name>` for the uploaded document's ID, writes the run to
  `uploads/<case>/extract/<run>.json`, an `extraction_runs` row with
  `kind = 'seed_fixture'` and the new column `producer =
  'prepared-fixture'` (the step 2 CHECK on `kind` stays), the alerts, the
  copied pages under `uploads/<case>/<doc>/pages/`, one document part per
  upload, documents `prepared`, and the case row (diagnosis, summary,
  page count, the documents' question when the referral had none).
- Removal of an open intake: `DELETE /api/cases/:id/intake` (the dialog's
  "Zavřít", Escape, and "Zpět" from the documents step), the cron sweep
  after 24 hours (`api/src/store/intake.ts`), and reset-demo. Nothing else
  can reference an open intake, so the case, patient, documents and files
  go entirely.
- Page in API mode: it looks as before the server. "Import z FHIR" asks
  the server; "Pokračovat" opens the intake; every file is listed at once
  as "Nahráno" and goes to the intake one by one (a file the server did
  not take stays in the dialog only); the hints come from the page's own
  check of names and birth number, as before; "Zpracovat" waits for the
  uploads, runs the pre-server animation and closes with its sentence,
  chosen by the server's verdict; "Přidat do databáze" completes it.
  Embedded mode keeps the browser-only flow. The source view and the documents tab open each
  uploaded file (`setReady` maps every document file to its case).
- `api/scripts/e2e-intake.mjs <base URL> [--pipeline] [--reset]` runs the
  whole S02 intake against a Worker with the committed files.

### Pipeline without an LLM (6b-1)

- `pipeline/page_reader/` (render, ocr, layer, page_index, readability, labs,
  redact) is the one implementation; `scripts/ocr_pages.py`,
  `build_page_index.py` and `redact_pages.py` are thin CLIs over it and
  reproduce `data/derived` byte for byte (tested).
  `pipeline/container/server.py` serves it (contract v1 in its
  docstring): `GET /healthz`, `POST /v1/inspect`, `/v1/pages`,
  `/v1/analyze` (page records with "ověřit" items from Tesseract against
  the PDF text layer, readability per page and document), `/v1/labs`, and
  since issue #18 `/v1/convert` (a photo into a one-page PDF).
  No `/v1/identity`, `/v1/redact` or `/v1/page-index` endpoints: the
  identity check stays the registry's (uploads are fixtures), redaction is
  for the LLM slices, and the page index is part of `/v1/analyze`.
- Differences from this design in the deterministic logic (`page_reader`): the
  "ověřit" share that makes a page poor is 25 %, not 10 % (clean pages
  reach 11 %, FNO's broken text layers up to 29 %; with the text layer as
  second reading a high share gives fair only); the Czech word-list rule
  is off (no `hunspell-cs` locally or in the image, and on in one place
  only would make them disagree); a unit differing only by look-alike
  letters without a digit (`umol/l`) stays documented with both readings
  kept; a draw date counts only when both readings carry the same
  "Odběr" header over the record; no fallback to the document date.
  Readability on the 35 pages of `data/derived`: 13 good, 21 fair, 1
  empty, none poor. There is no S03 degraded sample yet, so "poor" is
  tested on synthetic low confidences only.
- `ProcessDocumentWorkflow` (`api/src/workflows/process-document.ts`,
  binding `PROCESS_DOCUMENT`): inspect, pages in batches of 5, analyze,
  labs, compare with the prepared data, write. Outputs go to R2 under
  `uploads/<case>/<doc>/<run>/` (page PNG, raw readings, page records,
  `readability.json`, `labs.json`, `diff.json`); step results hold ids,
  counts and fixed codes only (tested). Runs are rows of a new table
  `pipeline_runs` (versions from `/healthz`, stage timings, readability,
  "ověřit" count, lab counts, the comparison counts), not
  `extraction_runs`: a run never becomes the case's current view, and
  `extraction_runs` has one current row per case with the alerts on it.
  A document with prepared data keeps it; an upload without data gets
  the run's pages (Tesseract's text with its marks) for the source view
  and state `processed` or `failed` with a Czech reason. Seeded documents
  never change state.
- Routes (`api/src/routes/pipeline.ts`): `POST /api/documents/:id/process`
  (role `document.process`, one active run per document),
  `GET /api/documents/:id/pipeline` (clinical read, logged; the run is
  labelled "Zpracováno pipeline bez AI (Tesseract a textová vrstva PDF);
  pozorování asistenta, ne dokumentace"; a poor or empty document carries
  "Dokument je špatně čitelný, vyžádejte lepší kopii."),
  `POST /api/admin/pipeline/warm`. `/api/health` reports
  `features.pipeline` (a page reader is reachable) and `/api/me` whether the
  acting org may use it (`PIPELINE_ORGS`). The documents tab offers "Přečíst bez AI" on each
  uploaded document in API mode and shows the run's summary next to the
  prepared data.
- How the Worker reaches the page reader (`api/src/services/page-reader.ts`):
  `PAGE_READER_URL` (local work: the Python service on port 8080; tests: a
  mocked host), else the `PAGE_READER` container binding when
  `PAGE_READER_CONTAINER` is "on", else the pipeline is off (503
  `pipeline_off`); it is also off for an org not in `PIPELINE_ORGS`. See the
  container below.
- Acceptance, measured locally with `wrangler dev`, the Python service
  and Homebrew Tesseract 5.5.3 (`node api/scripts/e2e-intake.mjs
  http://localhost:8799 --pipeline --reset`): re-processing S02's four lab
  sheets gives 18 tests x 4 draws, 72 points; 41 read exactly as the
  prepared data and 31 marked "ověřit" (units such as `10"9/|`, codes
  without the underscore, values where the readings disagree); 0 silent
  differences, 0 missing. Each sheet is "fair" (Tesseract misreads such as
  `mmol/1`). With the vision text as text of record (pytest) all 72 are
  documented.
- Deploy (2026-10-17): migrations 0005 to 0007 applied to the remote D1;
  the fixture registry (20 files, 12 fixture patients) and the 33
  `fixtures/` objects (uploads, S02's prepared data and page assets) were
  written to the remote D1 and the EU bucket without a reseed, so the
  shared demo's state and access log stayed; `npm run deploy` registered
  the Worker, the cron and both Workflows. `api/scripts/e2e-intake.mjs`
  against https://codebridge-mdt.juraj-oravec-josefson.workers.dev passed
  (unknown PDF refused, seven renamed PDFs, prepared data attached, no
  identity in the stored extraction, the quote found on the uploaded
  file's page, the wrong-patient result on NO-S01) and then ran
  reset-demo (45 statements, nothing left in `uploads/`).
- The page reader container (issue #18): `api/src/services/page-reader-container.ts`
  (`PageReader extends Container` from `@cloudflare/containers` 0.3.7,
  `defaultPort = 8080`, `sleepAfter = "15m"`, `enableInternet = false`) lives in
  its own Worker, `codebridge-page-reader` (`api/page-reader.wrangler.jsonc`,
  `src/page-reader-worker.ts`), with the `containers` entry (`class_name:
  "PageReader"`, `image: "../pipeline/container/Dockerfile"`,
  `image_build_context: ".."`, `instance_type: "standard-1"`, `max_instances: 3`,
  `constraints: { jurisdiction: "eu" }`) and the migration `v1-page-reader`
  (`new_sqlite_classes: ["PageReader"]`). The API Worker only binds it
  (`durable_objects.bindings` with `script_name: "codebridge-page-reader"`):
  a Worker that defines a Durable Object class gets no preview URLs, and
  `wrangler versions upload` (the `backend` alias) refuses a pending class
  migration. The tests give workerd an empty stand-in Worker of that name
  (`vitest.config.ts`); `wrangler dev` shows the binding "not connected".
  - **Image built in CI.** The `deploy` job of
    `.github/workflows/deploy-worker.yml` on `main` runs `wrangler deploy -c
    page-reader.wrangler.jsonc`, which builds the image with the runner's
    Docker and pushes it to Cloudflare's registry; nobody builds it locally.
    It runs before the D1 migration, after a check that
    `CLOUDFLARE_API_TOKEN` can run `wrangler containers list` (the account
    permission "Containers: Edit"), so a missing permission or an image that
    does not build stops the job before anything changes. The `backend`
    preview binds the page reader `main` deployed, so the first deploy must
    come from `main`.
    `.github/workflows/pipeline.yml` builds the same image on every change to
    `pipeline/`, checks `/healthz` (Tesseract 5.3.0, the Czech model), reads
    one page of an S02 lab sheet through `/v1/pages`, and runs the pytest
    suite inside the image, so the tests run on the deployed Tesseract.
  - **Instances by case.** Calls name an instance from a pool of three by a
    hash of the case ID (`poolInstance`; `POOL_SIZE` equals `max_instances`):
    however many documents run at once, at most three instances start, and
    two cases can run side by side. A case's documents queue on one
    half-vCPU instance (server.py works one request at a time), so the steps
    that wait for it have the 10-minute OCR timeout. The warm route
    (`POST /api/admin/pipeline/warm`) calls `/healthz` on all three; run it
    before a demo, since the first call after a deploy starts cold.
  - **Switches.** `PAGE_READER_CONTAINER` is "off" in `wrangler.jsonc`, so
    `wrangler dev`, the tests and the browser suite never reach for a
    container; CI's deploy commands and `npm run deploy` pass
    `--var PAGE_READER_CONTAINER:on`.
    `PIPELINE_ORGS` ("demo-b" deployed, "*" in the tests) lists the orgs the
    pipeline runs for: `/api/me` reports `features.pipeline` for the acting
    org, and the page shows processing states and "Přečíst bez AI" only then,
    so demo org A looks as before. `/api/health` `features.pipeline` now says
    only that the host reaches a page reader.

### Keeping uploads per org, photos (issue #18)

- **Which uploads keep their content.** Demo org A, the hackathon demo,
  keeps the content of registered fixtures only; any other file is listed
  by name and size, as before, with no refusal on screen (demo smoothness).
  `UPLOAD_STORE_ORGS` (comma-separated org ids) lists the orgs whose unknown
  uploads are stored whatever `UPLOAD_POLICY` says; demo org A is ignored
  there, so a typo cannot switch it on. It is the team's switch
  for demo org B and is empty on the deployed host: anyone with a demo
  account can act in org B and its demo reset wipes it, so the team turns
  it on only while it tests with its own synthetic files. Real patient
  documents wait for FNO's clearance and the login whatever it says.
- **Photos.** A JPEG or PNG (by magic bytes) is kept as uploaded under
  `uploads/<case>/<doc>.jpg|.png` with its own media type. The Workflow's
  first step, `convert`, sends it to the page reader's `/v1/convert`
  (`pipeline/page_reader/convert.py`, PyMuPDF and Pillow): a one-page A4
  PDF, upright by the EXIF orientation, in grayscale, transparency as white
  paper, at most about A4 at 300 dpi, rebuilt from the pixels alone so no
  metadata follows (EXIF with GPS, XMP, ICC, comments; tested); every later
  step reads that PDF
  (`<run prefix>converted.pdf`), and the original stays unchanged.
  Trade-off: the stored original still carries its EXIF data, location
  included; it is kept because the original stays findable and unchanged
  (CLAUDE.md), and it is read only by the pipeline.
- **Not converted.** Office files (DOCX, ODT) stay listed only: converting
  them needs LibreOffice, which would make the page reader image several
  hundred MB larger; the doctor uploads a PDF instead. HEIC photos are not
  decoded either (no HEIC support in PyMuPDF or Pillow without another
  library); a browser's file picker on a phone sends JPEG.
