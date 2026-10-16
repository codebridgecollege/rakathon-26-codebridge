# Talk notes: HL7 Rakathon 2026, introduction (FHIR and oncology data models)

> Settled guidance from this note is folded into [`CLAUDE.md`](../../CLAUDE.md),
> [`docs/agent/INDEX.md`](../agent/INDEX.md), and
> [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md). This note keeps the full detail.

Working notes extracted from one organizer talk. They may contain transcription
errors; check the sources before turning a point into a rule.

## Header

- **Talk title:** "HL7: propojené informace pro zdravotnictví. Rakathon 2026 / Úvod" (deck file name "HL7_Rakathon_2026 _ úvod-1").
  Subtitle on slide 1: "Společný jazyk zdravotnických dat" (a common language for health data) and "Organizace, standardy a onkologická data. Evropský Cancer Common a mCODE".
- **Speaker:** Hynek Kružík (speaker_4 in the transcript). External interoperability expert for NCEZ (Národní centrum elektronického zdravotnictví, the Czech national eHealth centre), partly responsible for its terminology server, technical lead of HL7 Česká republika and its representative in HL7 Europe [rec1 01:32:37].
  The host's introduction is transcribed as "Hynek Kůrůžník" [rec1 01:30:33]; the previous speaker, Michal Opatřil, names him "Hynek Kružík" [rec1 01:23:56], so "Kružík" is the likely spelling.
- **Host:** speaker_1 (Rakathon moderator), who also reads the audience question and asks one himself.
- **Sources:**
  - Deck: `docs/sources/presentations/HL7_Rakathon_2026 _ úvod-1.pptx` (23 slides). Slide numbers below are the slide's position in the file (1 to 23). The footer labels printed on the slides do not match the position (for example slides 11 to 13 are all labelled "11", slides 14 to 18 are all labelled "12").
  - Transcript: `docs/sources/presentations/GMT20261015-072521_Recording.elevenlabs.md`, cited as `[rec1 hh:mm:ss]` (the timestamp of the transcript block that contains the statement; blocks are about 2 minutes long).
  - Zoom chat: `docs/sources/presentations/GMT20261015-072521_RecordingnewChat.txt`, cited as `[chat hh:mm:ss]`. Chat times run about 12.5 minutes ahead of recording times: the chat question posted at chat 02:19:32 is read aloud at rec1 02:06:59.
- **Transcript time range:** host introduces the speaker at 01:30:33; the talk runs 01:32:09 to 02:05:30; questions 02:05:30 to 02:11:39; the host's closing remarks for the morning run to the end of the recording at about 02:14:41.
- **Slides that are images:** slides 11 (conceptual model diagram), 12 (logical model class diagram), 14 (CancerPatient class), 15 (CancerStage class), 16 (mapping table to FHIR), 17 (mapping table to OMOP) and 23 (HL7 Europe meeting in Málaga) carry their content as pictures. The text export shows them as empty or nearly empty; I read the images from the .pptx and describe them below.
- **Speaker notes:** the deck has written speaker notes with target timings (20 minutes total, sources "ověřeno 10. 10. 2026", that is checked on 10 October 2026). The speaker did not read them aloud; he spoke freely and skipped some slides [rec1 01:40:39]. Notes are cited as `[slide N notes]`. Slides 12 and 13 repeat the notes of slide 11, and slides 15 to 18 repeat the notes of slide 14.

## Summary

HL7 International is a non-profit that writes health data exchange standards; its newest standard, FHIR, describes health data as small linked records called resources (Patient, Condition, Observation and so on) exchanged as JSON or XML over a web API [slide 2, slide 7, rec1 01:34:38].
Europe and the Czech Republic use FHIR R4 today, with a move to R6 expected in about a year; Czech implementation guides at https://hl7.cz/fhir are built to validate against the European profiles too [slide 8, rec1 01:40:39, rec1 01:42:41, rec1 01:56:48].
The EHDS regulation (European Health Data Space) will force suppliers of systems that handle discharge reports, lab reports, imaging reports, patient summaries, and ePrescriptions to offer a FHIR interface [rec1 01:42:41].
For oncology, HL7 Europe is drafting the Common Cancer Model (ECCDM), a logical model of what must be recorded about a cancer patient: diagnosis and stage, treatment episodes, progression, treatment response, and follow-up [slides 10 to 13, rec1 01:44:41].
It is still a ballot draft (1.0.0-ballot), and only the Patient part is mapped to FHIR and OMOP so far [slide 10, slide 16, slide 17, rec1 01:52:47].
The American mCODE guide (STU4, 4.0.0) already gives concrete FHIR profiles for oncology and is expected to feed the European profiles; the two complement each other [slides 19 and 20, rec1 02:00:24].
On terminology, the speaker says new Czech profiles move to SNOMED CT everywhere except lab test codes, which stay on NČLP; this differs from the previous speaker's advice [rec1 01:54:48].
His practical advice to teams: do not build a proprietary interface and do not use DASTA for new work; start from FHIR's basic resources and the terminologies they use [rec1 02:02:25, rec1 02:09:23].
The only data-access question (a FHIR token for test data) was deferred to the afternoon Microsoft and InterSystems workshops [rec1 02:06:59].

## Guidance for our challenge

### Standards and data formats

- **HL7 is a family of standards, so ask which one.** V2 sends event messages (admission, orders, results), CDA (Clinical Document Architecture) sends whole clinical documents such as a discharge report or patient summary, and FHIR exchanges linked data records. They run side by side in hospitals, so a team should not expect every system to offer the same kind of interface [slide 6, slide 6 notes, slide 3 notes].
- **V2 is still used mainly in the US and between lab devices and clinical systems; Europe mostly uses V3 CDA; all European countries are expected to move to FHIR** [rec1 01:38:39]. The speaker called FHIR "Fast Health Information Resources" here, a slip; the correct name is Fast Healthcare Interoperability Resources [slide 7].
- **FHIR version: use R4.** Europe currently builds on R4; some European countries already implemented R5; a move to R6 is expected, the speaker estimates within about one year [rec1 01:40:39, rec1 01:56:48]. NCEZ publishes a REST API based on FHIR R4, and the oncology sources in the talk (Cancer Common, mCODE) are R4 [slide 8, slide 8 notes, slide 19].
- **Pick a fixed published version, not a continuous build**, because continuous builds change. The talk uses Cancer Common 1.0.0-ballot and mCODE STU4 4.0.0 [slide 22 notes].
- **FHIR basics.** A resource is a standard data record describing one thing: Patient (the person), Condition (a diagnosis), Observation (a measurement or assessment). References link related records. Formats are JSON or XML [slide 7, slide 7 notes]. FHIR has dozens of resources, including RelatedPerson, Observation, compositions and bundles, which combine "jako kostičky Lega" (like Lego bricks) into profiles for domains such as a discharge report, a lab order, or a lab result [rec1 01:38:39].
- **Resources not discussed.** DiagnosticReport, DocumentReference and CarePlan were not mentioned on the slides or in the talk. Composition and Bundle were only named in passing [rec1 01:38:39].
- **The 80/20 rule.** A base resource should cover about 80 percent of common needs out of the box; the other 20 percent is added by profiling and by extensions [rec1 01:40:39]. A profile narrows a general resource for a specific purpose [slide 19 notes].
- **FHIR covers more than data records**: server operations, search, terminology services, and security such as signing documents and bundles [rec1 01:36:38]. Its search and analysis operations mean the same tooling can serve secondary use (studies, analytics), though OMOP is the established standard for research data [rec1 01:36:38, rec1 01:38:39].
- **Czech implementation guides.** HL7 Česká republika publishes national profiles and guides for clinical information that are compatible with the EU specification: https://hl7.cz/fhir and the core guide at https://hl7.cz/fhir/core/1.0.0/en/index-cs.html [slide 8, slide 20 notes]. Czech guides are either derived from the European ones or declare compatibility, so the Czech validator also validates against the European profiles [rec1 01:42:41].
- **European layering.** Everything sits on HL7 FHIR R4. Above it, HL7 EU Base (also called the Core profile) defines reusable pieces once, for example one Patient definition and one binding to code systems. Domain guides sit on top: on slide 18 these are EU DR, EU MDR, EU Img, EU PS, EU PMD, EU CCM, plus an HL7 EU API guide and mCODE as an international input [slide 18, rec1 01:56:48]. The acronyms are not expanded in the talk; by context EU PS is the patient summary, EU Img imaging, and EU CCM the Common Cancer Model (inference).
- **European API profile.** HL7 EU API says which metadata to share through the IHE MHD profiles so a system can register that it holds data about a patient, find where in the country or Europe that data is stored, and fetch it [rec1 01:58:48]. MHD is IHE "Mobile access to Health Documents" (background knowledge, not stated in the talk).
- **Common Cancer Model (ECCDM, European Cancer Common Data Model).** Published by HL7 Europe as a minimal, extensible oncology model for all tumour types, for care and research, independent of one technical format, and planned to map to both FHIR and OMOP [slide 10, slide 10 notes]. It is a ballot draft: "model k posouzení" (a model for review), and its implementation parts are informative only [slide 10, slide 10 notes, rec1 01:46:44]. Links: https://hl7.eu/fhir/cancer-common/, artifacts at https://hl7.eu/fhir/cancer-common/artifacts.html, logical models at https://hl7.eu/fhir/cancer-common/1.0.0-ballot/logicalmodels.html#overview [slide 10, slide 12].
- **Common Cancer Model classes** (slide 11 conceptual diagram and slide 12 logical class diagram): CancerPatient, CancerConditionAtDiagnosis, CancerStage, CancerTreatment (abstract; subtypes Surgery, Radiotherapy, SystemicTreatment, ActiveSurveillance), Imaging, ClinicalCancerProgression, OverallCancerTreatmentResponse, LastFollowUp. Relations shown: a patient is affected by one cancer condition at a time; the condition has one or two stages; it can evolve through progression; treatment can be single or multimodal; a patient has one or more follow-ups; ActiveSurveillance "Applicable only before ClinicalCancerProgression. Discontinued when progression occurs." [slide 11, slide 12, slide 11 notes].
- **CancerPatient** (slide 14 image): birthDate dateTime [1..1]; sexAtBirth [1..1] with choice Male, Female, Unknown, Other; sexAtDiagnosis [0..1]; comorbiditiesAtCancerDiagnosis [0..*]. The notes call the gender field observedSexGender [slide 14, slide 14 notes]. It is a logical model, not the FHIR Patient profile itself; converting it to FHIR needs extra mapping rules [slide 14 notes].
- **CancerStage** (slide 15 image): classificationType [0..1] (TNM, FIGO, Lugano and others; required for TNM, optional for single-value systems); stage [1..*] as code and value pairs (TNM has 3 components T, N, M); type [1..1], Clinical or Pathological; a required reference to CancerConditionAtDiagnosis; and evidence references to Surgery or Imaging [slide 15]. On slide 11, a pathological stage is defined through surgery and a clinical stage through one or more imaging studies [slide 11]. TNM is mainly for solid tumours; other tumour types use other staging systems that also fit the model [rec1 01:50:47].
- **Mapping to FHIR so far covers only the patient** (slide 16 image): birthDate to Patient.birthDate (use a partial date if only year or month is known); sexAtBirth to the Patient extension recordedSexOrGender with type LOINC 76689-9 "Sex assigned at birth"; observedSexGender related to Patient.gender; comorbidities to an Observation profile, ObservationComorbiditiesEuCcm, with extensions for present and absent comorbidities. The FHIR profile names are PatientEuCcm and ObservationComorbiditiesEuCcm [slide 16]. Mapping of clinical information "bude mnohem složitější a dosud nebylo provedeno" (will be much harder and has not been done yet) [rec1 01:52:47].
- **Mapping to OMOP so far covers only the patient** (slide 17 image): PERSON year, month, day of birth (only year mandatory), gender_concept_id with Male 8507, Female 8532, Unknown and Other 0; observedSexGender and comorbidities to OBSERVATION and CONDITION_OCCURRENCE [slide 17, rec1 01:52:47].
- **Order of work in the European project:** first a logical model from clinicians, then a mapping of each concept to FHIR resources, and only then the FHIR profiles [rec1 01:50:47, rec1 01:52:47]. Next goals: finish the FHIR and OMOP mappings and create European oncology profiles for primary and secondary use [slide 18, rec1 01:56:48].
- **mCODE (minimal Common Oncology Data Elements)** is an American FHIR implementation guide with concrete profiles, terminology bindings and examples, organised into patient, disease, assessment, genomics, treatment, and outcomes. It is a useful pattern for diagnosis, stage, or assessment results, but it builds on US Core and the US context, so check that before using it in a Czech project. URL: https://hl7.org/fhir/us/mcode/STU4/ (artifacts at https://hl7.org/fhir/us/mcode/STU4/artifacts.html, cancer patient profile at https://hl7.org/fhir/us/mcode/STU4/StructureDefinition-mcode-cancer-patient.html) [slide 19, slide 19 notes].
- **Cancer Common versus mCODE.** Cancer Common answers "which concepts do we need and how do they relate"; mCODE answers "how do we write selected information in FHIR". They complement each other but are not interchangeable: the same name does not guarantee the same definitions, cardinalities, or terminology, and a Czech solution must also respect national identifiers and profiles [slide 20, slide 20 notes, rec1 02:00:24]. The speaker expects the European oncology profiles to combine EU Base with an adoption of mCODE profiles, to an extent he cannot predict, partly because the EU now wants less dependence on the US [rec1 02:00:24].
- **SNOMED CT.** HL7's preferred coding in many areas, and in Czechia the speaker's recommendation is to use it "všude tam, kde je to možné" (wherever possible). All new Czech profiles, including discharge reports and lab reports, move their coded information to SNOMED CT: specimen types, examination techniques, tube types, additives, substances. Reason: SNOMED CT is the preferred terminology in the EU and EHDS will require it anyway [rec1 01:52:47, rec1 01:54:48].
- **NČLP** ("národní číselník laboratorních položek", the national code list of lab tests; transcribed as "národních číselných laboratorních položek", with the abbreviation written NČLP). It stays the exception: Czech lab test codes are not being replaced by SNOMED CT [rec1 01:54:48]. For us this means lab values in Czech data will most likely carry NČLP codes, not LOINC (inference).
- **LOINC.** Made by the Regenstrief Institute; used mainly in lab medicine, also in radiology and some other non-lab examinations; the FHIR standard uses it for observations. About 85 percent of lab LOINC codes are available in the LOINC Ontology, a SNOMED CT extension [rec1 01:52:47, rec1 01:54:48]. LOINC is also used in the Cancer Common FHIR mapping (76689-9 "Sex assigned at birth") [slide 16].
- **Code where it adds value, but do not drop codes because LLMs exist.** The speaker agrees with the previous speaker that coding should be required only where it adds value, and that translation alone is not a strong enough reason, but says interoperability and machine processing will need codes "ani v éře dokonalých velkých jazykových modelů" (even in the era of perfect large language models) [rec1 01:54:48, rec1 01:56:48].
- **DASTA: do not use for new work.** "Prosím, zapomeňte na DASTu" (please forget DASTA). The speaker still helps maintain it, but only to keep existing systems running; he would not recommend it for any new development. FHIR should be friendlier for developers, though it takes a lot of reading [rec1 02:02:25]. DASTA is the Czech national data exchange standard (background knowledge, not explained in the talk).
- **MKN-10 was not mentioned by this speaker.** The previous speaker (Michal Opatřil, same recording) called MKN-10 "snad jediná nomenklatura, která se všeobecně jako ujala u nás" (perhaps the only code system widely adopted here) [rec1 01:23:56].
- **A data element needs its meaning, unit, time, and link to the patient**; a bare number could be a test result, a dose, or a score [slide 4, slide 4 notes].
- **Sex for lab interpretation.** Beyond administrative gender (male, female, other, unknown on documents), lab results are interpreted against biological sex, which can differ from how a person identifies; the cancer model adds sex at birth and sex at diagnosis for this reason [rec1 01:48:45, rec1 01:50:47].

### What the jury and the challenge owners expect

- **The HL7 talk says nothing about judging criteria.** A chat question "jestli se více hodnotí nápad nebo technické provedení" (whether the idea or the technical execution counts more) was posted after the recording ended and has no answer in this source [chat 02:28:04].
- **The deck's view of a good prototype:** "Dobrý prototyp ukáže přínos řešení i srozumitelný způsob práce s daty" (a good prototype shows the benefit of the solution and an understandable way of working with data) [slide 21].
- **Recommendation for Rakathon teams** (speaker notes, not read aloud): pick a small set of important information, explain its structure, and verify its meaning with a clinical mentor [slide 21 notes].
- **Prize for the winner (from the host and the previous speaker, not from this talk):** the winning team is invited to the eHealth interoperability event on Monday 19 October [rec1 01:27:56, rec1 01:32:37].

### The MDT meeting and clinical workflow

- **Oncology data has a time dimension, and a new assessment adds to the history.** "Onkologická data mají časový kontext. Nové hodnocení doplňuje historii." [slide 13]. The initial stage is not automatically the current state: "Počáteční stadium není automaticky současným stavem." [slide 11 notes].
- **The model separates areas that free text tends to mix:** patient (basic characteristics and other diseases), diagnosis and stage (tumour type, location, initial extent), treatment episodes (surgery, radiotherapy, systemic treatment), and disease course (changes, treatment response, follow-ups) [slide 13, slide 11 notes]. This is a natural outline for our summary and timeline (inference).
- **"Is the stage the state at first diagnosis or a later development?"** The deck raises this as the kind of question a shared model must answer [slide 9 notes].
- **Clinical versus pathological TNM.** Both exist for the same tumour and are expected to be distinguished [rec1 01:50:47, slide 15].
- **Care team summaries are a named use case** of the Common Cancer Model (see "Directly about challenge 2") [rec1 01:44:41].

### Data access and infrastructure

- **No test FHIR server, token, or dataset was given in this talk.** The chat question about a FHIR token for test data was deferred: "Ke konkrétním datům budeme mít odpoledne na to sessions Microsoft a InterSystems" (for concrete data we will have the Microsoft and InterSystems sessions in the afternoon) [chat 02:19:32, rec1 02:06:59].
- **Afternoon programme as announced by the host:** 13:00 Microsoft workshop (GitHub Copilot and the other Microsoft tools; send at least one person); 14:30 InterSystems workshop, described as "spousta dat" (lots of data) and about making hacks pluggable into hospital information systems; 15:30 workshop with a French and European FHIR expert, transcribed "Lucem Chatim" (probably Luc Chatty) [rec1 02:11:49].
- **Validators exist for the Czech profiles** and also validate against the European profiles [rec1 01:42:41]. No validator URL was shown.
- **NCEZ FHIR R4 REST API** is referenced at https://ncez.mzcr.cz/cs/node/5515 [slide 8].
- **Using AI coding tools for FHIR conformance.** The speaker says tools transcribed as "Clot a Clot a Corex" (probably Claude, Claude Code, and Codex) can produce compliant output if given a good prompt asking for compliance with EHDS or with a base profile transcribed as "eHealth Room FHIR Base" (unclear; possibly HL7 EU Base or the Czech core guide) [rec1 02:10:41].

### Privacy, legal, and safety constraints

- **A standard does not grant access to data.** "Standard není povolení k přístupu k údajům." Data quality, permissions, and usage rules always have to be handled separately [slide 5 notes].
- **A standard does not guarantee clinical correctness** of the data; it only makes reliable exchange and checking possible [slide 4 notes].
- **EHDS conformance.** Suppliers of systems that process EHDS priority categories must prove compliance, implement a FHIR interface, and give patients and clinicians access to the stored information. Priority categories: discharge reports of any type, lab reports, imaging reports including image exchange, the patient summary, ePrescription and dispensation [rec1 01:42:41]. The Commission's implementing acts are due "nejpozději v březnu příštího roku" (by March next year at the latest, so March 2027) [rec1 01:40:39].
- **HL7 licensing is open**: published versions are a "public good model" with no fees for users [rec1 01:48:45].
- **Trademark note on slide 1:** HL7, CDA, and FHIR are registered trademarks of HL7 International, and the presentation is not an endorsement of any product [slide 1].
- **For AI: keep the origin of every claim and separate known from missing data.** "U AI je zásadní zachovat původ tvrzení a rozlišovat známé a chybějící údaje." [slide 21 notes]. This matches our CLAUDE.md rules on citing sources and saying "not found".

### Recommended practices and pitfalls

- **Do not build a proprietary interface**; current and future Czech systems will have to support a FHIR data interface for external access and sharing [rec1 02:00:24, rec1 02:02:25].
- **For a 24-hour prototype, start from FHIR's basic resources and the terminologies in use**, because structure and terminology go together [rec1 02:09:23, rec1 02:09:40].
- **Pitfall: pre-coordinated versus post-coordinated codes.** A pre-coordinated code packs several facts into one code; a post-coordinated concept is built from several elements of the data model. If you only look at pre-coordinated code lists, you miss model elements you could use, and those code lists usually lack many of the combinations you need [rec1 02:09:40].
- **Reuse existing models instead of inventing your own names** for clinical concepts: Cancer Common for content, mCODE for concrete FHIR patterns, FHIR for building blocks [slide 21, slide 21 notes]. This is not a guarantee of speed or clinical value; results depend on design quality and available data [slide 21 notes].
- **Do not treat Cancer Common and mCODE as a ready conversion table**; the comparison on slide 20 is educational, not an official mapping [slide 20 notes].
- **When a project says "we support HL7", ask which standard** (V2, CDA, FHIR) [slide 3 notes].
- **Check the date of a source.** The deck's sources were checked on 10 October 2026 and its versions are fixed [slide 22 notes].

### Other useful facts

- HL7 International was founded in 1987; the name refers to layer 7 (the application layer) of the ISO/OSI model, not to version 7 [slide 2 notes, slide 3]. HL7 Europe aligns the European context; HL7 Česká republika covers national requirements [slide 2 notes].
- HL7 working groups include clinicians, IT people, patient organisations, and regulators; standards go through public review ("balloting") and a vote before a version is fixed and published [rec1 01:34:38, rec1 01:46:44, rec1 01:48:45].
- The Czech Republic helps write European standards, contributes to the EHDS implementing acts, and maintains the logical information model for the European Commission [rec1 01:40:39]. The speaker counts himself among the authors of the EEHRxF (European EHR exchange format) standards [rec1 01:32:37].
- HL7 working groups are open to non-members; Czech groups meet roughly weekly, European ones more often [rec1 02:02:25].
- **HL7 Europe Working Group Meeting, 16 to 20 November 2026, Málaga, Spain**, with a full day on the European Common Cancer Model (Roberta Gazzarata, Thomas Debertshäuser, Kai Heitmann), including a session titled "European Common Cancer Model, including Synthetic Data for Phoenix". https://www.hl7europe.eu/hl7-europe-working-group-meeting-malaga-2026/ [slide 23, rec1 02:04:25].
- Contact for HL7 Česká republika: the website hl7.cz, or the speaker directly by email or phone (no address given) [rec1 02:04:25].
- The host asked speakers to send slides to an address transcribed as "info zavináč chex tečka com" and said slides will be shared on the event Slack [rec1 02:05:30, rec1 02:06:06]. The exact address is unclear from the audio.
- **All URLs shown in the deck:**
  - https://HL7.org [slide 22]
  - https://dev3.hl7.org/about/index.cfm [slides 1 to 3, 22, notes]
  - https://info.hl7.org/learn-more [slide 2 notes]
  - https://hl7news.hl7.org/2026/01/02/new-hl7-europe-fhir-implementation-guides-to-support-the-european-health-data-space/ [slide 2 notes, slide 8 notes]
  - https://hl7.eu/fhir [slide 8]
  - https://hl7.eu/fhir/cancer-common/ [slides 1, 5, 9, 10, 14 to 18, 20 to 22]
  - https://hl7.eu/fhir/cancer-common/artifacts.html [slides 10 to 13 notes]
  - https://hl7.eu/fhir/cancer-common/StructureDefinition-ClinicalCancerProgression.html [slides 11 to 13 notes]
  - https://hl7.eu/fhir/cancer-common/StructureDefinition-CancerPatient.html [slides 14 to 18 notes]
  - https://hl7.eu/fhir/cancer-common/1.0.0-ballot/logicalmodels.html#overview [slide 12]
  - https://hl7.cz/fhir and https://hl7.cz/fhir/ [slide 2 notes, slide 8, slide 22]
  - https://hl7.cz/fhir/core/1.0.0/en/index-cs.html [slide 8 notes, slide 20 notes]
  - https://ncez.mzcr.cz/cs/node/5515 [slide 8 notes]
  - https://hl7.org/fhir/R4/overview.html [slides 4 to 7, 21 notes]
  - https://hl7.org/fhir/R4/terminologies.html [slide 4 notes]
  - https://hl7.org/fhir/R4/comparison.html [slide 6 notes]
  - https://hl7.org/fhir/R4/formats.html [slide 7 notes]
  - https://hl7.org/fhir/us/mcode/STU4/ [slides 1, 19 to 22]
  - https://hl7.org/fhir/us/mcode/STU4/artifacts.html [slide 19 notes]
  - https://hl7.org/fhir/us/mcode/STU4/StructureDefinition-mcode-cancer-patient.html [slide 19 notes, slide 20 notes]
  - https://www.hl7europe.eu/hl7-europe-working-group-meeting-malaga-2026/ [slide 23]

## Directly about challenge 2

- **A care team summary is one of the named oncology use cases.** The speaker lists what the Common Cancer Model should underpin: "jak má vypadat propouštěcí zpráva, jak má vypadat překladová zpráva, jak má vypadat informace pro care tým, který pacienta má v budoucnu pečovat, jaké specifické údaje musí histopatologie [...] přidávat [...]. Jak tedy má vypadat nějaký souhrnný model a souhrn informací, který ten care tým má mít k dispozici?" (what a discharge report should look like, what a transfer report should look like, what information the care team that will look after the patient should get, which specific data histopathology must add [...]. So what should a summary model and a summary of information that the care team has available look like?) [rec1 01:44:41]. Base FHIR resources are "příliš obecný" (too general) for this, which is why the project exists [rec1 01:44:41]. No finished FHIR profile for such a summary exists yet (inference from the mapping status at rec1 01:52:47).
- **The Common Cancer Model is a ready-made outline for our outputs** (inference): CancerConditionAtDiagnosis and CancerStage feed the patient summary; Surgery, Radiotherapy, SystemicTreatment, and ActiveSurveillance feed the treatment timeline; ClinicalCancerProgression and OverallCancerTreatmentResponse feed "significant changes"; LastFollowUp marks the end of the timeline; Imaging and Surgery are the evidence behind a stage, which fits our "findings overview" [slide 11, slide 12, slide 15].
- **Time matters for contradictions.** "Počáteční stadium není automaticky současným stavem" (the initial stage is not automatically the current state) and "Nové hodnocení doplňuje historii" (a new assessment adds to the history) [slide 11 notes, slide 13]. A later stage that differs from the stage at diagnosis is not by itself a contradiction, and neither is a clinical stage that differs from the pathological stage (inference from rec1 01:50:47 and slide 15). Our contradiction check should compare values of the same type and time.
- **Stage has a required source.** In the model, a clinical stage is defined through imaging and a pathological stage through surgery [slide 11, slide 15]. A stage without the matching imaging or histology report is a candidate "missing document" (inference).
- **Lab values need sex for interpretation.** The speaker explains that lab findings are interpreted against biological sex, which is why the cancer model records sex at birth and at diagnosis [rec1 01:48:45, rec1 01:50:47]. Our lab view should keep the reference range from the source document rather than computing one (inference, consistent with CLAUDE.md).
- **Lab codes in Czech data are NČLP.** New profiles move to SNOMED CT "s výjimkou kódů NČLP" (except NČLP codes) [rec1 01:54:48]. The previous speaker adds "LOINC tady není, nebude ještě dlouho" (LOINC is not here and will not be for a long time) [rec1 01:23:56].
- **Partial dates are allowed.** The FHIR mapping says to use a partial date if only the year or month is known [slide 16]. Our timeline should accept dates like "2024" or "03/2024" without inventing a day (inference).
- **The documents the record should contain** follow the EHDS priority categories: discharge reports, lab reports, imaging reports, patient summary, ePrescription [rec1 01:42:41]. These are a reasonable first checklist for "missing documents" (inference).
- **AI and provenance.** "U AI je zásadní zachovat původ tvrzení a rozlišovat známé a chybějící údaje." (For AI it is essential to keep where each claim comes from and to distinguish known from missing data.) [slide 21 notes].
- **Comorbidities can be present or absent.** The FHIR mapping has separate extensions for present and absent comorbidities [slide 16]. An explicit "no comorbidity" statement differs from "not documented" (inference).

## Questions and answers

1. **How can we get concrete data, for example a FHIR token for test data or any other format?** (Alex Y, in chat) [chat 02:19:32, read aloud at rec1 02:06:59].
   Answer (host): concrete data will be covered in the afternoon Microsoft and InterSystems sessions; "čekání je polovina slasti" (waiting is half the pleasure) [rec1 02:06:59].
2. **If I build a quick and dirty proof of concept in 24 hours, what must I get right from the start so it can later be brought to European or world standards, or can I always rebuild it?** (host) [rec1 02:07:36].
   Answer: look at FHIR's basic building blocks, since they contain the information usually needed, and look at the terminology systems in use, because structure and terminology are closely linked. Watch the difference between pre-coordinated and post-coordinated codes: pre-coordinated code lists do not contain all combinations, and focusing only on them hides useful model elements [rec1 02:09:23, rec1 02:09:40]. AI tools (transcribed "Clot a Clot a Corex", probably Claude, Claude Code, and Codex) given a good prompt asking for EHDS compliance or a FHIR base profile can help with this [rec1 02:10:41].
3. No further questions were asked [rec1 02:11:21].
4. **Unanswered in this source:** "Mám dotaz jestli se více hodnotí nápad nebo technické provedení" (does the idea or the technical execution count more?) (Vít Provazník) [chat 02:28:04]. Posted after the recording ended at about rec1 02:14:41.

## Open points

- **Which data and format will we actually get?** Not answered here; deferred to the Microsoft and InterSystems workshops [rec1 02:06:59]. Check that talk's notes (second recording `GMT20261015-105031`) for FHIR server URLs and tokens.
- **Judging: idea versus technical execution** is unanswered [chat 02:28:04]. Ask the organizers.
- **SNOMED CT disagreement between speakers.** Michal Opatřil: few people know or use SNOMED CT in Czechia, use NČLP for labs and MKN-10 for diagnoses [rec1 01:23:56]. Hynek Kružík: "moje doporučení naopak trošku je odlišné od toho, co říkal Michal" (my recommendation is a bit different from Michal's), new Czech profiles move to SNOMED CT except NČLP [rec1 01:54:48]. Both agree NČLP stays for lab tests. For our input, real FNO documents will likely use MKN-10 and NČLP and rarely SNOMED CT (inference); confirm with the challenge owners.
- **Will FNO data come as FHIR at all, or as PDFs, CDA, or DASTA exports?** The deck warns that not all Czech systems use FHIR yet and that CDA and other interfaces are in use [slide 8 notes, slide 6 notes]. DASTA is still maintained for existing systems [rec1 02:02:25], so a DASTA export from the hospital is possible (inference).
- **"Synthetic Data for Phoenix"** appears in the Málaga agenda [slide 23]. Our sources folder also holds `Rakathon_HoF_PHOENIX_XiA.pdf`; whether these refer to the same Phoenix, and whether synthetic oncology data in Common Cancer Model shape exists, is unverified.
- **Garbled terms to confirm:** "eHealth Room FHIR Base" [rec1 02:10:41] (possibly HL7 EU Base or the Czech core guide); "Clot a Clot a Corex" [rec1 02:10:41] (probably Claude, Claude Code, Codex); "Lucem Chatim" [rec1 02:11:49] (probably Luc Chatty); "info zavináč chex tečka com" [rec1 02:06:06] (the organizers' email); "ILFU" for the Monday event venue, which the previous speaker calls "Institut pro postgraduální vzdělávání" [rec1 01:27:56, rec1 01:32:37]; "Plie Hack" for the morning session [rec1 02:11:49] (probably "pre-hack").
- **EU guide acronyms on slide 18** (EU DR, EU MDR, EU PMD and others) are not expanded in the talk [slide 18].
- **The Common Cancer Model is a ballot draft** with only the Patient mapped [slide 10, rec1 01:52:47]. If we use its class names in our data model, say it is a draft and pin version 1.0.0-ballot.
