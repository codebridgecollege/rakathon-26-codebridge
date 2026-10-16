# Backlog - CodeBridge

Larger pieces of work the team has agreed to do next, in order. Each item
says what "done" means. Questions waiting for someone's answer go in
[`docs/agent/OPEN_QUESTIONS.md`](../agent/OPEN_QUESTIONS.md), not here;
features and their tiers are in [`PRODUCT.md`](PRODUCT.md).

When an item is done, delete it here and link its result from the doc it
produced.

## 1. Review how the patient summary is produced

Juro, 2026-10-16. The summary (MDT brief, detailed oncology summary,
anamnesis, flags) was built *some* way during the mocks; check whether it
was built correctly and whether it can be made compliant.

- How each part was generated: prompts, models, by hand, from which data
  (`mocks/src/extract/`, `mocks/src/data/`, sub-agent briefs).
- Whether every sentence traces to a source quote and page, and whether
  the assistant's inferences are labelled (`CLAUDE.md`, "Clinical trust").
- Whether it can be reproduced: pinned model, prompt in the repo, fixed
  inputs; and what was corrected by hand after reviews.
- What data it saw and where it was sent (`docs/design/DATA-PROTECTION.md`).
- Done when: a short write-up of the current method, its gaps, and the
  design of the production pipeline (extraction, summary, checks), with
  the decisions recorded.

## 2. Integrating the app into a real hospital

Juro, 2026-10-16. Live research on how others introduce apps into
hospitals, ideally in the EU and Czechia, then a design for FNO.

- State of the art and best practice: how clinical apps connect to the
  hospital information system (NIS), lab (LIS), imaging (PACS), and
  pathology systems; HL7 v2 messages, FHIR R4 APIs, IHE profiles (MHD for
  documents, PIXm/PDQm for patient identity), SMART on FHIR app launch,
  interface engines (FNO already uses InterSystems). What the organizer
  talks recommended is summarized in [`docs/agent/INDEX.md`](../agent/INDEX.md).
- Czech and EU context: EHDS, the Czech eHealth law and national services,
  Czech FHIR profiles, what Czech hospitals actually run.
- Identity and access: single sign-on with the hospital's identity server
  (for example Active Directory or Entra ID via OIDC/SAML), the user
  directory, groups, roles (doctor, coordinator, administrator,
  department), and fine-grained access (who may see which patient, break
  the glass for emergencies).
- Operations: e-mail notifications (link only, see `CLAUDE.md`), webhooks
  or events to other systems, admin panel, audit log (who saw what, kept
  how long, who can read it), backups, monitoring.
- Deployment requirements: on-premise or hospital cloud, hardware
  (including a GPU for a local vision model, see
  [`DATA-PROTECTION.md`](DATA-PROTECTION.md)), network zones, the Czech
  cybersecurity rules for essential services, medical device regulation
  (MDR) questions for an assistant that summarizes records.
- Done when: a research note in `docs/research/` with sources, and an
  integration design (architecture diagram, interfaces, identity and
  access model, deployment requirements) that the demo can point to.

## 3. Test with more data, ideally open data sets

Juro, 2026-10-16. FNO gave us ten fictitious patients, and only patient
10 is worked through. To see how the pipeline and the screens hold up,
import more data.

- Find open or synthetic data sets that fit: synthetic EHDS documents
  (SYNDERAI, see [`docs/agent/INDEX.md`](../agent/INDEX.md)), synthetic
  FHIR patients (for example Synthea, or the InterSystems kit's
  generated patients), public oncology and neuro-oncology case reports,
  and anything shaped like the Common Cancer Model. Check each licence
  and that it holds no real patient data.
- Prefer Czech or Slovak documents and real-world layouts (scans,
  tables, typos), because that is where reading fails.
- Import through the same path a hospital would use (upload or FHIR),
  run OCR, extraction, and summary on them, and see what breaks: dates,
  stages, negations, contradictions, missing documents, many documents
  per patient, many patients per seminar.
- Keep the imported sets as test cases under `samples/` with expected
  results where we can, so the failure cases in `CLAUDE.md` are covered.
- Done when: a note in `docs/research/` on which sets we used and what we
  learned, at least one larger set loaded into the app, and the gaps
  turned into fixes or open questions.
