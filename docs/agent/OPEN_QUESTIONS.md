# Open questions - CodeBridge

Every question the team still has to answer, in one place. Each item says
who can answer it and where it came from.

How to use this file:

- **Add** a question here when you find one, not in another doc.
- **When it is answered**, write the answer where it belongs (a rule in
  [`CLAUDE.md`](../../CLAUDE.md), a fact in [`INDEX.md`](INDEX.md), or a
  decision in [`HACKATHON.md`](HACKATHON.md), with the date and who
  confirmed it), then delete the question here.
- Items marked **blocking** stop work on something until answered.

Source shorthand: "path", "eHealth", "HL7", "Azure", and "FHIR/PHOENIX"
are the research notes listed at the top of [`INDEX.md`](INDEX.md).
`[design-N ...]`, `[chatgpt ...]`, `[juro-notes]`, and `[paper-notes]`
point into the team's design discussion; the citation forms are in
[`PRODUCT.md`](../design/PRODUCT.md#sources-and-speaker-mapping).

## Ask FN Ostrava (the challenge owner)

- [ ] What is "NOCO" in the FNO consultation form ("Otázka na NOCO")?
  Presumably the neuro-oncology centre or its MDT. (`Struktura MDT
  protokolu_FNO.docx`)
- [ ] The spreadsheets describe other patients (colorectal, breast cancer;
  IDs PAC001 to PAC010) than the neuro-oncology PDFs. Are they meant to
  be combined, or are they generic examples of FNO's export format?
  Their README sheets also disagree with the data: IDs "23001 to 23010"
  versus PAC001, and "9" versus 10 records. (`data/rakathon-26/samples/`)
- [ ] Lab results and genetics are listed as inputs (FNO deck, slides 3
  and 6) but are not in the challenge data; the only lab values are one
  undated set in patient 10's PDF, which cannot show a trend. Is there
  more data, or do we generate our own synthetic labs for the lab-trend
  view? (`INDEX.md`; `PRODUCT.md` F-21)
- [ ] Does the documentation include earlier MDT minutes? MDTs are often
  not recorded. (path, rec1 00:43:12)
- [ ] Which code lists appear in the documents: NČLP for labs, MKN-10 for
  diagnoses, any SNOMED CT? (HL7, rec1 01:54:48)
- [ ] May we commit and publish samples derived from FNO data? All
  submissions are published. (`CLAUDE.md`)
- [ ] Can a clinical mentor check the meaning of our extracted data early?
  The HL7 deck recommends it. (HL7, slide 21 notes)
- [ ] Verify: FNO hosts a comprehensive oncology centre (KOC). This is
  background knowledge, not from the talks. (`INDEX.md`)
- [ ] Is there an MDT protocol (minutes) template besides the
  consultation request form? Soňa expected FNO to show "what the MDT
  protocol should look like". (chatgpt P 12:14, R 12:14)
- [ ] How does FNO's MDT work today: who prepares a patient and how long
  it takes, whether preparation is one meeting or async (email, Teams),
  what most often prevents a decision, and who records and follows up
  after the meeting? (juro-notes; chatgpt R 10:29)
- [ ] Can one patient's data sit in different systems than another's?
  (juro-notes)

## Ask Soňa

Soňa is the oncologist on our team; the product is based on her
experience.

- [ ] How long does the MDT spend per patient? Her slots suggest about 5
  minutes (design-1 00:05:41), Juro's recap and paper note say 10 to 15
  (design-1 00:16:16; paper-notes more_notes), and design-3 00:00:00
  says ten seconds for common cases and five minutes for complicated
  ones. In the UI feedback she asked for calendar slots of about 15
  minutes (design-4 00:01:36). Slot time and decision time may differ.
- [ ] What frustrates her most about MDTs? ChatGPT asked; she did not
  answer. (chatgpt R 10:29)
- [ ] Does the proposed mapping of her five sections (anamnéza,
  onkologický súhrn, prítomní, dotaz, záver) onto FNO's expandable items
  work for her? (`PRODUCT.md`, "Reconciling Soňa's sections with FNO's
  items")
- [ ] Are ChatGPT's neuro-oncology items right (integrated WHO diagnosis,
  IDH, 1p/19q, MGMT, RANO, no TNM for primary brain tumours)? Which
  belong on the readiness checklist? (chatgpt R 12:14, R 15:52; `INDEX.md`)
- [ ] Should the app flag rare or hard cases from past MDTs? Her answer
  "to by som asi nechala na IHE" is unclear in the transcript.
  (design-3 00:02:18 to 00:03:01)
- [ ] Is the same doctor on a patient's repeated MDTs, and how long does
  preparation take her today? (design-1 00:04:59; juro-notes)
- [ ] Alerts now have their own tab (mock v2 and v3), and the Overview
  shows only those for the MDT question. In the second review Juro said
  he was glad they are in a separate tab and Soňa did not object, but
  she has not reviewed the alerts themselves yet. Is the split right?
  (design-4 00:02:30 to 00:04:53; design-5 00:14:49)
- [ ] Unknown values (for example pack-years): she wants the field left
  empty; `CLAUDE.md` requires "neuvedeno v dostupné dokumentaci" so a
  gap is not mistaken for "not extracted". Mock v3 keeps the wording in
  a quiet style. Is that acceptable? (design-5 00:07:30)
- [ ] Which screens may show patient names? She wants names in the
  calendar (design-5 00:02:50); should a projected calendar or the
  coordinator's view show initials instead?
- [ ] May the assistant draft the question for the MDT and a proposed
  management (Soňa's example names "stereotaktická radioterapie" as an
  option)? `CLAUDE.md` currently forbids treatment recommendations
  outside the guideline layer, so mock v3 leaves both to the referring
  doctor. A middle ground: the assistant drafts a neutral question
  without naming treatments, marked as a draft. (`PRODUCT.md`, round 6)
- [ ] How far should editing go (F-38)? Mock v3 lets a doctor change any
  extracted or drafted value as a marked override. Should some values
  (for example lab values or dates from a document) stay read-only?
  (design-5 00:19:27 to 00:20:46)
- [ ] What does "onkologické zaťaženie" in the upload checklist mean,
  family oncology history? (design-2 00:08:25)
- [ ] How is a glass slide or photo brought to the meeting captured: typed
  by someone, or heard from the comment? (design-1 00:42:35)

- [ ] For a pilot, may page images or text go to a cloud vision model or
  LLM at all? If yes, only an EU enterprise endpoint with a processing
  agreement and after local redaction (option B), or must everything run
  on FNO's servers (option A)? Does FNO have a GPU server for a local
  vision model? (`docs/design/DATA-PROTECTION.md`)

## Ask the organizers (opening, Slack, coaches)

- [ ] **What is the submission deadline, and what are the judging
  criteria?** Does the idea or the technical execution count more? Asked
  in chat, unanswered. (HL7, chat 02:28:04)
- [ ] Do the official rules say anything about sending challenge data to
  cloud LLMs? The rule we follow came from the InterSystems speaker.
  (Azure, rec2 cc 02:08:19)
- [ ] Which venue is our team at (Prague, Brno, Ostrava)?
- [ ] Are the eHealth deck's "credible MVP" and prototype slides (pages 17
  to 20) used as judging criteria? They were not presented aloud.
  (eHealth, pages 17 to 20)
- [ ] Is the Azure budget of 100 to 200 USD per team per day or for the
  whole event, and what happens when it runs out? (Azure, rec2 00:46:14,
  00:56:00)
- [ ] What are the exact LLM deployment names, regions (EU or global), and
  API versions? Read from the portal, then pin them in `.env.example`.
  The transcript garbled "Astra", "6.1 Sol", "Luna". (Azure, rec2
  00:19:07)
- [ ] What are the rate limits on the shared LLM endpoint? (Azure)
- [ ] Are OpenAI embedding models available in the Rakathon Azure
  environment? (FHIR/PHOENIX, rec2 01:56:30)
- [ ] If we deploy to Azure: how do we read secrets without assigning
  Key Vault roles? (Azure, rec2 01:05:31)
- [ ] Is there a Microsoft prize? Who is the third technology partner,
  transcribed "SECA"? (Azure, rec2 00:09:54, 01:07:58)
- [ ] Are "Výzva 1 to 4" in the oncology path deck official challenges?
  Its "Výzva 2" is not our challenge 2. (path, slides 44 to 48)
- [ ] May the organizers' decks, recordings, transcripts, and the
  challenge data in `data/` stay in our repository once it is published?
  (`HACKATHON.md`)

## Decide as a team

- [ ] **Which tech stack and which LLM deployment do we use?**
- [ ] **Do we read or produce FHIR, and do we aim for the InterSystems
  prize?** Partner tools are not part of the challenge judging, but FHIR
  cannot be added late. (FHIR/PHOENIX, rec2 01:07:58, 02:04:31)
- [ ] Before the repository goes public: remove or anonymize other
  participants' names in the Zoom chat exports and research notes.
  (`HACKATHON.md`)
- [ ] **Is the guideline layer on by default**, and visible before the
  discussion, hidden, or a mix? How far it goes was decided on
  2026-10-16 (quoted statements under the proposed management, the
  guideline opened at the passage, a deviations table; see `CLAUDE.md`).
  (design-2 00:00:36; chatgpt P 14:56, P 16:01, R 10:27; juro-notes)
- [ ] **NCCN guidelines need a login.** Do we get an account for the
  demo, or show NCCN as "not retrieved"? (Other PDFs are not stored in
  the repo; the app opens them online.)
- [ ] Where does the AI model run? Juro said the interface would run on
  the hospital's internal servers (design-4 00:01:17); Soňa wants no
  patient names sent to the AI (design-4 00:00:03). Is the model local
  too, or does pseudonymized text go to a cloud model?
- [ ] How do we define "missing": from guidelines, from the MDT question,
  or by reasoning back from possible diagnoses? (juro-notes)
- [ ] Only if live listening is built: one recording per patient with an
  explicit click, or one long recording split later? May the transcript
  be edited, or only the summary? (design-1 00:43:31, 00:44:31)

## Check ourselves (docs and the web)

- [ ] What are the URL of the InterSystems "FHIR AI Hackathon Kit" and the
  kit's default FHIR credentials? Both should be on the challenge page in
  `HACKATHON.md`. (FHIR/PHOENIX, rec2 01:36:27)
- [ ] Which EHDS priority record types are there? The eHealth slide says
  "six" but lists five. Check the Ministry of Health wiki page in
  `INDEX.md`. (eHealth, page 6)
- [ ] What does the Czech patient summary (EHDS priority type) contain? Use
  it to shape our summary. (eHealth, page 6)
- [ ] Which Czech FHIR guides (CZ Lab, Imaging, HDR, PS) are published and
  which are drafts? (eHealth, page 15)
- [ ] IHE MHD: the slide and the speech describe ITI-66 and ITI-67
  differently. Check profiles.ihe.net before modelling document lookup.
  (eHealth, page 12, rec1 01:21:56)
- [ ] Does SYNDERAI (https://synderai.net/) have oncology or Czech cases we
  can use as test input? (FHIR/PHOENIX, rec2 02:23:08)
- [ ] Is there synthetic data shaped like the Common Cancer Model? The HL7
  Europe Málaga agenda mentions "Synthetic Data for Phoenix". (HL7,
  slide 23)
- [ ] What do the EU guide acronyms on the HL7 slide mean (EU DR, EU MDR,
  EU PMD)? (HL7, slide 18)
- [ ] What does the ECOG performance status scale say for each grade?
  Soňa's paraphrase of grade 4 is loose. (design-1 00:03:42)
- [ ] What are current best practices for MDTs? (juro-notes)

## Low priority: details in the sources

Settle these only if one becomes relevant.

- Garbled names and abbreviations to confirm before citing: vendor and
  network names "eSpráva", "Emedox", "Clickbox", "Stapromise", "Medax";
  JSU, NPEZ, EZKarta, SZZ, HCID (eHealth, rec1 01:02:04, 01:08:47,
  pages 8 and 11); "eHealth Room FHIR Base", the organizers' email
  "info zavináč chex tečka com", "Plie Hack" (HL7, rec1 02:06:06 to
  02:11:49); "legatis", "vysmátý" (path, rec1 00:28:31, 00:30:31).
- PHOENIX: "the final text is out in March": which text, which March?
  (FHIR/PHOENIX, rec2 02:42:17)
- The EUSurvey link from the PHOENIX talk is missing from the chat export.
  (FHIR/PHOENIX, chat 03:13:35)
- Draft Czech eHealth law dates (electronic records from 2029, electronic
  requisitions from 2027/2028) may change; do not present them as current
  obligations. (eHealth, page 4)
- Oncology path deck: slide 30's speaker notes do not match the slide; the
  PD-L1 year in the speech (2006) does not match the chart (2018 to 2021);
  slide 38's MDT shares are read by eye; the title says January 2026 but
  notes cite later sources; speaker labels merge the moderator and the
  speaker in places. (path, slides 1, 30, 31, 38)
- Juro's notes: "Ako veľmi sa summaries ..." breaks off (paper-notes
  open_questions); "crazy scale" is listed as an edge case without
  explanation (juro-notes); what "patient registration" means in
  ChatGPT's list of MDT obstacles (design-2 00:07:36).
- The "Národní dialog" prize venue: the slide says Hotel ILF, the speech
  says the postgraduate institute (ILF). Check if we win. (eHealth,
  page 21)
