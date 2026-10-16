# UI mocks

Throwaway, clickable mocks of the MDT Workspace, used to check the design
direction with the team (see [`docs/design/PRODUCT.md`](../docs/design/PRODUCT.md)).
They are static HTML pages with the data embedded; there is no backend.
All patient data is FNO's fictitious challenge data.

| Page | What it is | Published copy |
|---|---|---|
| `v1.html` | First simple mock (one patient workspace) | https://claude.ai/artifact/KraDQ9X7diVo93QzXtse6t |
| `v2.html` | Full mock after feedback round 1 (database, calendar, patient detail, presentation, protocol, tasks) | https://claude.ai/artifact/6F5AbN6vEAHJQgXP1fkUdc |
| `v3.html` | Mock after feedback round 2 (Excel-style filters, month navigation, 10-minute slots, brief first, diagnosis headline, current state, lab chart, doctor edits, back/forward); its source view shows the rendered page image with the cited passage highlighted, so publishing it also needs the `pages/` folder | https://claude.ai/artifact/6JwakCBuGZr9STKnfRUz8T |

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
`scripts/redact_pages.py`) appears only when the doctor ticks "Co by
odešlo do cloudu (začerněno)", labelled as a demonstration of local
redaction; a page where the check found nothing says the check is
incomplete, and the quote and the transcription are hidden while the
redacted image is shown.

## Checks

- `src/test/v3.mjs`: clicks through mock v3 in Chromium with Playwright at
  1280 px and 400 px (filters, calendar, back/forward, edits, labs,
  approval, the source view: image, highlight, verify marks, zoom,
  transcription tab, page switch, redacted page, access log, admin) and reports JS errors and horizontal overflow
  (`node mocks/src/test/v3.mjs`).
- `src/test/smoke.mjs`: clicks through every screen of v2 in jsdom and reports JS
  errors (`npm i jsdom@24.1.0` in a scratch folder, then
  `node smoke.mjs <path to v2.html>`).
- `src/test/w.mjs`: opens every screen in Chrome at 400 px width and prints
  the page width, to catch horizontal overflow (`npm i playwright-core`,
  needs Google Chrome installed).
