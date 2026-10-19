# Hackathon logistics - CodeBridge

What the organizers told us about the event, the infrastructure, and the
judging, plus decisions we agree with them. This changes during the event;
update it when Slack or the organizers say something new, and date the
entry. Sources are the research notes in [`docs/research/`](../research/),
mostly [Azure and logistics](../research/2026-10-16-talk-azure-and-logistics.md)
and [FHIR workshop and PHOENIX](../research/2026-10-16-talk-fhir-workshop-and-phoenix.md).

## Timeline

- **16 October 2026, 9:30:** opening in Prague, Brno, and Ostrava at the
  same time: challenge introductions, mentors, the official rules, and the
  judging criteria. Hacking starts after the morning programme. The
  hackathon lasts 24 hours. The Prague venue is the Plzeňská campus of the
  Second Faculty of Medicine, Charles University, in Motol.
- **Sunday:** finals and the hacker prize, which participants vote for.
- Deadline, judging criteria, official rules, and our venue are pending;
  see [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

## Data

- Challenge data is posted in the challenge's Slack channel, at the latest
  after the opening block on 16 October.
- **16 October 2026:** we received `rakathon-26.zip`. It is committed as
  `data/rakathon-26.zip` and extracted to `data/rakathon-26/`. What it
  contains is described in [`INDEX.md`](INDEX.md#the-challenge-data).
- In Ostrava, and for the Prague "MDT Copilot" challenge, the
  InterSystems mentors hand out challenge data, in person or on Slack
  (InterSystems deck, `6 - Rakathon 2026 InterSystems Challenge
  Intro.pptx`, slides 6 and 8).
- The Azure team portal holds data only for the challenges set by VZP (the
  Czech general health insurance company), not ours.
- Public data may be used too.
- **17 October 2026: our own synthetic patient `S01_pacient`.** FNO's
  PDFs hold at most one lab panel per patient, so the team wrote a fully
  fictional neuro-oncology patient (glioblastoma, four dated lab sheets
  over nine months) to show lab trends from real document values. It is
  our work made during the event, not FNO data and not derived from it:
  the Markdown sources and the rendered PDF are in
  [`samples/S01_pacient/`](../../samples/README.md), the page images and
  Tesseract output in `data/derived/pages/S01_pacient/`, and the fixture
  data in `fixtures/data/mock-case-S01.json`.
- **17 October 2026: our own synthetic patient `S02_pacient`.** A fully
  fictional rectal cancer patient (neoadjuvant chemoradiotherapy, low
  anterior resection, a rising CEA over four lab sheets) for the intake
  demo: a FHIR referral is imported in "Nový pacient" and the documents
  are uploaded one PDF each. Our work made during the event, not FNO
  data: the sources, the combined PDF, the upload PDFs and the FHIR
  referral are in [`samples/S02_pacient/`](../../samples/README.md), the
  page images and Tesseract output in `data/derived/pages/S02_pacient/`,
  and the fixture data in `fixtures/data/mock-case-S02.json`.

## Infrastructure

- **Azure is optional.** A local demo is enough, and using Azure does not
  affect judging.
- **Team portal:** `aka.ms/Rakathon2026`. It shows one API key for all
  shared LLM deployments, their endpoints and exact deployment names, and
  a hello-world call. Models include OpenAI, xAI Grok, DeepSeek, and
  Microsoft models, called through the OpenAI API (Chat Completions and
  Responses). Deployment names say whether a model runs in the EU or
  globally. Read the names from the portal; the transcript garbled them.
- **Access card:** a team sign-in name and a time-limited password, handed
  out at the start. Never paste either into Slack.
- **Azure permissions:** each team gets a resource group named
  `RG-<team name>`. We can create and change resources in it but cannot
  grant permissions to anything, cannot use Entra ID (Azure's sign-in and
  identity service), and cannot start GPU machines. Ask the coaches on
  Slack for anything beyond that.
- **Budget:** roughly 100 to 200 USD of Azure per team; the presenter said
  both "for the hackathon" and "for roughly the day". Ask the coaches.
- **Rate limits:** the LLM endpoint is shared by about 70 teams; expect
  HTTP 429 and retry with backoff. Report HTTP 401 or 403 to the coaches.
- **GitHub Copilot:** each participant can activate a licence with about
  100 USD of credit through the portal's QR code. Use a personal GitHub
  account; if it already has paid Copilot, use a new account. The
  Microsoft presenter advised large models for planning and smaller ones
  for routine coding and sub-agents.
- **InterSystems FHIR AI Hackathon Kit:** a GitHub template that starts
  InterSystems IRIS with a FHIR R4 server in Docker, with Python notebooks
  for loading data, FHIR search, transaction bundles, vector search, and an
  MCP server (a way to offer data as tools to an AI agent). The challenge
  description, template, and tutorials are at
  https://developer.intersystems.com/intersystems-challenge-at-rakathon-2026/
  (InterSystems deck, slide 2). FNO already uses
  InterSystems for integration. Pitfall: when the login expires, the FHIR
  server returns empty results instead of an error, so check credentials
  before debugging queries.

## Judging and rules

- The goal is a proof-of-concept prototype.
- Only work done during the event counts. Declare reused code, tools, and
  data sources (see the lists below). All submissions are published.
- The jury expects higher quality than usual because teams use AI agents.
- Partner tools are not part of the challenge judging, but sponsor prizes
  need the sponsor's technology. InterSystems awards 1500 EUR for using
  IRIS (FHIR server, SQL, vector search, agent tools). There may also be a
  Microsoft prize.
- The InterSystems prize can be combined with any challenge. Its
  criteria: innovation and real-world impact (a clear healthcare problem
  and a path to an MVP), meaningful use of InterSystems technology with
  AI and/or FHIR, and technical coherence (a sound data model and
  architecture). Suggested patterns: RAG with IRIS vector search, an
  agent with tools (SQL, API, FHIR, vector search), and the IRIS FHIR
  server for exchange or as the storage layer (InterSystems deck,
  slides 2 to 5).
- What convinced past InterSystems juries: how the team works with the
  data, how it represents it in FHIR, how far it got, impact, innovation,
  and what it added beyond the brief.
- The eHealth deck's "minimum for a credible MVP" (page 20, not presented
  aloud): a clinical need and a responsible role; a source of truth and
  identifiers; a concrete FHIR or IHE profile; access rules and audit;
  synthetic data and a test of failure cases.
- The HL7 deck's advice (slide 21 notes): pick a small set of important
  information, explain its structure, and **verify its meaning with a
  clinical mentor**. Book time with the FNO mentor early.
- The Czech eHealth speaker's prize: entry to "Národní dialog pro
  digitalizaci Vol. II" (19 October 2026, Prague) for the winning team.

## Help channels and contacts

- Slack: one channel per challenge (data appears there), team channels,
  `#08-tech-helpdesk`, "Hledám mentora" (find a mentor), "Oznámení"
  (announcements), and `#best-use-of-intersystems-technology-for-ai-and-fhir`
  (InterSystems deck, slide 10).
- When asking for technical help, give the team name, the failing endpoint
  or deployment, and the time.
- InterSystems mentors on site: Prague (Ondřej Hoferek and Gabriel Ing),
  Ostrava (Daniel Kutáč), Brno (Daniil Drozdov and Thomas Dyar); the
  pre-hack talk also named Radek Zájem for Brno. Online mentors cover
  Friday 20:00 to Saturday 8:00 (InterSystems deck, slide 9). There is
  an InterSystems booth.
- The FNO challenge owner is doc. MUDr. Ing. Jakub Cvek, Ph.D., MBA,
  Klinika onkologická FNO (FNO deck, slide 1).
- Aleš Tichopád (ČVUT, oncology patient path) is at the Prague venue on
  Friday; the organizers will post his phone number on Slack.
- Michal Opatřil (Czech eHealth) offers consultations via LinkedIn.

## Decisions agreed with the organizers

Record each one with the date and who confirmed it. Questions still
waiting for an answer are in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

- **16 October 2026, reported by Juro and stated by FNO:** the challenge
  data in `data/rakathon-26.zip` is fictitious, so it is committed and
  agents and cloud models may read it. FNO's deck calls it "documentation
  of fictitious patients" (`2 - FN Ostrava – AI asistent multidisciplinárního týmu.pptx`, slide 8), and the spreadsheets'
  README sheets say "plně syntetických".

## Team decisions

- **17 October 2026, Juro for the team: FHIR.** The demo produces FHIR
  and does not read it. The patient view has an "Export FHIR" button that
  builds a FHIR R4 Bundle in the browser, with a Provenance (document,
  page, quote) on every fact; a saved copy passes the official HL7
  validator with no errors ([`fhir/README.md`](../../fhir/README.md)). No
  FHIR server in the demo; the pilot reads FNO's FHIR API as in
  [`docs/design/INTEGRATION.md`](../design/INTEGRATION.md). We do not aim
  for the InterSystems prize unless someone has spare hours.

## Before the repository goes public

All submissions are published, and the repository is private until then.
Before publishing, check:

- no patient data or FNO-derived samples without permission, and the
  organizers' permission to publish the challenge data in `data/`;
- the Zoom chat exports and research notes name other participants;
  remove or anonymize those names;
- the organizer decks, recordings, and transcripts in `docs/sources/`:
  ask the organizers whether they may be published, otherwise remove them;
- git history: commits 544fb19 and cd700c9 hold full pages of copyrighted
  guideline text (ESC, EASL, EANO-ESMO, Modrá kniha) and PubMed abstracts;
  the team chose to keep the history for now and clean it when the real
  server exists (2026-10-16).
- the demo ElevenLabs key: it was embedded in the published page and is
  in git history. On 2026-10-17 it left the page (the server holds the
  key now, issue #2); it must be revoked in the ElevenLabs dashboard,
  since removing it from the code does not unpublish it.

## What existed before the hackathon

Declare this list to the jury and mentors.

- The repository setup on 16 October 2026: agent rules (`CLAUDE.md`,
  `AGENTS.md`, `docs/agent/`), the `fable-mode` skill and house-style hook
  adapted from the maintainer's other project, `.github/`, `.editorconfig`,
  and `.gitignore`.
- `docs/sources/`: the organizers' pre-hack slides and recordings, with
  transcripts made by `scripts/transcribe.py`.
- `docs/research/`: notes on the pre-hack talks, written by AI agents.

## Tools and data sources used

- ElevenLabs Scribe, for transcribing the pre-hack talks and the team's
  design discussions, and (Scribe v2 Realtime and Scribe v2) for the
  live "AI záznam" demo, with fictitious speech only.
- The hackathon's Azure OpenAI gateway (`gpt-6-luna-dz-eu`), for the
  one-sentence summary of a recorded MDT discussion.
- Cloudflare Pages, which during the event hosted mock v3 (the
  single-file HTML page the demo started as) at
  https://codebridge-mdt.pages.dev, with Pages Functions for the speech
  and summary routes. On 2026-10-18 the page and its Pages deploy were
  removed from the repository. Colleagues still use the address, so the
  Pages project now only redirects every path to the app on the Worker
  (`api/pages-redirect/`, deployed by
  `.github/workflows/deploy-pages-redirect.yml`). The API Worker below is
  the demo.
- Cloudflare Workers (static assets, rate limiting binding, Workers
  Logs), hosting the API Worker `codebridge-mdt` in `api/`, which serves
  the demo (the Nuxt app at `/` and the API under `/api`), with Hono
  4.13.13, `jose` 6.2.12, Wrangler 4.147.0, TypeScript 5.9.3, and Vitest
  4.1.11 with `@cloudflare/vitest-plugin` 1.3.6. Cloudflare AI Gateway is
  wired as an option but off.
- JSON Schema libraries for the extraction format (written during the
  event): ts-json-schema-generator 2.9.0 (generates the schema from the
  TypeScript types), `@cfworker/json-schema` 4.1.1 (validates in the
  Worker) and Python `jsonschema` 4.23.0 (validates in the pipeline).
- Cloudflare D1 (database `codebridge-mdt`) and R2 (bucket
  `codebridge-mdt`), both created on 2026-10-17 with the EU jurisdiction,
  holding the seeded synthetic demo data (`api/seed/seed.py`). `wrangler d1
  info codebridge-mdt` reports `jurisdiction: eu`, region EEUR; `wrangler
  r2 bucket info codebridge-mdt --jurisdiction eu` reports location EEUR.
- Cloudflare Workflows (`codebridge-speaker-pass`, binding `SPEAKER_PASS`),
  a cron trigger, and R2 multipart uploads with a lifecycle rule on
  `audio/`, for the speaker pass after approval (step 5, issue #6).
- Cloudflare Workflows (`codebridge-process-document`, binding
  `PROCESS_DOCUMENT`) for the document pipeline without an LLM (step 6,
  issue #7), calling the page reader service (`pipeline/`: PyMuPDF 1.24.10,
  Pillow 10.4.0, Tesseract with the Czech model, pytest). The Cloudflare
  Container for the page reader is written (`pipeline/container/Dockerfile`) but
  not deployed on 2026-10-17: the build needs a running Docker daemon.
- ChatGPT, used by Soňa for brainstorming and UI sketches
  (`docs/sources/design/`).
- Claude artifacts (claude.ai), for publishing the early UI mocks
  (mock v1 to v3) to the team during the event.
- PyMuPDF and Tesseract (Czech model), for rendering and reading the
  patient PDFs (`scripts/ocr_pages.py`); Claude Sonnet as the vision
  model for the fictitious data. Full list with reasons:
  [`docs/design/TECHNOLOGIES.md`](../design/TECHNOLOGIES.md).
- Claude Code, for the research notes, the agent docs, and coding.
- Claude Code also wrote the synthetic patient `S01_pacient`
  ([`samples/README.md`](../../samples/README.md)), rendered to PDF with
  PyMuPDF and Python-Markdown 3.7 (`scripts/render_samples.py`).
- Claude Code also wrote the synthetic patient `S02_pacient` the same way,
  with the Liberation Sans 2.1.5 fonts from the liberation-fonts release.
- qrcode-generator 2.0.4 (MIT, Kazuhiko Arase, npm), pinned in
  `app/package.json`, draws the QR code of "Nahrát z telefonu" in the browser (issue #10). A pre-existing
  third-party component; the dialog, the phone page and the server routes
  were written during the hackathon.
- The Nuxt frontend in `app/` (issue #13, after the hackathon), which
  replaced mock v3 and is the only frontend since 2026-10-18:
  Nuxt 4.6.2, Vue 3.5.44, Vue Router 5.4.0, Pinia 4.1.0 with `@pinia/nuxt`
  1.0.3, `@fluent/bundle` 0.19.1 and `fluent-vue` 3.8.2, tested with Vitest
  4.1.11, happy-dom 21.0.3 and `@vue/test-utils` 2.5.1, type-checked with
  vue-tsc 3.3.13 and TypeScript 5.9.3. npm workspaces hold `api/`, `app/`,
  `packages/domain` (the case rules moved out of `api/src/domain`) and
  `packages/api-client`. Its accessibility checks use `@axe-core/playwright`
  4.13.0 with axe-core 4.13.0 (MPL-2.0, Deque, npm) in the e2e suite.
- Zitadel Cloud (CAOS AG, EU region, on Google Cloud), the identity
  provider of the login since 2026-10-19 (after the hackathon; design and
  choice in [`docs/design/AUTH.md`](../design/AUTH.md)): instance
  `glide-mdt--dev-dybk0r.eu1.zitadel.cloud`, project "GLIDE MDT", the
  demo accounts of both demo orgs (GitHub issue #15). The Worker's OIDC
  client and the session handling were written for this project with
  `jose`; the browser suite logs in at a mock IdP of our own
  (`e2e/mock-oidc.mjs`). Juro's earlier WorkOS adapter (`identity-workos`)
  was not used.
- HAPI FHIR JPA server (`hapiproject/hapi:v8.12.0-2`, Apache-2.0, pinned
  by digest in `fhir/nis/docker-compose.yml`) as an optional local NIS
  stand-in for issue #22 (after the hackathon); the tests use our own
  in-memory FHIR server (`fhir/nis/memory-server.ts`), written for this
  project. The HL7 FHIR validator 7.0.2 checks the NIS test Bundles as it
  checks the export.
- (Add the LLMs, libraries, and datasets as we adopt them.)



## Prognosis prototype work on 2026-10-17

The team added a local prognosis evidence-search prototype during the event. It
uses Python standard-library HTTP handling, the mock v3 page of the time,
and GPT Astra through OpenRouter with server-side web search. The source fixtures are
the fictitious FNO case 10 and the team synthetic S01 sample. The clinical profile
contains no patient names or birth numbers. Keys stay in the local gitignored
configuration. Model and integration details are in
[the prognosis design](../design/PROGNOSIS.md). Model extracts require source
review; the prototype does not provide an individual survival prediction.


## PDF report export (2026-10-17)

- jsPDF 4.2.1 (MIT), vendored from the npm registry, generates text-based PDF files
  locally in the browser. DejaVu Sans (Bitstream Vera/DejaVu license), subset for
  Latin/Czech and common clinical symbols using fontTools, supplies embedded fonts.
  These are pre-existing third-party components; report composition, pagination and
  application integration were written during the hackathon. Licenses are stored in
  `app/vendor/`, next to the vendored files. No patient text is sent to an external PDF service.

- GLIDE wordmark: existing brand asset reused from `sonicaopica/glide/GLIDE.svg`
  at blob `2a0eebad98a033b70f43c324b209fae760e3ff2a`, supplied by the team.
