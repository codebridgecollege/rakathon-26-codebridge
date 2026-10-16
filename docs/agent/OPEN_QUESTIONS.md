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

## Ask FN Ostrava (the challenge owner)

- [ ] **Blocking: may the challenge data go to cloud LLMs?** That includes
  the coding agents (Claude Code, Copilot), which are cloud LLMs too. Is
  the data anonymous or synthetic, and are only EU deployments acceptable?
  Until this is answered, agents stay out of `data/` and cloud models see
  only synthetic samples. (Azure, rec2 cc 02:08:38; `CLAUDE.md`)
- [ ] **Blocking: what format is the documentation in?** PDFs, scans, text
  exports, FHIR, CDA, DASTA, or CSV? This decides the whole input
  pipeline. (HL7, slides 6 and 8 notes; FHIR/PHOENIX, rec2 01:40:28)
- [ ] Does the documentation include earlier MDT minutes? MDTs are often
  not recorded. (path, rec1 00:43:12)
- [ ] Which diagnoses does the FNO MDT focus on? This decides the
  "missing documents" checklist beyond lung cancer. (`INDEX.md`)
- [ ] Which code lists appear in the documents: NČLP for labs, MKN-10 for
  diagnoses, any SNOMED CT? (HL7, rec1 01:54:48)
- [ ] May we commit and publish samples derived from FNO data? All
  submissions are published. (`CLAUDE.md`)
- [ ] Can a clinical mentor check the meaning of our extracted data early?
  The HL7 deck recommends it. (HL7, slide 21 notes)
- [ ] Verify: FNO hosts a comprehensive oncology centre (KOC). This is
  background knowledge, not from the talks. (`INDEX.md`)

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
- [ ] What is the real name of the tech help Slack channel: "Tech Support"
  or "Tech Helpdesk"? (Azure, rec2 02:04:31)
- [ ] Is there a Microsoft prize? Who is the third technology partner,
  transcribed "SECA"? (Azure, rec2 00:09:54, 01:07:58)
- [ ] Are "Výzva 1 to 4" in the oncology path deck official challenges?
  Its "Výzva 2" is not our challenge 2. (path, slides 44 to 48)
- [ ] May the organizers' decks, recordings, and transcripts stay in our
  repository once it is published? (`HACKATHON.md`)

## Decide as a team

- [ ] **Which tech stack and which LLM deployment do we use?**
- [ ] **Do we read or produce FHIR, and do we aim for the InterSystems
  prize?** Partner tools are not part of the challenge judging, but FHIR
  cannot be added late. (FHIR/PHOENIX, rec2 01:07:58, 02:04:31)
- [ ] Before the repository goes public: remove or anonymize other
  participants' names in the Zoom chat exports and research notes.
  (`HACKATHON.md`)

## Check ourselves (docs and the web)

- [ ] What are the URLs of the InterSystems "FHIR AI Hackathon Kit" and
  its challenge page, and the kit's default FHIR credentials? Linked from
  the InterSystems challenge on rakathon.cz. (FHIR/PHOENIX, rec2 01:36:27)
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
- The "Národní dialog" prize venue: the slide says Hotel ILF, the speech
  says the postgraduate institute (ILF). Check if we win. (eHealth,
  page 21)
