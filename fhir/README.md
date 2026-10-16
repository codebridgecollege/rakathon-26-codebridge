# FHIR export

Mock v3 exports a case as a FHIR R4 Bundle (FHIR is the HL7 standard for
exchanging health records as linked JSON records called resources). The
"Export FHIR" button in the patient view builds it in the browser from the
same data the screens show; there is no server. The team chose this on
2026-10-17 (`docs/agent/HACKATHON.md`, "Team decisions"); how a pilot would
exchange the same data with FNO's FHIR API is in
[`docs/design/INTEGRATION.md`](../docs/design/INTEGRATION.md).

Only the fully worked case (patient 10) has the button; the other patients
in the mock have no extracted facts to export.

## What is in the Bundle

A `collection` Bundle, built by `fhirBundle()` in
`mocks/src/v3-template.html`:

| Our data | FHIR R4 resource | Notes |
|---|---|---|
| The assistant | `Device` | Author of everything the assistant drafted |
| Patient | `Patient` | Case ID as identifier; sex only when the document states it |
| Source PDF | `DocumentReference` | One per document |
| Diagnosis | `Condition` | MKN-10 code, system `https://uzis.cz/terminology/CodeSystem/mkn-10` (from the Czech core guide) |
| Comorbidities | `Condition` | Text, category problem-list-item |
| Clinical findings, current state, imaging, histology | `Observation` | Text as the document states it, with the section as `code.text` |
| Past treatment | `Procedure` | Status `unknown`: the documents alone do not say whether it is completed |
| Medication | `MedicationStatement` | Status `unknown`, text as written |
| Lab values | `Observation` (laboratory) | FNO's lab code kept, original unit and reference range text, H/L from the document |
| Missing documents, contradictions, changes, unreadable passages | `DetectedIssue` | Status `preliminary`, author the assistant: these are the assistant's observations, not facts from the record |
| The summary for the MDT | `Composition` | Status `preliminary`, sections pointing at the entries above |
| Where each fact comes from | `Provenance` | One per fact: the target, the `DocumentReference`, and two extensions with the page and the quote |

The rules from `CLAUDE.md` carry over:

- **Every claim points to its source.** Every fact, observation of the
  assistant, and summary sentence has a `Provenance` with the document,
  the page (`source-page`) and the quote as written (`source-quote`),
  misread characters included.
- **Uncertainty is visible.** Each fact carries a `meta.tag` from the
  `extraction-certainty` code system: `documented`, `unclear_ocr`, or
  `inferred`.
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
- `CodeSystem-extraction-certainty.json`, `CodeSystem-assistant-flag.json`,
- `CodeSystem-fno-local-lab-code.json`: a fragment with the lab codes in
  the challenge data.

## Validation

`examples/case-10-bundle.json` is the export of patient 10 and
`examples/case-10-validation.txt` its report from the official HL7
validator (version 7.0.2, FHIR 4.0.1, with the Czech core guide 1.0.0
loaded). Result on 2026-10-17: **0 errors**, 101 warnings, 115
informational messages. The warnings are honest gaps, not defects:

- 59 observations have no performer: the documents do not say who
  performed them.
- 41 observations have no date: the document gives none, and we do not
  invent one.
- 1: the MKN-10 code cannot be checked offline; checking it needs the
  Czech terminology server.

To regenerate (needs Node with Playwright, Java 17+ and the validator jar):

```sh
uv run mocks/build.py
PLAYWRIGHT_PATH=<node_modules/playwright-core> node fhir/export.mjs
VALIDATOR_JAR=<validator_cli.jar> sh fhir/validate.sh > fhir/examples/case-10-validation.txt
```

The example contains the fictitious challenge patient's name, like the
rest of `data/`; never export a real patient into this folder.
