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
  `fixtures/data/mock-case-S01.json`.
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

In the app this patient is case `NO-S01` (route `/patient/S01/<tab>`), marked
"syntetický pacient" in the database and the header. It shows the
documents, the three missing-document alerts, the explicit MDT question,
and the "Vývoj v čase" lab matrix and chart, where each value opens its
line on its lab sheet. The e2e suite (`e2e/specs/patient-tabs.spec.ts`) checks the four draws,
the platelet value 54 of 12.5.2026, the chart following the picked test,
and that the value opens page 5 in the source viewer.

## S02_pacient: rectal cancer imported through "Nový pacient"

Why it exists: the demo shows how a new patient enters the app. The
presenter imports a FHIR referral ("Import z FHIR" in "Nový pacient") and
then drags in the patient's documents, one PDF per document, as a doctor
would receive them. S01 and FNO's patients arrive as one combined PDF, so
this patient also has the documents as separate files in `upload/`. In the
fixture data (`fixtures/data/mock-case-S02.json`) the case carries
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

On the API Worker (step 6) these files are registered fixtures: the
server recognises each one by the SHA-256 of its bytes, so a renamed copy
works and an edited file does not. Regenerated PDFs (`render_samples.py`)
are not guaranteed byte-identical, so the demo uses the committed files
or `fixtures/ukazka/S02-dokumenty.zip`; after regenerating, reseed. The
prepared data attaches only when all seven PDFs are uploaded and the
referral's name and birth number match; `api/scripts/e2e-intake.mjs`
runs that path against a Worker.

Pipeline check without an LLM (step 6, 2026-10-17, local Tesseract
5.5.3): re-reading the four lab sheets from the upload PDFs gives the 72
values of the prepared data; 41 read the same and 31 are marked "ověřit"
(Tesseract misreads units and codes, for example `10"9/|` for `10^9/l`
and `B LKC` for `B_LKC`), none differs without a mark. Every sheet is
judged "fair" for those misreads.

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

## S03_pacient: a poor scan with planted misreads

Why it exists: the failure case "a poor scan whose misread characters
change a value or a negation" needs a scan whose misreads we know exactly.
FNO's referrals are scans with a poor OCR text layer; S01 and S02 are clean
print.

Patient: Bořivoj Klenovský (fictional), born 7.11.1957, birth number
571107/1003, insurer 211. MUDr. Alena Brabcová, MUDr. Petr Vavřinec and
Mgr. Jitka Rybízková are fictional too.

Story: adenocarcinoma of the right upper lobe (EGFR wt, ALK negative, PD-L1
TPS 60 %), cT2a cN0 cM0 on CT 16.9.2026, COPD with FEV1 52 % and DLCO 48 %.
The report of 28.9.2026 asks the lung MDT whether the patient can have a
lobectomy or should have stereotactic radiotherapy.

| Page | File | Document |
|---|---|---|
| 1 | `01-ambulantni-zprava-2026-09-28.md` | Pulmonary outpatient report with the MDT question |
| 2 | `02-ct-hrudniku-bricha-2026-09-16.md` | CT of chest and abdomen |
| 3 | `03-laborator-2026-09-21.md` | Lab sheet, drawn 21.9.2026 07:40 |

`S03_pacient.clean.pdf` is the clean print; `S03_pacient.pdf` is the scan
made from it by `scripts/degrade_scan.py` with `damage.json`: five planted
defects (a dose 1,25 mg read as 4,25 mg, "neprokázáno" read as
"prokázáno", a draw date that no longer parses, potassium 5,8 read as 5,3)
on top of faded ink, noise, skew and strong JPEG compression. What each
defect does, what Tesseract read, and the misreads the wear made on its
own are in [`S03_pacient/GROUND-TRUTH.md`](S03_pacient/GROUND-TRUTH.md).

Built-in cases (beyond the planted defects):

- **Missing document:** the bronchoscopy (11.9.2026) and the histology
  (14.9.2026) are only quoted ("popis z NIS").
- **Critical fact for the question:** the MDT question rests on FEV1 and
  DLCO, which appear only in the report.
- **Recorded negative:** "DM neguje".

## S04_pacient: two patients in one referral

Why it exists: the failure case "two patients mixed up". A referral PDF
holds one page of another patient with the same surname.

Patient: Ludmila Vrbenská (fictional), born 3.2.1961, birth number
615203/1006, insurer 207. Page 4 belongs to Lenka Vrbenská (fictional),
born 18.4.1959, birth number 595418/1002, same insurer. MUDr. Markéta
Jedličková is fictional too.

Story: invasive carcinoma of the left breast NST, G2, ER 90 %, PR 70 %,
HER2 negative, Ki-67 25 %, cT2 cN0 cM0; the staging CT of 22.9.2026 shows
no distant metastases. The report of 5.10.2026 asks the breast MDT about
primary surgery versus neoadjuvant systemic therapy.

| Page | File | Document |
|---|---|---|
| 1 | `01-ambulantni-zprava-2026-10-05.md` | Oncology outpatient report with the MDT question |
| 2 | `02-histologie-biopsie-2026-09-15.md` | Core-cut biopsy histology |
| 3 | `03-ct-hrudniku-bricha-2026-09-22.md` | Staging CT of chest and abdomen, no metastases |
| 4 | `04-ct-bricha-2026-09-24.md` | **Another patient's** CT: progression of liver metastases, bone metastases L2 and L4 |
| 5 | `05-laborator-2026-10-01.md` | Lab sheet, drawn 1.10.2026 07:35 |

Built-in cases to check the assistant against:

- **Two patients:** page 4 names another woman (other first name, birth
  date and birth number). Its facts are quarantined, an identity alert
  names the page, and her metastases never become this patient's. The
  two CTs (22.9. and 24.9.2026) disagree about metastases; that is not a
  contradiction in one patient but two patients.
- **Missing document:** mammography and ultrasound of 2.9.2026 are only
  quoted ("popis z NIS").
- **Family history:** "matka karcinom prsu" is the mother's diagnosis
  (`subject: relative`), not the patient's.

## Expected outputs and the evaluation

`expected/<case>.json` holds what the pipeline must produce for each case:
S03 and S04 above, and S01, S02 and FNO's patient 10 as reference cases.
Each expectation names the failure case it tests (`failure_kind`: a
critical fact left out, a wrong date, a negation read as positive, two
patients mixed up, a missing report, a request without a result, a poor
scan, or `reference`), and describes a fact or an alert in the extraction
format (`docs/design/EXTRACTION-FORMAT.md`, `codebridge.extraction/2`)
that must be present or absent. The format document names the value
fields of each fact kind only in prose, so the names the expectations use
are listed in `VALUE_FIELDS` in `pipeline/eval.py`, and an expected file
naming any other field fails to load; reconcile the two when the JSON
Schema in `packages/domain` exists. Lab values are listed point by point
(S03, S04) or taken from the prepared case (`reference_labs`, the
human-checked `fixtures/data/mock-case-*.json`).

`pipeline/eval.py` runs the pipeline over the stored page readings and
reports per case and per failure kind (the README's "Document pipeline"
section has the commands). An expectation that needs a step the pipeline
does not have yet (diagnoses, requests, identity, missing reports) is
reported as `not_run`, never as a pass. A failure we know about carries
`known_failure` with the reason; CI fails on any other failure, and on a
known failure that starts to pass until its mark is removed.

State on 2026-10-19 (page reader without an LLM): only the lab, date and
readability expectations run. No lab value is shown clear but wrong;
S03's lab sheet is flagged as poorly readable and its undated values are
marked; one S03 value (`S_UREA`) is dropped silently by the lab parser
(known failure). All expectations for diagnoses, negations, identity,
missing reports and requests are `not_run` until the extraction exists.

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
5. `python3 fixtures/extract/build_case_s01.py` (S02:
   `build_case_s02.py`) writes
   `fixtures/data/mock-case-S01.json` from the page texts and fails if a
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
reads the synthetic patients' names from `fixtures/data/mock-case-S*.json`.

S03 and S04 are evaluation cases, not demo patients: they have no fixture
and are not in the app's page index. Their page readings go to
`samples/derived/pages/` instead of `data/derived/pages/` (pass
`--pages samples/derived/pages` to `render_samples.py` and
`--out samples/derived/pages` to `ocr_pages.py`), because the tests treat
every page under `data/derived` as a calibration page that is readable by
eye, which S03's scan is not. The page images (`p<n>.png`) are not
committed (`samples/derived/.gitignore`): the evaluation reads only the
text, and `ocr_pages.py` writes them again. S03 is rendered with
`--out samples/S03_pacient/S03_pacient.clean.pdf` and then degraded; the
three commands are in `S03_pacient/GROUND-TRUTH.md`. For S03, whose scan
differs from the text we wrote, `p<n>.truth.md` holds the written page
text in place of `p<n>.vision.md`, so it never passes for a reading of the
scan.

For S01 no redacted page images (`p<n>.redacted.png`) were produced:
`scripts/redact_pages.py` blacks out the name but leaves "nar. 12.3.1964",
"poj. 111" and the doctors' surnames on these pages, because its rules
expect a form label at the start of a line and blank only the first word
after a title.
