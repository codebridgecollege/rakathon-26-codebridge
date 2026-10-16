# UI mocks

Throwaway, clickable mocks of the MDT Workspace, used to check the design
direction with the team (see [`docs/design/PRODUCT.md`](../docs/design/PRODUCT.md)).
They are static HTML pages with the data embedded; there is no backend.
Mock v3, the current mock, splits the page into an in-page "server" and a
client, so a real backend can replace the server later (see
[Architecture of mock v3](#architecture-of-mock-v3)).
All patient data is FNO's fictitious challenge data.

| Page | What it is | Published copy |
|---|---|---|
| `v1.html` | First simple mock (one patient workspace) | https://claude.ai/artifact/KraDQ9X7diVo93QzXtse6t |
| `v2.html` | Full mock after feedback round 1 (database, calendar, patient detail, presentation, protocol, tasks) | https://claude.ai/artifact/6F5AbN6vEAHJQgXP1fkUdc |
| `v3.html` | The current mock, after the feedback rounds with Soňa (Excel-style filters, month navigation, 10-minute slots, brief first, diagnosis headline, current state, lab chart, doctor edits, back/forward, guideline layer), with one patient view for the whole MDT: "Zahájit MDT" with attendance starts a session, a session bar lists the day's cases, and a "Projednání na MDT" card holds the notes, next steps, approval and the report. An in-page server holds the data behind REST-shaped routes; the source view shows the rendered page image with the cited passage highlighted, the transcription in a second tab, "ověřit" marks, and the locally redacted page on request. Publishing it also needs the `pages/` folder | https://claude.ai/artifact/6JwakCBuGZr9STKnfRUz8T |

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
  plus `diagnosis_headline`, `status_praesens`, `labs_series_synthetic`
  and `document_history`, feed mock v3. `labs_series_synthetic` and
  `document_history` are invented example data and the UI labels them so.
- `mock-patient-list.json`: one entry per other patient.
- `ocr.json`: the raw OCR text of all ten patient PDFs.

Mock v3 also embeds `data/derived/page-index.json` (built by
`scripts/build_page_index.py` from the OCR outputs in `data/derived/pages/`):
per page the image path and size, the vision model's transcription,
Tesseract's words with confidence and box, and the tokens to verify.

`src/extract/` holds the scripts that produced the first version of this
data from `data/rakathon-26/`. The JSON was corrected by hand after two
reviews (OCR misreads, a planned dose shown as done, negation tags), so
re-running the scripts would undo those fixes. Edit the JSON instead.

## Architecture of mock v3

`v3-template.html` has two script blocks.

- **Server** (the first block, commented "SERVER"): the only code that
  reads the embedded JSON, and the owner of every record that can change
  (patients and slots, doctor edits, decisions, the per-case MDT
  discussion records, attendance, the running MDT session, tasks,
  e-mails, alert acknowledgements, the audit log). It exposes
  `api.get(path, headers)`, `api.post(path, body, headers)`, `api.put`,
  `api.patch` and `api.del`, which return Promises of copies
  (`structuredClone`) of JSON-safe data, and reject with
  `{ status, error }`. Login is stubbed: the client sends the current user
  in an `X-User` header; the server checks roles (doctor, coordinator,
  admin) and writes the audit log itself: every read of patient data
  (case content, alerts, edits, discussion record, decisions, the patient list,
  each viewed page) and every change, with identical reads within a
  minute merged into one entry. A real backend should audit at its
  data-access layer rather than in route handlers.
- **Client** (the second block, commented "CLIENT"): UI state (view, tab,
  filters, selection, open panels, drafts) and a cache of responses. For
  each screen it runs `load()`, which awaits the calls the screen needs,
  then `render()` draws synchronously from the cache. After a change it
  marks the cache stale and loads again; stale entries stay readable
  until the reply arrives. Typing in the discussion record (the conclusion
  in the brief block, notes and steps in the "Projednání na MDT" card,
  deviations in their tab) is a local draft, saved after
  a short pause, one save at a time, each with the version it is based on;
  every reload and the approval first send what is pending. Hash routing
  makes back and forward work.

Add `?latency=300` to the page URL to delay every request by a random 0
to 300 ms, so requests overtake each other as over a network.

To move to a real backend, replace the `api` object with `fetch()` calls
to the same routes and send a session token instead of `X-User`; the
client does not change. `:id` is the patient's number (`10` for
`10_pacient.pdf`), `:file` the PDF name.

| Method | Route | Returns or changes |
|---|---|---|
| GET | `/api/config` | Today's date, departments and staff, users and roles, seminar schedule and slot length (no user needed) |
| GET | `/api/patients` | All patients: identity, diagnosis line, owner, department, slot, previous MDT, status, page count |
| POST | `/api/patients` | Creates an example patient (the new-patient dialog) |
| GET | `/api/patients/:id` | One patient; logged as opening the case, with how the client opened it in `X-View` (`patient`, `calendar`, `start` for the first case of a started MDT, `session` for a case chosen in the session bar) and `X-Via: link` for URL or back/forward. Old `#present/:id` and `#protocol/:id` links open the patient view and are logged as opened by link |
| PUT | `/api/patients/:id/slot` | Books `{day, time}`; 422 outside a seminar slot, 409 if taken |
| DELETE | `/api/patients/:id/slot` | Frees the slot |
| GET | `/api/patients/:id/case` | Case content: for the structured patient the case and its extra data (other patients' data left out); for the others the summary, its sources and the page count |
| GET | `/api/patients/:id/guidance` | The guideline layer for the case: guidelines (name, society, year, version, PDF link), statements quoted verbatim with section and page, page excerpts for the viewer, statements next to past decisions, PubMed literature and its search queries, and sources not retrieved; empty for the patients not structured in the mock. Fetched only while the layer is switched on; logged |
| GET | `/api/patients/:id/alerts` | Alerts with their acknowledgement (who, when) |
| POST | `/api/patients/:id/alerts/:i/ack` | Acknowledges alert `i` |
| GET | `/api/patients/:id/edits` | Current doctor edits by field key, and the append-only edit log |
| POST | `/api/patients/:id/edits` | Saves `{key, text, orig}`; doctors only |
| DELETE | `/api/patients/:id/edits/:key` | Reverts to the original; the log keeps both |
| GET | `/api/patients/:id/protocol` | The case's MDT discussion record (the "Projednání na MDT" card): mode, notes, conclusion draft, steps, deviations, and after approval the approver and the snapshot |
| PUT | `/api/patients/:id/protocol` | Saves the draft (mode, notes, conclusion, steps, deviations from the quoted recommendations) with the `version` it is based on; 409 for a stale version or once approved; changing the conclusion text needs a doctor |
| POST | `/api/patients/:id/protocol/new-version` | Starts a new conclusion that will supersede the approved one; 409 if there is no approved conclusion |
| GET | `/api/patients/:id/decisions` | Approved MDT conclusions, oldest first (append-only) |
| POST | `/api/patients/:id/decisions` | Approves `{version, text, steps, picked, dev, guide_on}`: checks the user is a doctor marked present and the version is current, stores a structured snapshot (patient record, attendance, edits, ticked report fields, deviations with their quote and citation), creates tasks and the e-mail. The client renders the frozen report from the snapshot with escaping; no HTML is stored, and switching the guideline layer off later does not change it |
| POST | `/api/patients/:id/report-downloads` | Logs that the user printed or saved the report (draft or approved); the client renders it |
| GET | `/api/session` | The running MDT session `{day, by, when}`, or `null` |
| POST | `/api/seminars/:day/session` | Starts the MDT for that day (doctor or coordinator; 403 for the administrator, 422 without a seminar or without booked cases); starting another day ends the running one; logged |
| DELETE | `/api/seminars/:day/session` | Ends the MDT ("Ukončit MDT"); 409 if that day's MDT is not running; logged |
| GET | `/api/seminars/:day/attendance` | Who is present, per department, for a seminar day (or `bez-terminu-:id`) |
| PUT | `/api/seminars/:day/attendance` | Saves the attendance; only staff of each department |
| GET | `/api/tasks?assignee=&owner=` | Tasks assigned to a person, plus tasks on cases they own; all tasks without parameters |
| PATCH | `/api/tasks/:id` | Marks a task done or not done |
| GET | `/api/mails` | Coordinator e-mails (case ID, count, link only) |
| GET | `/api/edits` | Doctors' edits across all cases; administrator only |
| GET | `/api/audit` | The access and change log; administrator only |
| GET | `/api/documents/:file` | The document's pages and which are empty |
| GET | `/api/documents/:file/pages/:n` | One page: image path and size, vision text, Tesseract words, the "ověřit" items with their character offsets in the text, and the redacted image with its redaction count and reasons; logged as a viewed source |
| POST | `/api/documents/:file/pages/:n/locate` | Where `{quote}` sits on the image (word boxes) and in the text (character range), with how it matched; the quote goes in the body, not the URL, because quotes can contain names |

### Guideline layer

The guideline statements, guideline page excerpts and PubMed literature
come from `src/data/guidelines-case-10*.json` and
`literature-case-10.json`, merged by `build.py` and embedded in the server
block. The client gets them only from
`GET /api/patients/:id/guidance`. A statement opens in a text drawer
with the quote marked and a link to the publisher's PDF at the cited
page; guideline PDFs are not bundled, so the page-image viewer is used
only for the patient's own documents. Deviations recorded in the
"Odchylky od doporučení" tab are saved with the discussion record and
frozen in the approval snapshot.

### Source view and page images

Clicking a reference [n] or "zdroj" opens the document viewer: the page
image with the quoted passage boxed in yellow, the "ověřit" tokens outlined,
a page switcher, zoom (fit width or 100 %), and a "Přepis stránky" tab with
the vision transcription and the same passage marked. The quotes in the
data come from the PDF's old text layer, with its misreads, so the server
matches them tolerantly (case, accents, punctuation, O/0 and l/1 folded;
exact run first, else the best window covering at least 60 % of the
quote; a window holding the quote's numbers wins, and a near tie or a
repeated quote is reported). Of the 209 distinct references in patient
10's case data, every quote is found in the transcription; 6 are not
boxed on the image because Tesseract skipped those lines (four on the
medication lines of page 2, "CT Ag plicnice" on page 5), and the viewer
says so. A page without a match shows "Citace nenalezena přesně,
zobrazena celá stránka".

The "ověřit" marks come from `scripts/build_page_index.py`, which aligns
the two readings word by word and records each item's character offsets
in the vision text. A digit, date, dose or stage is marked when Tesseract
read it differently, read it with low confidence, or did not read it at
all ("četl jen jazykový model"). Unmarked text is not verified; the page
image decides.

The images are not embedded. `build.py` copies
`data/derived/pages/<stem>/p<n>.png` and `p<n>.redacted.png` to
`mocks/pages/<stem>/`, and the page refers to them as
`pages/<stem>/p<n>.png`. Open `v3.html` from the `mocks/` folder; to
publish it, publish `pages/` with it. The redacted image (from
`scripts/redact_pages.py`) appears only when the doctor ticks "Co by
odešlo do cloudu (začerněno)", labelled as a demonstration of local
redaction; a page where the check found nothing says the check is
incomplete, and the quote and the transcription are hidden while the
redacted image is shown.

## Checks

- `src/test/v3.mjs`: clicks through mock v3 in Chromium with Playwright at
  1280 px and 400 px: filters, calendar and scheduling through the server,
  back/forward, edits, labs, the guideline layer, alert acknowledgement,
  deviations, the "Projednání na MDT" card (report picks, approval, the
  frozen report after attendance changes, edits and switching the
  guideline layer off, a new conclusion under the valid one), the MDT
  session (start dialog, session bar, switching cases on the same tab,
  attendance, ending it, starting from a case header, the redirect of old
  presentation and protocol links), role and copy checks on the
  `api`, the server's audit log, the source view (image, highlight inside
  the image, verify marks, zoom, transcription tab, page switch, redacted
  page, missing quote, missing page, empty page, zoom to the passage),
  every page of all ten documents, the audit entries for session navigation
  and report downloads, admin; then a run with `?latency=300`
  that types a conclusion and a task and approves at once. It reports JS
  and console errors and horizontal overflow
  (`PLAYWRIGHT_PATH=<node_modules/playwright-core> node mocks/src/test/v3.mjs`).
- `src/test/smoke.mjs`: clicks through every screen of v2 in jsdom and reports JS
  errors (`npm i jsdom@24.1.0` in a scratch folder, then
  `node smoke.mjs <path to v2.html>`).
- `src/test/w.mjs`: opens every screen in Chrome at 400 px width and prints
  the page width, to catch horizontal overflow (`npm i playwright-core`,
  needs Google Chrome installed).
