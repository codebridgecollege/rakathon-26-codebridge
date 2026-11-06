# Moving the Worker's language model to OpenRouter

Status: 2026-11-06. Synthetic data only.

**OpenRouter** is a service that offers many models through one API and one key. The hackathon Azure gateway stopped
accepting our key, so the Worker's fact extraction, brief and discussion summaries moved to `openai/gpt-6-luna` on
the endpoint `azure/eu`, and page reading to `anthropic/claude-haiku-5.5` on `google-vertex/europe`. The Prognóza study search moved to
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

## Page reading: why two models

Luna dropped characters from clean print, so page images moved to another model. The redacted image was checked by eye
and is sharp; redaction is not the cause. Four runs per setup on two pages, with the real prompt, against dates and words
known from the text layer. A run is right when none of the known strings is lost.

| Model, effort | S04 p1 right | Case 10 p3 right | Cost per page |
|---|---|---|---|
| `openai/gpt-6-luna` on `azure/eu`, low | 1 / 4 | 1 / 4 | $0.0007 to $0.0011 |
| same, default effort | 0 / 4 | 3 / 4 | $0.0010 to $0.0024 |
| same, medium | 0 / 4 | 4 / 4 | $0.0011 to $0.0021 |
| same, high | 1 / 4 | 4 / 4 | $0.0015 to $0.0035 |
| `anthropic/claude-sonnet-5.5` on `google-vertex/europe`, low | 4 / 4 | 4 / 4 | $0.016 to $0.025 |
| `anthropic/claude-haiku-5.5` on `google-vertex/europe`, low | 4 / 4 | 4 / 4 | $0.0008 to $0.0013 |

Haiku cannot do the extraction: a strict schema may hold 16 nullable fields on Anthropic's models and ours has 31. So
Haiku reads the pages and Luna keeps extraction, the brief and summaries.

**Evaluation with both models,** one run over all five cases, with the pin on every call: critical fact 7 / 0, wrong date
4 / 0, negation 8 / 0, patients mixed up 8 / 0, report missing 8 / 1, request without result 7 / 0, poor scan 17 / 0. The
S04 mammography date and the case 10 sentence are read correctly. OpenRouter did once answer a 200 with no answer.

## Known issues to fix

1. **False "original report missing" alerts.** S02 in the run above: the facts of the original report carry no date, and an
   undated exam is never matched on purpose. It errs towards a warning and moved between cases across runs.
2. **Smaller:** old `azure_*` codes would show raw (production has no such rows on 2026-11-06); 402, 403 and 408 mapping;
   `require_parameters`; no pin check for `openai-compatible` pointed at OpenRouter; a page whose extraction failed still
   appears under "Nečitelné strany".

After a deploy, documents left unread during the outage need reprocessing by hand (`POST /documents/:id/process`).
