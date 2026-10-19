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
import { backingProblems, negationCues } from "./backing";
import { factWords, INN } from "./compose";
import { supersededFacts } from "./rules";
import { alertId, fnv1a32 } from "./keys";
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

/**
 * The facts the brief may rest on, in date order (undated last). An undated plan, or anything planned without a date,
 * is left out: a plan from an older report ("kontrolní MR za 8-10 týdnů", "RT 60 Gy / 30 frakcí") reads as current
 * although it may have happened since, and nothing in the fact says when it was written (CLAUDE.md failure case: an
 * outdated date). An undated request stays: it is the open question the MDT is often asked to answer.
 */
export function briefFacts(run: Pick<ExtractionRun, "facts">, options: BriefOptions = {}): Fact[] {
  const confirmed = new Set(options.confirmed ?? []);
  const replaced = supersededFacts(run.facts);
  return run.facts
    .filter((f) => !f.quarantined && f.subject === "patient" && BRIEF_KINDS.has(f.kind))
    .filter((f) => f.certainty === "clear" || confirmed.has(f.id))
    .filter((f) => !replaced.has(f.id))
    .filter((f) => !((f.kind === "plan" || f.status === "planned") && !f.date.sort))
    .sort((a, b) => cmp(a.date.sort ?? "￿", b.date.sort ?? "￿") || cmp(a.id, b.id));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The rule of the alert that says what the brief leaves out; the brief step owns it, not the case rules. */
export const BRIEF_WITHHELD_RULE = "brief_unverified_withheld";

/** Findings first in the withheld alert, so the doctor sees a left-out metastasis before a left-out plan. */
const WITHHELD_ORDER: Fact["kind"][] = ["metastasis", "diagnosis", "histology", "stage", "imaging", "systemic_therapy", "procedure", "radiotherapy", "decision", "request"];
const rank = (f: Fact) => {
  const i = WITHHELD_ORDER.indexOf(f.kind);
  return i < 0 ? WITHHELD_ORDER.length : i;
};

/**
 * The alert that says the brief rests on verified facts only and which facts of its kinds it therefore leaves out
 * (marked "verify", "unreadable" or "conflicting", not confirmed by a doctor). Without it a brief that skips an
 * unverified key finding (a brain MR read with an unclear negation) would read as complete: CLAUDE.md's failure case
 * "a critical fact left out of the summary". The facts are the source links, findings first and newest first;
 * confirming them lets the next brief state them. Null when nothing is left out. The subject names the set of facts,
 * so an acknowledgement never covers a fact newly left out.
 */
export function withheldAlert(run: Pick<ExtractionRun, "facts">, offered: readonly Fact[]): Alert | null {
  const used = new Set(offered.map((f) => f.id));
  const replaced = supersededFacts(run.facts);
  const left = run.facts
    .filter((f) => !f.quarantined && f.subject === "patient" && BRIEF_KINDS.has(f.kind) && !used.has(f.id) && !replaced.has(f.id) && f.certainty !== "clear" && f.certainty !== "inferred")
    .sort((a, b) => rank(a) - rank(b) || cmp(b.date.sort ?? "", a.date.sort ?? "") || cmp(a.id, b.id));
  if (!left.length) return null;
  const subject = `brief|${fnv1a32(left.map((f) => f.id).sort().join("|"))}`;
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

/** The rule of the alert that says sentences of the brief were dropped because their facts did not back them. */
export const BRIEF_DROPPED_RULE = "brief_sentences_dropped";

/** The rules of the brief step's alerts; every brief replaces both. */
export const BRIEF_RULES = [BRIEF_WITHHELD_RULE, BRIEF_DROPPED_RULE] as const;

/**
 * The alert that says the brief is shorter than the model wrote it: sentences whose dates, numbers, negations or
 * wording the facts did not back were dropped, so a brief that lost its staging sentence does not read as complete.
 * Its facts are those the dropped sentences named (as far as they were offered), so the doctor can open what the brief
 * leaves unsaid. The subject names that set and the count.
 */
export function droppedAlert(accepted: Pick<AcceptedBrief, "dropped">): Alert | null {
  const lost = accepted.dropped.filter((d) => d.sentence !== "question");
  if (!lost.length) return null;
  const facts = [...new Set(lost.flatMap((d) => d.facts))].sort();
  const subject = `brief_dropped|${fnv1a32(`${lost.length}|${facts.join("|")}`)}`;
  return {
    id: alertId({ rule: BRIEF_DROPPED_RULE, subject }),
    rule: BRIEF_DROPPED_RULE,
    subject,
    kind: "unclear",
    facts,
    message: { id: "alert-brief-sentences-dropped", args: { count: lost.length } },
    note: null,
  };
}

/**
 * The run's alerts with the brief step's alerts replaced by the current ones. Without a brief there is nothing that
 * could read as complete, so both go.
 */
export function withBriefAlerts<R extends Pick<ExtractionRun, "facts" | "alerts">>(run: R, offered: readonly Fact[], accepted: Pick<AcceptedBrief, "brief" | "dropped"> | null): R {
  const kept = run.alerts.filter((x) => !(BRIEF_RULES as readonly string[]).includes(x.rule));
  if (!accepted?.brief) return { ...run, alerts: kept };
  const extra = [withheldAlert(run, offered), droppedAlert(accepted)].filter((a): a is Alert => !!a);
  return { ...run, alerts: [...kept, ...extra] };
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

/** Whether a model answer has the shape the schema asks for; a cached or relayed answer may not. */
export function isBriefAnswer(x: unknown): x is BriefAnswer {
  const a = x as BriefAnswer;
  const refs = (r: unknown) => Array.isArray(r) && r.every((y) => typeof y === "string");
  if (!a || typeof a !== "object" || !Array.isArray(a.sentences)) return false;
  if (!a.sentences.every((s) => s && typeof s.text === "string" && refs(s.facts))) return false;
  if (a.question === null) return true;
  const q = a.question;
  return !!q && typeof q.text === "string" && typeof q.question_kind === "string" && Array.isArray(q.basis) && q.basis.every((b) => b && typeof b.role === "string" && refs(b.facts));
}

/** Why a sentence or the question was dropped; codes only, never the text (the reason may be logged). */
export type DropReason =
  | "empty"
  | "no_facts"
  | "unknown_fact"
  | "placeholder"
  | "date"
  | "number"
  | "negation"
  | "side"
  | "drug"
  | "abbreviation"
  | "gap_wording"
  | "stage_kind"
  | "certainty"
  | "status"
  | "not_a_question"
  | "recommendation"
  | "invalid";

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

/**
 * Abbreviations (three or more capitals: a regimen "FOLFOX", a scale "RANO") must be in the facts too, like drug
 * names; "MDT" is the meeting the brief is for.
 */
function unbackedAbbreviations(text: string, evidence: string): boolean {
  return [...text.matchAll(/(?<![\p{L}])\p{Lu}{3,}(?![\p{L}])/gu)].some((m) => m[0] !== "MDT" && !evidence.includes(m[0]));
}

// The brief never states a gap: missing documents and fields have their own alerts with the fixed wording, and
// "neprovedeno" turns a gap into a claim the documents rarely support (CLAUDE.md).
const GAP_WORDS = /neuveden|neprovedeno|nebylo provedeno|nebyl[aoy]? provedena?|chybí|není k dispozici|nejsou k dispozici|nedohledat|neznám/iu;

// Negating verbs the shared cue list (backing.ts) does not hold: each must be in the facts' own words, by stem.
const NEGATING_VERB = /(?<![\p{L}])ne(prokáz|potvrd|proved|uved|zjist|nalez|ukáz|popis|prokaz)\p{L}*/giu;

const ahead = (f: Fact) => f.status === "planned" || f.status === "requested";
const AHEAD_WORDS = /vyžád|požad|žádank|plánov|objedn|indikov|odeslán|zadáv|k projednání|doplnit|doporuč|kontrol/iu;
const DONE_WORDS = /proveden|prokázal|ukázal|potvrdil|zjistil|popsal|vykázal|výsledek/iu;
const suspected = (f: Fact) => (f.kind === "metastasis" && f.value.status === "suspected") || (f.kind === "diagnosis" && f.value.disease_status === "suspected");

/**
 * What a sentence says about status, certainty and stage kind against the fields of its facts, beyond the shared
 * backing check: a suspicion stays a suspicion, a request or plan never reads as done, a clinical stage never as
 * pathological (and the stage at diagnosis never as the current one).
 */
function frameProblems(text: string, facts: Fact[]): DropReason[] {
  const out: DropReason[] = [];
  const stages = facts.filter((f): f is Extract<Fact, { kind: "stage" }> => f.kind === "stage");
  if (stages.length) {
    const says = (re: RegExp) => re.test(text);
    const kinds = new Set(stages.map((f) => f.value.stage_kind));
    const wrongKind = (says(/klinick/iu) && !kinds.has("clinical")) || (says(/patologick/iu) && !kinds.has("pathological"));
    const nowForThen = says(/současn|aktuáln|nyní/iu) && stages.every((f) => f.value.at_diagnosis === true);
    if (wrongKind || nowForThen) out.push("stage_kind");
  }
  if (facts.some(suspected)) {
    // A sentence over a suspected fact must say "suspektní"/"podezření", and "potvrzen"/"prokázán" only when a
    // confirmed finding is cited beside it (a histology that confirmed another lesion).
    const saysSuspicion = /susp|podezř|možn/iu.test(text);
    const saysConfirmed = /potvrz|prokáz|verifikov/iu.test(text);
    const confirmedBeside = facts.some((f) => !suspected(f) && (f.kind === "histology" || f.kind === "metastasis" || f.kind === "diagnosis"));
    if (!saysSuspicion || (saysConfirmed && !confirmedBeside)) out.push("certainty");
  }
  const aheadFacts = facts.filter(ahead);
  if (aheadFacts.length) {
    const onlyAhead = aheadFacts.length === facts.length;
    if (!AHEAD_WORDS.test(text) || (onlyAhead && DONE_WORDS.test(text))) out.push("status");
  }
  return out;
}

/** The problems of one composed text against the facts it names, in a fixed order; empty when it may be kept. */
function textProblems(text: string, ids: string[], offered: Map<string, Fact>, sources: ReadonlyMap<string, Source>): DropReason[] {
  if (!text.trim()) return ["empty"];
  if (!ids.length) return ["no_facts"];
  if (ids.some((id) => !offered.has(id))) return ["unknown_fact"];
  if (PLACEHOLDER.test(text)) return ["placeholder"];
  const facts = ids.map((id) => offered.get(id)!);
  const ev = evidenceOf(facts, sources);
  const words = [...ev.texts, ...facts.map(factWords)].join("\n");
  const out: DropReason[] = [...backingProblems(text, ev)];
  // A negation word must be one the cited facts themselves say (their values, quotes or labels): the shared check
  // accepts any negation once one cited fact is negated, which would let "histologie adenokarcinom nepotvrdila" rest
  // on a negated node count beside it.
  const own = negationCues(words);
  const fw = fold(words);
  const negationOk = [...negationCues(text)].every((c) => own.has(c)) && [...text.matchAll(NEGATING_VERB)].every((m) => fw.includes(fold(m[0]).slice(0, 7)));
  if (!negationOk && !out.includes("negation")) out.push("negation");
  if (unbackedDrugs(text, words)) out.push("drug");
  if (unbackedAbbreviations(text, words)) out.push("abbreviation");
  if (GAP_WORDS.test(text)) out.push("gap_wording");
  out.push(...frameProblems(text, facts));
  return out;
}

const QUESTION_KINDS = new Set(["document_purpose", "latest_finding"]);
const ROLES = new Set(["purpose", "finding", "other"]);
// A drafted question asks; it never proposes the answer or a treatment ("je indikována reresekce, že?"). Asking what a
// body recommends ("jaký postup doporučuje seminář?") is a question, so "doporuč" alone is not refused.
const RECOMMENDS = /indikován|indikovat|zahájit|navýš|ukonč|vysadit|souhlasí|souhlasit|že\?|nemělo by|mělo by se|je vhodné|je třeba/iu;

export interface AcceptedBrief {
  brief: Brief | null;
  question: QuestionDraft | null;
  /** Per dropped sentence (by its index in the answer) and for the question, the reasons; for the run's log. */
  dropped: { sentence: number | "question"; reasons: DropReason[]; facts: string[] }[];
}

/**
 * Keeps the sentences of a model answer that say only what their facts say, mapped from the short references to fact
 * IDs; drops the rest. A brief with no sentence left is null, so the view shows no brief rather than a partial one
 * dressed as complete. The question is kept only when it passes the same checks against its basis and is a question.
 */
export function acceptBrief(
  answer: unknown,
  run: Pick<ExtractionRun, "sources">,
  offered: readonly Fact[],
  refs: ReadonlyMap<string, string>,
  madeBy: MadeBy,
): AcceptedBrief {
  // An answer of another shape is refused whole: nothing of it can be checked against the facts.
  if (!isBriefAnswer(answer)) return { brief: null, question: null, dropped: [{ sentence: "question", reasons: ["invalid"], facts: [] }] };
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
    if (problems.length) dropped.push({ sentence: i, reasons: problems, facts: facts.filter((id) => byId.has(id)) });
    else sentences.push({ text, facts });
  });
  let question: QuestionDraft | null = null;
  if (answer.question) {
    const basis = answer.question.basis.map((b) => ({ role: b.role, facts: ids(b.facts) })).filter((b) => b.facts.length);
    const all = [...new Set(basis.flatMap((b) => b.facts))];
    const text = answer.question.text.trim();
    // The question's own frame words ("vyžádaný", "susp.") are not required: it asks about the facts, it does not
    // state them. Its dates, numbers, negations, sides, names and gap words are checked as for a sentence.
    const problems = textProblems(text, all, byId, sources).filter((r) => r !== "status" && r !== "certainty");
    if (!text.endsWith("?")) problems.push("not_a_question");
    if (RECOMMENDS.test(text)) problems.push("recommendation");
    if (!QUESTION_KINDS.has(answer.question.question_kind) || basis.some((b) => !ROLES.has(b.role))) problems.push("invalid");
    if (problems.length) dropped.push({ sentence: "question", reasons: problems, facts: all.filter((id) => byId.has(id)) });
    else question = { text, question_kind: answer.question.question_kind, basis };
  }
  return { brief: sentences.length ? { sentences, made_by: madeBy } : null, question, dropped };
}
