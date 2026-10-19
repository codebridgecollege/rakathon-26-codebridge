// The request body a model call sends, built and checked without any Worker binding, so the Worker (services/model.ts)
// and the offline evaluation harness (api/scripts/extract-eval.ts) send exactly the same thing: pseudonymized text,
// labelled by position, and the gate over the whole payload.
import { countKinds, detectIdentifiers, pseudonymize, type CaseIdentity, type Pseudonymized, type TitledNumbers } from "../domain/pseudonymize";
import type { LoadedPrompt } from "../prompts";

export type ModelErrorCode =
  | "model_off"
  | "misconfigured"
  | "identifier_remains"
  | "image_not_redacted"
  | "too_large"
  | "budget_org"
  | "budget_case"
  | "budget_page"
  | "busy"
  | "upstream_error"
  | "refused"
  | "bad_output"
  | "network";

// Errors carry a fixed code and whether a later attempt can succeed; never upstream text or patient data.
export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    readonly retryable: boolean,
    readonly upstream: number | "network" | null = null,
  ) {
    super(code);
    this.name = "ModelError";
  }
}

export type PayloadInput<R> = {
  prompt: LoadedPrompt;
  text: { ref: R; text: string }[];
  // Images already redacted and encoded; the caller vouches for the redaction (model.ts takes only RedactedPage).
  imagesBase64: string[];
  identity: CaseIdentity;
  model: string;
  maxOutputTokens: number;
  reasoningEffort: string | null;
  maxInputChars: number;
  purpose: string;
};

/**
 * The text parts of one call, pseudonymized as that call sends them: one numbering of titled names for the whole call,
 * so [LEKAR_1] is the same person in every part. Deterministic, so a later Workflow step can rebuild the mapping
 * instead of storing it (the mapping holds the names and is never stored).
 */
export function pseudonymizeParts(texts: string[], identity: CaseIdentity): Pseudonymized[] {
  const titled: TitledNumbers = new Map();
  return texts.map((t) => pseudonymize(t, identity, titled));
}

export function buildPayload<R>(o: PayloadInput<R>): { body: Record<string, unknown>; parts: { ref: R; p: Pseudonymized }[]; chars: number } {
  const pseudo = pseudonymizeParts(o.text.map((t) => t.text), o.identity);
  const parts = o.text.map((t, i) => ({ ref: t.ref, p: pseudo[i]! }));
  // Parts are labelled by position only: a document ID or file name may itself name the patient.
  const content: Record<string, unknown>[] = [
    ...parts.map((x, i) => ({ type: "text", text: `[Část ${i + 1}]\n${x.p.text}` })),
    ...o.imagesBase64.map((b64) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}`, detail: "high" } })),
  ];
  const body: Record<string, unknown> = {
    model: o.model,
    messages: [
      { role: "system", content: o.prompt.text },
      { role: "user", content },
    ],
    max_completion_tokens: o.maxOutputTokens,
  };
  if (o.reasoningEffort) body.reasoning_effort = o.reasoningEffort;
  if (o.prompt.schema) body.response_format = { type: "json_schema", json_schema: { name: o.prompt.schema.name, strict: true, schema: o.prompt.schema.schema } };

  // The gate: every string that leaves, checked with the same rules that replaced the identifiers.
  const outgoing = [o.prompt.text, ...content.filter((c) => c.type === "text").map((c) => c.text as string), o.prompt.schema ? JSON.stringify(o.prompt.schema) : ""];
  const left = outgoing.flatMap((s) => detectIdentifiers(s, o.identity));
  if (left.length) {
    console.log(JSON.stringify({ route: "model", purpose: o.purpose, refused: "identifier_remains", kinds: countKinds(left) }));
    throw new ModelError("identifier_remains", false);
  }
  const chars = outgoing.reduce((s, x) => s + x.length, 0);
  if (chars > o.maxInputChars) throw new ModelError("too_large", false);
  return { body, parts, chars };
}
