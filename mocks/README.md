# UI mocks

Throwaway, clickable mocks of the MDT Workspace, used to check the design
direction with the team (see [`docs/design/PRODUCT.md`](../docs/design/PRODUCT.md)).
They are static HTML pages with the data embedded; there is no backend.
All patient data is FNO's fictitious challenge data, except the synthetic
patient S01 (mock v3, case ID `NO-S01`), whom the team invented
([`samples/README.md`](../samples/README.md)).

| Page | What it is | Published copy |
|---|---|---|
| `v1.html` | First simple mock (one patient workspace) | https://claude.ai/artifact/KraDQ9X7diVo93QzXtse6t |
| `v2.html` | Full mock after feedback round 1 (database, calendar, patient detail, presentation, protocol, tasks) | https://claude.ai/artifact/6F5AbN6vEAHJQgXP1fkUdc |
| `v3.html` | Mock after feedback round 2 (Excel-style filters, month navigation, 10-minute slots, brief first, diagnosis headline, current state, lab chart, doctor edits, back/forward), with one patient view for the whole MDT: a session bar with the day's cases and a "Projednání na MDT" card for notes, next steps and approval; its source view shows the rendered page image with the cited passage highlighted, so publishing it also needs the `pages/` folder. Round 19 added task drafts from approved conclusions with a coordinator view and a digest e-mail, out-of-hours booking, retrospective deviations with doctor-set severity, and strength-sorted guideline quotes. Round 20 added a status menu with history and "Uzavřít případ", one-button approval for the team, the report picks in a dialog behind "Stáhnout report (PDF)", and a lighter new patient form. Round 21 made guideline statements collapsed entries (quote and tier chip, opening to the reason with sources and the full citation), moved the MDT deviations table under them in "Navrhovaný postup", quoted the guideline edition valid at each past decision in "Retrospektivní odchylky", and replaced the inline missing list with a warning-styled "Upozornění" button. Round 23 added "Personál pracoviště": staff entered as title and surname, saved only in the viewer's browser (localStorage `mdt-staff-v1`, fictional defaults, "Obnovit výchozí"), from which attendance and the user picker are built. Round 24 added the synthetic patient S01 (marked "syntetický pacient", with its documents, missing-document alerts and a lab trend from four documented draws, every value linked to its line), removed the invented lab series of case 10, merged the reason and the question into one paragraph with the draft chip at its end, listed every passage a drafted question cites, and drew our own scalpel icon for surgery | https://claude.ai/artifact/6JwakCBuGZr9STKnfRUz8T |

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

## Timeline categories

Mock v3 uses the nine categories documented in
[`PRODUCT.md`](../docs/design/PRODUCT.md#timeline-categories). The `category`
field on each timeline card is display metadata; original dates, kinds,
sources and plan status are preserved. The compact summary shares the icons.
Lucide 0.468.0 paths are embedded in the template, with the ISC notice in
`src/vendor/lucide-LICENSE`; no icon CDN is needed at runtime.

## Checks

- `node mocks/src/test/timeline-categories.mjs`: category filters, preserved source indexes, partial and missing dates, planned status, and escaped labels.

- `src/test/v3.mjs`: clicks through mock v3 in Chromium with Playwright at
  1280 px and 400 px (filters, calendar, back/forward, edits, labs,
  approval, the source view: image, highlight, verify marks, zoom,
  transcription tab, page switch, redacted page, access log, admin, and the
  round 19 checks: logo, unscheduling by drag, out-of-hours booking, compact
  summary dates, alert labels, strength order, retrospective severity,
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

