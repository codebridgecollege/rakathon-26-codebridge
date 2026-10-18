# Data protection - CodeBridge

How patient data stays protected when the app reads documents with OCR
and language models. Written for the team and for questions from the
jury. Not legal advice; FNO's data protection officer decides for a real
deployment.

## The problem

Reading a page with a cloud vision model sends the whole page image to
another company: name, birth number, diagnosis, everything on it. The
same holds for any cloud LLM that turns text into structured facts.

## What the law says, in short

- Health data is a special category of personal data (GDPR article 9).
  Processing it for the patient's care is allowed (article 9(2)(h)), but
  every company that processes it for the hospital is a processor and
  needs a data processing agreement (article 28).
- **Pseudonymized data is still personal data** (GDPR recital 26).
  Replacing the name with a case ID lowers the risk but does not take the
  data out of GDPR. A rare diagnosis plus dates plus a town can identify a
  person.
- New processing of health data at scale needs a data protection impact
  assessment (article 35) and the hospital's approval. Hospitals like FNO
  also fall under the Czech cybersecurity rules for essential services.
- Data leaving the EU needs a transfer basis; keeping it in the EU avoids
  the question.

## Are enterprise providers exempt?

No provider is exempt. What enterprise offerings do is make compliance
possible, which consumer products do not:

- a data processing agreement with the hospital;
- processing and storage in the EU (for example Azure OpenAI deployments
  in EU regions, which the hackathon's endpoint offers);
- no training on customer data;
- no retention of prompts and outputs, where the provider offers it (some
  require an application, for example turning off abuse-monitoring
  storage);
- security certifications (ISO 27001, SOC 2).

Check the current terms of the specific provider before relying on any of
these. Even with all of them, the hospital decides, and many Czech
hospitals do not allow medical records in public cloud services at all.

## Options

| Option | How it works | Quality | Privacy | Cost and effort |
|---|---|---|---|---|
| A. Fully local | Tesseract, and a vision-language model run on the hospital's own GPU server (open models of this kind exist; pick one after testing on Czech print) | Tesseract alone made errors in digits and stages; local vision models are closer to cloud quality but need testing | Nothing leaves the hospital | Needs a GPU server and operations |
| B. Redact locally, then cloud | Local OCR finds the words and their positions; direct identifiers are blacked out on the image and removed from the text; only the redacted page goes to an EU enterprise endpoint | Cloud quality on everything except the blacked-out parts | Much lower risk, but still personal data (quasi-identifiers remain); needs the agreement and the assessment | Moderate: detection must be reliable |
| C. Cloud as is | Whole page to an EU enterprise endpoint | Best | Identifiable health data with a processor; acceptable only with FNO's approval, agreement, and assessment | Lowest effort |

### How option B finds what to black out

Direct identifiers come from three places, and we use all three:

1. **The form itself.** FNO's consultation form has fixed fields (name,
   birth number, insurer, referring doctor, contact). Their values are
   known from the form, so we search the page for exactly those strings.
2. **Patterns.** Birth number (`######/###(#)`), dates of birth, phone
   numbers, e-mail addresses, street addresses, insurer numbers.
3. **Names in free text.** A Czech named-entity recognizer run locally
   (for example the Czech models from Charles University's ÚFAL, or a
   general tool such as Microsoft Presidio with Czech rules) finds names
   of patients, relatives, and doctors.

On the image, we black out the boxes Tesseract reports for those words,
plus whole header blocks where identities usually sit, because a missed
name in a header is the typical failure. The black boxes are kept in the
page record, so the app can show where text was removed.

### The prototype (`scripts/redact_pages.py`)

Built on 2026-10-16 and run on all 20 pages; it writes `p<n>.redacted.png`
and a list of boxes with reasons (never the removed values) next to each
page in `data/derived/pages/`. It covers the form fields, patterns (birth
number, phone, e-mail, a value glued to its label such as
"nar.:13.10.1961"), known patient names, and doctors' names after
"MUDr." and similar titles. It found 54 identifiers on 10 of the 20
pages; on the other 10 it found nothing, which the source viewer states as "kontrola
je neúplná", not as "clean".

What testing on FNO's pages taught us, useful for questions:

- **Missed first:** Tesseract read "Dat. nar.: 13.10.1961" as one token
  "nar.:13.40.1961" (a misread digit, too) and "Kód poj.: 111" as
  "Kódpoj:111", so label rules missed them. Fixed by matching label and
  value in one token. Lesson: redaction inherits OCR errors.
- **Over-redacted next:** "v místě bydliště. Proto vyhledána ..." in free
  text was taken for the "Bydliště:" form field and medical words were
  blacked out. Fixed by treating a word as a label only at the start of a
  line or before a colon. Lesson: every rule needs a check on both sides.
- **Missed again (review of mock v4):** "MUDr.Hofrová" came out of
  Tesseract as one token, so the rule "the word after MUDr." missed it.
  Fixed by matching a title glued to the name. Widening the title list to
  "prim." then blacked out "přim. konfigurace" ("přiměřené"), so "prim."
  was taken out again; "prim. MUDr. X" is still caught through "MUDr.".
- **Not built yet:** a Czech name recognizer for names in free text
  (relatives, other doctors without "MUDr."), and blacking out whole
  header blocks. Until then, option B is a demonstration, not a
  guarantee, which is one more reason the pilot defaults to option A.

What option B cannot remove without hurting the medical content: dates of
examinations, diagnoses, rare findings, hospital names. These are
quasi-identifiers, which is why the data stays personal data.

## Recommendation

- **Hackathon demo:** we first tried local Tesseract alone; it was too
  weak (misread digits and stages, see the
  [OCR evaluation](../research/2026-10-16-ocr-evaluation.md)). FNO's data
  is fictitious, so the demo reads pages with a cloud vision model
  (`docs/agent/HACKATHON.md`) and keeps Tesseract alongside for the
  "verify" marks. We still show the redaction step, because the jury will
  ask, and the source view shows the original page. The short answer for
  the demo is in [Technologies](TECHNOLOGIES.md#why-the-demo-uses-a-cloud-vision-model-decided-2026-10-16).
- **Pilot at FNO:** option A by default, with Tesseract plus a local vision
  model on the hospital's server. Option B only where FNO approves an EU
  enterprise endpoint, with a processing agreement and an impact
  assessment, and with the smallest set of pages the task needs.
- **In the code:** one "page reader" interface with interchangeable
  engines (local Tesseract, local vision model, cloud vision model),
  chosen by configuration. Every page records which engine read it, and
  whether it was redacted before leaving the hospital.
- The structured-extraction step works on text, where pseudonymization is
  easier: replace identifiers with the case ID before the text leaves
  the hospital, and keep the mapping on the hospital's server
  (`CLAUDE.md`, "Expose as little as possible").

## Server storage (API Worker, step 2)

The Worker keeps the demo data in Cloudflare D1 (the database) and R2
(the file store), both created with the EU jurisdiction. Only synthetic
data is stored: the organizers' fictitious FNO patients and our own
synthetic patients.

- **Identity sits in two tables.** Name, name as written, birth number,
  birth date, age and insurer are in D1's `patients` table, and the
  registry of synthetic fixtures names each fixture's patient in
  `fixture_patients` (step 6, for the wrong-patient check; only its result
  leaves the server). The intake demo's upload files in R2,
  `fixtures/S02/`, and uploaded PDFs under `uploads/` are documents, so
  they carry identity by nature. Case
  rows, alerts and the extraction JSON in R2 refer to a case ID
  (`NO-010`). The seed (`api/seed/seed.py`) removes identity from the
  extraction JSON and stops when a patient's name or birth number is
  still found outside a `quote` field (`api/seed/out/identity-scan.txt`
  lists paths, never values; it found no hits on 2026-10-17).
- **This is not pseudonymization yet.** Quotes and page text are source
  evidence and stay verbatim (CLAUDE.md), so the page JSON and page images
  in R2 still show names. Removing them is the redaction step (option B).
- **The app holds no case data of its own.** It loads case data only from
  the server (per case, when opened; at most five cases in memory, cleared
  on a user switch), and page images through the logged
  `/api/documents/.../image` route. The Worker still serves the synthetic
  page images under `/pages/` as public static files, without an access
  check or a log row; the app does not use them.
- **Reads through the API are logged on the server** before the content
  is read (`access_log`, append-only): who, which role, which case,
  document and page, and a short Czech line. No quote or page text goes
  into the log. If the log cannot be written, the request fails and
  returns nothing. The admin view (Administrace) shows it. Opening a case
  writes `case.open`; its first load in this tab writes `case.data` (and
  `guidance.load` for the guideline layer); reopening a case still in
  memory writes only `case.open`. Opening the saved prognosis writes
  `prognosis.view`. Refused requests (403) are not logged. A search text in
  `/api/patients?q=` would sit in the URL and so in Workers Logs; the
  page does not use it yet, and it should move to a request body first.
- **Who may read what.** A doctor reads the cases whose team (department)
  is on the case; the seed puts every MDT department on every case, as in
  the shared demo. The coordinator and the administrator read clinical
  content too, because the Worker var `CLINICAL_ACCESS` defaults to
  `all_roles` (today's demo behaviour). `doctors_only` applies
  INTEGRATION.md: the coordinator gets the case header, documents list,
  decisions and tasks; the administrator identity and status only. Which
  one the prototype uses is open (`docs/agent/OPEN_QUESTIONS.md`). This
  trades privacy for a demo where a presenter can switch roles freely.
  Even in `doctors_only` mode, the coordinator's "header" routes still
  carry some clinical text: the question's source quote, decision report
  snapshots and the edit log.
- **Demo mode has no login.** The page sends the picked user's staff ID
  (header `X-Demo-User`, or the `cb_demo_user` cookie for page images);
  the server trusts it, as the UI says. With Cloudflare Access on, the
  verified e-mail decides who the user is and the header is ignored.
- **Retention.** The demo data and its access log stay until someone
  reseeds with `--reset` or an administrator runs "Obnovit ukázková
  data" (`POST /api/admin/reset-demo`). The reset first archives the
  access log and the append-only histories (decisions, edits, alert
  events, status history, question confirmations) to the private EU R2
  bucket under `audit-archive/`, then reseeds. Decisions go to the
  archive without their report HTML (ID, approver, time, report hash),
  and an R2 lifecycle rule deletes archives after 30 days. Edit-log rows
  keep the edited text, which can be clinical. Nothing else is kept.
- **No identity in stored reports.** The report a doctor approves is
  stored with an empty patient line (`pt-ident`); the page fills it from
  the patient row when it shows the report, and the server refuses a
  report that contains the patient's birth number or name, or markup
  beyond the page's own (no scripts, handlers or external URLs).
- **Write audit (step 4).** Every server write logs who acted, in which
  role and on which case, in the same transaction as the change. The
  line names the action and safe details only (status names, slot time,
  the edit key, the alert kind, counts), never a name, birth number,
  conclusion, quote or file name. Free text typed by staff stays out of
  the line: an optional reason for a second record per birth number is
  stored with the case, and a break-the-glass reason is stored once with the
  grant (later rows under the grant name the grant). Edit keys and
  attendance keys are checked against fixed formats before they reach
  the log. Refused attempts are logged too ("odmítnuto: ...").

## Uploads and the document pipeline (step 6)

- **The shared demo stores the content of known synthetic files only.**
  The upload route hashes a PDF in memory and stores its bytes only when
  the hash is a registered fixture (`UPLOAD_POLICY=fixtures_only`). Any
  other file (another PDF, Word, an image, an empty or oversized file) is
  accepted so the demo never refuses an upload (user decision
  2026-10-18), but only listed: the `documents` row keeps its name, size,
  declared media type, uploader and time, with no content, no hash and no
  identity result, and nothing goes to R2. Stored, the content would be
  third-party data without clearance in a database every visitor reads.
  The trade-off: the file still travels to the Worker and sits in its
  memory for the request, and its name is kept, which may name a patient
  (the name is display data only and never enters the access log; it
  travels in the `X-File-Name` header, so check that Workers Logs do not
  record request headers, as for the Access header in `api/AGENTS.md`).
  Other policies are for team staging and local work only.
- **Stored uploads** live in the EU bucket under `uploads/<case>/`, with
  a `documents` row (name, size, hash). The access log records actor,
  case, document ID, size and the first 12 hex characters of the hash
  (for a listed file: "uložen jen název a velikost" and the size), never
  the file name (it may name the patient) or content. A removed
  upload is deleted, rows and file. An intake left open is deleted with
  its files after 24 hours; reset-demo deletes every upload.
- **A FHIR referral is read, not kept.** The server fills the form from
  it and keeps only its SHA-256 on the case.
- **The prepared extraction attached by an intake holds no identity**,
  not even in quotes: the seed scans it strictly and the attach adds only
  document IDs. A refusal never names the fixture's patient to someone who
  typed another name.
- **The pipeline without an LLM keeps text out of the Workflow engine.**
  Workflow parameters and step results hold IDs, counts and fixed codes;
  page images, text and lab values go to R2 (EU) under the run's prefix.
  PageKit (the container) has no secrets, no storage and no outbound
  network, and logs only method, path, status, duration and page counts.
  It is meant to run in the EU (`constraints.jurisdiction: "eu"` once the
  container is deployed; today it runs locally, see step-6.md "As
  implemented"). Nothing in slice 6b-1 sends a page to a cloud model.

### Upload from a phone (issue #10)

[`PHONE-UPLOAD.md`](PHONE-UPLOAD.md). The desktop opens an upload
session; its token is the phone's only credential, so it is kept narrow:
one case, add files only, 15 minutes or until the desktop closes the
dialog, at most 30 files. The phone sees the case ID and the names and
sizes of the files sent with that code, nothing about the patient or the
case's other documents. The token travels after `#` in the QR
code (browsers never send that part to a server), then in the
`Authorization` header; the server stores only its SHA-256, and neither
the access log nor our own Worker log lines hold the token, its hash or a
file name. Cloudflare's request logs record request headers: `wrangler
tail` showed `Authorization` as `REDACTED` but `X-File-Name` in full
(2026-10-18); the stored Workers Logs need the same check before a pilot,
as for the Access header (`api/AGENTS.md`). The
phone page removes the token from the address bar and keeps it in the
tab's `sessionStorage`; the browser history and the QR scanner app may
still keep the full URL until it expires. Files take the same upload path as a
desktop upload (fixtures stored, anything else listed by name and size),
logged under the desktop user. Session rows are deleted by reset-demo and
a day after their expiry. The trade-off: whoever holds the QR code (a
photo of the screen, a shoulder-surfer) can add files to that case until
it expires, and see the names of the files sent with that code; they
cannot read anything about the patient.

## Meeting audio

The recording of an MDT discussion is patient data. In the demo, "AI
záznam" is off until a doctor starts it; the demo assumes the
participants agreed beforehand, which a pilot must record. Words are filed only under the case the doctor has open, never
split by guessing. Audio from moments when no case can take it is
replaced by silence before it leaves the browser. Speakers are numbered, not
named, because naming them would need voiceprints (biometric data). The
demo sends audio to ElevenLabs and is used only with fictitious speech; a
pilot needs a speech server inside FNO, or FNO's clearance for an
outside service. The ElevenLabs key stays on our server: the browser
streams the live audio to ElevenLabs with a single-use token our server
mints. ElevenLabs may keep request logs, because its zero-retention mode
is offered only to enterprise customers; this is another reason the demo
uses fictitious speech only.

Where the case audio for the speaker pass lives:

- **On the Worker with the data API** (step 5,
  `docs/research/backend-steps/step-5.md` "As implemented"), the server
  stores the live transcript lines in D1 and the case's raw audio in R2 (EU
  jurisdiction, key `audio/<case id>/<upload id>.pcm`, no name, birth
  number or date in it) in parts of 5 MiB while the case is discussed. So
  audio reaches our storage during the discussion, not only at approval;
  this is a privacy cost we accept so a closed tab does not lose the
  discussion and the browser does not hold an hour of audio. The server
  refuses lines and audio without a recording that was switched on, and
  only from the user who started it. After approval a background job
  (a Cloudflare Workflow) sends the audio to ElevenLabs, replaces the live
  lines with speaker lines, makes the summary draft and deletes the audio.
  The pass replaces only live lines whose audio it received, so speech whose
  audio never arrived keeps its live text. The audio is deleted when its
  speaker pass succeeds. When the pass fails, the audio is kept so
  "Zkusit znovu" can run the pass again, until a pass succeeds or the case
  is closed, and at most 7 days (user decision 2026-10-18); the summary is
  made from the live text meanwhile, and a retry after the audio is gone
  runs nothing and leaves the live text and its summary. Audio is also
  deleted when its case is closed or the seminar ends without approval;
  by a check every 15 minutes for unapproved audio older than 6 hours,
  any audio older than 7 days, audio left by a finished pass, or audio
  of a closed case (this check and the close and seminar-end deletions
  run even with the recorder switched off); and by an R2 storage rule
  that removes any remaining audio under `audio/` within about 8 days
  (rules count whole days, and R2 removes expired objects typically
  within a day). Each deletion is in the access log. The
  Workflow's own stored state holds case and job ids and counts only,
  never transcript text or audio, and is kept 1 day (3 after an error).
  Transcript lines and summaries stay with the case. Summaries are cached
  in R2 under `cache/summary/<case id>/` by a hash of the input, so the same
  transcript is not sent to the model twice.

Open points are in [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).



## Prognosis searches

The local prognosis API accepts only identifiers for two explicitly supported synthetic fixtures, not arbitrary uploaded documents. It constructs a dated clinical profile, removes names and birth numbers, and keeps the OpenRouter API key server-side. Searches require an explicit button action. Results and prompts are not logged or saved to disk; normalized results are held in a bounded process-memory cache. Browser edits are excluded. Provider retention remains subject to the provider policies; the request asks for providers with `data_collection:deny`. See [the API notes](../../prognosis/README.md).


## User-requested synthetic prognosis fixture

The user explicitly requested saving Poláček's prognosis search for demo replay.
`fixtures/data/prognosis-case-10.json` contains the minimized synthetic profile
and six normalized Astra study rows, including their source evidence and original
search timestamp. The seed stores them in R2, and the app shows them through
`GET /api/cases/{id}/prognosis` (logged as `prognosis.view`), matched to the
patient and scheduled day. This fixture is persistent; the backend runtime
cache remains memory-only. It contains no API key or real patient data.

## Visit analytics

The landing page (`glidemdt.com`) counts visits with Umami Cloud, which sets no cookies, and sends button clicks as
named events. The demo app on the Worker loads no analytics script, so the case number and tab in its paths reach no
analytics service.
