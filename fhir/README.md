# FHIR export

The app exports a case as a FHIR R4 Bundle (FHIR is the HL7 standard for
exchanging health records as linked JSON records called resources). The
"Export FHIR" button in the patient header (`app/app/lib/fhirExport.ts`)
builds it in the browser from the same data the screens show, opens it in a
dialog with "Stáhnout JSON", and records the export in the access log
(`fhir_exported`); the Bundle itself is not sent to the server. The team chose this on
2026-10-17 (`docs/agent/HACKATHON.md`, "Team decisions"); how a pilot would
exchange the same data with FNO's FHIR API is in
[`docs/design/INTEGRATION.md`](../docs/design/INTEGRATION.md).

Only a case with extracted finding groups (patient 10) has the button; the
other patients have no extracted facts to export.

## What is in the Bundle

A `collection` Bundle, built by the pure function `fhirBundle()` in
`packages/domain/src/fhir-export.ts`:

| Our data | FHIR R4 resource | Notes |
|---|---|---|
| The assistant | `Device` | Author of everything the assistant drafted |
| Patient | `Patient` | Case ID as identifier; sex only when the document states it |
| Source PDF | `DocumentReference` | One per document |
| Diagnosis | `Condition` | MKN-10 code, system `https://uzis.cz/terminology/CodeSystem/mkn-10` (from the Czech core guide); onset from the timeline's diagnosis event, with its source |
| Comorbidities | `Condition` | Text, category problem-list-item; the date next to it is the date of the exam that mentions it, so it stays a note, not an onset |
| Clinical findings, current state, imaging, histology | `Observation` | Text as the document states it, with the section as `code.text`; status `preliminary` when the reading is unclear |
| Past treatment | `Procedure` | Status `unknown`: the documents alone do not say whether it is completed |
| Medication | `MedicationStatement` | Status `unknown`, text as written |
| A drug the documents call contraindicated | `Flag` (category drug) | Never a `MedicationStatement`, which would read as a drug the patient may take |
| Lab values | `Observation` (laboratory) | FNO's lab code kept; the value with its written precision (4,130 stays 4.130), the original unit and reference range text, and the value as written in a note. H/L is marked as worked out by the assistant from the stated range, because the document does not mark it |
| Missing documents, contradictions, changes, unreadable passages, and anything the assistant inferred | `DetectedIssue` | Status `preliminary`, author the assistant, `implicated` the documents: these are the assistant's observations, not facts from the record |
| The summary for the MDT | `Composition` | Status `preliminary`: the MDT question (or the gap), summary sentences, the timeline, notes on the documents, and sections pointing at the entries above |
| Where each fact comes from | `Provenance` | One per fact: the target, the `DocumentReference`, and two extensions with the page and the quote. For a summary sentence or timeline event, the standard `targetElement` extension points at that sentence's id in the Composition |

The rules from `CLAUDE.md` carry over:

- **Every claim points to its source.** Every fact, observation of the
  assistant, and summary sentence has a `Provenance` with the document,
  the page (`source-page`) and the quote as written (`source-quote`),
  misread characters included.
- **Uncertainty is visible.** Each fact carries the `extraction-certainty`
  extension: `documented` or `unclear_ocr` (then the Observation is
  `preliminary`). What the assistant inferred is not exported as a fact
  at all but as a `DetectedIssue`.
- **No guessed values.** Dates keep their precision ("4/2022" becomes
  `2022-04`); a date we cannot read safely ("9/23") is not converted and
  goes into a note as written. Missing sections say "Neuvedeno v dostupné
  dokumentaci" with an empty reason.
- **Codes the source gives are kept.** MKN-10 for the diagnosis, FNO's own
  lab codes for labs. FNO's lab codes sit in a placeholder code system
  until FNO names the real one.
- **Drafts are not decisions.** The Composition and DetectedIssues are
  preliminary and the Provenance says "neověřeno lékařem" (not verified by
  a doctor).
- **The export is logged.** Exporting writes "exportoval(a) případ jako
  FHIR" to the access log, and the dialog warns that the file holds the
  patient's identity.

## Our definitions

`definitions/` holds what is ours, under the canonical base
`https://github.com/codebridgecollege/rakathon-26-codebridge/fhir`:

- `StructureDefinition-source-page.json`, `StructureDefinition-source-quote.json`:
  extensions on `Provenance.entity`,
- `StructureDefinition-extraction-certainty.json` with
  `ValueSet-extraction-certainty.json`: the certainty extension on a resource,
- `CodeSystem-extraction-certainty.json`, `CodeSystem-assistant-flag.json`,
- `CodeSystem-fno-local-lab-code.json`: a fragment with the lab codes in
  the challenge data.

## Validation

`examples/case-10-bundle.json` is the export of patient 10 and
`examples/case-10-validation.txt` its report from the official HL7
validator (version 7.0.2, FHIR 4.0.1, with the Czech core guide 1.0.0
loaded, codes checked against the HL7 terminology server). Result on
2026-10-17: **0 errors**, 98 warnings, 113 informational messages. The
terminology server confirmed MKN-10 C64 with its Czech name. The warnings
are honest gaps, not defects:

- 58 observations have no performer: the documents do not say who
  performed them.
- 40 observations have no date: the document gives none, and we do not
  invent one.

The informational messages say our own code systems are drafts. Czech
characters in the report's console text are garbled by the validator's
output encoding; the Bundle itself is UTF-8.

To regenerate (needs a local Worker on the seeded demo, the e2e suite's
Playwright from `npm --prefix e2e ci`, Java 17+, the validator jar, and
network access for the terminology server). `fhir/export.mjs` clicks
"Export FHIR" and "Stáhnout JSON" in the app, as a user does:

```sh
node fhir/export.mjs            # FHIR_BASE_URL defaults to http://localhost:8787
VALIDATOR_JAR=<validator_cli.jar> sh fhir/validate.sh > fhir/examples/case-10-validation.txt
```

The example contains the fictitious challenge patient's name, like the
rest of `data/`; never export a real patient into this folder.
