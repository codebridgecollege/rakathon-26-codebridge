# Talk notes: Czech eHealth in a nutshell

> Settled guidance from this note is folded into [`CLAUDE.md`](../../CLAUDE.md),
> [`docs/agent/INDEX.md`](../agent/INDEX.md), and
> [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md). This note keeps the full detail.

- **Talk:** "České eHealth v kostce" (Czech eHealth in a nutshell), a
  30-minute technical briefing for Rakathon 2026 teams, 15 October 2026.
  Slide subtitle: "Architektura, centrální služby, FHIR, IHE, AAfD, EHDS".
- **Speaker:** Michal Opatřil, Umbrellateam (umbrellateam.cz). He says he
  and his team work as external expert consultants for the Czech Ministry
  of Health and that he co-wrote the amendment of the eHealth law (Act
  325/2021) [rec1 01:00:04] [rec1 01:08:47].
- **Sources:**
  - Slides: `docs/sources/presentations/Ceske_eHealth_v_kostce_Rakathon_2026_Michal_Opatril.pdf`
    (22 pages). Page numbers below are PDF pages; they match the slide
    numbers printed on pages 2 to 22.
  - Transcript: `docs/sources/presentations/GMT20261015-072521_Recording.elevenlabs.md`
    (cited as "rec1"). The speaker is labelled `speaker_3`; the host is
    `speaker_1`.
  - Zoom chat: `docs/sources/presentations/GMT20261015-072521_RecordingnewChat.txt`
    (cited as "chat"). Chat timestamps run about 12.5 minutes ahead of
    the recording: the chat question at chat 02:19:32 is read aloud at
    rec1 02:06:59, and "Přestala se sdílet prezentace" at chat 00:22:13
    matches the host asking to re-share slides at rec1 00:09:32.
- **Transcript range:** the host introduces the speaker at rec1 00:57:20,
  the speaker starts at rec1 00:57:51, presents from rec1 01:00:04 to
  rec1 01:29:27, and the host hands over to the next speaker (Hynek
  Kružík, HL7 Czech Republic) at rec1 01:30:33. There was no audience
  Q&A for this talk. In chat time the talk spans roughly 01:10 to 01:43.
- **Coverage note:** the speaker ran short of time. He said aloud that he
  skips the FHIR slide (page 14) because the next speaker covers FHIR
  [rec1 01:23:56], and he jumped from the IHE profile table (page 16)
  straight to the developer link list (page 20) [rec1 01:25:56]. Pages 17,
  18, and 19, which are the most relevant to us, were never presented
  aloud. Everything cited only as [page 17], [page 18], or [page 19]
  comes from the slide text alone.

## Summary

The talk explains the system that a hackathon prototype would plug into,
so that a good idea does not die because it cannot fit into Czech
healthcare practice later [rec1 01:00:04] [rec1 01:02:04]. Czech eHealth
is not one central database: it has four layers (the EU layer with EHDS,
state central services, an exchange layer of accredited affinity domains,
and the hospitals' own systems), and clinical documents usually stay with
the provider that created them [page 3] [rec1 01:06:05]. The speaker
separates three things that people mix up: the legally kept electronic
medical record (EZD), the interoperable record used for exchange (EHR in
the EHDS sense), and the software (hospital or outpatient information
system) [page 7] [rec1 01:14:43]. For structured data he says to use HL7
FHIR, because anything else is "a pointless proprietary solution", and
to use codified terminologies (NČLP for labs, MKN-10 for diagnoses,
DICOM for images) [rec1 01:14:43] [rec1 01:16:43] [rec1 01:23:56]. To
find and fetch documents across providers he recommends the IHE MHD
profile (publish ITI-65, find ITI-67, retrieve ITI-68) plus ATNA for audit
[page 12] [rec1 01:21:56]. He asks teams not to build their own patient
register or requisition system, but to leave a clear placeholder where
the prototype would check the patient against the national base
registers [rec1 01:16:43] [rec1 01:18:44]. The slides propose an MVP
architecture with FHIR at the edge, a separate internal model, stubbed
national interfaces, synthetic data, and an audit trail [page 17]
[page 20]. A slide written for Rakathon's challenges says an AI answer
must carry its source, a measure of uncertainty, and a human who makes
the clinical decision [page 19]. The winning team gets free entry to the
"Národní dialog pro digitalizaci Vol. II" event on 19 October 2026 in
Prague [page 21] [rec1 01:25:56] [rec1 01:27:56].

## Guidance for our challenge

### Standards and data formats

- **FHIR R4 is the expected format for structured health data.** The
  speaker: "pokud něco vytváříte dneska moderního, tak je nutné, abyste s
  FHIRem pracovali, protože jinak vytváříte nějaké nesmyslné proprietární
  řešení" ("if you build something modern today, you must work with
  FHIR, otherwise you build a pointless proprietary solution"). Use FHIR
  for the exchange representation of extracted facts. [rec1 01:14:43]
  [rec1 01:16:43]
- **Keep both a human-readable document and a structured representation.**
  "PDF / text = lidsky čitelný dokument. FHIR = strukturální a výměnná
  reprezentace. U klinického záznamu potřebujete obojí" ("PDF/text is the
  human-readable document, FHIR is the structured exchange form; a
  clinical record needs both"). PDF is a fallback attachment for the
  oldest systems, not the primary carrier. For us this supports keeping
  the original document next to every extracted fact (inference).
  [page 7] [rec1 01:14:43]
- **A FHIR resource is not enough on its own; the national profile
  decides.** "„Pošli JSON“ není zadání. Rozhoduje profil, terminologie a
  klinický kontext" ("'send JSON' is not a specification; the profile,
  the terminology, and the clinical context decide"). The slide's sample
  Observation (LOINC 8867-4, heart rate) is labelled "ILUSTRAČNÍ JSON /
  NENÍ CZ PROFIL" (illustrative, not a Czech profile). Concepts listed:
  Resource, Profile (national constraints and required fields), ValueSet
  and CodeSystem, Implementation Guide (versions, profiles, examples,
  tests), OperationOutcome (how a server returns validation errors).
  [page 14]
- **Where to read Czech FHIR, in this order of layers:** (1) FHIR R4 base
  at hl7.org/fhir/R4; (2) CZ Core and Czech terminology at hl7.cz/fhir,
  published as STU 1.0; (3) the domain IG for a specific report type: CZ
  Lab, Imaging, HDR, PS; (4) the HIE IG for finding and retrieving
  documents (MHD, ATNA), which is only a CI build, a working version. Always
  check the publication status, because "CI build je průběžná pracovní
  verze" (a CI build is an ongoing working draft). HDR is probably
  Hospital Discharge Report and PS the Patient Summary (inference).
  [page 15] [rec1 01:25:56]
- **Suggested reading order for an IG:** status and version, then
  StructureDefinition, terminology, cardinality, invariants, examples,
  and finally the validator. [page 15]
- **FHIR, IHE, and terminology answer different questions.** FHIR (HL7):
  what the data means (Resource, Profile, Bundle, REST API). IHE: who
  performs which transaction with whom (Actor, Profile, ITI-65/67/68,
  audit). Terminology: the exact meaning of a value (LOINC, NČLP, SNOMED
  CT, units, code lists). Attachments and images: PDF/A, DICOM, a
  validated FHIR document. [page 13] [rec1 01:23:56]
- **Use IHE MHD for publishing, finding, and fetching documents.** MHD
  ("Mobile Access to Health Documents") is "standardizované API pro
  publikování, vyhledávání, získávání zdravotnických dokumentů" (a
  standard API to publish, search, and retrieve health documents), built
  on FHIR R4. Steps: Publish with ITI-65 Provide Document Bundle; Index
  as DocumentReference (metadata, type, patient, author); Find with
  ITI-67 Find Document References; Retrieve with ITI-68. ITI-66 is Find
  Document Lists. The speaker: "tyto věci nemusíte ve svých řešeních
  vynalézat ... můžete jako puzzle vzít" (you do not need to invent
  these; take them like puzzle pieces), and "IHE opravdu prosím
  používejte ... zapromptujte AI, aby ho používala" (please really use
  IHE; prompt your AI to use it). [page 12] [rec1 01:21:56]
- **DocumentReference is metadata plus a link, not the document.**
  "DocumentReference není dokument ani samostatná databáze" (it is
  neither a document nor a separate database), but a standard
  representation of metadata and a reference to the content. [rec1
  01:21:56]
- **The transcript and slide disagree on ITI-66 versus ITI-67** (see
  Open points). The slide says ITI-66 finds Document Lists and ITI-67
  finds Document References [page 12]; the speaker says "šedesát šestka
  slouží k vyhledávání jako záznamu dokumentu a šedesát sedm vyhledává
  jednotlivé reference" [rec1 01:21:56], which is loosely worded.
- **MHDS is the architecture profile for the exchange network and is the
  core of the Czech affinity domains.** "MHD, MHDS je něco, co používáme
  jako nativně jako jádro v akreditovaných afinitních doménách. Je to
  nový progresivní profil ... ale není to exotika" (MHD/MHDS is the
  native core of the accredited affinity domains; new, not yet
  widespread, but not exotic). He recommends counting on it. [page 12]
  [page 16] [rec1 01:25:56]
- **Include ATNA if possible.** ATNA covers audit logging and secure
  communication; it does not decide access permissions. "ATNA (audit) +
  oprávnění, identita, transportní bezpečnost musí běžet napříč tokem"
  (audit, permissions, identity, and transport security must run across
  the whole flow). [page 12] [rec1 01:21:56]
- **Other IHE profiles, chosen by problem** (slide table, not discussed
  aloud): MHD/MHDS for documents, registries, repositories and federated
  exchange; PDQm for querying patient demographics (find or verify
  identity); PIXm/PMIR for cross-referencing patient identifiers and
  identity changes (MPI updates); mCSD for a directory of health
  services (Organization, PractitionerRole, Endpoint); IUA/ATNA for
  authorization tokens and audit; DSUBm for subscribing to document
  notifications. The speaker: check first whether a profile already
  solves your problem. [page 16] [rec1 01:25:56]
- **EHDS and EEHRxF.** EHDS (European Health Data Space) is the first EU
  regulation that standardizes access to and exchange of health data.
  EEHRxF (European Electronic Health Record exchange Format) is, in the
  speaker's simplification, "technickou vyhláškou k EHDS" (the technical
  decree for EHDS). "Když budete promptovat nebo hledat nějaké
  informace, tak EEHRxF je určitě dobrá cesta" (when prompting or
  searching, EEHRxF is a good route). [page 3] [rec1 01:06:05]
- **EHDS priority categories (EHR archetypes).** The first wave on the
  slide: patient summary, discharge report, imaging report, laboratory
  report, and emergency medical service (ZZS) call-out report. The
  speaker calls the patient summary "pro vás dost důležitá entita" (quite
  an important entity for you). Each category has an "EHR archetype" that
  describes both the clinical structure (what the clinician sees: history,
  diagnoses as MKN codes, and so on) and the data structure (described in
  FHIR). "Pokud s nima budete chtít ve vašich řešeních pracovat, tak se
  na ně musíte podívat" (if you want to work with them, you must look at
  them). Definitions:
  https://mzcr.atlassian.net/wiki/spaces/EPZS/pages/203096069/Standardy+EHR+-+prioritn+kategorie
  (URL as printed; the last word is probably "prioritní" with the
  diacritic lost). [page 6] [rec1 01:10:48] [rec1 01:12:50] [rec1
  01:14:43]
- **Terminologies for Czech data:** for laboratory items use NČLP (the
  Czech national lab code list; transcribed as "NCLP"), because "LOINC
  tady není, nebude ještě dlouho" (LOINC is not here and will not be for a
  long time). MKN-10 (Czech ICD-10) is "snad jediná nomenklatura, která se
  všeobecně ujala" (perhaps the only nomenclature that is in general
  use). SNOMED CT is fine to use, but "málokdo ho zná a téměř nikdo
  nepoužívá" (few know it and almost nobody uses it), except in
  radiology where it is more common; if you use it, consider AI that
  generates SNOMED codes from narrative text. Imaging uses DICOM. [page 13]
  [rec1 01:23:56]
- **Prefer coded terminology over free text where it matters.** The
  speaker's field is moving "od nejednoznačného narrativního textu ... k
  způsobu, který je mnohem víc strukturovaný" (from ambiguous narrative
  text to a far more structured form), because a misread clinical
  statement can harm or kill a patient. [rec1 01:04:05] [rec1 01:06:05]
- **Accredited affinity domains (AAfD)** are a proposed federated exchange
  layer: a registry of metadata and references, authorization, routing,
  and audit, while the content can stay at the provider. "Nejsou to
  prosím repozitáře zdravotnické dokumentace ... Je to skutečně jako
  routing" (they are not repositories of medical records; it is really
  routing). Five are being built in the Czech Republic. Recommended: a
  solution should keep the AAfD architecture principles in mind. Slide
  also lists central components: home domain, HCID (probably the IHE Home
  Community ID, inference), cross-domain routing, possible supporting
  storage. [page 3] [page 11] [rec1 01:18:44] [rec1 01:20:45]

### What the jury and the challenge owners expect

- The talk does not describe the judging criteria. A participant asked in
  the chat whether the idea or the technical execution weighs more [chat
  02:28:04]; this is about 15 minutes after the talk ended (about rec1
  02:15) and after the transcript's last line, so no answer is recorded
  here.
- **A "minimum for a credible MVP"** per the slides: (1) a clinical need
  and a responsible role; (2) a source of truth and identifiers; (3) a
  concrete FHIR or IHE profile; (4) access rules and audit; (5) synthetic
  data and a test of failure cases. The slogan: "DATA → KONTEXT → PROCES
  → DŮVĚRA" (data, context, process, trust). Not presented aloud. [page 20]
- **The speaker's stated goal for teams** is that the prototype can live
  on in practice: he wants teams to know the ecosystem "abyste nevytvářeli
  řešení, které sice bude fajn, ale pro další praxi ... bude méně
  užitečné, a tím pádem může ta myšlenka umřít" (so you do not build a
  solution that is nice but less useful in practice, and the idea dies).
  The closing slide: "Ať to nezůstane jen u prototypu" (do not let it stay
  just a prototype), and "Zajímá mě hlavně to, co půjde použít v reálné
  praxi" (what interests me most is what can be used in real practice).
  [rec1 01:02:04] [page 22]
- **Prize:** each member of the winning team gets entry to "Národní dialog
  pro digitalizaci Vol. II", 19 October 2026, Hotel ILF, Prague, a
  technical event where Czech hospital, outpatient, lab, and integration
  system vendors meet to discuss FHIR, IHE, AAfD, eŽádanky, and EHDS. The
  speaker sends entries once he learns who won. [page 21] [rec1 01:25:56]
  [rec1 01:27:56]

### The MDT meeting and clinical workflow

- **"Fit into operations" is one of the four things to know**, and the
  slide lists "eŽádanka, MDT, lékař, koordinátor, audit" (electronic
  requisition, MDT, doctor, coordinator, audit) under it. Main rule:
  "technická interoperabilita ≠ klinicky a právně funkční služba"
  (technical interoperability is not the same as a clinically and legally
  working service). [page 2]
- **The national oncology guide (planned, uncertain)** shows the oncology
  patient's path as: suspicion, episode, documents for the meeting
  ("PODKLADY"), MDT, treatment plan, follow-up. Primary data for care
  management listed: "onko sumář" (oncology summary), "MDT závěr" (MDT
  conclusion), CarePlan, Task, eŽádanka. It links to national eHealth via
  providers, FHIR, AAfD, identities, and documents. The slide marks it as
  "STUDIE / ŽÁDOST O FINANCOVÁNÍ – REALIZACE JE NEJISTÁ" (a study and
  funding request, implementation uncertain) and "nikoli hotový národní
  produkt" (not a finished national product). Not presented aloud.
  [page 18]
- **Registries are not the clinical workflow.** "NOR / NZIS: sekundární a
  registrační rovina – není to náhrada klinického workflow" (the national
  oncology register and national health information system are the
  secondary and registry level, not a replacement for the clinical
  workflow). [page 18]
- **eŽádanka (electronic requisition) is a state machine, not an
  electronic PDF.** States: issue, store, find, accept, fulfil, result
  (finding or report), with exceptions: cancellation, cannot be
  performed, split, return to circulation, permissions, outage. The
  central requisition service's interface is not automatically the IHE MHD
  document API. First release covers consultation, physiotherapy, and
  imaging requisitions; lab requisitions come later. [page 9] [rec1
  01:18:44]
- **Clinicians prefer free text; do not overload them with structured
  input.** "Zdravotníci mají radši volný text ... Strukturovaná data jsou
  přesnější, ale vy je nesmíte ubít tím, že těch strukturovaných dat bude
  moc" (clinicians prefer free text; structured data is more precise, but
  you must not crush them with too much of it). AI can turn narrative
  into structured data "poměrně úspěšně" (fairly successfully). [rec1
  01:12:50] [rec1 01:14:43]

### Data access and infrastructure

- **No central data warehouse.** "Nemáme tady centrální datový sklad ...
  veškeré elektronické zdravotnické dokumentace" (there is no central
  warehouse of all electronic medical records). The centre holds
  reference identities and shared rules; clinical data often stays with
  the provider. [page 3] [page 8] [rec1 01:06:05]
- **Do not try to connect to real national services during the
  hackathon.** "Nepředpokládám, že ... tři dny budete zkoušet, jak se
  připojovat na proprietární rozhraní kmenových registrů ... To by byla
  asi blbost" (I do not expect you to spend three days trying to connect
  to the base registers' proprietary interface; that would be silly).
  Instead, leave a visible placeholder: "A tady ověříme pacienta k
  autoritativnímu zdroji pomocí API, které se připojí ke kmenovým
  registrům" (and here we verify the patient against the authoritative
  source via an API that connects to the base registers). Do not build an
  isolated product with its own patient database that ignores this.
  [rec1 01:16:43]
- **Base registers (kmenové registry):** three registers, of patients, of
  health workers, and of healthcare providers, are the authoritative
  sources for those entities. The reason: almost every Czech hospital has
  duplicate patients with the same birth number ("rodné číslo"). A system
  should reference, verify, and update against them. [page 8] [rec1
  01:16:43] [rec1 01:18:44]
- **Central services list (slide):** base registers (patient, provider,
  worker; identifiers and identity matching); security and trust ("JSU",
  register of permissions, journal, seals, time stamps); process services
  (eŽádanky, temporary storage, notifications, shared record); user
  channels (NPEZ, EZKarta, NCPeH, cross-border links). The API docs are in
  the national eHealth manual at mzcr.atlassian.net/wiki/spaces/EPZS.
  These services are "under construction" and "prochází porodními
  bolestmi" (going through birth pains). [page 8] [rec1 01:08:47] [rec1
  01:16:43]
- **Recommended MVP architecture** (not presented aloud): clinical UI
  (doctor, coordinator, patient); a process core (episode, task, state,
  audit); a FHIR adapter (mapping, validation, IG); an HIE/API stub (MHD,
  registers, simulated eŽádanka). Cross-cutting: data and metadata
  (patient identity, author, time, provenance); validation and
  terminology (FHIR profile, ValueSet, OperationOutcome); security and
  tests (RBAC, logs, mock data, negative scenarios). Subtitle: "FHIR na
  okraji systému, oddělený interní model, ověřitelná pravidla a žádná
  fiktivní produkční integrace" (FHIR at the system's edge, a separate
  internal model, verifiable rules, and no fake production integration).
  [page 17]
- **Existing health-share networks** in the Czech Republic are mostly
  mutually incompatible and proprietary. Named (as transcribed): eSpráva,
  "Emedox" (probably eMedocs) by ICZ, ePACS by ICZ for imaging,
  "Clickbox" (probably CLICKBOX) attributed to CGM, and "Stapromise"
  (unclear; probably a STAPRO product). Some projects are now linking
  these networks together, and the speaker wants all of them made
  interoperable.
  [rec1 01:08:47]
- **Hospital system market:** STAPRO has the largest share of hospital
  information systems; CGM and "Medax" (as transcribed) dominate the
  outpatient market with about 70 percent. The speaker says these vendors
  are not very relevant for our design, since a successful solution will
  eventually join a wider ecosystem. [rec1 01:02:04]
- **Medical records are often hybrid.** Providers keep a working version
  in NIS/AIS systems, but these do not always meet the legal requirements
  for an electronic record, so records are often kept partly on paper and
  partly electronically. (Implication for us: expect gaps and scans in
  source documents, inference.) [rec1 01:04:05]

### Privacy, legal, and safety constraints

- **Valid law to build on** [page 4] [rec1 01:08:47] [rec1 01:10:48]:
  - Act 372/2011 Sb. (Health Services Act; the speaker calls it "alfa
    omega"); covers medical documentation.
  - Decree 444/2024 Sb. on the content and keeping of medical
    documentation. "Prosím, při promptování mrkněte na ní, protože tam se
    právě docela taxativně říká, co je a co není součástí zdravotnické
    dokumentace" (when prompting, look at it, because it lists exactly
    what is and is not part of the medical record).
  - Act 325/2021 Sb. (eHealth Act) plus 236/2025 Sb. (services of
    electronic healthcare). §38 of Act 325 defines national eHealth
    standards.
  - GDPR: data protection, purpose, authorization.
- **Planned changes, not yet in force:** a further amendment of Act 325
  (draft 2026, in inter-ministerial comment procedure) would bring
  mandatory electronic documentation from 2029, mandatory eŽádanky from
  2027/2028, registered exchange networks and SZZ, and selected EHDS
  obligations. "Nejde o již účinné povinnosti. V říjnu 2026 může dojít ke
  změnám návrhu" (these are not obligations in force; the draft may change
  in October 2026). Build on current law and watch the drafts. [page 4]
  [rec1 01:08:47] [rec1 01:10:48]
- **EHDS timeline (from the slide):** 2025 regulation entered into force;
  2027 implementing acts and preparation; 2029 patient summary and
  ePrescription/eDispensation, and secondary use data; 2031 laboratory,
  imaging, and discharge report. The speaker: each member state must roll
  out the priority categories over 2027 to 2031. [page 5] [rec1 01:10:48]
- **EHDS primary versus secondary use.** Primary use: care of a specific
  patient by the patient and an authorized clinician, via MyHealth@EU and
  NCPeH. Secondary use: research, innovation, statistics, planning,
  through a Health Data Access Body (HDAB), HealthData@EU, and secure
  processing environments, with data that is "de facto anonymized". Know
  which one your solution belongs to. An MDT assistant is primary use
  (inference). [page 5] [rec1 01:10:48] [rec1 01:12:50]
- **Medical documentation is the provider's legal record; do not modify
  it.** "Zdravotnická dokumentace tu nelze sdílet. Tu má vždycky
  poskytovatel svoji a nikdo mu do ní nesmí šahat" (medical documentation
  cannot be shared; it always belongs to the provider and nobody may touch
  it), because it is the provider's forensic protection in court. The
  speaker prefers "zpřístupnit" (make accessible to an authorized party)
  over "sdílet" (share). The record at the provider is the "source of
  truth"; an index holds metadata about where documents are; access is
  verified, issued, and audited. "Oprávnění a klinický účel je nutné
  ověřovat při přístupu" (permission and clinical purpose must be checked
  at the moment of access). For us: our summary is a derived view and
  must not be presented as, or written back into, the record (inference).
  [page 10] [rec1 01:18:44]
- **What counts as medical documentation is defined exhaustively by law.**
  "Je naprosto jasně taxativně daná, co do ní spadá a co do ní nespadá";
  what falls outside is just "zdravotní data" (health data). [rec1
  01:02:04] [rec1 01:10:48]
- **EZD is not the same as EHR.** Czech electronic medical records are
  always tied to the provider who keeps them, and the patient can only
  view them. An EHR in the EHDS sense is broader and relates to everyone
  who handles the data, including patients. "České právo je tady
  diskrepantní s tím evropským" (Czech law is inconsistent with EU law
  here). [page 7] [rec1 01:10:48] [rec1 01:14:43]
- **An IHE profile does not grant legal access.** "Profil IHE sám o sobě
  nezaručuje právní oprávnění k přístupu." [page 16]
- **Safety rule for AI output:** "AI odpověď musí mít zdroj, míru
  nejistoty a člověka, který přijme klinické rozhodnutí" (an AI answer
  must have a source, a degree of uncertainty, and a human who makes the
  clinical decision). [page 19]
- **Data minimization:** "získávejte jen potřebná data" (fetch only the
  data you need), and use minimization and synthetic data where analysis
  is secondary. [page 19] [page 20]

### Recommended practices and pitfalls

- Do not build a requisition (žádanka) system: "není to dobrý nápad.
  Nějaký tady vzniká ... a ten bude ten jediný možný" (not a good idea;
  the state is building the only one). [rec1 01:18:44]
- Do not build an isolated patient database; plan for identity
  verification against the base registers, and keep patient identity,
  author, time, and provenance as metadata on every record. [page 17]
  [rec1 01:16:43]
- Reuse documented IHE transactions instead of inventing APIs, and tell
  your AI coding assistant to use IHE and EEHRxF. [rec1 01:06:05] [rec1
  01:21:56]
- Use FHIR at the edge with a separate internal model, keep rules
  verifiable, and do not fake a production integration; a clearly
  labelled stub is fine. [page 17]
- Validate FHIR output against the Czech profile and report errors as
  OperationOutcome. [page 14] [page 17]
- Test from the clinician's scenario through to the audit log, and include
  negative scenarios. [page 17] [page 20]
- Check the publication status of an IG before relying on it; CI builds
  change. [page 15]
- Do not confuse DocumentReference (metadata and link) with the document
  itself. [rec1 01:21:56]
- Use terminology precisely: say "zpřístupnit", not "sdílet", for medical
  records; keep EZD, EHR, and EHR system apart. [page 7] [page 10] [rec1
  01:18:44]
- Watch the difference between the six EU priority categories and the
  wider set of Czech records. [page 6]

### Other useful facts

- **Abbreviations used in the talk:**
  - PZS: poskytovatel zdravotních služeb, healthcare provider. [rec1
    01:02:04]
  - NIS / AIS / LIS / RIS / PACS: hospital, outpatient, laboratory, and
    radiology information systems, and the image archive. [page 2] [rec1
    01:02:04]
  - EZD: elektronická zdravotnická dokumentace, the legal electronic
    medical record. [page 7]
  - EZ: elektronické zdravotnictví, eHealth. [page 8]
  - ZZS: zdravotnická záchranná služba, emergency medical service. [page
    3] [page 6]
  - NCPeH: National Contact Point for eHealth, the national access point
    for cross-border exchange, run from the Vysočina region. [page 3]
    [rec1 01:06:05] [rec1 01:08:47]
  - MyHealth@EU: the EU platform for cross-border primary use. [page 5]
    [rec1 01:06:05]
  - HDAB: Health Data Access Body, controls secondary use access. [page 5]
  - NOR: Národní onkologický registr (national oncology register); NZIS:
    Národní zdravotnický informační systém. The expansions are inference;
    the slide gives only the abbreviations. [page 18]
  - MKN-10: the Czech ICD-10. [rec1 01:12:50] [rec1 01:23:56]
  - NPEZ, EZKarta, JSU, SZZ: listed on slides without expansion. NPEZ is
    probably the national eHealth portal and SZZ probably "sdílený
    zdravotní záznam" (shared health record, page 8 lists "sdílený
    záznam") (inference). [page 4] [page 8]
- **Transcription fixes:** "oheň" ("fire") is the speaker's joke for FHIR
  [rec1 01:04:05]; "IHM, HDM, HDS" is IHE, MHD, MHDS [rec1 01:06:05];
  "OFLIM" at rec1 01:23:56 is most likely FHIR; "NCLP" is NČLP; "jazikula"
  at rec1 01:06:05 is unclear. The next speaker's name is transcribed as
  both "Hynek Kružík" and "Hynek Kůrůžník". [rec1 01:23:56] [rec1
  01:30:33]
- **Links shown in the talk:**
  - hl7.org/fhir/R4/ (FHIR R4) [page 15] [page 20]
  - hl7.cz/fhir/ (Czech FHIR IGs, CZ Core) [page 15] [page 20]
  - build.fhir.org/ig/HL7-cz/HIE (HIE IG, CZ MHD/ATNA, in development)
    [page 20]
  - profiles.ihe.net/ITI/ (IHE IT Infrastructure profiles) [page 20]
  - mzcr.atlassian.net/wiki/spaces/EPZS (national eHealth manual and API,
    including the base registers; the speaker calls this and the EHDS link
    "extrémně důležité", extremely important) [page 8] [page 20] [rec1
    01:25:56]
  - https://mzcr.atlassian.net/wiki/spaces/EPZS/pages/203096069/Standardy+EHR+-+prioritn+kategorie
    (EHR priority category definitions) [page 6]
  - health.ec.europa.eu / EHDS (EHDS implementation calendar) [page 20]
  - linkedin.com/in/michalopatril/ (speaker; he offers to answer
    questions and consult on projects) [page 22] [rec1 01:27:56]
  - umbrellateam.cz [page 1]
- **Slides are shared on Slack.** The host asked the speaker to send the
  deck so it can be posted to Slack. [rec1 01:29:27]

## Directly about challenge 2

The talk never names challenge 2 aloud. These items bear on an MDT
assistant:

- Page 19, prototype type A "CESTA PACIENTA" (patient journey): "MDT,
  koordinátor, chybějící podklady a termíny. FHIR: Patient,
  DocumentReference, Task, CarePlan. IHE: MHD pro dohledání dokumentů."
  (MDT, coordinator, missing documents and deadlines. FHIR: Patient,
  DocumentReference, Task, CarePlan. IHE: MHD to look up documents.) This
  matches our "missing documents" output: model each expected document as
  a DocumentReference query result, and a missing one as an open Task
  (inference). [page 19]
- Page 19, prototype type B "VYTĚŽOVÁNÍ ZPRÁV" (extracting facts from
  reports): "AI extrakce klinických faktů s citací zdroje, lidským
  potvrzením. FHIR: Observation, Condition, DiagnosticReport. Validace vůči
  profilům." (AI extraction of clinical facts with source citation and
  human confirmation; FHIR Observation, Condition, DiagnosticReport;
  validation against profiles.) This fits our lab trends (Observation),
  diagnoses (Condition), and findings overview (DiagnosticReport)
  (inference). [page 19]
- Page 19, footer: "AI odpověď musí mít zdroj, míru nejistoty a člověka,
  který přijme klinické rozhodnutí." This matches our "every claim points
  to its source" and "the doctor decides" rules, and adds a requirement
  we do not yet have: show a degree of uncertainty. [page 19]
- Page 19, type C "DATA PRO HODNOCENÍ" (data for evaluation: screening,
  quality of care, NOR inputs) says to keep primary clinical data separate
  from secondary analysis. Our assistant is primary use; keep it so
  (inference). [page 19]
- Page 18 lists "PODKLADY → MDT → LÉČEBNÝ PLÁN" (documents for the
  meeting, MDT, treatment plan) and "onko sumář • MDT závěr" (oncology
  summary, MDT conclusion) as primary data. Our patient summary is close
  to an "onko sumář" (inference). [page 18]
- The patient summary is an EHDS priority category, "pro vás dost
  důležitá entita" (quite an important entity for you). Its Czech
  definition is on the MZČR wiki page from slide 6, and the domain IG "PS"
  on hl7.cz. Checking it could give us a recognized structure for our
  summary (inference). [page 6] [page 15] [rec1 01:10:48]
- Structured versus narrative: "jednou z částí challenge, které budete
  dělat ve vašich řešeních, že vždycky musíte evaluovat ... strukturovaná
  data od těch narativních" (part of the challenge you will face is that
  you always have to weigh structured data against narrative), and AI
  "z toho narativu je poměrně úspěšně schopné ... strukturovaná data
  vytvářet" (can fairly successfully create structured data from the
  narrative). [rec1 01:12:50] [rec1 01:14:43]
- Lab values: use NČLP codes rather than LOINC for Czech lab data [rec1
  01:23:56]. The slide's Observation example keeps value and unit together
  (`valueQuantity: {value: 72, unit: "/min"}`) [page 14].
- Patient identity: duplicate patients with the same birth number are
  common in Czech hospitals [rec1 01:16:43]. When we merge documents from
  several sources, the same patient may appear under several records, and
  we should flag identity mismatches rather than silently merge
  (inference).
- Provenance: "DATA + METADATA identita pacienta • autor • čas •
  provenience" (patient identity, author, time, provenance) should travel
  with every record. [page 17]

## Questions and answers

- **No audience questions were asked during or right after this talk.**
  The host thanked the speaker and moved straight to the next talk. [rec1
  01:29:27] [rec1 01:30:33]
- **Host asks for the slides.** The host asked the speaker to email the
  deck so it can be shared on Slack. [rec1 01:29:27]
- **Host asks whether the speaker attends the Sunday results.** The
  speaker is unsure, because his team runs its own hackathon on Monday.
  [rec1 01:30:21] [rec1 01:30:25]
- **Chat during the talk** (chat 01:10 to 01:43) contains only Fireflies
  notetaker notices and the host's request not to add recording bots,
  because everything is recorded centrally. [chat 01:22:31] [chat
  01:28:35] [chat 01:34:59]
- **Chat questions after the talk, not addressed to this speaker:**
  - How to get concrete data for the hackathon, for example a FHIR token
    for test data [chat 02:19:32]. The host answered that data access is
    covered in the afternoon Microsoft and InterSystems sessions [rec1
    02:06:59].
  - Whether the idea or the technical execution is judged more [chat
    02:28:04]. No answer in this recording.

## Open points

Moved to [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
