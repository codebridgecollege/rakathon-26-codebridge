# Talk notes: analysis of the oncology patient's path

> Settled guidance from this note is folded into [`CLAUDE.md`](../../CLAUDE.md),
> [`docs/agent/INDEX.md`](../agent/INDEX.md), and
> [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md). This note keeps the full detail.

- **Talk title:** "Analýza cesty onkologického pacienta" (analysis of the
  oncology patient's path). The title slide frames it as block 2 of an
  educational course "Systémová koordinace cesty pacienta" (system-wide
  coordination of the patient's path), dated "Leden 2026" (January 2026)
  [slide 1].
- **Speaker:** Aleš Tichopád, ČVUT Health Data Lab (Czech Technical
  University) [slide 1] [slide 2]. He says he analyses large healthcare
  datasets and that he and colleagues also work with the Ministry of Health
  [rec1 00:02:08]. The file name says FBMI (the ČVUT Faculty of Biomedical
  Engineering).
- **Moderator:** Tomáš Studeník (speaker_1 in the transcript, "caelestinus"
  in the chat) [rec1 00:04:09] [rec1 00:55:17].
- **Audience question:** Šárka Fajtlová, Národní onkologické centrum Brno
  (National Oncology Centre Brno), speaker_2 [rec1 00:50:21].
- **Sources:**
  - Deck: `docs/sources/presentations/Analyza_cesty_onkologickeho_pacienta_FBMI_final.pptx`
    (52 slides). Slide numbers below refer to this deck.
  - Transcript ("rec1"):
    `docs/sources/presentations/GMT20261015-072521_Recording.elevenlabs.md`
    (Czech, automatic, speaker labels sometimes merge people).
  - Zoom chat ("chat1"):
    `docs/sources/presentations/GMT20261015-072521_RecordingnewChat.txt`.
    Chat times run about 13 minutes ahead of the recording times (the
    "presentation disappeared" messages at chat1 00:22:13 and 00:32:26
    match the interruptions at rec1 00:09:32 and 00:19:00) (inference).
- **Transcript range:** rec1 00:00:00 to 00:57:51. The talk itself runs to
  about 00:49:13, then questions until 00:57:48. The next speaker (Michal
  Opatřil, eHealth) starts at 00:57:51. There are Zoom screen-sharing
  breaks at 00:09:32 and 00:19:00 to 00:24:28.

Many slides are charts or images whose text was not extracted. I opened the
images for slides 23, 26, 27, 30, 31, 32, and 38 and describe them where
they matter. Slides 2, 3, 4, 10, 14, 25, 28, 29, 37, 39, 41, and 43 are
mostly images I did not inspect in detail. The speaker skipped most of the
later slides (33 to 51), saying "Těch slidů je tu relativně hodně, na to já
je přeskáču" ("there are quite a lot of slides, I will skip them")
[rec1 00:47:13]. Slides 44 to 51 (the "Výzva 1-4" proposals, the
extraction design, and the legal notes) were not presented aloud, but they
are in the deck shared on Slack [chat1 01:02:14] [chat1 01:08:26].

## Summary

Aleš Tichopád explained, for a technical audience, why cancer care is a
race against time: tumours develop over years from precancerous stages,
are made of competing cell clones, and change between one year and the
next, so screening, fast diagnosis, and coordinated care matter
[rec1 00:08:12] [rec1 00:15:57]. He separated the "patient pathway"
(clinical trajectory, a sequence of recorded events in the health system)
from the "patient journey" (the patient's personal experience)
[slide 15] [rec1 00:24:28]. His group reconstructs the clinical trajectory
from insurance claims and hospital information systems as discrete dated
events, some of which are milestones and some irrelevant [slide 21]
[rec1 00:24:28]. He described the multidisciplinary team (MDT) as a key
step where surgeon, oncologist, and radiologist decide together, which the
patient is entitled to, but which in practice is sometimes just a phone
call and is often not recorded [rec1 00:28:31] [rec1 00:43:12]. Data shown
for Czech hospitals, including FN Ostrava, show large differences in how
many lung cancer patients have an MDT in their pathway, and a survival
curve that is better for patients with an MDT [slide 38]. Waiting times
are long: after a first bronchoscopy, only 42% of patients reach surgery
within 6 weeks [slide 27]. The deck ends with design principles for
extracting information from documentation (source link, date, uncertainty
flag, human check, audit) and test scenarios such as a lost result and an
extraction error on a negated finding [slide 49] [slide 50]. In the
questions, Šárka Fajtlová named secure data exchange between hospitals
with different information systems as the most painful problem, and the
speaker answered that exchange should run on HL7 FHIR [rec1 00:50:21]
[rec1 00:53:45].

## Guidance for our challenge

### Standards and data formats

- Use HL7 FHIR as the exchange format we design towards. The speaker said
  "My potřebujeme výměnný systém a to je HL7 FHIR" ("we need an exchange
  system, and that is HL7 FHIR") and that exchange between providers
  "by měla probíhat těmi standardy, o kterých se tu mluvilo" ("should run
  on the standards discussed here") [rec1 00:53:45].
- Do not treat OMOP as the exchange format. The speaker said he talks a lot
  about OMOP (the transcript writes "OMOPu"), but that it is for analytics
  and data warehouses, not exchange [rec1 00:53:45].
- Expect the clinical trajectory to come from two kinds of source:
  administrative care reported to insurers, and the hospital information
  systems directly [rec1 00:24:28].
- The payer (claims) data that describes a patient path has five
  dimensions: diagnosis code ("ICD"), drug ("DRUG"), medical examination
  ("MED.EXAM"), the specialty of the provider ("HCP SPEC."), and time
  [slide 21]. These are useful fields for our timeline events (inference).
- Diagnoses are coded with ICD-10 codes, for example K50 (Crohn's disease)
  and K51 (ulcerative colitis) on the IBD slides [slide 42].
- Model the timeline as discrete events "v čase s nějakým odstupem a s
  nějakou informační náplní" ("in time, with some gap between them and some
  information content"), and mark which events are milestones. Events
  unrelated to the cancer (an eye exam, a dentist visit) are not milestones
  [rec1 00:24:28]. For our timeline this suggests keeping all events but
  highlighting oncology milestones (inference).
- The analytic event codes on the charts are: BX (bronchoscopy), MDT,
  SX (surgery), PHT (pharmacotherapy), PHT_NEO (neoadjuvant
  pharmacotherapy), RT (radiotherapy), FLT (first-line treatment), DEATH,
  and CENSOR (follow-up data ended, outcome unknown) [slide 23] [slide 30]
  [rec1 00:39:10]. They are a ready-made set of event types for a
  lung/breast timeline (inference).

### The MDT meeting and clinical workflow

- What the MDT is for: "Odborníci více oborů lékařských se sejdou a budou
  posuzovat ten stav toho pacienta, jeho výhled a jeho následné kroky"
  ("specialists from several medical fields meet and assess the patient's
  condition, outlook, and next steps"), so that the surgeon, oncologist,
  and radiologist can each say how they could help [rec1 00:28:31].
- The patient is entitled to an MDT ("Na to má ten pacient nárok"), and it
  should be a standard part of the pathway [rec1 00:28:31].
- MDT meetings are often hybrid now rather than in one room, and there is
  "velké množství informace, co vstupuje na jednu hromadu" ("a large amount
  of information that lands on one pile") that must be combined
  [rec1 00:28:31]. This is the problem our assistant addresses (inference).
- The MDT is "jakýsi právní akt" ("a kind of legal act") and should have a
  defined procedure and a written record ("postup, zápis"), but this does
  not always happen; some "MDTs" are one doctor phoning another
  [rec1 00:28:31] [rec1 00:43:12]. Our output should therefore not assume
  that earlier MDT minutes exist in the record (inference).
- The MDT is where expensive drugs and innovations get chosen, so missing
  MDT expertise means patients may not get innovative treatment
  [rec1 00:28:31] [rec1 00:30:31].
- Where the MDT sits in the path: suspicion, diagnosis with histology and
  staging, then a care plan chosen by the expert team with the patient,
  then treatment and follow-up; on recurrence the path returns to
  decision-making [slide 18] [slide 16] [rec1 00:26:30]. The seven-step
  oncology trajectory (prevention and early detection, first symptoms and
  referral, diagnosis/staging/treatment planning, treatment, follow-up and
  recovery, recurrence or metastatic disease, end-of-life care) is a
  ready-made list of timeline phases [slide 17] [rec1 00:32:32]
  (inference for the use).
- In the lung cancer care algorithm, the MDT follows bronchoscopy or
  another biopsy (PET-CT, CT- or ultrasound-guided biopsy, EBUS,
  thoracoscopy), and the flowchart notes "musí být staging" ("staging must
  be done") at the MDT step. After the MDT the diagnosis and options are
  told to the patient, and pneumo-oncology makes the final treatment
  decision [slide 32]. This gives a concrete list of documents to expect
  before a lung cancer MDT: imaging, histology, staging (inference).
- The same flowchart sets target times: all examinations within 7 to 14
  days, ideally ordered within 3 days of first contact; a preliminary
  histology report within 1 week and results within 14 days; a missing CT
  ordered within 24 hours with a date within a week, at most 14 days
  [slide 32]. These could feed a "time since" display, but see the
  caution on fixed deadlines below (inference).
- After a bronchoscopy, 45.57% of 5,819 lung cancer patients went to an
  MDT, after a median of 20 days; from the MDT, 44.98% went to
  pharmacotherapy (median 20 days) and 23.45% to surgery (median 26 days)
  [slide 23].
- The disease changes over time: "nádor, který ten člověk měl před rokem,
  už často není tím stejným nádorem, kterým je dneska" ("the tumour the
  person had a year ago is often not the same tumour they have today")
  [rec1 00:15:57]. Older findings may be out of date, so the summary
  should show the date of each finding (inference).
- Patients often need more than one bronchoscopy (sometimes three or
  four), which wastes time [slide 26] [rec1 00:41:11]. Repeated procedures
  of the same kind are worth showing on the timeline (inference).
- Patients are mostly elderly: incident lung cancer patients peak at 65 to
  74 years, and the speaker said "lidech sedmdesát let a výše" ("people
  seventy and older") [slide 22] [rec1 00:36:33].
- Care coordinators are often not doctors ("nekvalifikovanej nelékař",
  "an unqualified non-doctor", his deliberately blunt phrase) and may know
  little about the process, so the process logic should live in the system
  [rec1 00:45:12].
- Treatment plans and care algorithms should ideally sit in the hospital
  information system ("NIS") and guide the doctor [slide 32]
  [rec1 00:45:12].

### What is often missing or contradictory in the record

- Histology can be done in a lab outside the treating site, so the tissue
  sample travels; it can get lost, the result can take long, and "Neví se,
  kde je výsledek" ("nobody knows where the result is"). Results may go by
  ordinary post [rec1 00:06:12]. A missing histology report is a realistic
  "missing document" case (inference).
- The speaker's own preventive CT scan got lost [rec1 00:06:12].
- "Odeslaná žádanka ještě neznamená objednané a dokončené vyšetření" ("a
  sent request does not yet mean a booked and completed examination")
  [slide 20] [rec1 00:34:32]. A referral in the record without a matching
  result should be flagged as possibly missing (inference).
- A missing result, a refusal, or a no-show should create a task for the
  coordinator [slide 20] [rec1 00:36:33].
- The MDT is often not reported ("nemají ho nebo ho nemají aspoň
  vykázanej", "they don't have one, or at least it isn't reported"), so it
  is unclear whether it happened and what form it took [rec1 00:43:12].
- Information travels on paper with the patient, often incompletely filled
  in, "protože ta informace tam často není" ("because the information is
  often not there") [rec1 00:52:46].
- Test scenario "Ztracený výsledek" (lost result): the examination took
  place but the report is missing; the system should catch it and say who
  handles it [slide 50].
- Test scenario "Chyba extrakce" (extraction error): the document states a
  negated finding or an old date; the system keeps the source and asks for
  verification [slide 50].
- A negative or incomplete result must not automatically close a case
  [slide 44].

### Data access and infrastructure

- Hospitals do not share the same information systems or unified paths,
  so documents must be forwarded and shared between institutions
  [rec1 00:50:21].
- A national solution is expected to be an "afinitní doména" (affinity
  domain, a shared document-exchange domain), which is planned but not yet
  in place [rec1 00:50:21].
- Building national exchange is the work of the "Národní centrum pro
  elektronizaci zdravotnictví" (National Centre for eHealth)
  [rec1 00:53:45].
- Coordination tools attached to each hospital information system are only
  a partial answer, because the problem is the exchange between them
  [rec1 00:52:46].
- The speaker called the situation "pláč nad chybějící elektronizaci
  zdravotnictví" ("crying over missing eHealth") and said the Czech system
  is not digitized [rec1 00:06:12] [rec1 00:53:24].

### Privacy, legal, and safety constraints

- Extraction should run in four steps: authorized input (verified source,
  patient identity, purpose of access); select only the fields needed for
  the task; check (link to the source, date, an uncertainty flag, a human
  verifies critical data); handover and audit (roles set the scope, log
  access, changes, and retention) [slide 49]. This matches our "every claim
  points to its source" rule and adds an explicit uncertainty flag
  (inference).
- "Původní klinická zpráva zůstává dohledatelná" ("the original clinical
  report stays findable") [slide 49].
- Extraction can run inside the provider's environment and expose only the
  structured output [slide 49, speaker notes]. This supports a local or
  hospital-hosted model setup (inference).
- "OCR a jazykové modely mohou chybovat" ("OCR and language models can make
  mistakes"). Evaluate especially: omitted critical information, a wrong
  date, negation, and confusing one patient with another
  [slide 49, speaker notes].
- Data minimization does not replace a legal basis; access rights,
  encryption, audit, deleting working copies, and whether a DPIA (data
  protection impact assessment) is needed must cover the whole life cycle.
  GDPR articles 5, 25, 28, 32, 35 [slide 49, speaker notes].
- Access to documentation is based on the real work role and need for care;
  the label "coordinator" alone grants nothing [slide 48].
- An app vendor acting as a processor needs a contract under GDPR article
  28, and the contract does not widen what users may access [slide 48].
- For each processing step a team needs a legal basis under GDPR article 6
  and a condition under article 9, plus confidentiality and a retention
  period. Consent is not a universal substitute for a legal basis
  [slide 48, speaker notes].
- Czech law: Act No. 372/2011 Coll. (zákon o zdravotních službách),
  especially § 45(2)(g), § 51(2)(a), and §§ 65 to 66, checked as of
  15 October 2026 [slide 48, speaker notes] [slide 51].
- The Czech data protection authority (ÚOOÚ) has a Q&A page for healthcare:
  https://uoou.gov.cz/verejnost/qa-otazky-a-odpovedi/zdravotnictvi
  [slide 48, speaker notes].
- Even "harmless" functional data can reveal health information, so it
  still needs a legal basis and protection [slide 47, speaker notes].
- Keep clinical decisions with the authorized clinician: "Klinická
  rozhodnutí zůstávají u oprávněného zdravotníka" [slide 20]. This matches
  our "the assistant prepares, the doctor decides" rule (inference).
- Prototypes should use synthetic cases [slide 44, speaker notes]
  [slide 50, speaker notes].

### Recommended practices and pitfalls

- Do not present a fixed waiting time as safe. "Čtyři týdny nejsou
  univerzální bezpečná čekací doba" ("four weeks is not a universally safe
  waiting time"); deadlines come from the specific diagnosis and plan
  [slide 50]. If we show intervals between events, show them as facts, not
  as a verdict (inference).
- The Hanna et al. finding (each 4-week delay in starting treatment is
  associated with higher mortality) comes from observational studies for
  selected indications and is not the same effect for every patient
  [slide 24] [slide 50, speaker notes].
- Separate necessary clinical preparation from avoidable organisational
  delay when measuring waiting [slide 50, speaker notes].
- Measure prototypes on: time to the next step, share of completed tasks,
  errors, and the coordinator's time; also track false alerts [slide 50]
  [slide 44].
- The software must distinguish these terms [slide 19]:
  - "Suspekce" (suspicion): reasonable suspicion, the tumour may not be
    confirmed yet.
  - "Histologie a staging": tissue examination determines the tumour type;
    staging describes the extent of the disease.
  - "MDT": the multidisciplinary team recommends the next step.
  - "Remise a recidiva" (remission and recurrence): signs of disease recede
    or return; remission still needs follow-up.
  - "KOC a ROC": comprehensive and regional oncology centre.
  Our summary should label the disease status with these distinctions and
  never present a suspicion as a confirmed diagnosis (inference).
- A suspected cancer may turn out not to be cancer; the diagnosis is
  confirmed in the end by the histopathology finding [rec1 00:26:30]. The
  deck's lung cancer cohort is defined by the first histologically
  confirmed bronchoscopy [slide 22]. Use the histology date as the
  confirmed-diagnosis anchor on the timeline (inference).
- Patients may not understand their own pathway (for example a referral to
  an "osteoonkolog" they have never heard of) [rec1 00:36:33].
- Expect low acceptance of rigid systems [rec1 00:55:04] (attribution
  uncertain, see open points).

### Other useful facts

- Screening programmes: breast screening every two years, sometimes yearly
  (speaker unsure) [rec1 00:11:56]. Different entry points: abnormal
  screening finding (breast), suspicious imaging (lung), positive
  screening test (colorectal) [slide 44].
- Breast cancer time to treatment (2020 to 2022, without RT) is shown by
  stage and by route of detection (DIG = diagnostic, SCR = screening) and
  treatment type (SX, PHT_NEO, PHT) [slide 30].
- Share of lung cancer patients reaching first treatment after the first
  bronchoscopy: surgery 21% within 4 weeks, 42% within 6, 61% within 8;
  radiotherapy 23%, 36%, 47%; pharmacotherapy 31%, 53%, 70% [slide 27].
  Recommended: surgery within 4 weeks [slide 27] [slide 35].
- PD-L1 testing (a biomarker test that guides immunotherapy) was almost
  absent in 2018 to 2020 and about a third of patients in 2021, with large
  regional differences [slide 31] [rec1 00:43:12].
- Median days from first to second bronchoscopy range from 14.5 (South
  Moravian region) to 34 (Karlovy Vary region) [slide 26].
- KOC (Komplexní onkologické centrum, comprehensive cancer centre) handles
  complex diagnostics, decisions, and highly specialised procedures;
  regional care handles checkups, long-term follow-up, and selected
  treatment closer to home. His group tests reinforcement learning to
  decide at which milestone a patient benefits from KOC versus regional
  care [slide 33] [rec1 00:45:12].
- Source for the KOC/regional split: ČVUT press release, 25 September 2026,
  "Centralizovat bychom neměli pacienta, ale péči, která centralizaci
  potřebuje" [slide 33, speaker notes] [slide 51].
- Coordination applies beyond oncology: IBD, diabetes, stroke, heart attack
  [slide 39] [rec1 00:47:13].
- The Ministry of Health publishes clinical guidelines ("doporučené
  postupy"), and companies want to turn them into digital procedures
  [rec1 00:34:32].

## Directly about challenge 2

The talk does not mention the FN Ostrava challenge or an MDT assistant by
name. These are the passages closest to it:

- **MDT data for FN Ostrava.** Slide 38 ("MDT v průběhu léčby", MDT during
  treatment, at sites that started the first therapy) shows the share of
  lung cancer patients with an MDT in their pathway per hospital, 2018 to
  2021. "Fakultní nemocnice Ostrava, N = 478" is one of the hospitals; by
  eye its MDT share is roughly 70 to 85% across those years, among the
  higher ones (my visual estimate from the chart). Other sites range down
  to under 25% (FN Brno; "KZ, a.s. - Masarykova nemocnice"). The same slide shows
  a survival curve where patients with an MDT do better (log-rank
  p < 0.0001) [slide 38].
- **Why the MDT exists:** "Odborníci více oborů lékařských se sejdou a budou
  posuzovat ten stav toho pacienta, jeho výhled a jeho následné kroky"
  ("specialists from several fields meet and assess the patient's state,
  outlook, and next steps") [rec1 00:28:31].
- **Room for MDT tools:** "tam je velkej prostor opravdu vytvořit řešení pro
  multidisciplinární týmy ... i sledování, trackování, protože tady je jako
  velké množství informace, co vstupuje na jednu hromadu a nějakým způsobem
  se s tím musí zamíchat" ("there is real room to build solutions for
  MDTs ... and for tracking, because a large amount of information lands on
  one pile and has to be combined somehow") [rec1 00:28:31].
- **MDT as a recorded act:** "je to vlastně jakýsi proces, který by měl mít
  svůj legatis[?], postup, zápis" ("it is a process that should have its
  [unclear word], procedure, minutes") [rec1 00:28:31].
- **Missing MDT records:** "Všichni by měli mít multidisciplinární tým, jo,
  a nemají ho nebo ho nemají aspoň vykázanej" ("everyone should have an
  MDT, and they don't, or at least it isn't reported") [rec1 00:43:12].
- **Extraction output example:** "Příklad výstupu: další krok, termín,
  odpovědné pracoviště, chybějící podklady a praktická omezení. Původní
  klinická zpráva zůstává dohledatelná." ("Example output: next step, date,
  responsible department, missing documents, and practical constraints. The
  original clinical report stays findable.") [slide 49]. Note that
  "chybějící podklady" (missing documents) is the exact phrase from our
  challenge text.
- **Check step:** "Odkaz na zdroj, datum a označení nejistoty. Člověk ověří
  kritické údaje." ("Link to the source, date, and an uncertainty flag. A
  human verifies critical data.") [slide 49].
- **Lost result:** "Vyšetření proběhlo, ale zpráva chybí. Systém zachytí
  problém a určí, kdo jej řeší." ("The examination took place but the
  report is missing. The system catches the problem and says who handles
  it.") [slide 50].
- **Extraction error:** "Dokument uvádí negovaný nález nebo starý termín.
  Systém zachová zdroj a vyžádá ověření." ("The document states a negated
  finding or an old date. The system keeps the source and asks for
  verification.") [slide 50].
- **Lab-related:** the speaker notes on slide 30 mention cholesterol testing
  being highest during hospitalization and dropping after discharge
  [slide 30, speaker notes]. This is the only lab-value remark, and it
  seems to belong to a different chart (see open points).
- **Timeline:** the clinical trajectory as "diskrétní události v čase s
  nějakým odstupem a s nějakou informační náplní" ("discrete events in time
  with a gap and an information content"), some of them milestones
  [rec1 00:24:28].

## Questions and answers

- **Šárka Fajtlová (NOC Brno), comment and question** [rec1 00:50:21]:
  Patient documents must be forwarded and shared between institutions that
  run different hospital information systems and have no unified paths.
  She called this the most pressing problem and hoped for a solution that
  is secure, fits cybersecurity and GDPR, and is simple for doctors,
  coordinators, and patients, before the planned national affinity domain
  arrives. She noted that implementation into hospital systems takes a
  year or more [rec1 00:52:22].
- **Answer, Aleš Tichopád** [rec1 00:52:46] [rec1 00:53:45]: Fully
  relevant; his faculty trains coordinators and discusses exactly this.
  Attaching coordination tools to hospital systems is only partly
  satisfying, because information travels with the patient on paper, often
  incomplete. Exchange should use HL7 FHIR; coordinators will be employees
  of healthcare facilities, not freelancers; national exchange is the job
  of the National Centre for eHealth; OMOP is for analytics, not exchange.
  He framed it as a challenge for the Rakathon ("To je vlastně výzva pro
  ten Rakathon").
- **Follow-up remark** [rec1 00:55:04]: "Který to obejde, ale já mám jako
  velký obavy, že ta akceptace toho rigidního systému bude jako nízká"
  ("[a solution] that works around it, but I am very worried that
  acceptance of the rigid system will be low").
- **Availability:** The speaker will be at the Prague venue in Motol on
  Friday from about mid-morning; the organizers will add him to Slack and
  post his phone number so teams in Brno and Ostrava can consult remotely
  [rec1 00:56:18] [rec1 00:56:41] [rec1 00:57:20].
- **Chat:** Jiří Pölzer asked whether the recording will be available
  [chat1 00:14:47]. Vít Tuček asked for the slides; the moderator
  ("caelestinus") put them on Slack and confirmed "Je to tam" ("it's
  there") [chat1 01:01:42] [chat1 01:02:14] [chat1 01:08:26].

## Open points

Moved to [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
