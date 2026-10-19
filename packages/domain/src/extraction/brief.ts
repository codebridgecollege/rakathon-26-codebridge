// The brief and the drafted MDT question of a run (EXTRACTION-FORMAT.md, "The brief", "The drafted MDT question";
// issue #21). A language model words them; this module decides what it may see and what of its answer is kept.
//
// - briefFacts picks the facts the model may state: verified ones only (certainty "clear", or confirmed by a doctor),
//   never quarantined, never a relative's, and not a value a newer fact of the same slot replaces.
// - briefPrompt lists them for the model under short references (F1, F2...), so the model never copies fact IDs and
//   the input holds no ID that a pseudonymization gate could mistake for a number.
// - acceptBrief checks every sentence of the answer against the facts it names: each date, number, negation and side
//   must be in them (backing.ts), and each drug name too; a sentence that fails, names no fact or names one it was not
//   given is dropped, never repaired. The drafted question gets the same checks and stays a draft (QuestionDraft) until
//   a doctor confirms it in D1.
//
// Everything here is pure; the Worker step that calls the model is api/src/domain/brief.ts.
import { backingProblems } from "./backing";
import { factWords, INN } from "./compose";
import { supersededFacts } from "./rules";
import { alertId } from "./keys";
import type { Alert, Brief, BriefSentence, ExtractionRun, Fact, MadeBy, QuestionBasis, QuestionDraft, Source } from "./types";
import { evidenceOf } from "./validate";

/** The kinds a brief may state; vital signs, single lab values and the anamnesis stay in their own views. */
const BRIEF_KINDS: ReadonlySet<Fact["kind"]> = new Set([
  "diagnosis",
  "histology",
  "stage",
  "metastasis",
  "procedure",
  "systemic_therapy",
  "radiotherapy",
  "imaging",
  "performance_status",
  "prognostic_score",
  "adverse_event",
  "request",
  "decision",
  "plan",
]);

export interface BriefOptions {
  /** Facts a doctor has confirmed: verified even when the extraction marked them "verify". */
  confirmed?: Iterable<string>;
}

/** The facts the brief may rest on, in date order (undated last). */
export function briefFacts(run: Pick<ExtractionRun, "facts">, options: BriefOptions = {}): Fact[] {
  const confirmed = new Set(options.confirmed ?? []);
  const replaced = supersededFacts(run.facts);
  return run.facts
    .filter((f) => !f.quarantined && f.subject === "patient" && BRIEF_KINDS.has(f.kind))
    .filter((f) => f.certainty === "clear" || confirmed.has(f.id))
    .filter((f) => !replaced.has(f.id))
    .sort((a, b) => cmp(a.date.sort ?? "￿", b.date.sort ?? "￿") || cmp(a.id, b.id));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The rule of the alert that says what the brief leaves out; the brief step owns it, not the case rules. */
export const BRIEF_WITHHELD_RULE = "brief_unverified_withheld";

/**
 * The alert that says the brief rests on verified facts only and which facts of its kinds it therefore leaves out
 * (marked "verify", "unreadable" or "conflicting", not confirmed by a doctor). Without it a brief that skips an
 * unverified key finding (a brain MR read with an unclear negation) would read as complete: CLAUDE.md's failure case
 * "a critical fact left out of the summary". The facts are the source links; confirming them lets the next brief state
 * them. Null when nothing is left out. The subject is fixed, so an acknowledgement carries over while the set changes.
 */
export function withheldAlert(run: Pick<ExtractionRun, "facts">, offered: readonly Fact[]): Alert | null {
  const used = new Set(offered.map((f) => f.id));
  const replaced = supersededFacts(run.facts);
  const left = run.facts
    .filter((f) => !f.quarantined && f.subject === "patient" && BRIEF_KINDS.has(f.kind) && !used.has(f.id) && !replaced.has(f.id) && f.certainty !== "clear" && f.certainty !== "inferred")
    .sort((a, b) => cmp(b.date.sort ?? "", a.date.sort ?? "") || cmp(a.id, b.id));
  if (!left.length) return null;
  const subject = "brief";
  return {
    id: alertId({ rule: BRIEF_WITHHELD_RULE, subject }),
    rule: BRIEF_WITHHELD_RULE,
    subject,
    kind: "unclear",
    facts: left.map((f) => f.id),
    message: { id: "alert-brief-unverified-withheld", args: { count: left.length } },
    note: null,
  };
}

/** The run's alerts with the brief's withheld alert replaced by the current one (or removed when none is left). */
export function withWithheldAlert<R extends Pick<ExtractionRun, "facts" | "alerts">>(run: R, offered: readonly Fact[]): R {
  const a = withheldAlert(run, offered);
  return { ...run, alerts: [...run.alerts.filter((x) => x.rule !== BRIEF_WITHHELD_RULE), ...(a ? [a] : [])] };
}

const STATUS_CS: Partial<Record<Fact["status"], string>> = {
  planned: "plánováno",
  requested: "vyžádáno, výsledek neuveden",
  done: "provedeno",
  stopped: "ukončeno",
  interrupted: "přerušeno",
};

const KIND_CS: Record<string, string> = {
  diagnosis: "diagnóza",
  histology: "histologie",
  stage: "stadium",
  metastasis: "metastáza",
  procedure: "výkon",
  systemic_therapy: "systémová léčba",
  radiotherapy: "radioterapie",
  imaging: "zobrazení",
  performance_status: "výkonnostní stav",
  prognostic_score: "prognostické skóre",
  adverse_event: "nežádoucí účinek",
  request: "požadavek",
  decision: "rozhodnutí",
  plan: "plán",
};

/** A fact as one line of the model's input, under its short reference. */
function inputLine(ref: string, f: Fact): string {
  const parts = [`[${ref}]`, KIND_CS[f.kind] ?? f.kind, f.date.as_written ?? "bez data"];
  const status = STATUS_CS[f.status];
  if (status) parts.push(status);
  if (f.negated) parts.push("ZÁPOR");
  if (f.kind === "stage") parts.push(f.value.stage_kind === "pathological" ? "patologické" : f.value.stage_kind === "clinical" ? "klinické" : "po neoadjuvanci");
  if (f.kind === "diagnosis" && f.value.disease_status) parts.push(`stav: ${f.value.disease_status}`);
  return `${parts.join(" | ")} | ${factWords(f)}`;
}

/**
 * The model's input: the facts under short references, one part per source document (so the model interface's audit
 * records which documents' content was sent), and the map back to fact IDs. The first part opens with whether a
 * question is wanted. A fact goes under the first document it rests on; one resting only on NIS records under "nis".
 */
export function briefPrompt(
  facts: readonly Fact[],
  sources: readonly Source[],
  draftQuestion: boolean,
): { parts: { documentId: string; text: string }[]; refs: Map<string, string> } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const refs = new Map<string, string>();
  const parts = new Map<string, string[]>();
  facts.forEach((f, i) => {
    const ref = `F${i + 1}`;
    refs.set(ref, f.id);
    const doc = f.sources.map((id) => byId.get(id)).find((s) => s?.type === "document");
    const key = doc?.type === "document" ? doc.document_id : "nis";
    parts.set(key, [...(parts.get(key) ?? []), inputLine(ref, f)]);
  });
  const header = `Navrhnout otázku pro MDT: ${draftQuestion ? "ano" : "ne"}\n\nFakta:`;
  const out = [...parts].map(([documentId, lines], i) => ({ documentId, text: `${i === 0 ? `${header}\n` : ""}${lines.join("\n")}` }));
  return { parts: out.length ? out : [{ documentId: "nis", text: header }], refs };
}

/** What the model answers (prompt compose-brief-cs). */
export interface BriefAnswer {
  sentences: { text: string; facts: string[] }[];
  question: { text: string; question_kind: string; basis: { role: QuestionBasis["role"]; facts: string[] }[] } | null;
}

/** Why a sentence or the question was dropped; codes only, never the text (the reason may be logged). */
export type DropReason = "empty" | "no_facts" | "unknown_fact" | "placeholder" | "date" | "number" | "negation" | "side" | "drug" | "not_a_question";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Drug names in a text that its evidence does not hold (compared by a six-letter stem, so declension still meets). */
function unbackedDrugs(text: string, evidence: string): boolean {
  const ev = fold(evidence);
  return fold(text)
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 6 && INN.test(w))
    .some((w) => !ev.includes(w.slice(0, 6)));
}

/** A pseudonymization placeholder ("[PACIENT]", "[LEKAR_1]"): the brief never names a person. */
const PLACEHOLDER = /\[[A-Z][A-Z_0-9]*\]/;

/** The problems of one composed text against the facts it names, in a fixed order; empty when it may be kept. */
function textProblems(text: string, ids: string[], offered: Map<string, Fact>, sources: ReadonlyMap<string, Source>): DropReason[] {
  if (!text.trim()) return ["empty"];
  if (!ids.length) return ["no_facts"];
  if (ids.some((id) => !offered.has(id))) return ["unknown_fact"];
  if (PLACEHOLDER.test(text)) return ["placeholder"];
  const facts = ids.map((id) => offered.get(id)!);
  const ev = evidenceOf(facts, sources);
  const out: DropReason[] = [...backingProblems(text, ev)];
  if (unbackedDrugs(text, ev.texts.join("\n"))) out.push("drug");
  return out;
}

export interface AcceptedBrief {
  brief: Brief | null;
  question: QuestionDraft | null;
  /** Per dropped sentence (by its index in the answer) and for the question, the reasons; for the run's log. */
  dropped: { sentence: number | "question"; reasons: DropReason[] }[];
}

/**
 * Keeps the sentences of a model answer that say only what their facts say, mapped from the short references to fact
 * IDs; drops the rest. A brief with no sentence left is null, so the view shows no brief rather than a partial one
 * dressed as complete. The question is kept only when it passes the same checks against its basis and is a question.
 */
export function acceptBrief(
  answer: BriefAnswer,
  run: Pick<ExtractionRun, "sources">,
  offered: readonly Fact[],
  refs: ReadonlyMap<string, string>,
  madeBy: MadeBy,
): AcceptedBrief {
  const byId = new Map(offered.map((f) => [f.id, f]));
  const sources = new Map(run.sources.map((s) => [s.id, s]));
  // A reference the model invented maps to nothing and makes its sentence fail as an unknown fact.
  const ids = (xs: string[]) => [...new Set(xs.map((x) => refs.get(x.trim().replace(/^\[|\]$/g, "")) ?? `?${x}`))];
  const dropped: AcceptedBrief["dropped"] = [];
  const sentences: BriefSentence[] = [];
  answer.sentences.forEach((s, i) => {
    const facts = ids(s.facts);
    const text = s.text.trim();
    const problems = textProblems(text, facts, byId, sources);
    if (problems.length) dropped.push({ sentence: i, reasons: problems });
    else sentences.push({ text, facts });
  });
  let question: QuestionDraft | null = null;
  if (answer.question) {
    const basis = answer.question.basis.map((b) => ({ role: b.role, facts: ids(b.facts) })).filter((b) => b.facts.length);
    const all = [...new Set(basis.flatMap((b) => b.facts))];
    const text = answer.question.text.trim();
    const problems = textProblems(text, all, byId, sources);
    if (!text.endsWith("?")) problems.push("not_a_question");
    if (problems.length) dropped.push({ sentence: "question", reasons: problems });
    else question = { text, question_kind: answer.question.question_kind, basis };
  }
  return { brief: sentences.length ? { sentences, made_by: madeBy } : null, question, dropped };
}
