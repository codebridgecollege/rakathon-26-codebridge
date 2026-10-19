# Azure gateway check (issue #20, stream D phase 1)

Status: measured 2026-10-19 with synthetic inputs only, about 20 calls, no load test.

**The hackathon Azure gateway** is the endpoint the organizers gave us: Azure API Management (APIM) in front of an
Azure OpenAI deployment, `https://apim-rakathon-q7146n.azure-api.net/openai/v1`, deployment `gpt-6-luna-dz-eu`.
The decision to use it for now is in
[`2026-10-19-patient-pipeline-gaps.md`](2026-10-19-patient-pipeline-gaps.md), "Decisions needed".

The probe was a Node script outside the repository that read the key from `api/.dev.vars` without printing it. The
only page image sent was our synthetic patient S02, page 1, after redaction
(`data/derived/pages/S02_pacient/p1.redacted.png`).

## Results

| Question | Answer | Evidence |
|---|---|---|
| Model behind the deployment | `gpt-6-luna-2026-09-22`, a reasoning model | `model` in every answer; `reasoning_tokens` in `usage` |
| Region | Sweden Central (EU) | `x-ms-region` header |
| Image input | **Yes.** `image_url` with a `data:image/png;base64` URL and `detail: "high"` | 1240 x 1755 grayscale page: 200, 2,483 prompt tokens, the first 15 lines transcribed correctly, black boxes written as `[X]` as asked |
| Structured output | **Yes.** `response_format: {type: "json_schema", strict: true}` and `{type: "json_object"}` | Valid JSON matching the schema; a negation ("bez známek metastáz") came back with `negated: true` |
| Temperature | **Only the default (1).** `temperature: 0` answers 400 `unsupported_value` | Reproducibility rests on the pinned model, the prompt in the repository and the output cache, not on temperature |
| `seed` | Accepted (200); not checked whether it makes answers repeatable | |
| `reasoning_effort` | Accepted. `low` cut the image call from 13.7 s and 1,229 reasoning tokens to 8.1 s and 287 | One page each, same prompt |
| Maximum input | **922,000 input tokens**, stated by the 400 `context_length_exceeded` answer | 558,158 tokens accepted (5.4 s); 1,116,302 refused |
| Rate limits | 3,333 requests and 3,333,000 tokens per window per key, from `x-ratelimit-limit-*` headers | A burst of 8 parallel calls: all 200, about 1 s each |
| 429 | Seen once: a 1.1 M-token request right after a 558 k-token one (the token window), in 0.7 s. It carried **no `Retry-After` header** that the probe printed | One occurrence; the repeat a minute later got the 400 above |
| Latency | Short text: 1.0-1.3 s. JSON schema extraction of 3 facts: 2.2 s. One page image: 8-14 s | |

## What this changes

- **Vision reading through this gateway is possible**, so a scanned page can be read by the model after redaction.
  It is still personal data (DATA-PROTECTION.md); real patients need FNO's clearance.
- **Fact extraction can use `json_schema` with `strict: true`**, so the extraction prompts (phase 2) get the
  schema-checked shape the format in [`EXTRACTION-FORMAT.md`](../design/EXTRACTION-FORMAT.md) needs; the server still
  validates every answer and anchors every quote.
- **Input size is not the constraint**; time and the shared rate limit are. The model interface caps input at
  `MODEL_MAX_INPUT_CHARS` (200,000 characters) and a page budget per org and case, both in `api/wrangler.jsonc`.
- **The retry code must not rely on Retry-After.** `fetchWithRetry` (`api/src/services/retry.ts`) honours
  `retry-after-ms` and `Retry-After` when present and otherwise backs off exponentially.
- **`reasoning_effort: low`** is the default (`MODEL_REASONING_EFFORT`); phase 2 checks it against the evaluation cases
  before relying on it.

## A redaction gap this check found

The model read "nar. 14.6.1958" on the redacted S02 page: `redact.py` caught a birth date only when "nar." started a
line or was glued to the date. Fixed in the same change (a date after "nar." anywhere on a line, and the case's birth
date from the record), and the committed S02 redaction files were regenerated. The redaction remains a demonstration,
not a guarantee (DATA-PROTECTION.md).

## Not checked

- Whether the gateway keeps prompts or outputs (abuse monitoring), and its data processing terms: a question for the
  organizers before any real data.
- PDF input, several images in one call, and the image size limit.
- Behaviour under the shared load of all teams.
