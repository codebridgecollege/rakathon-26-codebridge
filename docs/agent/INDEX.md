# Agent index - CodeBridge

Facts about the problem, the domain, and the standards. Operating rules are
in [`CLAUDE.md`](../../CLAUDE.md); hackathon logistics are in
[`HACKATHON.md`](HACKATHON.md). Facts below cite the research notes in
[`docs/research/`](../research/), which in turn cite the slide or
timestamp in [`docs/sources/`](../sources/).

Research notes used here (all dated 2026-10-16):

- [oncology patient path](../research/2026-10-16-talk-oncology-patient-path.md)
  (Aleš Tichopád, ČVUT), cited as "path"
- [Czech eHealth](../research/2026-10-16-talk-czech-ehealth.md) (Michal
  Opatřil), cited as "eHealth"
- [HL7 and FHIR intro](../research/2026-10-16-talk-hl7-fhir-intro.md)
  (Hynek Kružík, HL7 CZ), cited as "HL7"
- [Azure and logistics](../research/2026-10-16-talk-azure-and-logistics.md)
  (Microsoft), cited as "Azure"
- [FHIR workshop and PHOENIX](../research/2026-10-16-talk-fhir-workshop-and-phoenix.md)
  (InterSystems; Luc Chatty, HL7 Europe), cited as "FHIR/PHOENIX"

"rec1" and "rec2" are the morning and afternoon Zoom recordings of the
pre-hack day (15 October 2026); times point into their transcripts in
`docs/sources/presentations/`. Slide and page numbers point into the
decks in the same folder.

## The challenge

Rakathon 2026, challenge 2, set by Fakultní nemocnice Ostrava (FNO).
Original text:

> **2. AI asistent multidisciplinárního týmu**
>
> Uvolněte lékařům ruce od zdlouhavého dohledávání informací před jednáním
> multidisciplinárního týmu. Vytvořte AI asistenta, který z dostupné
> dokumentace sestaví stručné shrnutí pacienta, časovou osu léčby, vývoj
> laboratorních hodnot a přehled nálezů. Současně zvýrazní zásadní změny,
> rozpory a chybějící podklady.

Translation:

> Free doctors from the slow work of looking up information before a
> multidisciplinary team meeting. Build an AI assistant that, from the
> available documentation, puts together a short patient summary, a
> timeline of the treatment, how lab values changed, and an overview of
> findings. At the same time, it highlights significant changes,
> contradictions, and missing documents.

No organizer talk discussed challenge 2 by name. The facts below come from
talks about the domain and the standards.

## What an MDT meeting is

A multidisciplinary team (MDT, Czech "multidisciplinární tým", also called
a seminar or commission) is a meeting where specialists such as the
surgeon, oncologist, and radiologist assess
one patient's condition, outlook, and next steps together (path, rec1
00:28:31).

- **Where it sits in the patient's path:** suspicion, then diagnosis with
  histology and staging, then the MDT recommends a treatment plan, then
  treatment and follow-up; on recurrence the path returns to the MDT
  (path, slides 16 to 18).
- **What must be ready before it:** for lung cancer, the care flowchart
  says staging must be done before the MDT, which means imaging and
  histology (path, slide 32). This is our first checklist for "missing
  documents".
- **It is often poorly recorded.** The patient is entitled to an MDT, and
  it should have minutes, but some "MDTs" are a phone call and many are
  not reported at all (path, rec1 00:43:12). Do not assume earlier MDT
  minutes exist.
- **Cases are quick, data is scattered.** MDTs are often hybrid, and "a
  large amount of information lands on one pile" (path, rec1 00:28:31).
- **FNO runs MDTs for most of its lung cancer patients.** A chart of
  2018 to 2021 data shows FNO among the hospitals with a high share of
  patients reviewed at an MDT, and patients with an MDT survive longer
  (path, slide 38; the share is read by eye from a chart).

### From Soňa's experience

Soňa is the oncologist on our team; these facts come from the team's
design discussion of 16 October 2026. Citations point into
[`docs/sources/design/`](../sources/design/README.md): `[design-N
hh:mm:ss]` is recording N, `[chatgpt P hh:mm]` is Soňa's prompt in her
ChatGPT brainstorm. The speaker mapping is in
[`PRODUCT.md`](../design/PRODUCT.md#sources-and-speaker-mapping). Items
marked "Juro's recap" are Juro restating an unrecorded conversation with
Soňa.

- **What the MDT decides.** It synthesizes what each specialty brings,
  then decides whether the patient can tolerate a treatment (surgery,
  chemotherapy, immunotherapy given the comorbidities) and the intent:
  radical (aim to cure) or palliative (relieve symptoms) [design-1
  00:00:16].
- **The diagnosis does not fix the treatment.** A frail patient with the
  same diagnosis gets different treatment; decisions are case by case.
  Some teams see the patient in person, most do not [design-1 00:03:03;
  design-2 00:08:04].
- **Performance status gates treatment.** Scored with Karnofsky or
  performance status (0 fully fit, 4 bedridden): "we treat up to 2, and 3
  with half-closed eyes" [design-1 00:03:42]. Check her description of
  the grades against the ECOG definition before using it in UI text.
- **Preparing a case today.** A new patient comes with about 12
  documents (biopsy and histology, surgery, CT, ultrasound, PET). The
  oncologist reads them and writes a condensed summary: diagnosis, TNM
  stage, metastases, surgeries and why, other relevant diagnoses. This is
  the time-consuming part [design-1 00:21:06, 00:22:33, 00:13:20].
- **The "diagnosis" part of an oncology report is the running record.**
  Oncologists keep adding exam results to it, and it is what matters for
  the MDT; visit notes and the plan do not [design-1 00:23:40, 00:24:58].
- **A case is introduced in about two lines** [design-1 00:25:19].
- **Session size and time.** A session covers about 15 to 40 patients
  [design-1 00:08:18]. Common cases are decided in about ten seconds, a
  complicated one in about five minutes, and a small share of rare
  diagnoses takes many times longer because someone must search the
  literature (guidelines, cohort papers, case reports in PubMed) by hand;
  a case owner should prepare that beforehand [design-3 00:00:00,
  00:00:52, 00:01:58]. Time per patient is an open question (see
  [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md#ask-soňa)).
- **When a patient returns.** On partial remission the oncologist goes on
  treating; on progression a change of treatment needs MDT approval
  [design-1 00:25:19]. The same patient can be presented many times.
- **An MDT can run without every document**; sometimes the gap is the
  question, and the outcome is "complete the exam and present again"
  [chatgpt P 15:54]. Before an MDT only part of the path is known, unlike
  a retrospective guideline audit where the whole path is known [chatgpt
  P 09:24].
- **Who attends.** Members mostly hold standing positions; some know all
  patients, others only their own (Juro's recap) [design-1 00:14:16].
  Each department has a set of specialties with known doctors [chatgpt
  P 14:33]. The neuro-oncology MDT records at the start of the day who
  represents neurosurgery and neuroanaesthesia [design-1 00:41:13].
- **Case owner.** The referring doctor owns the case: Soňa says the owner
  and the referring physician are the same person [design-1 00:38:30;
  chatgpt P 14:36].
- **Radiologist and pathologist.** Their findings are in their reports,
  and they may add spoken comments [design-1 00:42:56]. A pathologist may
  project the slide live from a microscope and brings the glass slides
  [design-2 00:04:00].
- **How the meeting runs** (Juro's recap): the lead doctor presents,
  others comment, the team concludes, ideally books the next step, writes
  the conclusion, moves on. Most attendees have a laptop, some take notes
  on paper [design-1 00:16:16]. The room is quiet and focused [design-1
  00:48:30].
- **Where documents come from.** Results from other sites often arrive
  by email as PDFs; the rest is downloaded from the NIS (hospital
  information system); someone assembles and uploads them [design-1
  00:30:26; design-2 00:07:19, 00:08:19]. Imaging lives in PACS (the
  imaging archive) [design-1 00:20:52].
- **After the meeting** a coordinator tells the patient where and when to
  come, how to prepare, and which blood tests come first [design-1
  00:33:10; chatgpt P 14:51].
- **How Czech oncology summaries are written.** TNM and markers in the
  heading line, one dated bullet per exam, abbreviations (st.p., SD, PR,
  neoCHT, pCR), partial dates ("4/2025", "08/25"), and a condensed
  one-paragraph form for the MDT. Anamnesis sections: osobní, rodinná,
  pracovní, sociální, farmakologická, alergologická, abusus,
  epidemiologická; "neguje" is the doctor's recorded negative [chatgpt
  P 14:33]. Use this style for synthetic samples.

Unverified, from ChatGPT only (confirm with Soňa or FNO before relying on
them):

- Neuro-oncology MDTs track the integrated WHO diagnosis with IDH,
  1p/19q, and MGMT; MRI location, extent, enhancement, and edema;
  extent of resection, radiotherapy, systemic treatment; KPS or ECOG,
  neurological deficit, seizures, steroids, antiepileptics; response by
  RANO criteria, and pseudoprogression versus progression [chatgpt
  R 12:14, R 14:33]. There is no universal TNM requirement for primary
  brain tumours [chatgpt R 15:52].
- The newest document is not always the most relevant: an older
  definitive histology may matter more than a newer outpatient note
  [chatgpt R 11:54].
- A list of MDT bottlenecks (late referrals, too little time, dominant
  senior voices, decisions not turned into tasks) [chatgpt R 10:29]. Soňa
  said this list came from ChatGPT, not her experience [design-2
  00:11:34]; use it only to explain the problem.

## Why the record has gaps and contradictions

These are normal, so the assistant reports them as facts, not errors.

- Histology may run in another lab; samples and results can get lost or
  arrive by post (path, rec1 00:06:12).
- A sent request does not mean the examination happened (path, slide 20).
- Records are often half paper, half electronic, and information travels
  with the patient on paper, often incomplete (eHealth, rec1 01:04:05;
  path, rec1 00:52:46).
- Hospitals often hold duplicate patient records with the same birth
  number (eHealth, rec1 01:16:43).
- The tumour changes over time: "the tumour the person had a year ago is
  often not the same tumour they have today" (path, rec1 00:15:57). A new
  assessment adds to the history; the stage at diagnosis is not the
  current state (HL7, slides 11 and 13).
- A negative or incomplete result must not automatically close a case
  (path, slide 44).

## Required outputs and how to model them

Each output links every fact to its source document (see `CLAUDE.md`).
The two right-hand columns are **our proposed mapping**, built from the
Common Cancer Model concepts (HL7, slides 11 to 15), the PHOENIX slide's
"illustrative FHIR resource choices" (FHIR/PHOENIX, page 10), and the
eHealth prototype slide (eHealth, page 19). No official mapping exists
yet: only the patient part of the Common Cancer Model has FHIR profiles
(HL7, slide 16), and the HL7 notes warn that the comparison is not a
ready conversion table (slide 20 notes).

| Output | Czech term | Common Cancer Model concept (proposed) | FHIR R4 resource (proposed) |
|---|---|---|---|
| Patient summary | stručné shrnutí pacienta | CancerPatient, CancerConditionAtDiagnosis, CancerStage | Patient, Condition, Observation |
| Treatment timeline | časová osa léčby | Surgery, Radiotherapy, SystemicTreatment, ActiveSurveillance, LastFollowUp | Procedure, MedicationAdministration, Encounter, CarePlan |
| Lab value trends | vývoj laboratorních hodnot | (not in the model) | Observation, DiagnosticReport |
| Findings overview | přehled nálezů | Imaging, CancerStage evidence | DiagnosticReport, Specimen, Observation |
| Significant changes | zásadní změny | ClinicalCancerProgression, OverallCancerTreatmentResponse | Observation |
| Contradictions | rozpory | (our own check) | - |
| Missing documents | chybějící podklady | (our own check) | DocumentReference, Task |

Timeline phases that the speakers used: diagnosis, staging, treatment,
response, follow-up (FHIR/PHOENIX, page 7); or in more detail, prevention
and screening, first symptoms and referral, diagnosis and staging,
treatment, follow-up, recurrence, end-of-life care (path, slide 17).

### Building the timeline

- Keep every dated event, but highlight oncology milestones; an eye exam
  or dentist visit is not a milestone (path, rec1 00:24:28).
- Show repeated procedures of the same kind; patients often need two to
  four bronchoscopies (path, slide 26).
- Event types the analysts use: BX (bronchoscopy), MDT, SX (surgery), PHT
  (pharmacotherapy), PHT_NEO (neoadjuvant pharmacotherapy), RT
  (radiotherapy) (path, slide 23).

### Finding missing documents

The expected documents depend on the diagnosis and the step. Sources for
the checklist:

- Lung cancer before an MDT: imaging, histology, staging (path, slide 32).
- A stage implies its evidence: a clinical stage needs imaging, a
  pathological stage needs surgery or histology (HL7, slides 11 and 15).
- A referral or request without a matching result (path, slide 20).
- The EHDS priority record types (patient summary, discharge report,
  imaging report, lab report) are a general checklist (HL7, rec1 01:42:41).
- The oncology path deck's example output for each case: next step, date,
  responsible department, missing documents, practical constraints
  (path, slide 49).

### Reading lab values

Lab results are interpreted against biological sex and the lab's own
reference range, so keep the range from the source document instead of
computing one (HL7, rec1 01:48:45).

### Terms to keep apart

From path, slide 19:

- **Suspekce** (suspicion): the tumour may not be confirmed yet.
- **Histologie a staging**: histology confirms the tumour type; staging
  describes how far it has spread.
- **Remise a recidiva** (remission and recurrence).
- **Clinical vs pathological stage**: clinical comes from imaging,
  pathological from surgery and histology; both can exist for one tumour
  (HL7, slide 15).
- **KOC / ROC**: comprehensive and regional oncology centre. FNO hosts a
  KOC (background knowledge, not stated in the talks; see
  [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)).

## Standards we follow

| Topic | Use | Source |
|---|---|---|
| Data exchange | HL7 FHIR R4, pinned version | all talks; HL7, rec1 01:40:39 |
| Czech profiles | https://hl7.cz/fhir (core guide 1.0.0) | HL7, slide 8; eHealth, page 15 |
| Oncology concepts | HL7 Europe Common Cancer Model 1.0.0-ballot, https://hl7.eu/fhir/cancer-common/ (draft; FHIR profiles exist only for the patient part) | HL7, slide 10; FHIR/PHOENIX, page 9 |
| Oncology FHIR patterns | mCODE STU4 4.0.0, https://hl7.org/fhir/us/mcode/STU4/ (US-based; adapt) | HL7, slide 19 |
| Lab test codes | NČLP (national lab code list), not LOINC | eHealth, rec1 01:23:56; HL7, rec1 01:54:48 |
| Diagnoses | MKN-10 (Czech ICD-10) | eHealth, rec1 01:23:56 |
| Other clinical codes | SNOMED CT where the source has it; it is little used today outside radiology, and the two speakers disagree on whether to recommend it | HL7, rec1 01:54:48 |
| Document lookup | IHE MHD, a standard API to publish, find, and fetch documents (ITI-65 publish, ITI-67 find, ITI-68 retrieve), stubbed | eHealth, page 12 |
| EU direction | EHDS (the EU regulation on sharing health data) and its exchange formats, EEHRxF; the patient summary is a priority record type | eHealth, page 6; HL7, rec1 01:42:41 |
| Not for new work | DASTA, proprietary interfaces, OMOP for exchange (OMOP is a research-database model) | HL7, rec1 02:02:25; path, rec1 00:53:45 |

The Czech definition of the patient summary (an EHDS priority category) is
on the Ministry of Health wiki:
https://mzcr.atlassian.net/wiki/spaces/EPZS/pages/203096069/Standardy+EHR+-+prioritn+kategorie
(eHealth, page 6). Check it before designing our summary layout.

## Czech legal frame

- The provider's medical record is its legal record; nobody else may
  change it. Documents are "made accessible" (zpřístupnit) to authorized
  people, and permission and clinical purpose are checked at access
  (eHealth, page 10).
- Laws in force: Act 372/2011 (health services), Act 325/2021 (eHealth)
  with Act 236/2025, Decree 444/2024 (what medical documentation contains), GDPR articles 5,
  6, 9, 25, 28, 32, 35 (eHealth, page 4; path, slides 48 and 49). Planned
  2027 to 2029 obligations are only a draft.
- EHDS separates "primary use" (care of one patient) from "secondary use"
  (research); an MDT assistant is primary use (eHealth, page 5; the
  classification is our inference).

## The challenge data

FNO's archive, received 16 October 2026, is in `data/rakathon-26/`.
FNO's challenge deck calls it "documentation of fictitious patients with
sample oncology cases" (`docs/sources/presentations/2 - FN Ostrava – AI asistent multidisciplinárního týmu.pptx`, slide 8; see
[`HACKATHON.md`](HACKATHON.md)). What FNO expects us to build is listed
in [`REQUIREMENTS.md`](REQUIREMENTS.md). The MDT is
**neuro-oncological**: the patient PDFs are about brain and spine
findings (glioblastoma, meningioma, brain metastases, spinal cord lesions,
and non-oncological differentials such as vertigo or stroke).

- `2_AI asistent MDT/<n>_pacient.pdf`, ten patients: referrals to the MDT,
  one to five pages each. Most pages are a faded background image with
  the readable text drawn on top in fonts; some fonts have broken
  character maps, so extracted text differs from what the page shows
  ("Ambulantnf vyletfenf" for "Ambulantní vyšetření"). Read the rendered
  page, not the text layer or the embedded image; see
  [the OCR evaluation](../research/2026-10-16-ocr-evaluation.md). Expect
  mixed layouts, tables, partial dates, and free text. Five (11, 17, 18, 19, 20) are filled-in consultation
  request forms (see the next item); the others are outpatient or
  radiology reports, presumably sent as the request's attachments.
- `Struktura MDT protokolu_FNO.docx`: FNO's consultation request form,
  which a referring doctor fills in to bring a patient to the MDT. It is
  the input of a case, not a database schema. Readable copy, with field
  types:
  [`konzultace-pacienta-form.json`](../sources/fno/konzultace-pacienta-form.json).
  Fields: patient identity (name, birth number, insurer), history
  (anamnéza), imaging, current clinical state, the referring doctor and
  department, attachments, and the question for the MDT ("Otázka na
  NOCO").
- `Upresneni vystupu AI asistenta pro MDT.docx`: FNO's description of the
  expected output (renamed from a garbled file name; readable copy in
  [`docs/sources/fno/`](../sources/fno/upresneni-vystupu-ai-asistenta.md)).
  The output is **twofold**:
  1. a **presentation app** used during the MDT: an interactive,
     schematic, readable view with "wiki" style links, showing patient
     identity, a short case summary, and expandable items (clinical
     finding, imaging, histology, past treatment, the current question for
     the MDT), ideally with a switchable timeline view; members click an
     item to see detail when they have questions;
  2. a **PDF report** for the medical record or for a request for further
     examination or treatment, containing the patient identity and the
     fields ticked in the presentation app.
- `samples/*.xlsx`: four exports of ten fully synthetic general-oncology
  patients (PAC001 to PAC010; colorectal and breast cancer among them):
  outpatient reports, discharge reports, operation protocols, histology
  findings (HTML in a cell). They show FNO's export column names. They are
  different patients from the PDFs.
- There are no separate lab result files; any lab values appear only
  inside the PDF text.

Where the data lives at FNO (deck slide 3): NIS (medical records), LIS
(lab results), PACS (imaging), INTELIPAT (pathology), and the genetics
lab. Today a doctor or coordinator searches them by hand.
FNO's NIS supports FHIR (Juro, from the team, 2026-10-17), so a pilot can
read patients, documents and staff from it over FHIR.

## Other test data
- SYNDERAI (https://synderai.net/) has synthetic EHDS examples: lab
  reports, patient summaries, discharge reports; no imaging or medication
  reports, oncology content unknown (FHIR/PHOENIX, page 6).
- The InterSystems "FHIR AI Hackathon Kit" preloads generated FHIR
  patients (FHIR/PHOENIX, rec2 01:50:29).

## Open questions

All open questions are in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
