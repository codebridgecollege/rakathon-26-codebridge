# Pre-hack day talks: FHIR workshop (InterSystems) and PHOENIX / XiA

> Settled guidance from this note is folded into [`CLAUDE.md`](../../CLAUDE.md),
> [`docs/agent/INDEX.md`](../agent/INDEX.md), and
> [`docs/agent/HACKATHON.md`](../agent/HACKATHON.md). This note keeps the full detail.

Notes from the last two sessions of the Rakathon 2026 pre-hack day
(15 October 2026, second Zoom recording). They cover what the speakers said
that matters for our entry, challenge 2 (an AI assistant that prepares a
patient overview for a multidisciplinary team meeting, set by Fakultní
nemocnice Ostrava). These are working notes and may contain errors. Check
the source before relying on a detail.

## How to read the citations

- `[rec2 hh:mm:ss]` is a timestamp in the ElevenLabs transcript
  `docs/sources/presentations/GMT20261015-105031_Recording.elevenlabs.md`
  (the timestamp of the speaker block that contains the statement; long
  blocks run about two minutes). Where the ElevenLabs transcript drops a
  passage, the citation says "Zoom captions" and the time comes from
  `docs/sources/presentations/GMT20261015-105031_Recording.cc.vtt`.
- `[page N]` is the PDF page of
  `docs/sources/presentations/Rakathon_HoF_PHOENIX_XiA.pdf`. The slide
  numbers printed on the slides differ from the PDF page numbers (for
  example PDF page 10 shows "09"), so always use the PDF page.
- `[chat hh:mm:ss]` is a line in the Zoom chat,
  `docs/sources/presentations/GMT20261015-105031_RecordingnewChat.txt`. The
  chat clock runs about 27 minutes 50 seconds ahead of the recording clock
  (the PHOENIX e-mail is posted at chat 03:13:10, when the speaker says he is
  putting it in the chat at rec2 02:45:22).
- "(inference)" marks our own reading, not something a speaker said.

Known gap in the ElevenLabs transcript: it drops the answer about cloud LLMs
and patient data (Zoom captions 02:08:19 to 02:09:39) and labels the next
block 02:08:28 instead of about 02:09:43. The answer is recorded below from
the Zoom captions.

---

# Part 1: FHIR and AI on InterSystems IRIS (technical workshop)

- **Title:** technical workshop on FHIR and on using FHIR with AI on the
  InterSystems IRIS platform ("technický workshop o FHIRu, vlastně k použití
  FHIRu a umělé inteligence nad platformou InterSystem IRIS")
  [rec2 01:20:25]
- **Speaker:** Ondřej Hoferek, InterSystems (speaker_4; introduced by the
  host at [rec2 01:11:10], the surname comes from the transcript and
  captions and may be misspelled). Host: speaker_0.
- **Sources:** transcript and Zoom captions of the second recording, Zoom
  chat. The speaker shared slides and a live browser and notebook demo, but
  we have no copy of his deck.
- **Time range:** speaker_4 joins at [rec2 01:12:09]; short InterSystems
  intro [rec2 01:12:55] to [rec2 01:16:36]; screen-sharing problems and a
  pause [rec2 01:17:02] to [rec2 01:20:22]; the workshop itself
  [rec2 01:20:25] to [rec2 02:06:48]; questions [rec2 02:06:48] to
  [rec2 02:12:12].

## Summary

InterSystems, the main technology partner of Rakathon, runs its own side
challenge with a prize of 1500 EUR for teams that use InterSystems IRIS,
either as the data platform behind AI (SQL, vector search, agent tools) or
for interoperability through its FHIR server [rec2 01:20:25]. The speaker
argued that the hardest practical problem for hospital AI is not the model
but connecting to the hospital information system (NIS), which controls the
data, and that HL7 FHIR is becoming the standard way to do that in Europe
and in Czechia [rec2 01:24:25] [rec2 01:26:25]. He walked through the
"FHIR AI Hackathon Kit", a GitHub template that starts IRIS with a ready FHIR
repository in Docker, plus Jupyter notebooks in Python for loading CSV data,
loading and searching FHIR resources, building transaction bundles, vector
search with embeddings, agent tools, and an MCP server built with FastMCP
[rec2 01:36:27] to [rec2 01:58:30]. Teams have no access to a real or test
hospital system during the hackathon, so the kit's FHIR server is the way to
show that a solution can read from and write to FHIR [rec2 01:36:27]
[rec2 01:38:28]. The data preloaded in the kit is generated and is not
challenge data [rec2 01:50:29] [rec2 02:02:31]. His main warning: teams
that postpone FHIR as "nice to have" cannot fit it in later in a 24-hour
hackathon, so decide at the start, keep it simple, and skip things like
OAuth [rec2 02:04:31]. On cloud LLMs he said that sending data to a cloud
model is fine only if the challenge owner confirms the data is anonymous
and may be sent there; otherwise a local model is needed, which InterSystems
does not provide [rec2 02:08:19, Zoom captions]. He also mentioned that
Fakultní nemocnice Ostrava (our challenge owner) already uses InterSystems
technology for integration between its systems [rec2 01:14:55].

## Guidance for our challenge

### Standards and data formats

- In Czechia the local data exchange standard is DASTA, but HL7 FHIR is the
  de facto interoperability standard now and for the future, and the largest
  Czech NIS vendors are starting to support it [rec2 01:26:25].
- FHIR is a standard data model plus a REST API to read, create, update and
  search resources. It aims to cover about 80 % of typical health data and
  can be extended (profiles) [rec2 01:28:26] [rec2 01:30:26].
- Resources he named: `Patient`, `Practitioner` (a doctor), `Observation`,
  `Condition` ("typicky diagnózy nebo problémy", typically diagnoses or
  problems), medications, `CarePlan`, `Encounter`, questionnaires and their
  answers [rec2 01:28:26] [rec2 01:30:26] [rec2 01:54:29].
- A `CarePlan` can show which step of a treatment plan is open now or what
  it is waiting for [rec2 01:30:26].
- Each FHIR element carries one defined meaning, so the risk that data is
  misread between systems is much lower than with a one-off integration
  [rec2 01:32:26].
- Both the EU and the Czech eHealth strategy plan to share data in FHIR, so a
  solution that reads (and ideally publishes) FHIR is likely to find the data
  it needs in the near future [rec2 01:32:26].
- Use FHIR R4: it is the most used version, including for European exchange.
  R5 is also offered by the server wizard [rec2 01:50:29].
- To store one clinical event at once (for example an examination, the
  document written about it, its structured observations and orders), send a
  `Bundle` with `type` = `transaction`; each entry holds a resource and the
  request (for example POST). Notebook 3.4 builds a bundle with an
  `Encounter` referencing a patient and an `Observation` for heart rate
  [rec2 01:52:29] [rec2 01:54:29].
- FHIR defines search parameters for many fields and lets profiles define
  new ones; the speaker considered custom parameters too deep for a 24-hour
  hackathon [rec2 01:44:29].
- If your own outputs have a reasonable mapping to FHIR, ask a coding
  assistant to propose the mapping; publishing results into FHIR counts as a
  plus for the InterSystems challenge [rec2 01:46:29] [rec2 02:02:31].

### Tools and infrastructure

- **InterSystems IRIS** is a multi-model database (SQL, documents, key-value)
  with vector search built into SQL, and it can create a FHIR repository
  "na jedno volání skriptu nebo dvoje zakliknutí" (with one script call or
  two clicks) [rec2 01:34:27] [rec2 01:36:27].
- **FHIR AI Hackathon Kit**: a GitHub template linked from the InterSystems
  challenge page, which is linked at the end of the InterSystems challenge
  text on the Rakathon website. Clone it, install Docker, and run its Docker
  Compose file to get IRIS with a pre-created FHIR repository. The exact URL
  was not read out [rec2 01:36:27] [rec2 01:38:28] [rec2 01:58:30].
- The kit has a "Tutorials" section with setup notes and Jupyter notebooks in
  Python. Python connects to IRIS as a normal SQL database, with connection
  settings already matching the local container. Other languages (.NET,
  Node.js) work too [rec2 01:38:28].
- Notebook 1 (SQL basics): create a table, insert rows, load a CSV with
  pandas, infer column types and map them to IRIS SQL types; it includes a
  reusable class for loading CSV files, because some challenge data will
  arrive as CSV [rec2 01:38:28] [rec2 01:40:28].
- Pitfall seen in the demo: rerunning the create-table cell fails with
  "table already exists"; use `CREATE TABLE IF NOT EXISTS` [rec2 01:38:28]
  [rec2 01:40:28].
- **Management Portal** (the IRIS admin web UI) lets you browse tables and
  run SQL by drag and drop, to check that data arrived [rec2 01:40:28].
- Loading FHIR data: POST each JSON file from a folder to the FHIR base URL
  with the server's default user name and password; then `GET
  [base]/Patient` returns all patients as JSON [rec2 01:42:28].
- For large FHIR files (gigabytes), copy them into the container or a shared
  folder and use the kit's file import script, which reads local files
  instead of going over HTTP and is faster [rec2 01:42:28] [rec2 01:44:29].
- Searching: the notebooks use Python `requests` with basic authentication
  and search parameters such as a patient name (the demo searched for a
  patient named "Tish"). To shrink responses, use the elements parameter
  (FHIR spells it `_elements`, inference from the transcript's "search
  parametru elements"), for example to return only id and gender
  [rec2 01:44:29] [rec2 01:46:29].
- A Python FHIR client library (not named) gives a simpler API over REST
  with chained search parameters; plain REST may suit a simple web app better
  [rec2 01:46:29].
- Notebook 3.3 creates single resources (`Patient`, `Observation`,
  `Condition`) as JSON objects, validates them, and uploads them
  [rec2 01:48:29].
- The FHIR server includes a **Swagger UI** to list resources, see their
  search parameters, and try calls [rec2 01:48:29] [rec2 01:50:29].
- **FHIR Management Page** in the portal shows the defined FHIR servers and
  has a wizard to create a new one (choose namespace, name, FHIR version,
  URL). Its **FHIR Explorer** link connects to any FHIR server URL and
  browses its data [rec2 01:50:29].
- A wizard projects FHIR data into SQL tables, so FHIR data can be queried
  with SQL from the portal or from Python [rec2 01:54:29] [rec2 01:56:30].
- Vector search notebook: a table with a `VECTOR` column, embeddings created
  in Python with small OpenAI models (cost "centy", cents), chunking of long
  texts, similarity search. The speaker did not know whether those models are
  in the Azure environment provided at Rakathon; the examples can be switched
  to other models [rec2 01:56:30].
- The last two notebooks build Python agent tools (a SQL tool over a demo
  "superheroes" table, a vector search tool, a FHIR data tool) and an MCP
  tool with **FastMCP** (transcript "Fast MCP") that serves IRIS data
  [rec2 01:56:30] [rec2 01:58:30].
- RAG over IRIS also works through LangChain or LlamaIndex [rec2 02:00:30].
- To run IRIS remotely (for example in the team's Azure environment), start
  an IRIS container there and use the script in Tutorials, FHIR section,
  "3.0 Setup FHIR Server": set host or IP, port, IRIS credentials, server
  name and endpoint, and it creates the FHIR server with one command
  [rec2 01:58:30] [rec2 02:00:30].

### Data access

- The resources preloaded in the kit's FHIR server are generated; they are
  not data from any challenge owner. You can delete them in the UI or create
  a new server [rec2 01:50:29] [rec2 02:02:31].
- Some challenge owners deliver data already in FHIR, which can be uploaded
  unchanged; others export in other formats, which teams can convert to FHIR
  with coding agents ("ve většině případů by to mělo bejt možný a
  příhodný", in most cases it should be possible and suitable)
  [rec2 01:40:28] [rec2 01:42:28].
- During Rakathon there is no access to a test or real hospital environment
  to show interoperability; use the IRIS FHIR repository to simulate it
  [rec2 01:36:27] [rec2 01:38:28].
- For some data teams must request it, and during that process the owner and
  team will confirm what may be done with it [rec2 02:09:18, Zoom captions].

### What the jury and the challenge owners expect

- The InterSystems challenge (prize 1500 EUR) rewards using IRIS for
  interoperability or as the data platform with agents, vector search, or a
  combination [rec2 01:20:25].
- They will look at whether data sits in IRIS with tools that your agents
  use; it does not matter whether access is SQL, your own API, or the FHIR
  server, and combinations are interesting [rec2 01:24:25].
- Showing interoperability through the FHIR server is "důležitej bod" (an
  important point) for the InterSystems challenge and "může to bejt
  zajímavý i pro ty hodnotitele těch výzev" (may also interest the judges of
  the individual challenges), though not every challenge needs it
  [rec2 01:38:28] [rec2 02:00:30].
- The host said earlier, before this session, that Microsoft and InterSystems
  tools are recommended but not mandatory and "nebude to součástí
  hodnocení" (will not be part of the evaluation), except that the
  InterSystems prize is hard to win without them [rec2 01:07:58].
- What convinced past InterSystems juries: see "Questions and answers"
  [rec2 02:07:09].

### Privacy, legal, and safety constraints

- Cloud LLMs: allowed only if the challenge owner confirms the data is
  anonymous and may go to cloud models; otherwise use a local model, which
  InterSystems does not offer. Most owners tried to provide synthetic or
  anonymous data for this reason, but confirm with the owner or the hospital's
  technical team [rec2 02:08:19, Zoom captions] [rec2 02:09:01, Zoom
  captions].
- The NIS (hospital information system) controls the data, and integrating
  with existing clinical systems for inputs and outputs is often the hidden
  blocker for real deployment [rec2 01:24:25] [rec2 01:26:25].
- Explainability is something a team can control in its own solution
  [rec2 01:24:25].
- InterSystems' own AI-based hospital system (transcript "IntelliCare") holds
  EU MDR certification class IIa, which shows that AI that prepares clinical
  content is regulated as a medical device (inference about relevance)
  [rec2 01:12:55].

### Recommended practices and pitfalls

- Do not postpone FHIR as "nice to have": "už se vám nepodaří později si to
  na to řešení napasovat" (you will not manage to fit it in later). If it
  makes sense, have an assistant propose the FHIR design and start with it at
  the beginning [rec2 02:04:31].
- Do not try to cover every FHIR feature; focus on what you must present
  after 24 hours. Past teams lost time on OAuth authentication and
  authorization. "Keep it simple" [rec2 02:04:31].
- Talk to the InterSystems mentors early about architecture to avoid dead
  ends; they can also bring in challenge owners or Microsoft
  [rec2 02:02:31].
- Use coding assistants for everything you can, including learning FHIR
  from its documentation [rec2 01:30:26] [rec2 02:02:31].
- Pitfall from the demo: when authentication expires, the FHIR server
  answers as if it has no data instead of returning an error, "aby
  neprozradil, kde se stala chyba" (so as not to reveal where the error
  happened); check credentials before debugging queries [rec2 01:50:29].
- If your main data has a reasonable FHIR mapping, the FHIR server can be
  the primary database, accessed through REST [rec2 02:02:31].

### Other useful facts

- InterSystems mentors on site: Prague (the speaker and Gabriel), Ostrava
  (Dan Kutáč), Brno (Radek Zájem and Daniel Drozdov); online mentors cover
  the night 24/7 [rec2 02:04:31].
- Slack: channel "Tech Helpdesk" for technical problems and a channel for the
  InterSystems challenge [rec2 02:04:31] [rec2 02:06:32].
- The host asked the speaker to post his presentation to the challenge channel, the
  helpdesk, and announcements [rec2 02:08:28].
- Celestinus is a health-tech incubator run with InterSystems: a three-month
  online program; at least one team will get a "wild card" into the next run
  [rec2 01:14:55] [rec2 01:17:58].
- FHIR documentation on hl7.org has a "Resources" tab listing all resources
  and the REST API rules [rec2 01:30:26].
- InterSystems presents again on the hackathon day [rec2 02:11:31].

## Directly about challenge 2

- Our challenge owner uses InterSystems for integration: "jedna, která
  tuhle technologii pro tyhle účely používá, tak je právě třeba fakultka v
  Ostravě" (one hospital that uses this technology for these purposes is the
  faculty hospital in Ostrava) [rec2 01:14:55]. A FHIR-shaped input or output
  may therefore be close to how FNO already moves data (inference).
- The transaction example fits an MDT record well: "zdokumentovaný nějaký
  vyšetření ... založit dokument, kterej o tom vyšetření vzniknul ...
  strukturovaný informace o tom, co se při tom vyšetření zjistilo" (a
  documented examination, the document written about it, and structured
  information about what it found) [rec2 01:52:29]. This matches our need to
  link each extracted fact to its source document (inference).
- Treatment plans in FHIR: "Vy můžete zjistit, kterej krok v tom konkrétním
  plánu je teďka otevřenej ... nebo že teďka ještě čeká na nějakej krok"
  (you can find which step of the plan is open now, or that it is still
  waiting for a step) [rec2 01:30:26]. A plan that waits for a step could
  feed our "missing documents" output (inference).
- Long clinical texts: the vector search notebook shows how to split long
  texts into chunks and index them, which is the usual way to retrieve the
  relevant parts of a patient's documents for a summary [rec2 01:56:30].
- Explainability "je ale něco, co vy můžete v tom vašem řešení ovlivnit"
  (is something you can influence in your solution) [rec2 01:24:25].
- Inputs live in the NIS, and outputs often have to go back into it
  [rec2 01:26:25].

## Questions and answers

- **Audience exercise: what is the biggest technical obstacle to deploying
  such projects?** Chat answers "NIS" and "explainability". The speaker:
  the NIS is right, because it controls the data and integrating with
  existing clinical systems often blocks deployment; explainability is
  something teams can influence themselves [rec2 01:24:25] [chat 01:53:34]
  [chat 01:53:45].
- **What convinced the jury for your past winners?** (Stan Nagy in chat,
  read by the host.) Whether teams thought through how to work with the data,
  how to represent it in FHIR, what in the app can be interoperable, and how
  far they got; past hackathons were longer than 24 hours, so they will take
  that into account. Also overall impact, how well the challenge was solved,
  what teams added beyond the brief, innovation, and use of interoperability
  or of making data available to agents and LLMs [chat 02:34:40]
  [rec2 02:06:48] [rec2 02:07:09].
- **The notebooks use the OpenAI library. With health data (even fake or
  anonymized), may we use cloud LLMs for RAG and chatbots in the app, or do
  we need local models?** (JakubLorenc in chat.) Each challenge has its own
  input data. If the challenge owner confirms the data is anonymous and may be
  sent to cloud models, that is fine; if not, a local model is appropriate,
  which InterSystems does not provide. Most owners tried to provide synthetic
  or anonymous data for cloud use, but always check with the owner or the
  hospital's technical team; for some data the request process will settle
  what may be done with it [chat 02:34:34] [rec2 02:08:19, Zoom captions] to
  [rec2 02:09:39, Zoom captions].
- **Did every team get its solution working last year?** (Veronika
  Sedlářová in chat.) Some teams on the InterSystems platform succeeded and
  some did not, and the same for teams without it; it depends on the
  complexity and innovation of the concept, and this 24-hour format will be
  new for them too [chat 02:38:15] [rec2 02:10:41] [rec2 02:10:48].

## Open points

Moved to [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
---

# Part 2: Oncology solutions that work beyond one hospital (Hospitals on FHIR, PHOENIX, XiA)

- **Title:** "Beyond the hackathon: Oncology solutions that work beyond one
  hospital. Hospitals on FHIR, PHOENIX, XiA" [page 1]; announced by the host
  as "how to build an oncology solution that works beyond one hospital.
  FHIR and PHOENIX" [rec2 02:12:13].
- **Speaker:** Luc Chatty (Fyrstain, HL7 Europe, Hospitals on FHIR) [page 1]
  (speaker_5). The transcript garbles the name as "Luc Châtillon" and "Rika
  Shatiho" [rec2 02:12:13] [rec2 01:17:58]. Host: speaker_0. In English.
- **Sources:** transcript of the second recording; slides
  `docs/sources/presentations/Rakathon_HoF_PHOENIX_XiA.pdf` (16 PDF pages;
  page 11 is a picture slide, "The only way forward, is together. Help us
  shape the oncology standards of the future."); Zoom chat.
- **Time range:** host introduction [rec2 02:12:13]; talk [rec2 02:13:06]
  to [rec2 02:38:57]; questions [rec2 02:39:05] to [rec2 02:46:22]; host's
  closing of the pre-hack day [rec2 02:46:22] to the end (about 02:50:30).

## Summary

The speaker argued that a convincing prototype is easy now; the real test is
whether the second hospital can deploy it without rebuilding everything,
because each hospital has different systems, identities, workflows and
codes [rec2 02:13:06] [rec2 02:15:06] [page 2]. FHIR is part of the answer,
but it is "the toolbox, not the blueprint": a team must also agree on
profiles, terminology, security and workflows, and "'We store JSON' does not
mean 'we are interoperable'" [rec2 02:17:07] [page 3]. The hard part in a
real hospital is turning about 150 separate applications and databases into
one FHIR API that gives one aggregated view of a patient [rec2 02:19:07]
[rec2 02:21:08]. The EU's European Health Data Space (EHDS) law will require
common FHIR formats for the patient summary, prescriptions, dispensations,
lab reports, imaging reports and discharge reports [rec2 02:21:08] [page 6].
PHOENIX, an HL7 Europe initiative, is building a European Common Cancer Data
Model on top of EHDS, using the American mCODE as a main input; its
conceptual and logical models are published as a ballot implementation guide,
but the FHIR profiles are still work in progress [rec2 02:23:08]
[rec2 02:31:11] [page 9]. For test data he pointed to SYNDERAI, an HL7 Europe
library of synthetic EHDS examples (lab reports, patient summaries, discharge
reports) [rec2 02:23:08] [page 6]. XiA is an EU co-funded training project
for interoperability skills [page 12] [rec2 02:33:12]. His closing advice:
start from the clinical workflow, agree on shared "FHIR contracts", use codes
instead of free text, plan trust and provenance from day one, test with
synthetic data, and share your mappings and assumptions [rec2 02:37:12]
[page 15]. In the questions he estimated 3 to 5 years from idea to a
certified medical device and stressed that real hospitals still send PDFs,
so a product needs its own converter into a standard format
[rec2 02:41:01] [rec2 02:42:17] [rec2 02:44:18].

## Guidance for our challenge

### Standards and data formats

- FHIR lets you say what hospital data looks like ("pathology can be a FHIR
  condition") and map local codes to international terminologies such as
  SNOMED and LOINC [rec2 02:15:06].
- FHIR is used differently in oncology than for, say, flu: the field has its
  own workflows and terminologies, so "FHIR provide the toolbox. It does not
  really provide the blueprint" [rec2 02:17:07].
- A FHIR deployment needs four agreements on top of the API: profiles (which
  rules), terminology (which meaning), security (who can access), workflows
  (when and why) [page 3].
- EHDS defines European formats for: patient summary (International Patient
  Summary), prescription, dispensation of medication, lab reports, imaging
  reports, discharge reports; they are to be exchanged in FHIR across Europe
  "in two years" [rec2 02:21:08]. The slide names the format family EEHRxF
  (European electronic health record exchange format) [page 6].
- PHOENIX aims to "take the FHIR profiles for EHDS and ... specify them for
  oncology" [rec2 02:23:08], as "an EHDS-aligned cancer data model and FHIR
  implementation guidance for care and research reuse" [page 6].
- The PHOENIX specification (title in chat: "HL7 Europe Common Cancer Model
  v1.0.0-ballot") is at https://build.fhir.org/ig/hl7-eu/cancer-common/ and
  is under development [page 9] [chat 03:14:38].
- It contains a conceptual model (the objects in a cancer patient journey,
  with definitions) and logical models with cardinalities, for example
  "cancer condition at diagnosis" with subject, histology behavior and body
  site [rec2 02:29:10] [rec2 02:31:11].
- There is no PHOENIX FHIR model yet ("we don't have yet a FHIR model");
  for a prototype, fit the data to standard FHIR resources as closely as
  possible and read mCODE, the American oncology model (transcript "M code"
  and "Xcode") [rec2 02:27:10] [rec2 02:31:11] [page 9].
- Illustrative resource choices for an oncology prototype: person and visit
  (`Patient`, `Encounter`); cancer diagnosis (`Condition`, `Observation`);
  tests and reports (`DiagnosticReport`, `Specimen`); treatment events
  (`Procedure`, `MedicationAdministration`); response over time
  (`Observation` plus clinical context) [page 10].
- "Real interoperability also needs terminology, patient context,
  provenance and validation" [page 10].
- "Choose FHIR contracts": prefer reusable resources and established
  profiles, and agree on the same ones across all groups that exchange data
  [page 15] [rec2 02:37:12]. "FHIR contract" here means the agreed set of
  resources and profiles that both sides use (inference from the slide
  wording).

### Tools and infrastructure

- Three ways to offer a FHIR API: your own database with your own FHIR API,
  a "FHIR warehouse" product that implements the whole specification, or a
  mix [rec2 02:15:06] [rec2 02:17:07].
- Reference architecture: departmental sources (EHR, lab, imaging, oncology)
  feed a governed integration layer (identity and provenance, mapping and
  terminology, validation and access), which exposes FHIR APIs and profiles
  for clinical care, oncology innovation and research. "The point is not to
  replace the hospital; it is to make its data usable through agreed
  services" [page 5].
- Pipeline: hospital data (EHR, LIS, imaging) goes through a mapping layer
  (context, conversion) to a FHIR API (resources, search) used by an oncology
  app [page 3].
- XiA open learning material on interoperability and EHDS:
  https://learn-health-data-exchange.netlify.app/en/ (work in progress)
  [page 12] [rec2 02:33:12] [rec2 02:35:12].

### Data access

- **SYNDERAI** (transcript "CINDEREI"), an HL7 Europe library of synthetic
  EHDS examples: https://synderai.net/ . In the demo it held European lab
  reports (about 237 patients and 4000 lab report instances), International
  Patient Summaries, and discharge reports; medication and imaging reports
  were "not yet available" [rec2 02:23:08] [page 6] [chat 03:14:29].
- "Go find some synthetic data, some example from the internet. Try to see
  how it actually goes when your model is put under stress" [rec2 02:37:12].
- "Test outside your demo: use realistic datasets and validate instances"
  [page 15].

### What the jury and the challenge owners expect

- The speaker's checklist for Rakathon teams ("for the first 48 hours";
  the hackathon itself lasts 24 hours [rec2 02:04:31]): start with the
  workflow, choose FHIR contracts, reuse coding systems, plan trust from day
  one, test outside your demo, share the artefacts [page 15].
- "Your future customer is not only the clinician: it is also the next
  hospital" [page 15]; "Don't just win the hackathon. Make the next hospital
  say yes" [page 16].
- Host, closing the day: it is an AI hackathon, so "porota pak čeká, že i
  ta kvalita těch výstupů bude vyšší než obecně" (the jury will expect higher
  quality output than usual) [rec2 02:48:22].
- Host: hacking starts at 9:30 in Prague, Brno and Ostrava with challenge
  introductions, mentors, rules and judging; a hacker prize voted by
  participants is announced on Sunday [rec2 02:46:22] [rec2 02:48:22].

### Privacy, legal, and safety constraints

- FHIR turns hospitals from pushing data to known recipients into answering
  requests from outside, a big change for security: "if you have access,
  doesn't mean that you have the right to see everything" [rec2 02:17:07].
- "Plan trust from day one: identity, access, provenance and safety matter"
  [page 15]; the validation stage includes "conformance tests" and "safety &
  governance" [page 13].
- From hackathon idea to a certified medical device takes about 3 to 5
  years, based on feedback from startups he works with [rec2 02:41:01].

### Recommended practices and pitfalls

- "Always start with the clinical context and what you want to do from a
  clinical point of view" [rec2 02:37:12]; "Who makes the decision, using
  which clinical context?" [page 15].
- "Use coding system. Use terminologies. Don't use text. You need to have
  codes. You need to know what they mean" [rec2 02:37:12]; "Do not hide
  local meanings in ad-hoc strings" [page 15].
- "Share the artefacts: document mappings, assumptions, examples and tests"
  [page 15]; "specify, because interoperability is about sharing
  information" [rec2 02:37:12].
- The interesting lesson of a proof of concept is where it fails, not what
  goes right [rec2 02:19:07].
- Build for EHDS formats, but also have a fallback for hospitals that only
  have PDFs and free text: "you will probably need to also to have a strategy
  to come and grab the data, transform it into the way you actually want it
  to be. And it's easier if the target format is actually something
  standardized" [rec2 02:42:17] [rec2 02:44:18].
- After certification, startups install in the first hospital "and then
  realize, well, nothing is pluggable" [rec2 02:41:01] [rec2 02:41:30].

### Other useful facts

- Hospitals on FHIR: an HL7 Europe community of healthcare providers and FHIR
  implementers that shares where implementations fail; vendors can find
  hospitals willing to try their product there [rec2 02:17:07]
  [rec2 02:19:07] [page 4].
- PHOENIX started about two years ago with cancer institutes, healthcare
  providers and vendors from the Netherlands, France, Belgium, Germany and
  others; motivation: the European Commission funded about 3000 cancer
  projects without one common data model [rec2 02:27:10] [rec2 02:29:10].
- XiA means "Xpanding Innovative Alliance", EU co-funded, 2025 to 2028
  [page 12]. The transcript's "Share project" and "Erasmus project" most
  likely refer to XiA (inference from context) [rec2 02:13:06]
  [rec2 02:33:12].
- Contacts: PHOENIX e-mail phoenix@hl7europe.org; an EUSurvey form (only the
  title survived in the chat export); XiA community of practice; websites
  hospitalsonfhir.eu and xia-project.iscte-iul.pt; events in Pisa on 19 to 21
  October [chat 03:13:10] [chat 03:13:35] [rec2 02:45:22] [page 16].

## Directly about challenge 2

- On the shape of a cancer history (our timeline): "cancer is not just about
  one pathology. Um, it can disappear, come back. You can have multiple
  stage, multiple treatments, uh- Different responses to different
  treatments. And sometime it will come back fifteen years later, and you
  need to go back to the information you had before." [rec2 02:25:09]
- "A cancer journey is not a single record. Clinical decisions evolve over
  time, across departments, teams and organisations." Stages: diagnosis
  (tumour type), staging (extent of disease), treatment (therapies and
  events), response (assessments), follow-up (longitudinal status) [page 7].
  These stages are a natural skeleton for our treatment timeline (inference).
- The slide separates "Direct care: decisions, context, workflow" from
  "Research: observations, cohorts, reuse" [page 7]; the transcript's
  "primary care, so decision making, getting the context" is most likely
  "direct care" (inference from the slide) [rec2 02:25:09]. An MDT assistant
  belongs to direct care.
- On the patient summary: "How do I go from one hundred and fifty
  application to create one patient summary?" and "one single FHIR API that
  will give me, for example, one aggregated view of a patient"
  [rec2 02:21:08].
- The resource list on page 10 lines up with our outputs (inference): the
  diagnosis and stage in the summary with `Condition` and `Observation`, lab
  trends with `Observation` and `DiagnosticReport`, findings with
  `DiagnosticReport` and `Specimen`, timeline events with `Procedure` and
  `MedicationAdministration`, response over time with `Observation`
  [page 10].
- PHOENIX's logical model for "cancer condition at diagnosis" (subject,
  histology behavior, body site) suggests the minimum fields for our
  diagnosis entry [rec2 02:31:11].
- On real input data: "they just got PDFs. Well, what do I do with PDFs? ...
  that's the hospital world, where you still have people doing text"
  [rec2 02:42:17]. Our assistant is exactly such a converter from documents
  to structured data (inference).
- On provenance: the slides list "identity & provenance" as part of
  integration and "provenance" as a requirement of real interoperability,
  which matches our rule that every fact cites its source [page 5]
  [page 10] [page 15].
- SYNDERAI's synthetic lab reports, patient summaries and discharge reports
  could serve as test input for lab trends and summaries if FNO data is late
  or limited; they are not oncology-specific as far as the talk showed
  [rec2 02:23:08].

## Questions and answers

- **How many years from a hackathon idea to an approved, certified AI
  oncology device in European hospitals?** (Host.) About 3 to 5 years, from
  what startups he works with report; after certification they install in
  the first hospital and find nothing is pluggable [rec2 02:39:05]
  [rec2 02:41:01] [rec2 02:41:30].
- **So should teams build for the world of five years from now?** (Host.)
  Yes. EHDS means software will be obliged to expose the EHDS formats, so
  look at the European Patient Summary and the other EHDS specifications;
  he said "the final text is out in March" (which text was not stated). The
  formats will be expected everywhere in about five years but will not
  actually be everywhere, so also plan a fallback for PDFs and text, and be
  ready to build the converter yourself. His image: many hospitals still run
  on steam power; "FHIR is electricity" [rec2 02:41:36] [rec2 02:42:17]
  [rec2 02:44:18].
- **How can people reach you?** PHOENIX by e-mail (phoenix@hl7europe.org,
  posted in chat); XiA through its community of practice, to hear first about
  EHDS trainings; personal questions directly to him [rec2 02:45:22]
  [rec2 02:46:07] [chat 03:13:10].

## Open points

Moved to [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
