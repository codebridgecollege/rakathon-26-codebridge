# Our own synthetic samples

Test cases written by the CodeBridge team during the hackathon. Everything
here is invented: the patients, the doctors, the documents and the values.
No sample is derived from real FNO data or from FNO's challenge data in
`data/`. FNO's fictitious patients stay in `data/rakathon-26/`.

Each folder is one patient, named `S<nn>_pacient` (S for synthetic, so it
never collides with FNO's `<n>_pacient.pdf`). It holds the source
documents as Markdown, one file per clinical document in the order they
appear in the PDF, and the rendered `S<nn>_pacient.pdf`.

## S01_pacient: glioblastoma with lab values over time

Why it exists: FNO's challenge PDFs hold at most one lab panel per patient,
so the "Vývoj v čase" (trend) view of the lab tab had no real series to
show. This patient's documentation holds four dated lab sheets.

Patient: Radovan Křemínek (fictional), born 12.3.1964, insurer 111, no birth
number (left out on purpose: the documents do not need one). The treating
doctor MUDr. Hana Modřínová and the lab's Mgr. Tomáš Javorník are fictional
too.

Story: glioblastoma, IDH-wildtype, CNS WHO grade 4, MGMT methylated, left
frontal lobe, diagnosed 12/2025 after a seizure. Subtotal resection
2.12.2025, chemoradiotherapy after Stupp (60 Gy in 30 fractions with
temozolomide) 12.1. to 20.2.2026, deep vein thrombosis 24.2.2026 treated
with full-dose enoxaparin, six cycles of adjuvant temozolomide with a dose
reduction after grade 2 thrombocytopenia (12.5.2026), dexamethasone
restarted 15.7.2026 with steroid hyperglycaemia, a creatinine rise from
8/2026, and progression by RANO criteria on MRI 29.9.2026. The latest
report (6.10.2026) asks the neuro-oncology MDT about re-resection,
re-irradiation or second-line lomustine, and about the anticoagulation.

| Page | File | Document |
|---|---|---|
| 1-2 | `01-ambulantni-kontrolni-2026-10-06.md` | Outpatient follow-up report with the MDT question |
| 3 | `02-laborator-2026-10-06.md` | Lab sheet, drawn 6.10.2026 07:30 |
| 4 | `03-laborator-2026-08-04.md` | Lab sheet, drawn 4.8.2026 07:45 |
| 5 | `04-laborator-2026-05-12.md` | Lab sheet, drawn 12.5.2026 07:35 |
| 6 | `05-ambulantni-vstupni-2026-01-08.md` | First outpatient oncology report |
| 7 | `06-laborator-2026-01-08.md` | Lab sheet, drawn 8.1.2026 07:40 |

The newest report comes first, as in FNO's referral PDFs. Each lab sheet
prints one test per line in the form of FNO's lab printouts (`S_CREAE: 142
µmol/l [59 ... 104]`, NČLP-style codes such as `B_PLT`, `S_GLC`,
`PT(KIDN)_EGFRCKDE`), with the draw date and time, and out-of-range values
in bold. Units and reference ranges are the ones in FNO's patient 10.

Built-in cases to check the assistant against (expected behaviour):

- **Lab trend from documents:** 13 tests at four draws; platelets 268, 54,
  131, 97 (10^9/l), creatinine 78, 91, 117, 142 (µmol/l), glucose 7,8,
  5,4, 12,9, 11,2 (mmol/l). Every value has its page and quote in
  `mocks/src/data/mock-case-S01.json`.
- **Missing document:** the MRI of 29.9.2026 is only quoted in the report
  ("popis z NIS"); the radiologist's report is not attached. Histology
  (9.12.2025) and the operation (2.12.2025) are also only quoted.
- **Referral with no result:** PET/CT with 18F-FET was requested on
  1.10.2026 ("t.č. výsledek nemáme"); it must show as requested, not done.
- **Recorded negatives:** "DM neguje", "AA: neguje", "Paroxysmy neguje"
  are the doctor's recorded negatives; "LDK bez otoku" is a finding.
- **Suspicion vs. confirmed:** MRI 14.7.2026 says pseudoprogression versus
  progression; only the MRI of 29.9.2026 concludes progression by RANO.
- **No contradiction planted:** values quoted in the 6.10.2026 report (PLT
  97, creatinine 142, eGFR 0,79, glucose 11,2, K 5,34; PLT 54 on
  12.5.2026; glucose 12,9 on 4.8.2026) match the lab sheets. A tool that
  reports a contradiction here is wrong.

The text is clean print, not a scan; it does not exercise OCR misreads.

## How it was generated

1. The Markdown documents were written by hand (by Claude Code, for the
   team) in the style of FNO's outpatient reports and lab printouts.
2. `uv run scripts/render_samples.py samples/S01_pacient` renders them to
   `samples/S01_pacient/S01_pacient.pdf` (A4, Liberation Sans, a footer
   "SYNTETICKÝ DOKUMENT" on every page) and writes each page's Markdown as
   `data/derived/pages/S01_pacient/p<n>.vision.md`. That file stands in
   for the vision model's transcription: we wrote the text, so no model
   read the page.
3. `uv run scripts/ocr_pages.py samples/S01_pacient/S01_pacient.pdf`
   writes the page images (`p<n>.png`, 150 dpi) and Tesseract's words and
   boxes (`p<n>.tess.tsv`), as for FNO's PDFs.
4. `uv run scripts/build_page_index.py` adds `S01_pacient.pdf` to
   `data/derived/page-index.json`. Tesseract reads the unit `10^9/l` as
   `10"9/|` or `1099/1`, so those lines carry "ověřit" marks, as they would
   on a real printout.
5. `python3 mocks/src/extract/build_case_s01.py` writes
   `mocks/src/data/mock-case-S01.json` from the page texts and fails if a
   quote is not verbatim on its page, if a bold value is not out of range
   (or the reverse), or if a test changes unit or reference range between
   draws.

No redacted page images (`p<n>.redacted.png`) were produced:
`scripts/redact_pages.py` blacks out the name but leaves "nar. 12.3.1964",
"poj. 111" and the doctors' surnames on these pages, because its rules
expect a form label at the start of a line and blank only the first word
after a title.
