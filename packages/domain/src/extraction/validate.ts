// The validator every run passes before it is stored (EXTRACTION-FORMAT.md, "Validation and versioning").
//
// Two layers: the JSON Schema generated from types.ts (shapes, enums, required fields, no unknown fields), then the
// rules a schema cannot express: references between facts, sources, checks and alerts; stable keys and alert IDs;
// quarantine. The Python mirror (pipeline/extraction_format/validate.py) applies the same rules with the same codes.
//
// @cfworker/json-schema is used because it validates without generating code at runtime, which Workers forbid.
import { Validator, type OutputUnit } from "@cfworker/json-schema";
import schema from "../../schema/extraction-2.schema.json";
import { alertId, baseKey, buildFactKey } from "./keys";
import { EXTRACTION_SCHEMA, FACT_KINDS, type ExtractionRun, type Fact, type Source } from "./types";

export type IssueCode =
  | "schema"
  | "unknown_kind"
  | "duplicate_fact_id"
  | "duplicate_fact_key"
  | "duplicate_source_id"
  | "duplicate_alert_id"
  | "duplicate_check_id"
  | "fact_without_sources"
  | "unknown_source"
  | "unknown_fact"
  | "unknown_document"
  | "unknown_part"
  | "key_mismatch"
  | "alert_id_mismatch"
  | "interval_not_assistant"
  | "contradiction_mixed_kinds"
  | "quarantine_missing"
  | "quarantine_without_conflict"
  | "quarantine_without_identity_alert"
  | "quarantined_in_use"
  | "sentence_without_facts";

export interface Issue {
  /** JSON pointer into the run, for example "/facts/3/sources/0". */
  path: string;
  code: IssueCode;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
}

type Definitions = Record<string, unknown>;
const DEFS = (schema as { definitions: Definitions }).definitions;

const runValidator = new Validator(schema as object, "7", false);

/** One validator per fact kind, so an invalid fact reports what is wrong with it instead of 25 failed alternatives. */
const factValidators = new Map<string, Validator>();
function factValidator(kind: string): Validator | null {
  const name = `${kind
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("")}Fact`;
  if (!DEFS[name]) return null;
  let v = factValidators.get(name);
  if (!v) {
    // The whole schema with another root, so its $id and definitions resolve the same way as for the run.
    v = new Validator({ ...(schema as object), $ref: `#/definitions/${name}` }, "7", false);
    factValidators.set(name, v);
  }
  return v;
}

const WRAPPER_KEYWORDS = new Set(["$ref", "anyOf", "allOf", "oneOf", "properties", "items", "if", "then", "else"]);

function schemaIssues(errors: OutputUnit[], prefix = ""): Issue[] {
  // The validator reports every enclosing step too ($ref, properties, anyOf), and a property that fails its own schema
  // is reported again by additionalProperties as if it were unknown. The deepest location carries the real problem, so
  // only those are kept, and an additionalProperties echo is kept only when nothing else explains the location.
  const locs = errors.map((e) => e.instanceLocation);
  const deepest = errors.filter((e) => !locs.some((l) => l !== e.instanceLocation && l.startsWith(`${e.instanceLocation}/`)));
  const out = new Map<string, Issue>();
  const echo = (e: OutputUnit) => e.keyword === "false" || e.keyword === "additionalProperties";
  // A $ref or anyOf step at the same location only says "a subschema had errors"; the step inside it says which.
  const wrapper = (e: OutputUnit) => WRAPPER_KEYWORDS.has(e.keyword);
  for (const e of deepest) {
    const path = prefix + e.instanceLocation.replace(/^#/, "");
    const here = deepest.filter((x) => x.instanceLocation === e.instanceLocation);
    if (wrapper(e) && here.some((x) => !wrapper(x))) continue;
    const real = here.some((x) => !echo(x) && !wrapper(x));
    if (echo(e) && real) continue;
    const message = echo(e) ? `unknown field ${path.split("/").pop()}` : e.error;
    if (!out.has(`${path}|${message}`)) out.set(`${path}|${message}`, { path, code: "schema", message });
  }
  return [...out.values()];
}

/** Validates a run. `ok` is false when there is any issue; the run must then not be stored. */
export function validateRun(input: unknown): ValidationResult {
  const issues: Issue[] = [];
  const top = runValidator.validate(input);
  if (!top.valid) {
    // Fact errors are reported per fact below, with the fact's own schema.
    issues.push(...schemaIssues(top.errors).filter((i) => !/^\/facts\/\d+/.test(i.path)));
  }
  if (typeof input !== "object" || input === null) return { ok: false, issues };
  const run = input as Partial<ExtractionRun>;
  if (run.schema !== EXTRACTION_SCHEMA) return { ok: false, issues };

  const facts = Array.isArray(run.facts) ? run.facts : [];
  facts.forEach((f, i) => {
    const kind = (f as { kind?: unknown })?.kind;
    if (typeof kind !== "string" || !(FACT_KINDS as readonly string[]).includes(kind)) {
      issues.push({ path: `/facts/${i}/kind`, code: "unknown_kind", message: `unknown fact kind ${JSON.stringify(kind)}` });
      return;
    }
    const r = factValidator(kind)!.validate(f);
    if (!r.valid) issues.push(...schemaIssues(r.errors, `/facts/${i}`));
  });
  // Reference rules need well-formed arrays; with schema errors present they would only add noise.
  if (issues.length) return { ok: false, issues };
  issues.push(...referenceIssues(run as ExtractionRun));
  return { ok: issues.length === 0, issues };
}

function duplicates<T>(items: readonly T[], idOf: (x: T) => string, path: (i: number) => string, code: IssueCode, what: string): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  items.forEach((x, i) => {
    const id = idOf(x);
    if (seen.has(id)) out.push({ path: path(i), code, message: `duplicate ${what} ${id}` });
    seen.add(id);
  });
  return out;
}

/** The rules a JSON Schema cannot express. Assumes the run passed the schema. */
export function referenceIssues(run: ExtractionRun): Issue[] {
  const issues: Issue[] = [];
  const push = (path: string, code: IssueCode, message: string) => issues.push({ path, code, message });

  issues.push(
    ...duplicates(run.facts, (f) => f.id, (i) => `/facts/${i}/id`, "duplicate_fact_id", "fact ID"),
    ...duplicates(run.facts, (f) => f.key, (i) => `/facts/${i}/key`, "duplicate_fact_key", "fact key"),
    ...duplicates(run.sources, (s) => s.id, (i) => `/sources/${i}/id`, "duplicate_source_id", "source ID"),
    ...duplicates(run.alerts, (a) => a.id, (i) => `/alerts/${i}/id`, "duplicate_alert_id", "alert ID"),
    ...duplicates(run.checks, (c) => c.id, (i) => `/checks/${i}/id`, "duplicate_check_id", "check ID"),
  );

  const docs = new Map(run.documents.map((d) => [d.document_id, new Set(d.parts)]));
  const sources = new Map<string, Source>(run.sources.map((s) => [s.id, s]));
  const facts = new Map<string, Fact>(run.facts.map((f) => [f.id, f]));
  const hasFact = (id: string) => facts.has(id);

  const checkDocPart = (path: string, documentId: string, part: string | null) => {
    const parts = docs.get(documentId);
    if (!parts) push(`${path}/document_id`, "unknown_document", `document ${documentId} is not in the run's documents`);
    else if (part !== null && !parts.has(part)) push(`${path}/part`, "unknown_part", `part ${part} is not a part of ${documentId}`);
  };

  run.sources.forEach((s, i) => {
    if (s.type === "document") checkDocPart(`/sources/${i}`, s.document_id, s.part);
  });

  run.facts.forEach((f, i) => {
    const p = `/facts/${i}`;
    // Only an assistant inference may stand without a passage, and then it must say which facts it rests on.
    if (!f.sources.length && !(f.origin === "assistant" && f.based_on?.length)) {
      push(`${p}/sources`, "fact_without_sources", `fact ${f.id} has no sources (only an assistant fact with based_on may)`);
    }
    f.sources.forEach((s, j) => {
      if (!sources.has(s)) push(`${p}/sources/${j}`, "unknown_source", `unknown source ${s}`);
    });
    f.based_on?.forEach((b, j) => {
      if (!hasFact(b)) push(`${p}/based_on/${j}`, "unknown_fact", `unknown fact ${b}`);
    });
    if (f.kind === "request" && f.value.result_fact && !hasFact(f.value.result_fact)) {
      push(`${p}/value/result_fact`, "unknown_fact", `unknown fact ${f.value.result_fact}`);
    }
    if (f.kind === "interval") {
      if (f.origin !== "assistant") push(`${p}/origin`, "interval_not_assistant", "an interval is always the assistant's computation");
      for (const end of ["from_fact", "to_fact"] as const) {
        if (!hasFact(f.value[end])) push(`${p}/value/${end}`, "unknown_fact", `unknown fact ${f.value[end]}`);
      }
    }
    // A key that does not follow from the fact would let the next run's matcher pick a different ID. Lab keys name
    // the source document, so with a missing source the issue above is the real one and the key is not judged.
    const resolved = f.sources.length > 0 || f.origin === "assistant";
    const want = buildFactKey(f, sources);
    if (resolved && f.sources.every((s) => sources.has(s)) && baseKey(f.key) !== want) {
      push(`${p}/key`, "key_mismatch", `key ${JSON.stringify(f.key)} should be ${JSON.stringify(want)}`);
    }

    const conflicting = f.sources.some((s) => {
      const src = sources.get(s);
      return src?.type === "document" && src.identity === "conflicts";
    });
    if (conflicting && !f.quarantined) {
      push(`${p}/quarantined`, "quarantine_missing", `fact ${f.id} rests on a page that shows another patient and must be quarantined`);
    }
    if (f.quarantined && !conflicting) {
      push(`${p}/quarantined`, "quarantine_without_conflict", `fact ${f.id} is quarantined but none of its sources conflicts on identity`);
    }
  });

  const quarantined = new Set(run.facts.filter((f) => f.quarantined).map((f) => f.id));
  if (quarantined.size && !run.alerts.some((a) => a.kind === "identity")) {
    push("/alerts", "quarantine_without_identity_alert", "quarantined facts need an identity alert that tells the doctor");
  }
  // A quarantined fact stays out of the brief, the question and the rules until a doctor resolves the identity.
  const useOf = (path: string, id: string) => {
    if (quarantined.has(id)) push(path, "quarantined_in_use", `quarantined fact ${id} is used outside the identity alert`);
  };
  run.facts.forEach((f, i) => {
    if (f.quarantined) return;
    f.based_on?.forEach((b, j) => useOf(`/facts/${i}/based_on/${j}`, b));
    if (f.kind === "interval") {
      useOf(`/facts/${i}/value/from_fact`, f.value.from_fact);
      useOf(`/facts/${i}/value/to_fact`, f.value.to_fact);
    }
    if (f.kind === "request" && f.value.result_fact) useOf(`/facts/${i}/value/result_fact`, f.value.result_fact);
  });

  run.alerts.forEach((a, i) => {
    const p = `/alerts/${i}`;
    a.facts.forEach((id, j) => {
      if (!hasFact(id)) push(`${p}/facts/${j}`, "unknown_fact", `unknown fact ${id}`);
      else if (a.kind !== "identity") useOf(`${p}/facts/${j}`, id);
    });
    const want = alertId(a);
    if (a.id !== want) push(`${p}/id`, "alert_id_mismatch", `alert ID ${a.id} should be ${want} (rule and subject)`);
    if (a.kind === "contradiction") {
      const kinds = new Set(a.facts.map((id) => facts.get(id)?.kind).filter(Boolean));
      if (kinds.size > 1) push(`${p}/facts`, "contradiction_mixed_kinds", "a contradiction compares facts of one kind only");
    }
  });

  run.checks.forEach((c, i) => {
    const p = `/checks/${i}`;
    if (c.expected && !hasFact(c.expected.of_fact)) push(`${p}/expected/of_fact`, "unknown_fact", `unknown fact ${c.expected.of_fact}`);
    c.covered.forEach((x, j) => checkDocPart(`${p}/covered/${j}`, x.document_id, x.part));
    c.unreadable.forEach((x, j) => checkDocPart(`${p}/unreadable/${j}`, x.document_id, x.part));
  });

  run.brief?.sentences.forEach((s, i) => {
    // A brief sentence with no facts cannot be checked against them, so the producer must drop it.
    if (!s.facts.length) push(`/brief/sentences/${i}/facts`, "sentence_without_facts", "a brief sentence must point at the facts it states");
    s.facts.forEach((id, j) => {
      const path = `/brief/sentences/${i}/facts/${j}`;
      if (!hasFact(id)) push(path, "unknown_fact", `unknown fact ${id}`);
      else useOf(path, id);
    });
  });
  run.question_draft?.basis.forEach((b, i) => {
    b.facts.forEach((id, j) => {
      const path = `/question_draft/basis/${i}/facts/${j}`;
      if (!hasFact(id)) push(path, "unknown_fact", `unknown fact ${id}`);
      else useOf(path, id);
    });
  });
  return issues;
}
