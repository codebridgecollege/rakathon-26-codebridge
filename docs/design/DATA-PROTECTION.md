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

What option B cannot remove without hurting the medical content: dates of
examinations, diagnoses, rare findings, hospital names. These are
quasi-identifiers, which is why the data stays personal data.

## Recommendation

- **Hackathon demo:** FNO's data is fictitious, so the cloud vision model
  is allowed (`docs/agent/HACKATHON.md`). We still show the redaction step,
  because the jury will ask, and the source view shows the original page.
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

Open points are in [`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md).
