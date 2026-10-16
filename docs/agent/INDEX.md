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
  KOC (background knowledge, not stated in the talks; verify).

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

## Test data

- Challenge data arrives in the challenge's Slack channel (see
  [`HACKATHON.md`](HACKATHON.md)).
- SYNDERAI (https://synderai.net/) has synthetic EHDS examples: lab
  reports, patient summaries, discharge reports; no imaging or medication
  reports, oncology content unknown (FHIR/PHOENIX, page 6).
- The InterSystems "FHIR AI Hackathon Kit" preloads generated FHIR
  patients (FHIR/PHOENIX, rec2 01:50:29).

## Open questions

Record answers here as the team learns them.

- What format does FNO's documentation come in (PDF, scans, text exports,
  FHIR, CDA, DASTA)? Does it include earlier MDT minutes?
- Is the data anonymized or synthetic, and has FNO confirmed it may go to
  a cloud LLM? (Blocks the cloud LLM rule in `CLAUDE.md`.)
- Which diagnoses does the FNO MDT focus on? That decides the "missing
  documents" checklist beyond lung cancer.
- How is the challenge judged: idea or technical execution? Asked in chat,
  unanswered (HL7, chat 02:28:04).
- Which tech stack and which LLM deployment do we use?
- Do we read or produce FHIR, and do we also aim for the InterSystems
  prize? Record the decision in `HACKATHON.md`.
