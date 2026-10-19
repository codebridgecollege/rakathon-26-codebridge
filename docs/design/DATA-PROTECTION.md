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
- **Missed again (gateway check, 2026-10-19):** "Lipenská Věra, nar.
  14.6.1958" kept the birth date, because "nar." in the middle of a line
  was not taken as a label; the vision model read it from the redacted
  page. Fixed: a date right after "nar." anywhere, and the case's own
  birth date wherever it appears.
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
  `fixtures/S02/`, and uploaded PDFs under `org/<org>/uploads/` are
  documents, so they carry identity by nature. Case
  rows, alerts and the extraction JSON in R2 refer to a case ID
  (`NO-010`). The seed (`api/seed/seed.py`) removes identity from the
  extraction JSON and stops when a patient's name or birth number is
  still found outside a `quote` field (`api/seed/out/identity-scan.txt`
  lists paths, never values; it found no hits on 2026-10-17).
  Where the document names the patient (file, page and the name as quoted)
  is kept with the identity (`patients.identity_source_json`) and leaves
  the server only in the case header (`GET /api/cases/:id`, membership
  checked, `case.open` logged), for a role that reads clinical content;
  never in the patient list. The FHIR export takes the Patient's Provenance
  from it.
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
  memory writes only `case.open`. Showing the earlier value of a fact a
  doctor confirmed (a later processing changed it, or no longer has it)
  reads that fact from the earlier run and writes one more `case.data`
  row per fact. Opening the saved prognosis writes
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
- **Organizations keep their data apart** (`AUTH.md`, `DATABASE.md`).
  Every patient, case, document, recording, task and access-log row
  belongs to one organization (org): demo org A ("Ukázková nemocnice A")
  and demo org B ("Ukázková nemocnice B") share one database, with an
  `org_id` on every row. A request acts in the org of the membership it
  acts with; a record of another org answers 404, the same as an unknown
  ID, so its existence is not confirmed. The database refuses a row that
  points at another org's case or person (composite foreign keys), unique
  keys are per org (a slot booked in one org does not block or reveal the
  same time in another), case numbers count per org, and files go under
  `org/<org id>/` in R2. Isolation tests in `api/test/orgs.test.ts` act in
  org B with org A's IDs on every route. Not separated: the person record
  (`users`: name, titles, e-mail) is shared by all of a person's orgs, and
  the synthetic fixture registry, guideline data and seed bookkeeping are
  global. Time Travel restores the whole database, so one org's data
  cannot be restored alone (`DATABASE.md`, known gap).
- **Who the user is.** The deployed hosts run the login (`AUTH_MODE=oidc`,
  section "Login and identity" below): the session cookie decides who
  acts, and `X-Demo-User` is ignored. Local development and the browser
  suite run demo mode, which has no login: the page sends the picked
  membership's ID (header `X-Demo-User`, or the `cb_demo_user` cookie for
  page images), the server trusts it, as the UI says, and the picker lists
  every demo org's memberships (`/api/demo/memberships`, demo mode only).
- **Retention.** The demo data and its access log stay until someone
  reseeds with `--reset` or an org's administrator runs "Obnovit ukázková
  data" (`POST /api/admin/reset-demo`), which resets that org only. The
  reset first archives the org's access log and append-only histories
  (decisions, edits, alert events, status history, question
  confirmations) to the private EU R2 bucket under
  `org/<org id>/audit-archive/`, then reseeds the org; people are never
  deleted, a membership added after the seed is ended. Decisions go to the
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

## Login and identity (AUTH.md steps 3 and 4)

The deployed Worker logs people in at an identity provider (IdP) over
OpenID Connect (OIDC, the standard login protocol); design and details in
[`AUTH.md`](AUTH.md).

- **The IdP is Zitadel Cloud in its EU region** (instance
  `glide-mdt--dev-dybk0r.eu1.zitadel.cloud`, region chosen at creation).
  The contracting party is CAOS AG (Switzerland, Swiss law); the service
  runs on Google Cloud, a sub-processor with a US parent, so US access
  laws still reach the identity data. No data processing agreement with
  CAOS AG is recorded yet; one is needed before real staff accounts exist.
  The demo accounts are fictitious (`lekar1.a@codebridge.demo` and the
  like).
- **What the IdP holds:** each account's e-mail (verified), a display
  name, the password hash and login data (login times, sessions at the
  IdP). No health data, no org, role or membership: those stay in our EU
  D1 database. Self-registration is off, so only accounts an administrator
  created can log in.
- **What the Worker asks for:** the scopes `openid email`, so the ID token
  carries the subject (the IdP's user ID) and the verified e-mail; no
  profile. If Zitadel leaves the e-mail out of the ID token, the Worker
  reads it once from Zitadel's userinfo endpoint with that login's access
  token and drops the token.
- **What our side stores:**
  - `user_identities`: issuer, subject, the person it is linked to, first
    and last login time. Linked at the first login by the verified e-mail
    of a person provisioned in `users`; nothing is created for an unknown
    e-mail.
  - `auth_sessions`: the SHA-256 of the session ID (the ID itself is only
    in the browser's `__Host-cb_session` cookie, HttpOnly, Secure,
    SameSite=Lax), the person, the org, the membership and, after a role
    switch, the membership acted as, the times, and the ID token, kept
    only as the hint for the IdP's logout. No access or refresh token is
    kept anywhere.
  - A login transaction (state, nonce, PKCE verifier, return path) lives
    for at most ten minutes in an encrypted cookie (AES-256-GCM with the
    Worker secret `SESSION_KEY`) and is deleted by the callback.
- **Retention.** A session ends 12 hours after the login at the latest; in
  a hospital org also after 1 hour without use; logout deletes it at once.
  The cron sweep clears the ID token of a session that ended within 15
  minutes and deletes the row 30 days after it expired. Identities stay
  while the person has a membership; deleting them with the person's last
  membership, after the access-log retention FNO sets, is not built yet.
- **Logs.** Access-log rows name the person's ID and name, never the
  e-mail; the login writes `session.login`, `session.org` and
  `session.role` rows. Failed logins go to Workers Logs as a kind and a
  short code (`no_person`, `nonce`, `jwks`), never a token, e-mail or
  subject.
- **Role switch in a demo org.** A presenter logged in once acts as
  another demo account of the same demo org. Every access-log row then
  names the real person, the membership acted as and `impersonating = 1`;
  Administrace shows "Ing. Kovář (jako MUDr. Svobodová)". Hospital orgs
  have no role switch. This trades the audit's simplicity for a demo
  without repeated logins; the log keeps who really acted.

## Uploads and the document pipeline (step 6)

- **The identity check sends the case's identity to the page reader.** To tell whether an uploaded document is the
  case's patient's, the document Workflow sends the patient's name, birth number and birth date as written, with the
  page texts, to the page reader's `/v1/identity` (issue #18). That is the same service that already reads the pages:
  the Cloudflare Container in the EU (or `PAGE_READER_URL` locally), with no storage and no body in its logs. Only
  the result (`matches`, `conflicts`, `cannot_verify`, per page) comes back and is stored; the Workflow's step results
  hold the code only. A registered fixture's identity is never sent (the registry decides it).
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
  Other policies are for team staging and local work only, and
  `UPLOAD_STORE_ORGS` keeps content per org: the team's switch for demo
  org B, empty on the deployed host, since anyone with a demo account can
  act in org B. A kept photo is stored as uploaded, EXIF (including a
  location) and all; the pipeline reads only the PDF it converts it to,
  which drops that metadata (step-6.md, "Keeping uploads per org").
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
  The page reader (the container) has no secrets, no storage and no outbound
  network, and logs only method, path, status, duration and page counts.
  It runs in the EU as a Cloudflare Container (`constraints.jurisdiction:
  "eu"`, outbound network off with `enableInternet = false`; step-6.md "As
  implemented"), only for the orgs in `PIPELINE_ORGS`. Nothing in slice
  6b-1 sends a page to a cloud model.

### Documents from the NIS (issue #22)

- **They are uploads.** A document the NIS import brings is stored and
  read exactly as a file uploaded by hand (`storeFile`): the same keep
  policy, identity check per page, access-log line and retention.
- **A NIS document that is voided, removed or no longer the patient's is
  deleted from the case** (Juro's decision, 2026-10-19). When the NIS voids
  a DocumentReference (entered-in-error), when it disappears from the NIS,
  or when the patient is unlinked from their NIS record, the app withdraws
  the document through the doctor's withdraw path. Its file, pages, page
  text, derived facts, the model cache of its pages and its content in
  older runs are deleted. The access-log row gives the reason, and the
  case shows an alert naming the document by its NIS ID only. A
  deliberate re-link or a later import that finds the document current
  again brings it back. A document a doctor withdrew as another patient's
  is never taken back automatically, and a doctor's own upload that the
  NIS also holds is never deleted by the import. A document missing from
  the NIS answer is read once more directly before it goes, so a skipped
  page does not delete it. A removal is noticed at the next full pull of
  the record, at most a day later. A document that cannot go at once
  (being read, prepared) is retried at the next import; in a closed case,
  only once the case is open again. After an unlink it stays until a
  doctor withdraws it (open question in `docs/agent/OPEN_QUESTIONS.md`).
  In a case of the same patient the unlinking doctor may not act in, the
  documents stay for that case's team. The dialog warns before unlinking
  that documents will be deleted, and reports how many were.

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

## Text sent to a model (issue #20)

Every call from the document pipeline to an external model goes through one
interface in the Worker (`api/src/services/model.ts`). Nothing is built on
it yet that sends real documents; the extraction prompts come in phase 2.

- **Configuration only.** Provider, endpoint, model and key come from
  `MODEL_*` vars and a secret. Today that is the hackathon Azure gateway in
  Sweden Central ([gateway check](../research/2026-10-19-azure-gateway-check.md));
  another EU model is a configuration change.
- **Pseudonymized text.** Before a call, the Worker replaces in every text
  part: the case patient's name in its Czech declensions ("Lipenské",
  "VĚROU"), also without diacritics as OCR writes it, and double surnames
  part by part; any birth number with a slash, a ten-digit one that passes
  the birth-number check (month, day, divisible by 11), and the patient's
  own in any spacing; a birth date after "nar." (also with slashes or a
  two-digit year) and the patient's own (from the record, or from the
  birth number) in any format; phone numbers with +420 or after "tel.",
  "mobil", "fax"; e-mail addresses; form fields (Jméno, Příjmení,
  Bydliště, Adresa, Telefon) and the name after "Pacient:"; the org's
  staff names; any name after a title (MUDr., doc., Mgr., ...).
  Placeholders are `[PACIENT]`, `[RC]`, `[DATUM_NAROZENI]`, `[TELEFON]`,
  `[EMAIL]`, `[ADRESA]`, `[JMENO]`, `[PERSONAL_n]` (one number per staff
  member) and `[LEKAR_n]` (one number per titled name, the same in every
  part of one call). The mapping back stays in the Worker's memory for the
  length of the call, in private fields that a structured clone or JSON
  does not copy; it is never in a prompt, a log line, a Workflow step
  result, the cache or D1. Text parts are labelled by position, not by
  document ID or file name.
- **A gate on the whole payload.** The same rules run again over
  everything that would be sent (prompt, text parts, schema); any hit
  refuses the call (`identifier_remains`) and logs only the counts per
  kind. Because the rules are the same, the gate catches identifiers in
  parts that were never pseudonymized (a prompt or a schema that names a
  patient, a code path that skipped the step), not what the rules
  themselves miss. Images are accepted only as `RedactedPage` objects,
  which only the redaction step makes, for the same org and case.
- **Page images are redacted first** by the page reader (`/v1/redact` in
  `pipeline/container/server.py`), with the names from the case record and
  the org's staff in D1, never from fixture files. It also blacks out dark
  areas no OCR word covers (signatures, stamps, handwriting), best effort:
  on our synthetic pages it marks none, and a light stamp or a signature
  over printed text can be missed. The redacted image and its boxes with
  reasons (never values) are stored next to the page.
- **Vision reading of a page** (issue #20; `ExtractDocumentWorkflow`, off
  unless `MODEL_ORGS` lists the org) sends only the redacted image (a
  `RedactedPage`, from `/v1/redact`), with the prompt `read-page-cs`; the
  model writes a blacked-out place as `[X]` and never guesses it. Whose
  page it is (identity check, quarantine) is decided from the local,
  unredacted Tesseract or text-layer reading, never from the model's. In
  the Worker a page that shows, or may show, another patient is not sent
  to the model at all, as text or image: the pseudonymization knows only
  the case's identifiers. It fails closed: nothing is sent for a document
  marked as another patient's or without a page identity check, and no page
  the check did not list. (The offline harness still sends such synthetic pages, to
  measure the quarantine.)
- **Audit and budget.** One access-log row per page sent, written before
  the first attempt: case, document, page, provider, model, purpose and
  prompt version, never text. The attempt count and outcome go on a
  `model_calls` row (the access log is append-only). A budget of pages per
  org and per case and calls per page in a 24-hour window
  (`MODEL_BUDGET_*`) is checked in the same D1 batch, so a call over budget
  is refused before anything is sent.
- **Cache.** Model answers are cached in the EU R2 bucket under
  `org/<org>/cache/model/<case>/<document>/<model>/<prompt>@<version>/<prompt hash>/<input hash>.json`
  (a call over several documents: `<case>/multi-...`),
  so one org never reads another's. The cached answer is the pseudonymized
  one. Withdrawing a document as another patient's deletes its answers
  and the case's multi-document ones with its other content (the offline
  evaluation harness's local cache in `api/.cache/`, synthetic data only,
  is outside this purge). Reset-demo
  deletes the org's `cache/model/`; a lifecycle rule
  expires it after 30 days (`api/AGENTS.md`).

**Known limits of the pseudonymization**, to state to FNO and the jury:

- A name part alone (the patient's or a staff member's) is matched only
  when capitalized, because many names are ordinary Czech words ("Malá",
  "Černý", "Hlava": "malé pánve", "CT hlavy" must stay readable). Two parts
  of the same name together ("věra lipenská") and any name after a title
  are matched in any case. So a name part written in lower case on its own
  is missed, and a capitalized ordinary word that equals a name part ("Malá
  pánev" at the start of a sentence) is replaced, which loses that word for
  the model. The page images follow the same rule.
- A phone number without +420 or a label is not matched: nine digits in
  groups of three are as often a lab row ("Na 138 140 137").
- A birth date after "*" is matched only when it is the patient's own:
  OCR reads a bullet before an event date as "*" too.
- The staff list holds surnames only (D1 `users.sur`), so a staff first
  name alone is not matched.
- Names of other people without a title or a form label (relatives,
  external doctors) are not found: there is no Czech name recognizer yet.
- An OCR misread inside a name ("Lipcnská") is not matched, in text or on
  the image.
- Pseudonymized text is still personal data: diagnoses, dates and places
  stay because they are the medical content.

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
