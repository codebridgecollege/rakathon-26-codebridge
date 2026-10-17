# UI mocks

Throwaway, clickable mocks of the MDT Workspace, used to check the design
direction with the team (see [`docs/design/PRODUCT.md`](../docs/design/PRODUCT.md)).
They are static HTML pages with the data embedded. The only server parts are
the Pages Functions in `functions/` (speech-to-text and the discussion
summary for "AI záznam"), which hold the API keys.
All patient data is FNO's fictitious challenge data, except the synthetic
patient S01 (mock v3, case ID `NO-S01`), whom the team invented
([`samples/README.md`](../samples/README.md)).

| Page | What it is | Published copy |
|---|---|---|
| `v1.html` | First simple mock (one patient workspace) | https://claude.ai/artifact/KraDQ9X7diVo93QzXtse6t |
| `v2.html` | Full mock after feedback round 1 (database, calendar, patient detail, presentation, protocol, tasks) | https://claude.ai/artifact/6F5AbN6vEAHJQgXP1fkUdc |
| `v3.html` | Mock after feedback round 2 (Excel-style filters, month navigation, 10-minute slots, brief first, diagnosis headline, current state, lab chart, doctor edits, back/forward), with one patient view for the whole MDT: a session bar with the day's cases and a "Projednání na MDT" card for notes, next steps and approval; its source view shows the rendered page image with the cited passage highlighted, so publishing it also needs the `pages/` folder. Round 19 added task drafts from approved conclusions with a coordinator view and a digest e-mail, out-of-hours booking, retrospective comparisons (now read-only), and strength-sorted guideline quotes. Round 20 added a status menu with history and "Uzavřít případ", one-button approval for the team, the report picks in a dialog behind "Stáhnout report (PDF)", and a lighter new patient form. Round 21 made guideline statements collapsed entries (quote and tier chip, opening to the reason with sources and the full citation), moved the MDT deviations table under them in "Navrhovaný postup", quoted the guideline edition valid at each past decision in "Retrospektivní odchylky", and replaced the inline missing list with a warning-styled "Upozornění" button. Round 23 added "Personál pracoviště": staff entered as title and surname, saved only in the viewer's browser (localStorage `mdt-staff-v1`, fictional defaults, "Obnovit výchozí"), from which attendance and the user picker are built. Round 24 added the synthetic patient S01 (marked "syntetický pacient", with its documents, missing-document alerts and a lab trend from four documented draws, every value linked to its line), removed the invented lab series of case 10, merged the reason and the question into one paragraph with the draft chip at its end, listed every passage a drafted question cites, and drew our own scalpel icon for surgery. Round 25 renamed the brief block "Stručný přehled", made alerts resolvable ("Vyřešeno", "Vrátit", history), removed the "Změna" kind and the lab-range and "J-" alerts, replaced the everolimus alert with a chronology observation, dropped "ověřit čtení" marks where both OCR readings agree, scrolled the oncology summary inside its card, folded the lab explanations into "Zdroje", fixed the calendar double click, shortened the database diagnoses and shows 20 patients per page | https://claude.ai/artifact/6JwakCBuGZr9STKnfRUz8T |

The published copies are private claude.ai artifacts owned by Juro; ask him
to share them. To view a mock locally, open the `.html` file in a browser.

## How to change a mock

Do not edit `v1.html` to `v3.html` or `pages/` directly; they are generated.

1. Edit the template in `src/` (`v1-template.html` to `v3-template.html`)
   or the data in `src/data/`.
2. Run `uv run mocks/build.py`.
3. Check it (below), then open the page in a browser.

## Data

`src/data/` is the source of truth for what the mocks show:

- `mock-case-10.json`: patient `10_pacient.pdf` structured into sections,
  timeline, labs, flags, and the OCR text of each page. Every fact has a
  source quote.
- `mock-case-10-extra.json`: anamnesis, the MDT brief and detailed summary
  with numbered references, timeline cards, the documents inside the PDF,
  and short facts about the other nine patients. The keys ending in `_v3`,
  plus `diagnosis_headline`, `status_praesens` and `document_history`,
  feed mock v3. `document_history` is invented example data and the UI
  labels it so. Case 10 has no lab series: its documents hold one undated
  panel, and the product owner ruled out invented values (round 24).
- `mock-patient-list.json`: one entry per other patient. A drafted MDT
  question has `question_draft_cs`, `question_kind` (`document_purpose` or
  `assistant_inference`) and `question_basis`, a list of
  `{role, quote, source}`: the document's purpose sentence (role
  `purpose`, if any), then each finding the draft cites (role `finding`).
  `src/extract/buildlist.py` checks every quote against the OCR text.
  Case 10's `mdt_question` in `mock-case-10.json` has the same fields.
- `ocr.json`: the raw OCR text of all ten patient PDFs.
- `mock-case-S01.json`: our own fictional patient `S01_pacient.pdf`
  ([`samples/README.md`](../samples/README.md)): a patient-list entry, the
  documents, the data gaps, and `labs_series`, the lab values of four
  dated lab sheets, each with its page and verbatim quote. Built by
  `src/extract/build_case_s01.py`. `build.py` embeds every
  `mock-case-S*.json` into mock v3 only (placeholder `/*SYN*/`); the patient
  joins the database after FNO's patients, unscheduled, with the tabs
  "Dokumenty" and "Laboratoř". The lab trend ("Vývoj v čase") is shown only
  for a patient whose `labs_series` has at least two draws from documents.

Mock v3 also embeds `data/derived/page-index.json` (built by
`scripts/build_page_index.py` from the OCR outputs in `data/derived/pages/`):
per page the image path and size, the vision model's transcription,
Tesseract's words with confidence and box, and the tokens to verify.

`src/extract/` holds the scripts that produced the first version of this
data from `data/rakathon-26/`. The JSON was corrected by hand after two
reviews (OCR misreads, a planned dose shown as done, negation tags), so
re-running the scripts would undo those fixes. Edit the JSON instead.

## Two data modes: embedded and server

Mock v3 decides at startup where its data comes from, and the top bar shows
the result in a chip:

- **Data: vložená** (embedded). Opened from a file, on Pages
  (`codebridge-mdt.pages.dev`), under `mocks/serve.py`, or with
  `?data=embedded`. The page uses the JSON embedded by `build.py`, exactly as
  before.
- **Data: server**. On the API Worker (`api/`), when `GET /api/health`
  answers JSON with `service: "codebridge-mdt"` and `features.data: true`.
  Before the first render the page loads `/api/me`, `/api/staff`,
  `/api/patients` and `/api/tasks`. Case data loads per case when a case is
  opened: `/api/cases/:id/extraction` fills the page's per-case store
  (`caseStore`, at most five cases in memory, cleared on a user switch, never
  in `localStorage`); identity comes from the patient row, not from the case
  JSON. A case the server lists as unprocessed and patients created in this
  browser need no request. While a case loads the view says "Načítám podklady
  případu…"; a failed load says so with "Zkusit znovu" and "Chybějící podklady
  nelze ověřit", never "nezpracováno". The guideline layer calls
  `/api/cases/:id/guidance`, the source viewer fetches each page from
  `/api/documents/:id/pages/:n` (images from `.../image`), opening a case
  calls `/api/cases/:id` so the server writes the access log, and
  Administrace shows the server's log.
  Every change goes through the write API (step 4,
  `docs/research/backend-steps/step-4.md`, "As implemented"): status and
  closing, booking and drag-and-drop, the discussion record (autosaved 800 ms
  after typing, on leaving a field and before approval, with a conflict bar
  "Koncept mezitím upravil(a) …" offering "Načíst jejich verzi" or "Přepsat
  mou verzí"), approval (one request with an `Idempotency-Key`, the button
  disabled while it runs), "Nový závěr", tasks, drafted tasks, the digest, the
  drafted question, fact edits, alert events, attendance, MDT sessions, new
  patients (a second record for a known birth number needs a reason), the
  staff list (a new person's role is chosen explicitly; "MUDr." prefills
  "lékař") and break-the-glass ("Otevřít mimo tým" with a reason). The server
  checks each rule and writes the audit row; the page shows the server's
  answer and its Czech message on a refusal. `GET /api/workflow` loads the
  stored state of every case at startup, so a reload shows decisions, drafts,
  edits, alert history, attendance, the running session and mails. The page's
  own access log is off in API mode: views the server cannot see go to
  `POST /api/audit/events` as fixed codes, never as text. Doctors are the
  people the server's `roles` map calls doctors, not a title. A banner on
  every view says the data is shared and fictional; Administrace offers
  "Obnovit ukázková data" (type OBNOVIT) where the server enables it, and a
  tab opened before a reset reloads on its next write. Uploads in the
  discussion card still stay in the browser (step 6).
- **Data: vložená (server nedostupný)** in amber: the health check said the
  data API is on, but a load failed. Nothing from the server is used; the page
  runs on embedded data, so a silent fallback cannot hide a broken backend.

The demo has no login. The picked user travels as a staff id (`d2p1`,
`coord`, `admin`) in the `X-Demo-User` header and in the `cb_demo_user`
cookie (page images load through `<img>`, which cannot send a header).

`?parity` (server mode only) compares the server's patient rows, staff and
tasks with what the embedded data builds and prints the differences to the
console (identity keys by name only, never their values).

The embedded data stays in the HTML in both modes until a later step removes
it, so the server mode does not yet reduce what the page carries.

## New patient from FHIR and uploaded documents

Synthetic patient S02 (Věra Lipenská, rectal cancer, `samples/S02_pacient`) is the demo of a new referral. Her
`mock-case-S02.json` has `intake_demo: true`, so she is not in the patient database until someone creates her:

1. "+ Nový pacient", "Import z FHIR", then "Vložit ukázku" (or choose `samples/S02_pacient/upload/zadost-fhir.json`)
   and "Načíst". Tick the GDPR consent and continue.
2. Drop the seven PDFs from `samples/S02_pacient/upload/` into "Dokumenty": the outpatient report, the biopsy and
   resection histology, and four lab sheets. The dialog links them as `ukazka/S02-dokumenty.zip`, which
   `build.py` packs and `deploy.sh` publishes.
3. "Zpracovat", then "Přidat do databáze": the patient opens with her documents, missing documents and the lab
   trend (CEA 14,8 → 5,8 → 2,9 → 9,6 µg/l).

The documents were read and extracted in advance, like every case in the mock; the dialog recognises them by
file name and attaches that record only when the birth number from the form matches and all seven are uploaded.
Any other upload makes an empty record, as before.

## Source view and page images

Clicking a reference [n] or "zdroj" opens the document viewer: the page
image with the quoted passage boxed in yellow, the "ověřit" tokens outlined,
a page switcher, zoom (fit width or 100 %), and a "Přepis stránky" tab with
the vision transcription and the same passage marked. The quotes in the
data come from the PDF's old text layer, with its misreads, so the viewer
matches them tolerantly (case, accents, punctuation, O/0 and l/1 folded;
exact run first, else the best window covering at least 60 % of the
quote; a window holding the quote's numbers wins, and a near tie or a
repeated quote is reported). Of the 209 distinct references in patient
10's case data, every quote is found in the transcription; 6 are not
boxed on the image because Tesseract skipped those lines (four on the
medication lines of page 2, "CT Ag plicnice" on page 5), and the viewer
says so. A page without a match shows "Citace nenalezena přesně,
zobrazena celá stránka".

The "!" (ověřit čtení) marks on facts come from `ocr_note_cs` in the case data. `src/extract/ocr_confidence.py`
(round 25) checks each note against the two readings in the page index and stores `ocr_check`; the mark is hidden
when both readings agree on the word (diacritics, case and punctuation aside) or differ by one harmless character
in a known word, and kept for a digit, negation, unit or meaning difference, a word only one engine read, or a note
that states a doubt. Run it with `--write` after changing a note.

The "ověřit" marks come from `scripts/build_page_index.py`, which aligns
the two readings word by word and records each item's character offsets
in the vision text. A digit, date, dose or stage is marked when Tesseract
read it differently, read it with low confidence, or did not read it at
all ("četl jen jazykový model"). Unmarked text is not verified; the page
image decides.

The images are not embedded. `build.py` copies
`data/derived/pages/<stem>/p<n>.png` and `p<n>.redacted.png` to
`mocks/pages/<stem>/`, and the page refers to them as
`pages/<stem>/p<n>.png`. Open `v3.html` from the `mocks/`
folder; to publish it, publish `pages/` with it. The redacted image (from
`scripts/redact_pages.py`) appears only when the doctor ticks "Cenzurovat
(demo)", labelled as a demonstration of local
redaction; a page where the check found nothing says the check is
incomplete, and the quote and the transcription are hidden while the
redacted image is shown.

## AI záznam (live transcription)

"AI záznam" in the "Projednání na MDT" card records the discussion and
writes a live Czech transcript. "Spustit záznam" starts it at once. The
page holds no speech key: it asks our server for an ElevenLabs single-use
token (`POST /api/stt/token`, which returns the socket URL) and sends the
case audio for the speaker pass to `POST /api/stt/diarize`. These Pages
Functions (`functions/api/stt/`) hold the key from the Pages secret
`ELEVENLABS_API_KEY`; model names and limits are in `pages-wrangler.toml`.
On load the page asks `GET /api/health` what the server offers; opened from
a file, in the claude.ai viewer or under `serve.py` there is no such server,
and the recorder shows as unavailable (the conclusion can still be typed).

The team's live copy is https://codebridge-mdt.pages.dev
(Cloudflare Pages, HTTPS, so the browser allows the microphone);
a push to main that changes `v3.html`, `pages/`, `ukazka/`, `functions/` or `pages-wrangler.toml` redeploys it
(`.github/workflows/deploy-mock.yml`, which refuses to publish a page that
contains an API key); `mocks/deploy.sh` does the same by hand after
`npx -y wrangler@4.147.0 login`.

To run the recorder locally, put the two keys in `mocks/.dev.vars`
(gitignored; `ELEVENLABS_API_KEY=` and `AZURE_OPENAI_KEY=` lines) and
stage the site the way `deploy.sh` does. `.dev.vars` goes next to
`wrangler.toml`, never into `public/`, which is served as is:

```bash
T=$(mktemp -d) && mkdir "$T/public" && cp mocks/v3.html "$T/public/index.html"
cp -R mocks/pages mocks/ukazka "$T/public/" && cp -R mocks/functions "$T/functions"
cp mocks/pages-wrangler.toml "$T/wrangler.toml" && cp mocks/.dev.vars "$T/.dev.vars"
(cd "$T" && npx -y wrangler@4.147.0 pages dev public)
```

Open http://localhost:8788 in Chrome; localhost counts as a secure
context, so the microphone works.

- One recording runs for the whole meeting. Each word goes to the patient
  whose case was open when it was spoken: the service returns word
  timestamps on the session timeline, and the page keeps a list of which
  case was open from which second. Moving to another case and back
  continues the earlier transcript; nothing is overwritten.
- A case with an approved conclusion gets no more words. Audio spoken
  while no such case is open is replaced by silence before it is sent.
  When every case of the running seminar ("Zahájit MDT") is approved, the
  recording stops by itself; "Ukončit MDT" stops it too.
- Live text comes from Scribe v2 Realtime (`scribe_v2_realtime`,
  `commit_strategy=vad`), which does not tell speakers apart. After
  approval, the case's own audio (kept in memory, 16 kHz PCM) goes once
  to Scribe v2 (`scribe_v2`, `diarize=true`); its version, with speakers
  numbered per case, replaces the live text, and the audio is deleted.
  Speakers are not named: that would need voiceprints.
- A third pass sends the speaker transcript to an LLM for a one or two
  sentence summary in the manner of an MDT conclusion (decisions, next
  steps, no who-said-what), shown as "Shrnutí AI" above the transcript,
  which folds into a closed "Přepis diskuse" panel. ElevenLabs has no
  text model, so the page posts the transcript to `/api/summarize`, a
  server route (today the Pages Function `functions/api/summarize.js`) that holds the
  prompt and calls the hackathon's Azure OpenAI gateway (`gpt-6-luna-dz-eu`,
  EU) with the key from the Pages secret `AZURE_OPENAI_KEY`. The gateway
  rejects browser CORS preflights, hence the function. Opened from a file,
  the page has no `/api/summarize` and the summary shows an error.
- Starting, stopping and the speaker pass go to the access log.

Checked with Chrome's fake microphone
(`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>`)
playing a fictitious two-voice Czech dialogue: words split correctly at a
case switch, the speaker pass separated the two voices, and the recording
stopped after the last case of the seminar was approved.

## Timeline categories

Mock v3 uses the nine categories documented in
[`PRODUCT.md`](../docs/design/PRODUCT.md#timeline-categories). The `category`
field on each timeline card is display metadata; original dates, kinds,
sources and plan status are preserved. The compact summary shares the icons. Category checkboxes support multiple selection: all start checked, unchecking excludes a category, and Vše selects or clears all. A partial selection gives Vše a mixed state.
Lucide 0.468.0 paths are embedded in the template, with the ISC notice in
`src/vendor/lucide-LICENSE`; no icon CDN is needed at runtime.

## Checks

- `src/test/case-store.mjs`: the per-case data store and the data-driven
  patient view in jsdom (`npm i jsdom@24.1.0` in a scratch folder, then
  `JSDOM_PATH=<that folder>/node_modules/jsdom node mocks/src/test/case-store.mjs`):
  the embedded seed, no case-data request on Pages, the tabs each case's data
  gives (case 10, S01, an unprocessed patient, a copy of S01 with a brief and
  finding groups), and API mode against a fake server (loading state, late
  replies, a deep link while loading, errors and retry, approval waiting, the
  five-case bound, the user switch).
- `src/test/write-api.mjs`: the write path of API mode in jsdom against a fake
  server that follows the step 4 contract (same setup as `case-store.mjs`):
  the workflow load, the banner, approval (stored first, one request on a
  double click, the idempotency key kept for a retry), "Nový závěr" only after
  approval in both modes, a taken slot, the reset reload, view events as
  codes, the protocol conflict bar, the coordinator's read-only record,
  attendance ids, task rollback, alert keys, a duplicate birth number with a
  reason, break-the-glass and a new person's role.
- `node mocks/src/test/timeline-categories.mjs`: category filters, preserved source indexes, partial and missing dates, planned status, and escaped labels.

- `src/test/v3.mjs`: clicks through mock v3 in Chromium with Playwright at
  1280 px and 400 px (filters, calendar, back/forward, edits, labs,
  approval, the source view: image, highlight, verify marks, zoom,
  transcription tab, page switch, redacted page, access log, admin, and the
  round 19 checks: logo, unscheduling by drag, out-of-hours booking, compact
  summary dates, alert labels, strength order, read-only retrospective comparisons,
  coordinator tasks, digest e-mail; round 20: required fields in the new
  patient form, the report dialog, approval with automatic attendance, status
  menu, history and closing; round 21: guideline entries collapsed and
  opening to Proč with sources, the ordering sentence, the deviations table in
  "Navrhovaný postup", retrospective quotes equal to the historic-edition
  file with the edition year and PDF page, and the warning-styled
  "Upozornění" button; round 23: the staff screen read-only for doctors, adding,
  renaming and removing a person, refused duplicates, the attendance grid
  and the user picker following the list, persistence across a reload, a
  removed person kept in an earlier decision, and the reset) and reports JS errors and horizontal overflow
  (`node mocks/src/test/v3.mjs`).
- `src/test/smoke.mjs`: clicks through every screen of v2 in jsdom and reports JS
  errors (`npm i jsdom@24.1.0` in a scratch folder, then
  `node smoke.mjs <path to v2.html>`).
- `src/test/w.mjs`: opens every screen in Chrome at 400 px width and prints
  the page width, to catch horizontal overflow (`npm i playwright-core`,
  needs Google Chrome installed).



## Local prognosis search

Build with `python3 mocks/build.py`, then run `python3 mocks/serve.py` from the repository root. Open `http://127.0.0.1:8766/v3.html#patient/10/prognosis`. The patient must have a calendar slot. The Prognóza tab previews dated synthetic facts, then starts one GPT Astra search through OpenRouter when requested. Configure the server using `.env.example`; keys stay in the gitignored `.env`. Static hosting displays the tab but needs this backend to search. See [the API and limitations](../prognosis/README.md).

Validation: `python3 -m unittest discover -s prognosis/tests -v`, `node mocks/src/test/prognosis-ui.mjs`, and `node mocks/src/test/timeline-categories.mjs`.


## Saved Poláček prognosis

The generated v3 page embeds the saved synthetic Poláček search from
`src/data/prognosis-case-10.json`. On first opening Prognóza for case 10 with
MDT date 2026-10-22, its six result rows appear after two seconds, labeled as a
saved search with the original timestamp. No model API request is made for replay.
A new search remains an explicit action. Rebuild after intentionally updating the
fixture.

The prognosis table uses compact 11.5 px text, smaller population descriptions and
fixed column proportions. The population column is wider; the four OS timepoints
are narrow. All twelve columns fit together in the desktop view. Source passages
remain available under Zdroj.


## Glide visual integration

The approved design uses flat, square sections on a white canvas, a navy patient header,
opaque timeline icon circles and rounded semantic badges. The question stays editable by
clicking its text (including an empty placeholder); confirmation, history and provenance
remain available in state and exports. The heading is "Stručný souhrn".

"Retrospektivní odchylky" is a passive eight-column table: finding, area,
severity, guideline name, year, verbatim guideline passage, documentation quote
and possible clinical consequence. Source links stay available. No assessment,
reason or confirmation is required. Existing clinician assessments are read-only;
missing severity and clinical consequence stay missing. Rows compare historical
records with the edition valid at the decision, rather than declaring a deviation.
"Navrhovaný postup" keeps the proposal and guideline passages.

Acknowledged and resolved warnings move into an expandable archive with a reversible
"Vrátit" action. Brief and synthetic-case data gaps use the same per-patient, append-only
history as other warnings. Archiving a gap does not supply a missing document; its amber
missing-document signal remains. The oncology panel retains main's CSS-native scrolling.

Integration starts from current main so prognosis (including its source drawer), FHIR
import/export, timeline multiselect, recording/transcript summary, staff management,
calendar handling and clinical data corrections remain present. Run the regression checks:

```sh
node mocks/src/test/case-store.mjs
node mocks/src/test/v3.mjs
node mocks/src/test/patient-panels.mjs
node mocks/src/test/main-preservation.mjs
node mocks/src/test/timeline-categories.mjs
node mocks/src/test/prognosis-ui.mjs
```

Set `PLAYWRIGHT_PATH` if Playwright is installed outside the default path
(the cached Chromium 1248 matches `playwright@1.64.0`), and `JSDOM_PATH` for
`case-store.mjs`.

## Direct PDF report

"Stáhnout report (PDF)" now creates a real `.pdf` download locally, without a print
popup, server upload or CDN. The plain black-and-white A4 report is titled "Záznam
z MDT" and includes identification, attendance, diagnosis, selected NO/findings,
"Prezentován pro", conclusion, further steps, filled deviations, sources and two
blank signature lines. There is no presenting-doctor or authorization section.
Unapproved exports are marked "Koncept".

Anamnesis is an optional checkbox (off initially); sources belonging only to
unchecked sections are omitted. Doctor edits and missing-data/uncertainty wording
remain. Approved reports still use their frozen HTML snapshot and frozen field
selection. The download captures its patient/content before yielding so later
navigation cannot change it. Font and PDF errors are shown and permit retry.

`mocks/src/report-pdf.js` renders selectable text with embedded Czech-capable
DejaVu Sans subsets and jsPDF 4.2.1, vendored under `mocks/src/vendor/` with licenses.
`mocks/build.py` embeds all three components into the self-contained v3 HTML.
Run `node mocks/src/test/report-pdf.mjs` to exercise actual downloads, snapshot
invariance, field selection and error recovery. Test outputs go to `tmp/pdfs/`.

The app and PDF use the GLIDE MDT name and the original GLIDE wordmark. The logo
is embedded locally from `src/brand/` so exports need no external asset request.

## Passive case 10 observations

Four curated case 10 observations reference existing case excerpts and guideline IDs in `src/data/deviations-case-10.json`: HBV documentation, blood pressure context, shortened induction with documented toxicity, and the missing NCH seminar result. The main table requires no input. It labels possible consequences as assistant observations and leaves clinical severity unassessed. Additional historical comparisons are collapsed; previous clinician ratings and their history remain readable. Run `node mocks/src/test/deviations.mjs` after building to check source references, patient scope and passive rendering.
