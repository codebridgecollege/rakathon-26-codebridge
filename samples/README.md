# Our own synthetic samples

Test cases written by the CodeBridge team during the hackathon. Everything
here is invented: the patients, the doctors, the documents and the values.
No sample is derived from real FNO data or from FNO's challenge data in
`data/`. FNO's fictitious patients stay in `data/rakathon-26/`.

Each folder is one patient, named `S<nn>_pacient` (S for synthetic, so it
never collides with FNO's `<n>_pacient.pdf`). It holds the source
documents as Markdown, one file per clinical document in the order they
appear in the PDF, and the rendered `S<nn>_pacient.pdf` (S02 also has
`upload/` with one PDF per document and the FHIR referral).

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

In mock v3 this patient is case `NO-S01` (route `#patient/S01`), marked
"syntetický pacient" in the database and the header. It shows the
documents, the three missing-document alerts, the explicit MDT question,
and the "Vývoj v čase" lab matrix and chart, where each value opens its
line on its lab sheet. `mocks/src/test/v3.mjs` checks the four draws, the
platelet row (268, 54, 131, 97) and that the 12.5.2026 value opens page 5
at "B_PLT: 54 10^9/l [150 ... 400]".

## S02_pacient: rectal cancer imported through "Nový pacient"

Why it exists: the demo shows how a new patient enters the app. The
presenter imports a FHIR referral ("Import z FHIR" in "Nový pacient") and
then drags in the patient's documents, one PDF per document, as a doctor
would receive them. S01 and FNO's patients arrive as one combined PDF, so
this patient also has the documents as separate files in `upload/`. In the
mock data (`mocks/src/data/mock-case-S02.json`) the case carries
`"intake_demo": true`, so the app hides it from the patient list until it
is created through "Nový pacient"; each document names its upload file
(`upload_name`), and `fhir_referral` holds the same Bundle as
`upload/zadost-fhir.json`.

Patient: Věra Lipenská (fictional), born 14.6.1958, birth number
585614/4019 (valid format for a woman: month + 50, divisible by 11, not a
real person's as far as we know), insurer 111. The surgeon MUDr. Ondřej
Habrman, the oncologist MUDr. Iveta Lomnická, the endoscopist MUDr. Radek
Sýkora, the pathologist MUDr. Kamil Rosický and the lab's Mgr. Petra
Šindelářová are fictional too.

Story: adenocarcinoma of the rectum (6-11 cm from the anal verge), G2,
MMR proficient, found at colonoscopy on 9.3.2026 (biopsy report
12.3.2026). Staging MRI of the pelvis 16.3.2026 cT3b cN1, CT of chest and
abdomen 17.3.2026 without distant metastases, so cT3b cN1 cM0 before
treatment. Neoadjuvant chemoradiotherapy 7.4. to 18.5.2026 (50,4 Gy in 28
fractions with capecitabine), restaging MRI 20.7.2026 with regression, low anterior resection with TME and a
protective ileostomy 11.8.2026; the resection specimen (report 21.8.2026)
is ypT2 ypN0 (0/14), R0, CRM 9 mm, TRG 2. In 9/2026 a high-output stoma
caused dehydration with a creatinine rise. CEA fell to normal after
surgery and rose again on 6.10.2026; a CT was requested on 7.10.2026. The
report of 8.10.2026 asks the colorectal MDT about adjuvant chemotherapy,
the work-up of the rising CEA (PET/CT?) and the timing of ileostomy
closure.

| Page | File (upload PDF has the same stem) | Document |
|---|---|---|
| 1-2 | `01-ambulantni-zprava-2026-10-08.md` | Surgical outpatient report with the MDT question |
| 3 | `02-histologie-biopsie-2026-03-12.md` | Biopsy histology with MMR immunohistochemistry |
| 4 | `03-histologie-resekat-2026-08-21.md` | Histology of the resection specimen after neoadjuvant CRT |
| 5 | `04-laborator-2026-03-10.md` | Lab sheet, drawn 10.3.2026 07:25 |
| 6 | `05-laborator-2026-06-02.md` | Lab sheet, drawn 2.6.2026 07:40 |
| 7 | `06-laborator-2026-09-15.md` | Lab sheet, drawn 15.9.2026 07:30 |
| 8 | `07-laborator-2026-10-06.md` | Lab sheet, drawn 6.10.2026 07:20 |
| - | `upload/zadost-fhir.json` | FHIR R4 referral (Bundle of type collection: Patient, insurer Organization, Coverage, referring Organization, PractitionerRole, ServiceRequest with the MDT question and a short history) |

Unlike S01, the order is chronological by document type, because the
upload files are dropped in one by one; the page numbers above are those
of the combined `S02_pacient.pdf`. Each upload PDF numbers its own pages
from 1.

Built-in cases to check the assistant against (expected behaviour):

- **Lab trend from documents:** 18 tests at four draws (KO, urea,
  creatinine, Na, K, liver tests, albumin, CRP, CEA, CA 19-9). CEA
  (µg/l, ref. 0 ... 5): 14,8 (10.3.2026), 5,8 (2.6.2026), 2,9 (15.9.2026),
  9,6 (6.10.2026), high, high, normal, high. CA 19-9 (kU/l, ref.
  0 ... 37): 48,2, 31,5, 19,4, 27,8. Creatinine (µmol/l): 66, 71, 104, 78.
  Haemoglobin (g/l): 108, 112, 116, 124.
- **Like with like, no contradiction:** cT3b cN1 cM0 (clinical, imaging,
  3/2026, before therapy) and ypT2 ypN0 (0/14), R0 (pathological, after
  neoadjuvant therapy, 21.8.2026) are two different kinds of stage at two
  times. A tool that calls this a contradiction is wrong. The values
  quoted in the report (Hb 108, creatinine 104, the four CEA values) match
  the lab sheets.
- **Missing document:** the staging MRI of the pelvis (16.3.2026) is only
  quoted ("popis z NIS"); the radiologist's report is not attached. The
  colonoscopy (9.3.2026), the staging CT (17.3.2026), the restaging MRI
  (20.7.2026) and the operation protocol (11.8.2026) are also only
  quoted, and there is no record of the MDT of 20.3.2026 and no
  radiotherapy or oncology summary of the chemoradiotherapy. All are
  in `data_gaps`.
- **Referral with no result:** CT of chest, abdomen and pelvis requested
  on 7.10.2026 ("t.č. výsledek nemáme"); it must show as requested, not
  done.
- **Recorded negatives vs. findings:** "DM neguje", "Bolesti břicha
  neguje", "Kašel neguje", "AA: neguje" are the doctor's recorded
  negatives; "Lymfovaskulární invaze neprokázána" and "0/14 lymfatických
  uzlin s metastázou" are histological findings.
- **Diagnosis confirmed by histology:** the biopsy report of 12.3.2026 is
  the point of confirmation; it states that the depth of invasion cannot
  be assessed in the biopsy.

The text is clean print, not a scan; it does not exercise OCR misreads
beyond what Tesseract does on its own: it reads `10^9/l` as `10"9/|`
and M0/N0/R0 as MO/NO/RO, which the page index marks "ověřit", and µ
as "u" (`ug/l`), which it does not mark because the unit has no digit.

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
5. `python3 mocks/src/extract/build_case_s01.py` (S02:
   `build_case_s02.py`) writes
   `mocks/src/data/mock-case-S01.json` from the page texts and fails if a
   quote is not verbatim on its page, if a bold value is not out of range
   (or the reverse), or if a test changes unit or reference range between
   draws.

For S02 the steps are the same with `samples/S02_pacient`; step 2 adds
`--upload samples/S02_pacient/upload`, which also writes one PDF per
document (`<md stem>.pdf`). On macOS, where the Debian font package is
missing, point `SAMPLE_FONTS` at a folder with Liberation Sans 2.1.5
(`LiberationSans-*.ttf` from the liberation-fonts release). S02 was
redacted on its own (`scripts/redact_pages.py --pages <folder holding
only S02_pacient>`): its name and birth number are blacked out, the date
after "nar." is not (same rule limitation as below). The redaction script
reads the synthetic patients' names from `mocks/src/data/mock-case-S*.json`.

For S01 no redacted page images (`p<n>.redacted.png`) were produced:
`scripts/redact_pages.py` blacks out the name but leaves "nar. 12.3.1964",
"poj. 111" and the doctors' surnames on these pages, because its rules
expect a form label at the start of a line and blank only the first word
after a title.
