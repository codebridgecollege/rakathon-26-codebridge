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
pages; on the other 10 it found nothing, which the mock states as "kontrola
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

## Meeting audio

The recording of an MDT discussion is patient data. In the demo, "AI
záznam" is off until a doctor starts it; the demo assumes the
participants agreed beforehand, which a pilot must record. Words are filed only under the case the doctor has open, never
split by guessing. Audio from moments when no case can take it is
replaced by silence before it leaves the browser, and a case's audio is
deleted as soon as its speaker pass is done. Speakers are numbered, not
named, because naming them would need voiceprints (biometric data). The
demo sends audio to ElevenLabs and is used only with fictitious speech; a
pilot needs a speech server inside FNO, or FNO's clearance for an
outside service.

Open points are in [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).



## Prognosis searches

The local prognosis API accepts only identifiers for two explicitly supported synthetic fixtures, not arbitrary uploaded documents. It constructs a dated clinical profile, removes names and birth numbers, and keeps the OpenRouter API key server-side. Searches require an explicit button action. Results and prompts are not logged or saved to disk; normalized results are held in a bounded process-memory cache. Browser edits are excluded. Provider retention remains subject to the provider policies; the request asks for providers with `data_collection:deny`. See [the API notes](../../prognosis/README.md).


## User-requested synthetic prognosis fixture

The user explicitly requested saving Poláček's prognosis search for demo replay.
`mocks/src/data/prognosis-case-10.json` contains the minimized synthetic profile
and six normalized Astra study rows, including their source evidence and original
search timestamp. The generated page embeds them for a two-second replay matched
to the patient and scheduled day. This fixture is persistent; the backend runtime
cache remains memory-only. It contains no API key or real patient data.
