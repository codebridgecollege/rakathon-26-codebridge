# NIS test server and test data

The NIS (nemocniční informační systém) is the hospital information system;
FNO's NIS would give CodeBridge patients, documents and results over FHIR R4
(the HL7 standard for exchanging health records as linked JSON records called
resources; [`docs/design/INTEGRATION.md`](../../docs/design/INTEGRATION.md)).
Until a hospital connects, this folder stands in for it: synthetic FHIR test
data and a local FHIR server to load it into. Issue #22, stream F, phase 1.

Nothing here goes to a public FHIR server: `seed.ts` refuses any host that is
not this machine, and both servers listen on `127.0.0.1` only.

## What is here

| File | What it does |
|---|---|
| `bundles.ts` | Builds the test data as FHIR R4 transaction Bundles from the committed synthetic fixtures (`fixtures/data`, `samples/`, `data/rakathon-26`), never from `private/` |
| `build.ts` | Writes the Bundles to `out/` (gitignored: they hold the sample PDFs as base64) |
| `memory-server.ts` | An in-memory FHIR server (the test double): the interactions the connector uses, answered as the FHIR specification describes them (not compared against a running HAPI) |
| `serve.ts` | Runs the in-memory server on `http://127.0.0.1:8090/fhir` |
| `seed.ts` | Loads `out/` into a local FHIR server (the in-memory one or HAPI) |
| `docker-compose.yml` | HAPI FHIR JPA server `v8.12.0-2`, pinned by digest, on `http://localhost:8091/fhir` |
| `validation/` | The HL7 validator's report for each Bundle |

The Worker's connector is `api/src/services/fhir.ts`; its tests
(`api/test/nis.test.ts`) run against `memory-server.ts` loaded with these
Bundles (`api/vitest.config.ts` builds them without the PDF bytes).

## Run it locally

Node 22.18 or newer runs the TypeScript files directly.

```sh
node fhir/nis/build.ts                  # writes fhir/nis/out/*.json
node fhir/nis/serve.ts --seed           # in-memory server with the Bundles, http://127.0.0.1:8090/fhir
```

Or with HAPI FHIR in Docker (needs a running Docker daemon; not run on the
machine this was built on, where Docker did not answer, so the compose file is
untested):

```sh
docker compose -f fhir/nis/docker-compose.yml up -d
node fhir/nis/seed.ts http://localhost:8091/fhir
```

Then point an org at it and start the Worker (demo mode):

```sh
cd api && npm run stage && npx wrangler dev --var AUTH_MODE:demo \
  --var 'NIS_CONFIG:{"demo-a":{"base_url":"http://127.0.0.1:8090/fhir","label_cs":"Testovací NIS (syntetická data)","auth":{"mode":"none"}}}'
```

"Import z NIS" then appears in the patient header of org A's cases. Case 10
and S01 have no birth number in our data, so the dialog asks for one: type
the test-only number of their NIS record, `610518/3007` (case 10) or
`640312/3001` (S01), invented for this server (below), and confirm the link
by hand.

Checked this way on 2026-10-19 against the in-memory server and a seeded
local Worker: `/api/me` shows the NIS, case 10's search finds `cb-c10`, the
link is refused without confirmation and stored with it, the access log has
a row per pull, and neither the Worker's log nor the server's log holds the
birth number.

## The patients

| Bundle | Patient | Resources | What it holds |
|---|---|---|---|
| `s01` | Radovan Křemínek (S01, glioblastoma) | 79 | Patient, Coverage, Condition C711 and I802, Procedures (resection, chemoradiotherapy, the MRI of 29.9.2026 without a report), MedicationStatements, Encounters, ServiceRequests (PET/CT requested 1.10.2026 with no result; the MDT referral with its question), 4 lab panels (DiagnosticReport + 13 Observations each), DocumentReference + Binary for `S01_pacient.pdf` |
| `s02` | Věra Lipenská (S02, rectal cancer) | 119 | The same kinds; identity from the FHIR referral `samples/S02_pacient/upload/zadost-fhir.json`; cTNM (17.3.2026) and ypTNM (21.8.2026) as Observations inside their reports; radiology and pathology DiagnosticReports; CT requested 7.10.2026 with no result; 4 lab panels with 18 tests; 7 DocumentReferences + Binaries for the upload PDFs |
| `case-10` | Daniel Poláček (FNO's patient 10, kidney cancer) | 41 | Condition C64, pTNM, procedures, the four lines of systemic treatment, brain MRI report, 26 lab Observations without a draw date (the lab sheet gives none), DocumentReference + Binary for `10_pacient.pdf` |
| `failure-cases` | F01-F04, test patients only | 17 | The failure cases below |

Lab values, units, reference ranges, codes and dates are the ones the
documents state. Where a document states nothing, the element is left out:
case 10's labs have no `effectiveDateTime`, histology reports have no
`issued` (the documents give the day without a time), case 10's document and
patient have no date and no sex, a document's day goes to
`DocumentReference.context.period` because `DocumentReference.date` needs a
time, and medication has no end date unless the text gives one. H/L
interpretation is set only where the lab sheet marks the value. Medication
has text only (the documents give no ATC or SÚKL code) and status `unknown`
(they do not say whether a drug is still taken). A diagnosis keeps the
document's wording in `onsetString` ("diag. 12/2025"), because the documents
date the diagnosis, not the first symptom.

What the test data adds beyond the documents, so a reader does not take it
for a fact: the identities below; the shape a NIS would give the same facts
(an Encounter per outpatient visit, a DiagnosticReport per lab draw, stage
Observations inside their reports, a Procedure for an exam the documents
only mention); S02's radiology conclusions, which are the outpatient
report's quotes of the NIS reports ("popis z NIS"), not the reports; and case
10's pathological stage written `M0` where the document's text layer reads
`MO`.

**Test-only identity.** S01's and case 10's documents print no birth number,
and F01-F04 exist only here, so their birth numbers are invented for the test
server (`TEST_ONLY_BIRTH_NUMBERS` in `bundles.ts`): valid in form, not taken
from any document. Case 10's birth date is invented the same way. S02's
number is the one its documents print. The app's own patient rows keep NULL
where the documents state none.

**Codes.** MKN-10 (`https://uzis.cz/terminology/CodeSystem/mkn-10`) is
written without the dot (`C711`), as ÚZIS's code system and the HL7
terminology server know it; the documents print `C71.1`, which the validator
rejects as an unknown code. The document's wording is in `code.text`; the
coding has no `display`, because display must be ÚZIS's own name. Lab tests
carry FNO's own codes (`S_CREAE`, `B_PLT`) in our placeholder code system
(`fhir/definitions/CodeSystem-fno-local-lab-code.json`, extended with
`S_ALB`, `S_CA199` and `S_CEA` for S02). NČLP codes would come from FNO's lab
system; the documents give none.

## The failure cases

| Patient | Case (CLAUDE.md, "Test against the known failure cases") | Expected behaviour |
|---|---|---|
| F01, birth number `720905/3005` | Two patients mixed up: three records for one birth number. `cb-f01-b` is inactive and `replaced-by` `cb-f01-a` (stored without the slash); `cb-f01-c` is a second, unmerged record with the name typed without diacritics | The search shows all three and says the NIS holds duplicates; `cb-f01-b` cannot be linked and points at `cb-f01-a`; `cb-f01-c` is marked "jméno zapsáno jinak"; nothing is merged |
| F02 | An amended document: the histology `cb-f02-doc-histo-v2` `relatesTo` `replaces` `cb-f02-doc-histo-v1` (status `superseded`; G2 became G3) | The mapping lists v1 as superseded and v2 as replacing it (`api/test/nis-map.test.ts`); reading the current version through the upload path and flagging facts from the old one comes with the document import |
| F03 | A real contradiction: two pathological stages of the same specimen and day (`pT3 pN0` and `pT4a pN1a`); the clinical stage `cT4a cN1 cM0` before surgery differs too, which is not a contradiction | The mapping keeps them as three stage facts, the two pathological ones under one key (`#2`); the contradiction alert itself belongs to the case rules |
| F04 | A referral with no result: MRI requested and reported (`basedOn`), PET/CT requested with no report | The MRI request is `done` with `result_fact` pointing at the imaging fact; the PET/CT request stays `requested` with none |
| S01, S02 | The same "requested, no result" in real sample data (PET/CT 1.10.2026, CT 7.10.2026); S01's MRI of 29.9.2026 as a Procedure without a report ("an examination that happened but whose report is missing") | The mapping keeps the PET/CT and CT requests `requested` with no result and the MRI as a done procedure (`api/test/nis-map.test.ts`); the missing-report alert belongs to the case rules |

Phase 1 uses F01 (patient match); phase 2's mapping uses F02-F04.

## Validation

The official HL7 validator 7.0.2 (FHIR 4.0.1, Czech core guide 1.0.0 and
`fhir/definitions` loaded; codes checked against tx.fhir.org, which receives
codes only) on 2026-10-19: **0 errors** in all four Bundles. The warnings are
the honest gaps: no narrative on the resources (dom-6), no performer on the
observations (the documents do not say who performed them), and no date on
case 10's labs.

```sh
node fhir/nis/build.ts
VALIDATOR_JAR=<validator_cli.jar> sh fhir/validate.sh fhir/nis/out/s01.json > fhir/nis/validation/s01.txt
```

## What the test double supports

Transaction and batch Bundles with `PUT <type>/<id>` entries; read and vread;
search by GET and by `POST <type>/_search` with a form body, with `_id`,
`identifier` (`system|value`, comma for OR), `patient`, `subject`, `status`
and `_count`; paging through `next` links (`?_getpages=...`, as HAPI writes
them); `GET metadata`. An unknown search parameter answers 400, so a
connector that sends one fails a test instead of getting everything.
`failNext(status, times)` makes the next requests answer 429 or 503, and a
`bearer` option requires a token. It does not validate resources, check
references, or support `_include`, `_has`, conditional updates or history
searches.
