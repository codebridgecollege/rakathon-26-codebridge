# Technologies - CodeBridge

Every technology the project uses or plans to use, what it does for us,
and why we chose it. Use this to answer questions when presenting. The
list we declare to the jury (tools and data sources used during the
event) is in [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md); keep the
two in step.

Status: **used** (in the repo now), **planned** (designed, not built),
**dev only** (used to build the project, not part of the product).

## Reading documents

FNO's patient PDFs are not ordinary scans. Most pages hold a faded
background image with the readable text drawn on top in fonts, and some
fonts map glyphs to the wrong characters, so the text you can copy from
the PDF differs from what the page shows ("Ambulantnf vyletfenf" for
"Ambulantní vyšetření"). Evidence: [OCR evaluation](../research/2026-10-16-ocr-evaluation.md).

### How each case is read

| Case | How we read it | Why |
|---|---|---|
| Digital PDF (text in fonts, no page image), e.g. `20_pacient.pdf` | Planned: use the PDF's text, after checking it against a quick OCR of the rendered page | The text is exact when the font maps are correct; the check catches broken maps |
| Edited or scanned page (image plus text, or image only), most FNO pages | Render the page as a viewer shows it, then read it with the vision LLM and with Tesseract | Neither the PDF's text layer nor its embedded image is reliable |
| A token where the two engines disagree (a digit, a date, a stage) | Marked "ověřit" (verify) for the doctor | Each engine fails differently; disagreement finds the risky spots |
| A Tesseract word below 60 % confidence | Marked "ověřit" | In the evaluation every Tesseract error was among these words |
| A page too poor to read (low confidence across the page) | Readability warning and a request for a better copy (F-03) | A wrong value is worse than a missing one |
| Photo of a paper report | Planned, same path as an image page | |
| Word or Excel exports (FNO's samples) | Planned: read the cells directly | Structured already; no OCR needed |

The PDF's own text layer is kept only for comparison, never shown as the
source.

### Tools

| Technology | Status | What we use it for | Why this one | Privacy |
|---|---|---|---|---|
| PyMuPDF 1.24.10 | used | Render each PDF page to an image (150 dpi for display, 300 dpi for OCR); inspect fonts and images | Renders exactly what a viewer shows, fast, no external service | Local |
| Tesseract 5 with the Czech model (`ces`) | used | Local OCR of the rendered page; per-word confidence and position | Free, runs on the hospital's own server, gives confidences and boxes for "verify" marks and for highlighting the quote on the page image | Local |
| Vision LLM | used for development (Claude Sonnet); planned for the product | Primary transcription of the rendered page: Czech medical print, tables kept as tables, stamps and blacked-out areas marked | It was correct at every problem spot in the evaluation, including the iRECIST table | Cloud unless run locally; see [data protection](DATA-PROTECTION.md) |
| pypdf 5.1.0 | used, superseded for reading | First text extraction for the fixture data (`fixtures/data/ocr.json`); still useful for metadata | | Local |
| `scripts/ocr_pages.py` | used | Our pipeline: render, OCR with Tesseract, write images, text, and word boxes to `data/derived/pages/` | | Local |
| `scripts/build_page_index.py` | used | Merge the vision text, Tesseract words, and disagreements into `data/derived/page-index.json` for the app | | Local |
| `pipeline/page_reader` (Python package) | used | One implementation of render, Tesseract, the "ověřit" marks (also Tesseract against the PDF text layer), the readability check from the text and a deterministic parser for FNO-format lab sheets; `scripts/` and the page reader service both use it | Scripts, server and tests cannot drift apart | Local |
| Page reader service (`pipeline/container/`, Python standard-library HTTP server, Docker image on Debian bookworm with Tesseract 5.3.0 and the Czech model) | built, runs locally; Cloudflare Container not deployed yet | The API Worker's document Workflow calls it for the native work | Containers run the binaries Workers cannot; no secrets, storage or network in it | EU when deployed with the jurisdiction constraint |
| `scripts/redact_pages.py` with Pillow 10.4.0 | used (prototype) | Black out direct identifiers on page images before any cloud call (option B in [data protection](DATA-PROTECTION.md)) | Rules plus Tesseract word boxes; runs locally; tested on all 20 pages, known gaps listed in the data-protection doc | Local |

### Why the demo uses a cloud vision model (decided 2026-10-16)

If asked at the demo, the short answer:

> For the demo we first tried reading the pages locally with Tesseract.
> It was too weak for clinical use: it misread digits and stages (11 as
> "l", L5 as "LS", M0 as "MO", q3w as "g3w"). The vision model read every
> problem spot correctly, including the iRECIST table. FNO's challenge
> data is fictitious, so sending it to a cloud model is allowed. We still
> run Tesseract next to it: its confidences and the places where the two
> readings disagree become the "ověřit" (verify) marks for the doctor.

For a real deployment at FNO we recommend:

1. **Default: a local vision model on FNO's own server**, with Tesseract
   alongside it. No page leaves the hospital.
2. **Cloud only through an FNO-approved EU endpoint**, with a data
   processing agreement and an impact assessment, and **only after local
   redaction** of direct identifiers (name, birth number, insurer number,
   contacts, names in the text, header blocks).

The code reads pages through one interchangeable "page reader", so the
engine is a configuration choice, and every page records which engine
read it and whether it was redacted. Evidence:
[OCR evaluation](../research/2026-10-16-ocr-evaluation.md); reasoning:
[data protection](DATA-PROTECTION.md).

## Understanding documents (planned for the product)

| Technology | Status | What we use it for | Notes |
|---|---|---|---|
| LLM for extraction | planned | Turn page text into structured facts (diagnosis, stage, treatment lines, labs, dates), each with its source quote and page | Model, endpoint, and key from configuration (`CLAUDE.md`, "Calling LLMs"); the hackathon's Azure endpoint offers OpenAI and other models, EU deployments preferred |
| Pseudonymization step | planned | Replace name, birth number, and other direct identifiers with the case ID before any text or image leaves the hospital | See [data protection](DATA-PROTECTION.md) |
| Rules and checklists | planned | Missing documents, contradictions (like with like), readability | Deterministic code, not the LLM, wherever a rule can decide |

The demo's patient data was extracted by Claude sub-agents during
development and corrected by hand after two reviews
([`fixtures/README.md`](../../fixtures/README.md)).

## User interface

| Technology | Status | What we use it for | Why |
|---|---|---|---|
| Page-image source view | used | A source reference opens the rendered page image (150 dpi) with the cited passage boxed from Tesseract's word positions, the vision transcription in a second tab with the same passage marked, and the "ověřit" tokens marked in both | Team decision 2026-10-16: show the actual page, so the doctor can check the original; the text tab keeps source links pointing at a passage |
| ElevenLabs Scribe v2 Realtime and Scribe v2 | used (demo) | "AI záznam": live Czech transcript of the MDT discussion, each word filed under the case open when it was spoken; after a case's conclusion is approved, its audio goes once through Scribe v2 with speaker separation ("Mluvčí 1, 2"), then the audio is deleted. Both go through our server: the live socket with a single-use token from `/api/stt/token`; the speaker pass as a Workflow that reads the case's audio from R2 (step 5). The key stays on the server | The live model does not separate speakers, so speakers come from the second pass. Demo only, with fictitious speech; at FNO the same two passes would run on a speech server inside the hospital (a Whisper-class model with a diarization model), see [integration](INTEGRATION.md) |
| Azure OpenAI (`gpt-6-luna-dz-eu`, hackathon gateway, EU) through the API Worker | used (demo) | "Shrnutí AI": one or two sentences of decisions and next steps from a case's speaker transcript, shown above the folded transcript | ElevenLabs has no text model; the Worker route `/api/summarize` keeps the key off the page and fixes the prompt (`api/src/prompts/summarize-cs.ts`) |
| Cloudflare Workers with static assets | used (demo hosting, `api/`) | One Worker `codebridge-mdt` serves the built app as files and the API under `/api`; CI deploys `main` to production and `backend` to a preview alias | One deploy for page and API, HTTPS so the browser allows the microphone, rate limiting bindings, and the login on the same host (`/auth/*` runs in the Worker) |
| Hono 4.13.13 | used (API Worker) | Routing and middleware: errors, `no-store`, auth, same-origin check, rate limits | Small, made for Workers, typed bindings |
| Zitadel Cloud, EU region | used (login, deployed hosts) | The identity provider (IdP, the service that logs people in): one project "GLIDE MDT" with a confidential web app, the demo accounts with verified e-mails, Czech login page; the Worker is the OIDC client (`AUTH_MODE=oidc`, [`AUTH.md`](AUTH.md)) | EU storage with a European contracting party (CAOS AG), free for the MVP, can broker a hospital's own IdP later, open source so it can run inside a hospital; compared with WorkOS, Auth0, Entra External ID, Keycloak and others in `AUTH.md`. Runs on Google Cloud, so a US-parent sub-processor ([`DATA-PROTECTION.md`](DATA-PROTECTION.md)) |
| `jose` 6.2.12 | used (API Worker) | The login: verifies the ID token (RS256 signature against the IdP's cached key set, issuer, audience, nonce, expiry with 30 s tolerance) and encrypts the login-transaction cookie (AES-256-GCM, `dir`) | WebCrypto-only, no Node built-ins, so it runs in Workers; pinned |
| Workers rate limiting binding | used (API Worker) | Per-minute limits on summary, speech token and speaker pass, per logged-in person or per IP in demo mode | Caps cost and abuse of the shared hackathon endpoint; approximate, not a security control |
| Cloudflare D1 (SQLite), EU jurisdiction | used (API Worker, steps 2 and 4) | Directory, patients (identity only here), cases, documents, pages index, alerts, tasks, the server access log; append-only triggers on decisions, histories and the log (`api/migrations/`). Every write is one D1 batch: guard rows re-check what the route read (a `CHECK (ok = 1)` on `write_guards` rolls the whole batch back), then the change, then its access-log row | Relational rows with constraints next to the Worker; the jurisdiction keeps the data in the EU. D1 has no interactive transactions, so the guards close the gap between a read and the batch |
| Cloudflare R2, EU jurisdiction | used (API Worker, step 2) | Page JSON and images, original PDFs, extraction, guidance and prognosis JSON, read only through the Worker after the access check | Large objects stay out of D1's row limits; private bucket, no public URL |
| Cloudflare Workflows | used (API Worker, step 5) | `SpeakerPassWorkflow`: after a doctor approves a case's conclusion, the case's stored audio goes once through ElevenLabs Scribe v2 with speaker separation, the speaker lines replace the live lines, the audio is deleted and the summary draft is made (`api/src/workflows/speaker-pass.ts`); the page polls the job | The pass takes minutes and must survive a closed tab; each step is retried on its own with backoff on 429 and 5xx, and a step that ran is not run again. Params and step results hold ids and counts only |
| R2 multipart uploads, lifecycle rules, cron trigger | used (API Worker, step 5) | The page uploads a case's raw audio in 5 MiB parts while it is discussed; every 15 minutes `scheduled()` deletes audio that should already be gone; an R2 rule removes anything left under `audio/` after 7 days (the longest a failed pass keeps audio for a retry) | Keeps browser memory flat and the audio on our EU storage for as short a time as the pass needs, with two independent backstops for deletion |
| Cloudflare AI Gateway | optional, off | Can sit in front of the Azure OpenAI call when `AI_GATEWAY_BASE` is set | Off until we check that it accepts the APIM host, whether it retries 429 itself, and that its logging is off |
| Wrangler 4.147.0, TypeScript 5.9.3, Vitest 4.1.11 with `@cloudflare/vitest-plugin` 1.3.6 | used (API Worker) | Local run, deploy, type check, tests inside workerd | Tests run in the same runtime as production |
| Nuxt 4.6.2 (Vue 3.5.44, Vue Router 5.4.0) in SPA mode | used (`app/`, issue #13) | The frontend, with path routes so browser back and forward work; built with `nuxt generate` and served by the API Worker at `/` | Typed components instead of one 5,500-line page (mock v3, the single-file page it replaced); per-route server rendering later for public pages without a second framework ([`FRONTEND.md`](FRONTEND.md)) |
| Pinia 4.1.0 with `@pinia/nuxt` 1.0.3 | used (`app/`) | Session, staff, patients, workflow and the per-case cache | Long-lived state that survives route changes (later the recorder) |
| Fluent: `@fluent/bundle` 0.19.1, `fluent-vue` 3.8.2 | used (`app/`, `i18n/`) | Interface text from `i18n/cs/*.ftl` (Slovak and English fall back to Czech) | Plurals and variants per language, terms for the fixed clinical wording ([`I18N.md`](I18N.md)); `fluent-vue` is registered in a plain Nuxt plugin |
| npm workspaces, `@codebridge/domain`, `@codebridge/api-client` | used (issue #13) | One lockfile for `api/`, `app/` and `packages/*`; the pure case rules shared by the Worker and the app; a typed client for the API | A clinical rule exists once instead of being copied by hand between page and server |
| Vitest 4.1.11 with happy-dom 21.0.3 and `@vue/test-utils` 2.5.1; vue-tsc 3.3.13 | used (`app/`, `packages/`) | Store, boot and catalog tests; type checks of the app | The same test runner as the Worker |
| Google Fonts: Manrope, DM Sans | used | Headings and text | Soňa's visual brief (GLIDE-inspired clinical workspace) |
| Content security policy and headers through the assets' `_headers` and `_redirects` files | used (Worker, issue #13) | `api/scripts/headers.mjs` pins the hashes of the app's two inline scripts and allows only our origin, Google Fonts and the speech service's socket; nosniff, same-origin referrer, no framing; rewrites of the app's route paths | No inline or injected script can run in the app; written at staging so it follows each build, and with no extra module in the app (nuxt-security would add one for the same two hashes) |
| claude.ai artifacts | dev only, during the event | Publishing the early mocks as private links for the team | Quick sharing and comments |

## Standards and codes

| Standard | Status | Use |
|---|---|---|
| HL7 FHIR R4 (4.0.1) | used (export) | The app exports a case as a FHIR R4 Bundle with a Provenance on every fact, built in the browser; reading FHIR from the hospital is planned ([`fhir/README.md`](../../fhir/README.md), [`INTEGRATION.md`](INTEGRATION.md)) |
| HL7 Czech core guide (hl7.fhir.cz.core 1.0.0) | used (validation) | Loaded by the validator; the MKN-10 code system URI comes from it |
| MKN-10 | used in data | Diagnosis codes as written in the documents; shown below the histology, because doctors read the histology and stage first |
| TNM, ECOG PS, iRECIST | used in data | Kept exactly as written; TNM labeled as stage at diagnosis |
| NČLP | planned | Lab codes, kept as the source gives them |
| JSON Schema (draft 7) | used (extraction format) | The extraction format `codebridge.extraction/2` ([`EXTRACTION-FORMAT.md`](EXTRACTION-FORMAT.md)): generated from the TypeScript types by ts-json-schema-generator 2.9.0, checked in the Worker by `@cfworker/json-schema` 4.1.1 (no code generation at runtime, which Workers forbid) and in the Python pipeline by `jsonschema` 4.23.0 |

## Development tools (not part of the product)

| Technology | What for |
|---|---|
| Claude Code (Claude Opus and Sonnet) | Coding, research notes, data extraction for the demo fixtures, reviews |
| ChatGPT | Soňa's brainstorming and UI sketches (`docs/sources/design/`) |
| ElevenLabs Scribe v2 (`scripts/transcribe.py`) | Transcribing the organizers' talks and the team's design discussions; no patient data in the audio |
| uv | Running the Python scripts with pinned dependencies |
| Playwright 1.64.1 with `@axe-core/playwright` 4.13.0 (axe-core 4.13.0) | The DOM-only end-to-end suite (`e2e/`) against the app; automated WCAG 2.1 A/AA checks of the app's screens and dialogs, a content security policy check on every test |
| python-pptx, macOS `textutil` | Reading the organizers' decks and FNO's Word documents |
| GitHub | Repository, shared by the team |
| HL7 FHIR validator 7.0.2 with OpenJDK 21 (`fhir/validate.sh`) | Checking the FHIR export against FHIR R4 |



## Prognosis evidence search

The 2026-10-17 prototype uses a Python standard-library local HTTP server and one OpenRouter Chat Completions request to GPT Astra with server-side web search. The exact model ID is configured and catalog-checked; the initial catalog verified GPT-6 Astra. No browser code receives the key. The table and source disclosures use the existing generated HTML pipeline. See [the design](PROGNOSIS.md) and [API](../../prognosis/README.md).
