// What the fact-extraction model answers (prompt extract-facts-cs, issue #20 phase 2), as a strict JSON Schema and
// the matching TypeScript type. The answer is not the extraction format itself: it is a flat list the server checks
// and turns into codebridge.extraction/2 facts and sources (build.ts). Flat, because strict structured output needs
// every property listed and required; fields that do not apply to a kind are null.
//
// The model never writes IDs, keys, sort dates, anchors or certainty beyond "verify": the server computes them, so a
// model cannot make a fact look more certain than the checks allow.

/** The fact kinds this step looks for. Lab values come from the deterministic lab parser. */
export const EXTRACT_KINDS = [
  "diagnosis",
  "histology",
  "stage",
  "metastasis",
  "imaging",
  "procedure",
  "systemic_therapy",
  "radiotherapy",
  "request",
  "plan",
  "decision",
  "family_history",
  "symptom",
  "performance_status",
  "comorbidity",
  "allergy",
  "risk_factor",
  "exam_finding",
  "medication",
  "contraindication",
] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

export type ModelFact = {
  kind: ExtractKind;
  /** The part number the quote is in ("[Část n]"). */
  part: number;
  /** Verbatim from the part, placeholders included. */
  quote: string;
  subject: "patient" | "relative";
  relation: string | null;
  status: "documented" | "planned" | "requested" | "done" | "stopped" | "interrupted";
  negated: boolean;
  date_as_written: string | null;
  text: string;
  code: string | null;
  disease_status: "suspected" | "confirmed_histology" | "progression" | "stable" | "remission" | "suspected_recurrence" | "recurrence" | null;
  primary: boolean | null;
  tnm_as_written: string | null;
  stage_kind: "clinical" | "pathological" | "post_neoadjuvant" | null;
  at_diagnosis: boolean | null;
  site: string | null;
  metastasis_status: "suspected" | "confirmed" | "excluded" | null;
  modality: string | null;
  region: string | null;
  specimen: string | null;
  tumour_type: string | null;
  grade: string | null;
  line: number | null;
  stop_as_written: string | null;
  reason_stopped: string | null;
  dose: string | null;
  request_kind: "exam" | "consultation" | "mdt" | "other" | null;
  decision_body: "mdt" | "koc" | "consultation" | "other" | null;
  scale: string | null;
  value_as_written: string | null;
  reaction: string | null;
  risk_type: "smoking" | "alcohol" | "social" | "epidemiology" | null;
  pack_years: number | null;
  strength: string | null;
  dosing: string | null;
  change: string | null;
  indication: string | null;
  reported_as: "original" | "cited";
  certainty: "clear" | "verify";
  uncertainty: string | null;
};

export type ModelAnswer = { facts: ModelFact[] };

const str = { type: ["string", "null"] };
const en = (values: readonly string[]) => ({ type: ["string", "null"], enum: [...values, null] });

const FACT_PROPS: Record<keyof ModelFact, Record<string, unknown>> = {
  kind: { type: "string", enum: [...EXTRACT_KINDS] },
  part: { type: "integer" },
  quote: { type: "string" },
  subject: { type: "string", enum: ["patient", "relative"] },
  relation: str,
  status: { type: "string", enum: ["documented", "planned", "requested", "done", "stopped", "interrupted"] },
  negated: { type: "boolean" },
  date_as_written: str,
  text: { type: "string" },
  code: str,
  disease_status: en(["suspected", "confirmed_histology", "progression", "stable", "remission", "suspected_recurrence", "recurrence"]),
  primary: { type: ["boolean", "null"] },
  tnm_as_written: str,
  stage_kind: en(["clinical", "pathological", "post_neoadjuvant"]),
  at_diagnosis: { type: ["boolean", "null"] },
  site: str,
  metastasis_status: en(["suspected", "confirmed", "excluded"]),
  modality: str,
  region: str,
  specimen: str,
  tumour_type: str,
  grade: str,
  line: { type: ["integer", "null"] },
  stop_as_written: str,
  reason_stopped: str,
  dose: str,
  request_kind: en(["exam", "consultation", "mdt", "other"]),
  decision_body: en(["mdt", "koc", "consultation", "other"]),
  scale: str,
  value_as_written: str,
  reaction: str,
  risk_type: en(["smoking", "alcohol", "social", "epidemiology"]),
  pack_years: { type: ["number", "null"] },
  strength: str,
  dosing: str,
  change: str,
  indication: str,
  reported_as: { type: "string", enum: ["original", "cited"] },
  certainty: { type: "string", enum: ["clear", "verify"] },
  uncertainty: str,
};

export const EXTRACT_SCHEMA = {
  name: "facts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
      facts: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: Object.keys(FACT_PROPS), properties: FACT_PROPS },
      },
    },
  },
};
