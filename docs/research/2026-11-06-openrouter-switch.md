# Moving the Worker's language model to OpenRouter

Status: 2026-11-06, deployed at the team's request with the known issues below still open. Synthetic data only.

**OpenRouter** is a service that offers many models through one API and one key. The hackathon Azure gateway stopped
accepting our key, so the Worker's page reading, fact extraction, brief and discussion summaries moved to
`openai/gpt-6-luna` on the endpoint `azure/eu`. The Prognóza study search moved to
`anthropic/claude-opus-5.5` on `google-vertex/europe`, at effort medium, and is on for the demo orgs.

## Measurements

- **Pin.** A pin to an unknown endpoint gets a 404, never another provider. `azure/eu` and `azure/us` resolve to
  different endpoint IDs, as do `google-vertex/europe` and `google-vertex/us`. `data_region` said "global" for all of
  them, so it does not state where the model ran.
- **Search, one synthetic lung profile.** Catalog prices per million tokens: Opus 5.5 $4 in, $20 out; GPT-6 Astra $10
  in, $50 out.

| Endpoint, effort | Result | Rows | Cost | Time |
|---|---|---|---|---|
| `google-vertex/europe`, low | searched, passed the checks | 2, one study | $0.18 | 34 s |
| `google-vertex/europe`, medium | searched, passed the checks | 8, more than one study | $0.34 | 75 s |
| `amazon-bedrock/eu-west-1`, low | did not search, refused as `ungrounded_response` | 0 | $0.03 | 8 s |

- **Extraction evaluation.** Pass / fail, from `pipeline/eval.py --ai-runs`. Run 1 covered all five cases. Run 2 repeated
  10, S02 and S04 and reused run 1 for S01 and S03. The briefs of run 1 were sent without the pin, so they prove nothing
  about `azure/eu`. Baseline: `2026-10-19-extraction-eval.md`.

| Failure kind | Run 1 | Run 2 |
|---|---|---|
| critical fact left out | 7 / 0 | 7 / 0 |
| wrong date | 4 / 0 | 4 / 0 |
| negation read as positive | 8 / 0 | 8 / 0 |
| patients mixed up | 8 / 0 | 8 / 0 |
| report missing | 7 / 2 | 7 / 2 |
| request without result | 6 / 1 | 7 / 0 |
| poor scan | 17 / 0 | 17 / 0 |

## Known issues to fix

Most urgent first. The first one can put a wrong value in front of a doctor.

1. **Page reading drops characters; cause not known.** S04 page 1 says "2.9.2026"; both runs read "9.2026", though the
   text layer, Tesseract and the stored `p1.vision.md` have it right. Case 10 "mozku" became "mozu" and "mohu", and "NCH"
   became "CH" in one run. Check first whether the redacted image covers those characters, then the image input and
   whether `reasoning_effort` is honoured.
2. **False "original report missing" alerts.** S02 in run 1, S04 in run 2: the facts of the original report carry no date.
3. **Unfinished answers pass as finished** (`services/model.ts`, `services/summarize-transcript.ts`). Accept only
   `finish_reason: "stop"` with non-blank text.
4. **A document the model never read shows as "not stated"** (`domain/extract/build.ts`, `not_found` for `calls: []`).
5. **A failed search replaces the good saved one** (`workflows/prognosis.ts`). On case 10 a failed search hides the six saved rows until a demo reset.
6. **Transcripts have no protection** (`workflows/speaker-pass.ts`, `routes/summarize.ts`): no pseudonymization, gate or
   budget, and no `MODEL_ORGS` check. Send them through `callModel`.
7. **A failed vision read falls back to the text layer unmarked** (`workflows/extract-document.ts`).
8. **The 400-token summary cap is not measured** against reasoning tokens, and a `length` finish is retried.
9. **Smaller:** old `azure_*` codes show raw; 402, 403 and 408 mapping; `require_parameters`; no pin check for
   `openai-compatible` pointed at OpenRouter; budget rows from the outage count for 24 hours; stale passages in
   `DATA-PROTECTION.md`, `TECHNOLOGIES.md`, `PROGNOSIS.md`, `PRODUCT.md`, `api/AGENTS.md`, `e2e/README.md`.

After the deploy, documents left unread during the outage need reprocessing by hand (`POST /documents/:id/process`).
