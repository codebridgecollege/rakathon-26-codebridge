# CLAUDE.md - CodeBridge

Operating rules for AI agents working on this repository. Facts about the
problem, the data, and the architecture live in
[`docs/agent/INDEX.md`](docs/agent/INDEX.md).

## What this project is

CodeBridge is our entry for the [Rakathon](https://www.rakathon.cz/)
hackathon, challenge 2: **an AI assistant for a multidisciplinary team**
(MDT), set by Fakultní nemocnice Ostrava (University Hospital Ostrava).

Before an MDT meeting, doctors spend a long time digging through a
patient's records. The assistant reads the available documentation and
prepares:

- a short patient summary,
- a timeline of the treatment,
- how lab values changed over time,
- an overview of findings,

and it highlights significant changes, contradictions between documents,
and documents that are missing.

The full challenge text and what it implies for the design are in
[`docs/agent/INDEX.md`](docs/agent/INDEX.md).

## Working mode - always use the fable-mode skill

When NOT using a Fable model, work in the `fable-mode` skill
([`.claude/skills/fable-mode/SKILL.md`](.claude/skills/fable-mode/SKILL.md))
for any non-trivial task: map the stages before editing, delegate
independent reads and analysis to parallel sub-agents, verify each stage
against its expected output before advancing, and have a separate agent
review the result before delivery.

## This is a hackathon - optimize for a working demo

We have hours, not weeks. Every rule below is meant to keep the demo
correct and trustworthy, not to slow it down.

- **A working end-to-end path beats a polished component.** Get the thin
  slice running first (documents in, summary out, shown in the UI), then
  improve the parts the jury will look at.
- **Match the evidence to the risk.** A UI tweak needs a quick look in the
  browser. Anything that changes what the assistant tells a doctor
  (extraction, the timeline, lab values, contradiction detection) needs a
  check against real sample documents.
- **No benchmark or evaluation rabbit holes.** Before starting one, state
  which decision it will change and how long it may take. Stop once the
  next decision has enough evidence.
- **Keep `main` demo-ready.** Do not merge something that breaks the demo
  path. If a change is half-done at a deadline, leave it on its branch.
- **Say when time runs over.** If a task takes more than twice the
  expected time, stop and tell the team what is eating the time, what is
  essential, and the fastest safe path forward.
- **Record what existed before the hackathon.** Only work done during the
  event counts, reused code must be declared to the jury and mentors, and
  all submissions are published. Keep the list in
  [`docs/agent/HACKATHON.md`](docs/agent/HACKATHON.md) current, along with
  the tools and data sources we used.
- **The jury expects more than usual.** The host said that because teams
  use AI agents, the jury expects higher quality. Our reading: a narrow
  demo that is trustworthy beats a broad demo that bluffs.
- **Keep it simple where it does not show.** Skip login, OAuth, and
  scaling; InterSystems mentors have seen past teams sink their time into
  OAuth. Keep a simple log of who opened which patient, since access and
  audit are part of a credible prototype.

Logistics, infrastructure, judging, and contacts are in
[`docs/agent/HACKATHON.md`](docs/agent/HACKATHON.md).

## Patient data and privacy - non-negotiable

We work with medical documentation, which is health data under GDPR.

- **Never commit patient data.** That includes real records, exports,
  screenshots, logs, prompts, or model responses that contain them. Real
  data stays in `private/` (gitignored) or outside the repo. `data/` holds
  the synthetic challenge data the organizers gave us, and it is committed.
  Our own test cases go under `samples/` (create it when the first sample
  lands). Samples derived from real FNO data need FNO's written
  permission, recorded in [`docs/agent/HACKATHON.md`](docs/agent/HACKATHON.md),
  because all submissions are published.
- **Ask before sending data to an external service.** Sending documents to
  a hosted LLM API, an OCR service, or any outside company hands them over,
  and the company may keep a copy. The InterSystems speaker's answer,
  pending the official rules: challenge data may go to a cloud LLM only
  after the challenge owner (FN Ostrava) confirms it is anonymous or
  synthetic and may be sent there. The challenge data in `data/` is
  synthetic (see `docs/agent/HACKATHON.md`); anything else that may be
  real goes to cloud models only after the same confirmation.
  Prefer the EU deployments, and keep the code able to run with a local
  model.
- **Meeting audio is patient data.** Record an MDT only when recording
  is switched on explicitly, with the participants' consent and FNO's
  clearance for any speech-to-text service; a typed conclusion is always
  available instead. A recording is tied to the patient the doctor
  selects, never split by guessing. Voiceprints for naming speakers are
  biometric data; do not collect them in the prototype.
- **Notifications carry a link, not medical data.** An email to the
  coordinator says that tasks are waiting and links to the app.
- **Coding agents are cloud LLMs too.** Claude Code, Copilot, and similar
  tools send every file they read to their provider. No agent opens files
  in `private/`; `.claude/settings.json` blocks it for Claude Code.
  Develop against the synthetic data in `data/` and `samples/`.
- **Send only what the task needs.** Pass the model the documents and
  fields a step uses, not the whole record.
- **Expose as little as possible, and protect what is exposed.** Follow
  data-protection best practice in every design, even with synthetic
  data, so the prototype behaves as it would with real patients:
  minimize the data each screen, step, log, and export holds;
  pseudonymize before processing where the task allows (a case ID instead
  of name and birth number, with the mapping kept separately); show
  identifiers only where the user needs them; give each role access only
  to what it needs; keep the access log; and state how long data is kept.
  The demo has no login, so roles and the confirming doctor are a typed
  name or a role picker, and the UI says so.
  When a design choice trades privacy for convenience, say so.
- **Do not log full documents or prompts by default.** Debug logging of
  patient text must be opt-in and must write to a gitignored location.
- **Secrets go in `.env`** (gitignored), never in code. Keep `.env.example`
  in step with the variables the code reads.

## Clinical trust - every claim points to its source

A doctor will act on what the assistant shows. A confident wrong statement
is worse than an empty field.

Two organizer decks state it in writing: an AI answer needs a source, a
degree of uncertainty, and a human who makes the clinical decision
(eHealth deck page 19, oncology path deck slide 49). The HL7 deck's notes
add: keep where each claim comes from, and separate known from missing
data (slide 21 notes).

- **Every extracted fact carries its source, its date, and how sure we
  are.** Source means the document and the place in it; the UI lets the
  doctor jump to the original text, which stays findable and unchanged.
  Show uncertainty (for example a "verify" flag) wherever the extraction
  was not clear-cut, and let the doctor confirm critical facts.
- **Say "not found", never guess.** When the documentation does not state
  something, show it as missing. Do not let the model fill gaps with
  plausible values. Missing documents are one of the required outputs, so
  treat absence as data.
- **Alerts inform, they never block.** An MDT can run without every
  document. Show the alerts that matter for the question to the MDT
  first (when there is no explicit question, for the most recent
  finding), so the doctor is not buried in warnings. Missing-document alerts
  are always on (not switchable, and not part of the guideline layer) and
  always signalled on the brief; the list itself may sit one click away
  (team decision 2026-10-17).
- **"Not documented" is not "absent".** "No metastases" in a report is a
  finding; silence is a gap. Keep them apart, and watch for negations,
  which models and OCR misread.
- **Use fixed Czech wording for gaps.** When the documentation says
  nothing, the wording is "neuvedeno v dostupné dokumentaci" (not stated
  in the available documentation). On screen a missing value shows as "-"
  with that wording in its tooltip (team decision 2026-10-16); printed
  reports use the full wording. Never use "neguje" for silence: it is the
  doctor's recorded negative and may only be quoted where the document
  says it. Never turn a gap into "neprovedeno" (not performed): from
  documents alone the assistant rarely knows whether an exam was done
  elsewhere.
- **Keep what the documents say separate from what the assistant
  infers.** A detected trend, change, or contradiction is labeled as the
  assistant's observation and lists the facts it is based on.
- **Compare like with like over time before calling a contradiction.**
  The stage at diagnosis is not the current stage, and a clinical stage
  (from imaging) may differ from a pathological stage (from histology).
  Neither is a contradiction. Two values of the same kind, for the same
  time, that disagree are.
- **A suspicion is not a diagnosis.** Label disease status as the
  documents do (suspicion, confirmed by histology, remission, recurrence),
  and use the histology report as the point where the diagnosis is
  confirmed.
- **Do not merge patients silently.** Czech hospitals often hold duplicate
  records for one birth number. If documents disagree on who the patient
  is, show it.
- **Preserve the original values.** Keep lab values with their original
  units, reference ranges, codes, and dates. Keep partial dates as they are
  ("03/2024" stays a month, never a made-up day). Convert only for display.
- **Show intervals as facts, not verdicts.** "38 days from biopsy to MDT"
  is fine; "too late" is a clinical judgement the assistant does not make.
- **The assistant prepares, the doctor decides.** It must not present a
  conclusion as a medical decision, and its output is a view for the
  meeting, never written back into the hospital's record, which legally
  belongs to the provider. The one exception is the optional guideline
  layer (F-27 in [`docs/design/PRODUCT.md`](docs/design/PRODUCT.md)),
  which the team decided on 2026-10-16 to explore. Every item it shows
  names the guideline (name, society, year, version, section, page) and
  the patient documents it rests on; it is labeled as the assistant's
  observation; it is stored apart from the MDT conclusion and never
  becomes one. The team decided on 2026-10-16 how far it goes: it
  quotes guideline statements that apply to the documented facts under
  the proposed management, verbatim and with their evidence level,
  opens the guideline document at the quoted passage, and lists in a
  deviations table where the MDT's plan departs from a quoted statement.
  Retrospective deviations list past decisions from the documentation
  next to guideline passages on the same topic; their severity and
  assessment are set by doctors, never by the assistant.
  It never ranks options, never writes the proposal or the conclusion,
  and the doctors record whether a deviation is intended and why. A
  statement is never paraphrased as a quote and never invented: no
  verified source text, no statement. When guidelines are not enough
  (rare situations), the layer may add literature from PubMed, labeled as
  literature and not as a recommendation, with verbatim abstract
  sentences; its searches use clinical terms only, never patient data.
  Whether the layer is on by
  default is open in
  [`docs/agent/OPEN_QUESTIONS.md`](docs/agent/OPEN_QUESTIONS.md).
  Outside that layer the assistant does not recommend a treatment.
- **A draft is never shown as approved.** A conclusion or task the
  assistant drafts stays a draft until a named doctor confirms it. New
  documents may update drafts but never silently change content a doctor
  confirmed. When the referral states no question for the MDT, the
  assistant drafts one, labeled as a draft with the document passage it
  rests on, until a doctor confirms or edits it (team decision
  2026-10-17).
- **MDT decisions are an append-only history.** A new decision supersedes
  an earlier one and never erases or edits it; the same patient can come
  to the MDT many times. Each decision records which doctor confirmed it
  and when.
- **Czech clinical text is the input.** Expect Czech, Latin terms,
  abbreviations, typos, scans, and inconsistent date formats. Test with
  such text, not with clean English examples.
- **Check that a document is readable before using it.** Each uploaded
  document gets a reading certainty, judged from the text itself, not
  from whether a text layer exists: FNO's text layers are poor OCR
  ("1112023" for 11/2023, "MO" for M0, "lmg/kg"). Watch for broken dates,
  l/1 and O/0 swaps, and words that are not Czech or medical. A poorly
  readable document gets an immediate warning and a request for a better
  copy. Parts that cannot be read are marked as unreadable and
  never filled in by guessing.

## Test against the known failure cases

The speakers named the ways extraction goes wrong in clinical documents.
Every pipeline change that affects what the doctor sees is checked against
synthetic cases for each of these:

- a critical fact left out of the summary,
- a wrong or outdated date,
- a negated finding read as positive,
- two patients mixed up,
- an examination that happened but whose report is missing,
- a referral with no result (a sent request is not a done exam),
- a poor scan whose misread characters change a value or a negation.

Keep these cases under `samples/` with the expected output, so anyone can
rerun them.

## Standards and data model - decide at the start

The eHealth, HL7, InterSystems, and PHOENIX speakers all recommended the
same standards. FHIR (the HL7 standard for exchanging health records as
linked JSON records called resources) is a strong recommendation, not a
judging requirement; the host said partner tools are not judged. The
InterSystems mentors' experience is that teams who postpone FHIR do not
fit it in later, so the team decides early and records the decision in
[`docs/agent/HACKATHON.md`](docs/agent/HACKATHON.md).

- **FHIR R4 where data enters or leaves, our own simple model inside.**
  Keep an internal model shaped for our outputs, and pin the version of
  every implementation guide we use.
- **Use the existing concepts instead of inventing names.** Shape the
  oncology data after the European Common Cancer Model (the HL7 Europe
  draft of what to record about a cancer patient: diagnosis, stage,
  treatment, progression, response, follow-up) and mCODE (a US set of
  FHIR profiles for cancer data). Our proposed FHIR mapping is in
  [`docs/agent/INDEX.md`](docs/agent/INDEX.md).
- **Keep the codes the source gives.** Czech lab results use NČLP (the
  national code list for lab tests) and diagnoses use MKN-10 (the Czech
  ICD-10); radiology uses SNOMED CT more than other fields. If we assign a
  code ourselves, mark it as assigned by the assistant. Never invent a
  code, and never drop one in favor of free text.
- **Provenance on every record**: patient identity, author, time, and
  source document.
- **Stub national services visibly, do not fake them.** Patient lookup in
  the national registers, document exchange (IHE MHD, a standard API to
  publish, find, and fetch health documents), and requisitions are shown
  as clearly labeled stubs ("here we verify the patient against the
  national register"). Do not build our own requisition system or a
  proprietary interface, and do not use DASTA (the older Czech
  data-exchange format) for new work.

## Calling LLMs

- **Model names, endpoints, and keys come from configuration**, never from
  code. The hackathon portal lists the exact deployment names; copy them
  into `.env` and `.env.example` (without the key).
- **Retry on HTTP 429 with exponential backoff.** About 70 teams share the
  same rate-limited endpoint, so expect slow or refused calls, possibly
  during the demo. Cache model outputs for the demo patients.
- **Never put an API key in browser code, Slack, or git.**
- **Keep extraction prompts and their outputs reproducible**: a pinned
  model, the prompt in the repository, and a fixed temperature where the
  model accepts one.

## Delegating to subagents and workflows

A delegated agent starts with none of this file in its context; it sees
only the brief you write.

- **Every brief tells the agent to read `CLAUDE.md` first**, plus
  [`docs/agent/INDEX.md`](docs/agent/INDEX.md) and any doc for the area it
  touches ([`docs/design/PRODUCT.md`](docs/design/PRODUCT.md) for
  anything the user sees). Name the files in the brief.
- **Coding subagents also work in the `fable-mode` skill.** Say so in the
  brief. A read-only research agent does not need it.
- **Effort and model size follow the risk.** Use high effort and a large
  model for extraction logic, data design, and privacy-relevant code.
  Routine UI work, lookups, and enumeration get medium effort or a smaller
  model; model credit is limited.
- **Never pass real patient data to an agent that may send it elsewhere.**
  Point agents at synthetic samples unless the team has cleared it.

## Mechanism 1 - when something does not work, read the source

Do not guess-and-patch in a loop.

1. **Reproduce minimally.** Print the actual values, types, and data.
   One targeted print beats five speculative edits.
2. **Read the API you are calling.** The answer is almost always in the
   library source or the docs, not in another retry.
3. **Only then fix.** If the fix feels complex or hacky, you probably have
   not found the real cause yet.

For LLM output that is wrong, look at the exact prompt and input the model
received before changing the prompt.

## Mechanism 2 - when you fix a bug, sweep for the whole class

Reduce the bug to a pattern you can search for (a date format the parser
misses, a unit that is not normalized, a document type the extractor
skips) and check the rest of the code and the sample data for the same
pattern. Fix siblings in the same pass, or say what you left out.

## Mechanism 3 - you own everything your change makes stale

When you change a data shape, a prompt's output format, or an API, update
every producer, consumer, sample, test, and doc that depends on it in the
same change. If you deliberately leave something for later, say so in the
change and to the team. Silence is not deferral.

## Mechanism 4 - review goes to a separate agent, never self-review

Rereading your own work repeats the assumptions that produced it. For a
change to what the doctor sees (extraction, summary, timeline, labs,
contradictions, missing documents), a privacy-relevant change, a design,
or a claim you are about to call settled, dispatch a separate agent to
review it adversarially: hunt for holes, missed cases, untested claims,
and privacy leaks. Tell it to read `CLAUDE.md` first. Fold its findings
back before presenting the work. Routine UI and tooling changes are
exempt.

## Where new agent knowledge goes

Pick **one** location. All of these are in git, so the whole team sees them.

| Kind of knowledge | Goes in |
|---|---|
| Operating rule (applies to any task) | `/CLAUDE.md` (this file) |
| Problem, data, domain, or architecture fact | [`/docs/agent/INDEX.md`](docs/agent/INDEX.md) |
| Product design: users, flows, screens, features and their tiers | [`/docs/design/PRODUCT.md`](docs/design/PRODUCT.md) |
| UI mocks and their data | [`/mocks/`](mocks/README.md) |
| Technologies we use and why, per case (for presenting) | [`/docs/design/TECHNOLOGIES.md`](docs/design/TECHNOLOGIES.md) |
| How patient data is protected (OCR, LLMs, redaction) | [`/docs/design/DATA-PROTECTION.md`](docs/design/DATA-PROTECTION.md) |
| How the app connects to the hospital (login, roles, FHIR, deployment) | [`/docs/design/INTEGRATION.md`](docs/design/INTEGRATION.md) |
| Hackathon logistics, infrastructure, judging, contacts, decisions with organizers | [`/docs/agent/HACKATHON.md`](docs/agent/HACKATHON.md) |
| What FNO asks us to deliver, as a checklist | [`/docs/agent/REQUIREMENTS.md`](docs/agent/REQUIREMENTS.md) |
| Agreed larger work items, in order (backlog) | [`/docs/design/BACKLOG.md`](docs/design/BACKLOG.md) |
| Open question, unanswered or pending a decision | [`/docs/agent/OPEN_QUESTIONS.md`](docs/agent/OPEN_QUESTIONS.md); when answered, move the answer to its home above and delete the question |
| Fact local to one package or folder | that folder's `AGENTS.md` (create when needed) |
| Research, exploration, meeting notes, open findings | [`/docs/research/`](docs/research/), one file per topic |
| Raw source material (organizer slides, transcripts, specs) | [`/docs/sources/`](docs/sources/), kept as received |
| How to run, build, and demo | [`/README.md`](README.md) |
| Per-user preference | `/CLAUDE.local.md` or `/.claude/settings.local.json` (gitignored) |

Notes are working material and may be wrong or outdated. Once a finding is
settled, move it into `CLAUDE.md` or `docs/agent/INDEX.md` and leave a
one-line pointer in the note. Sources are evidence: do not edit them, and
cite them (file and slide or line) when a rule or fact comes from them.

Do not write project knowledge into the machine-local agent memory store
(`~/.claude/projects/<project>/memory/`). Teammates cannot see it.

## Code conventions

- **Formatters and linters must pass** once the stack is chosen; record the
  commands in the README.
- **Imports at the top of the file.** Import inline only to break a real
  circular dependency or fix a measured problem.
- **Comments explain why, not what.** Each meaningful step gets a short
  comment on why it exists: why this approach, this guard, this value.
- **Name booleans as positive actions.** `include_labs=True`, not
  `skip_labs=False`.
- **Behavior that a doctor will see comes with a test or a recorded check**
  against sample documents.
- **Do not keep wrong behavior to keep tests passing.** If a fix is more
  correct, update the test and say so.
- **Pin versions** of dependencies and model IDs so the demo behaves the
  same on every machine.

## House style

- **Plain, direct language everywhere**: replies, docs, comments, commit
  messages, and UI text. State who does what to what, and why. Prefer
  plain words over jargon, and verbs over abstract noun phrases.
- **A project-specific term gets a one-sentence explanation** the first
  time it appears in each file.
- **UI text the doctors see is in Czech.** Code, comments, and docs are in
  English so every teammate and agent can work with them.
- **No em dashes** (the U+2014 character) in docs, comments, or
  docstrings. Use a hyphen, a comma, parentheses, or two sentences. A
  PostToolUse hook
  ([`.claude/hooks/check-em-dashes.py`](.claude/hooks/check-em-dashes.py))
  warns when one slips through.
- **Never call an integration mechanism a "seam".** Name the concrete
  mechanism: the hook, the callback, the endpoint. The same hook warns.
- **Sentence case for Markdown headings.**
- **Honest analysis.** Do not validate a suggestion uncritically, and
  report results faithfully, including failures.
- **Document what is there.** Describe the current design; do not leave
  notes about removed approaches in docs or comments.
