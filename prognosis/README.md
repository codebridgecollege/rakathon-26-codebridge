# Local prognosis evidence search

Run `python3 mocks/serve.py` from the repository root, then open
`http://127.0.0.1:8766/v3.html`. The standard-library server serves the generated
mock and a same-origin API bound only to loopback. Static hosting still displays
the tab, but cannot call this local server implicitly. No browser receives the
OpenRouter key.

Copy missing settings from `.env.example` into the gitignored `.env`. Existing
process environment variables take precedence. The explicit GPT Astra model ID is
checked against the public OpenRouter catalog before searching. A missing or
unavailable model stops preflight without silently substituting another model.

## API

- `GET /api/prognosis/config`: key-present boolean, configured model IDs and labels.
- `GET /api/prognosis/profile?patient_id=10_pacient.pdf&scheduled_date=2026-10-17`:
  clinical profile preview without making a model call.
- `POST /api/prognosis`, JSON body
  `{"patient_id":"10_pacient.pdf","scheduled_date":"2026-10-17"}`: one request to GPT Astra, with OpenRouter's server-side web search tool.
  Optional `refresh:true` explicitly bypasses the memory cache and makes one new
  model request. Concurrent submissions receive HTTP 409. There are no automatic
  model retries, including on HTTP 429, to preserve the requested one-call limit.
Each model has a 240-second response budget and at most four server-tool steps.
Optional `OPENROUTER_REASONING_EFFORT=low` applies only if advertised by the model.
Provider errors report a safe category and code without echoing request text.

Only the two explicitly supported synthetic fixtures, case 10 and S01, are accepted.
The caller cannot submit arbitrary documents, patient text or file paths. Case 10
uses dated timeline and section facts plus dated comorbidities. Undated facts,
including the undated ECOG, are omitted and the omission is disclosed. S01 uses its
source-document dates, sourced summary, allowed clinical sections from its two
fixed synthetic notes (including performance status and medication), and the latest
available result per lab test. Identity headers, authors and social details are
excluded. Both past and recent clinical findings retain their document dates.
Partial dates use their latest possible day; ambiguous future months and future
facts are excluded. A dated fact containing a later explicit date is also excluded.
Source names, patient names and birth numbers are removed from the outgoing profile.
This implementation does not ingest browser edits, uploaded files or real records.

## Evidence and similarity

The checked-in prompt requires one row per study population and treatment arm,
explicit time origin, source, short source quote and separate endpoints. Evidence
must have been published by the earlier of the MDT date and today's date. Missing
values remain null. OS without time origin or numbers without a source quote and
HTTPS source are suppressed. At least one web search must be reported in provider usage. Each row URL must
appear in provider citation annotations. Endpoint quotes must match a supplied
search excerpt without crossing excerpt boundaries and use the same dated
publication as their row. Unsupported values and rows are suppressed. Numerical
values must also occur in their quoted passage. These are retrieval and structural
checks, not independent verification of the publication or its clinical relevance: every result remains labeled
`model_extracted_unverified`. The server does not fetch model-provided URLs. Semantic URL query parameters
remain part of source identity; known tracking parameters are ignored. A DOI
or PMID is a model claim until a person checks the original source.

Similarity is an inspectable heuristic calculated on the server from model-proposed
comparisons. A claimed match or mismatch requires a patient quote present verbatim
in the outgoing facts and a study quote; otherwise the dimension is unknown. The
score uses only known dimensions and coverage reports their total weight. Unknown
similarity has a null score, not zero. Histology, biomarkers and treatment-line
mismatches are separately visible. This is neither a validated prediction model nor
an individual survival probability.

Rows deduplicate only when the canonical publication ID and time origin agree,
using explicit cohort, arm and analysis IDs when all are supplied. Otherwise the
normalized arm and population descriptions must agree. Different descriptions remain separate to avoid merging unlike
cohorts. Conflicting endpoint values are retained in `conflicts` and the displayed
endpoint is null, rather than averaging. Model disagreement on the semantic similarity assessment suppresses
the overall score and retains its attributed variants; wording differences alone do
not suppress the score. No exhaustive-review claim is made.

When the provider explicitly reports output truncation (`finish_reason=length`),
only complete dictionary rows already present in the root JSON rows array can be
recovered. No unfinished row or invented closing data is used. Every recovered row
passes the same source checks, and the model status is partial with a warning.
Malformed JSON without a length signal is an error. Safe diagnostics include
finish reason, output character count and a parse error category, never raw output.
Entirely failed searches are not cached.

The cache contains normalized results in process memory only, at most 32 searches,
keyed by profile, evidence date, pinned model IDs and prompt. Restarting the server
clears it. No prompts, raw responses, case requests or access URLs are logged or
persisted. The provider's own retention is controlled by its service policies;
requests ask for providers with `data_collection:deny` and disable provider fallback.

## Validation

`python3 -m unittest discover -s prognosis/tests -v` exercises cutoff dates, partial
precision, identifier removal, source requirements, unknown similarity, preserved
conflicts, one model call, cached reuse, partial provider failure, malformed
responses, concurrency, search-grounding evidence and local HTTP origin/host/static-file restrictions. Fixtures
are explicitly synthetic and do not stand in for live clinical evidence.

Official integration references checked on 2026-10-17:

- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/guides/features/server-tools/web-search
- https://openrouter.ai/docs/guides/routing/provider-selection


## Saved synthetic replay

At the user's request, `mocks/src/data/prognosis-case-10.json` preserves the six
actual Astra result rows for synthetic case 10 and its 2026-10-22 MDT. The generated
page embeds this fixture and automatically displays it 2000 ms after the first
opening of the Prognóza tab. This replay makes no model API request, retains the
original search timestamp and source evidence, and is explicitly labeled as a
saved search. It is used only when both patient file and scheduled day match.
The backend's runtime cache remains memory-only; fresh searches do not silently
replace this saved fixture.
