// Case rules: the alerts computed across all facts of one case run (EXTRACTION-FORMAT.md, "Alerts"; issue #21).
//
// The per-document extraction sees one document at a time, so what needs the whole case lives here: an exam that is
// only cited with no original report, a request with no result, two values of the same kind for the same time that
// disagree, dates that cannot be in this order, and which facts a newer one of the same kind replaces. The merge step
// that publishes a case run (stream B) calls applyCaseRules after prepareRun, so every fact has its final ID and every
// alert ID follows from its rule and subject (keys.ts alertId); an acknowledgement then carries over to the next run.
//
// Everything here is pure and deterministic: the same facts give the same alerts in the same order. Every alert is the
// assistant's observation, lists the facts it rests on, and never blocks anything (CLAUDE.md: alerts inform). Quarantined
// facts take no part: they rest on a page that shows another patient and only the identity alert may name them.
import { alertId, dateSeg, fnv1a32, normText, pairSubject, valueText } from "./keys";
import type { Alert, AlertKind, Check, CheckPage, ExtractionRun, Fact, FactDate, FactKind, Source } from "./types";

/** The engine name the run's "rules" stage records; bump the number when a rule changes what it raises. */
export const RULES_ENGINE = "codebridge case-rules@1";

/** The rules this module owns. applyCaseRules replaces their alerts and leaves every other alert of the run alone. */
export const CASE_RULES = [
  "original_report_missing",
  "original_reports_missing",
  "request_without_result",
  "lab_value_differs",
  "stage_differs",
  "dosing_differs",
  "performance_status_differs",
  "metastasis_status_differs",
  "histology_grade_differs",
  "response_assessment_differs",
  "therapy_stop_before_start",
  "date_after_processing",
  "result_before_request",
] as const;
export type CaseRule = (typeof CASE_RULES)[number];

/** The checks this module writes, by what they look for; applyCaseRules replaces checks of these kinds. */
export const CASE_RULE_CHECKS = ["original_report", "contradiction", "chronology"] as const;

export interface CaseRuleOptions {
  /**
   * More cited reports missing their original than this become one grouped alert instead of one per report, so the
   * doctor is not buried in warnings (issue #49 proposal, pending expert review). Crossing the threshold changes the
   * alert's identity, so an acknowledgement of the grouped alert does not carry over to per-exam alerts or back; the
   * set of missing reports has changed then, so the doctor sees it again. Default 3.
   */
  groupMissingReportsAbove?: number;
}

/** What the rules read from a run. */
export type RuleInput = Pick<ExtractionRun, "facts" | "sources" | "documents" | "checks"> & { run: Pick<ExtractionRun["run"], "created_at"> };

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

/** Lower case without diacritics, for comparing words of different documents ("mozku" and "Mozku", "CT" and "ct"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Significant words as 5-letter stems, so Czech inflection ("mozek", "mozku") still meets. */
function stems(s: string | null | undefined): Set<string> {
  return new Set(
    fold(s ?? "")
      .split(/[^\p{L}\d]+/u)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
}

const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

/** Two texts name the same thing when either is empty (not stated, so not different) or they share a word stem. */
function compatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = stems(a);
  const sb = stems(b);
  return !sa.size || !sb.size || overlaps(sa, sb);
}

/** The first word of an imaging modality ("CT s kontrastní látkou" -> "ct"), or "" when none is written. */
const modalityWord = (m: string | null | undefined) => fold(m ?? "").split(/[^\p{L}\d]+/u).find(Boolean) ?? "";

/**
 * How two dates relate: "same" (equal at the same precision), "within" (one is a partial date that contains the other,
 * "11/2025" and "10.11.2025"), "apart", or null when either is undated. Only the sort form is compared, so a partial
 * date never gains a day.
 */
function dateRelation(a: FactDate, b: FactDate): "same" | "within" | "apart" | null {
  if (!a.sort || !b.sort) return null;
  const sa = dateSeg(a);
  const sb = dateSeg(b);
  if (sa === sb) return "same";
  return sa.startsWith(sb) || sb.startsWith(sa) ? "within" : "apart";
}

/** -1, 0 or 1 comparing two sort forms at the coarser of their precisions; 0 also when they cannot be told apart. */
function compareSort(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A written date as a sort form ("27.1.2026" -> "2026-01-27", "8/2026" -> "2026-08", "2026" -> "2026"), or null when
 * the text holds no date. For the start and stop of a therapy line, which the format keeps as written.
 */
export function writtenSort(text: string | null | undefined): string | null {
  if (!text) return null;
  const pad = (n: string) => n.padStart(2, "0");
  const dmy = /(?<!\d)(\d{1,2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{4})(?!\d)/.exec(text);
  if (dmy) return `${dmy[3]}-${pad(dmy[2]!)}-${pad(dmy[1]!)}`;
  const my = /(?<![\d/.])(\d{1,2})\/(\d{4})(?!\d)/.exec(text);
  if (my && Number(my[1]) >= 1 && Number(my[1]) <= 12) return `${my[2]}-${pad(my[1]!)}`;
  const y = /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(text);
  return y ? y[1]! : null;
}

function alert(rule: CaseRule, subject: string, kind: AlertKind, facts: string[], message: Alert["message"]): Alert {
  return { id: alertId({ rule, subject }), rule, subject, kind, facts, message, note: null };
}

function pairAlert(rule: CaseRule, kind: AlertKind, a: Fact, b: Fact): Alert {
  const [x, y] = [a.id, b.id].sort();
  return alert(rule, pairSubject(a.id, b.id), kind, [x!, y!], { id: messageId(rule), args: { fact_a: x!, fact_b: y! } });
}

/** The Fluent message of a rule: "alert-" and the rule with hyphens (i18n/<locale>/alerts.ftl). */
export const messageId = (rule: string) => `alert-${rule.replace(/_/g, "-")}`;

/** Facts a rule may look at: not quarantined (CLAUDE.md: patients are never merged silently). */
const usable = (facts: readonly Fact[]) => facts.filter((f) => !f.quarantined);

// ---------------------------------------------------------------------------------------------------------------------
// Missing original reports

/**
 * The kinds whose record is a report of its own: a radiology report, a histology report, an operation protocol, an
 * MDT or committee protocol, a radiotherapy report. A systemic therapy is documented across oncology visits, not in one
 * report, so citing it is not a missing document.
 */
const EXAM_KINDS: ReadonlySet<FactKind> = new Set(["imaging", "histology", "procedure", "decision", "radiotherapy"]);

/** Whether a source is the report itself: a page of the report, or the NIS record of it. */
const isOriginal = (s: Source | undefined) => !!s && (s.type === "nis" || s.reported_as === "original");

/** An exam that happened (not a plan, a request or a recorded "not done"). */
const performed = (f: Fact) => EXAM_KINDS.has(f.kind) && !f.negated && f.status !== "planned" && f.status !== "requested";

/** The words that tell two reports of one kind apart: modality and region, the specimen, the procedure's name, the body. */
function examWords(f: Fact): { modality: string; what: string | null } {
  switch (f.kind) {
    case "imaging":
      return { modality: modalityWord(f.value.modality), what: f.value.region };
    case "histology":
      return { modality: "", what: f.value.specimen };
    case "procedure":
      return { modality: "", what: `${f.value.name} ${f.value.region ?? ""}` };
    case "decision":
      return { modality: f.value.body, what: null };
    case "radiotherapy":
      return { modality: "", what: f.value.target };
    default:
      return { modality: "", what: null };
  }
}

/**
 * Whether two facts may be the same exam: same kind, dates that meet (one may be the partial form of the other), and
 * modality and region that do not differ. An undated exam is never matched, because a wrong match would hide a missing
 * report, while a missed match only raises an alert the doctor can dismiss.
 */
function sameExam(a: Fact, b: Fact): boolean {
  if (a.kind !== b.kind) return false;
  const rel = dateRelation(a.date, b.date);
  if (rel !== "same" && rel !== "within") return false;
  const wa = examWords(a);
  const wb = examWords(b);
  if (wa.modality && wb.modality && wa.modality !== wb.modality) return false;
  return compatible(wa.what, wb.what);
}

/**
 * The exams the documents only cite ("MR mozku 14.9.2026 (popis z NIS)") with no original report anywhere in the case:
 * the failure case "an exam happened but its report is missing". Returns the cited exams in date order, each with
 * whether an original was found, so the caller can write one check per exam.
 */
export function citedExams(facts: readonly Fact[], sources: readonly Source[]): { fact: Fact; original: Fact | null }[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const own = usable(facts);
  const hasOriginal = (f: Fact) => f.sources.some((id) => isOriginal(byId.get(id)));
  const out: { fact: Fact; original: Fact | null }[] = [];
  for (const f of own) {
    if (!performed(f) || f.origin === "assistant" || !f.sources.length || hasOriginal(f)) continue;
    const original = own.find((g) => g !== f && performed(g) && hasOriginal(g) && sameExam(f, g)) ?? null;
    out.push({ fact: f, original });
  }
  return out.sort((a, b) => (a.fact.date.sort ?? "￿").localeCompare(b.fact.date.sort ?? "￿") || a.fact.id.localeCompare(b.fact.id));
}

/** One expected report: the cited facts it would hold, whether an original was found, and the alert's subject. */
export interface CitedReport {
  /** "report|<kind>|<modality>|<date>" for a dated report, so the alert follows the report, not one of its facts. */
  subject: string;
  facts: Fact[];
  original: Fact | null;
}

/**
 * Whether two cited facts come from one report: the same date, and the same exam (one histology report gives the
 * tumour type, the grade and each receptor as separate facts), or one exam told as two kinds ("koloskopie" as imaging
 * and as a procedure). Undated facts are never joined.
 */
function sameReport(a: Fact, b: Fact): boolean {
  if (!a.date.sort || !b.date.sort || dateSeg(a.date) !== dateSeg(b.date)) return false;
  if (a.kind === b.kind) return sameExam(a, b);
  const words = (f: Fact) => stems(`${examWords(f).modality} ${examWords(f).what ?? ""}`);
  return overlaps(words(a), words(b));
}

/**
 * The cited exams joined into the reports they come from, in date order. A report counts as found when any of its
 * facts has an original. The subject names the report by kind, modality and date; two reports that would share one
 * (two biopsies of one day) are told apart by their first fact.
 */
export function citedReports(facts: readonly Fact[], sources: readonly Source[]): CitedReport[] {
  const clusters: { facts: Fact[]; original: Fact | null }[] = [];
  for (const c of citedExams(facts, sources)) {
    const home = clusters.find((k) => k.facts.some((g) => sameReport(c.fact, g)));
    if (home) {
      home.facts.push(c.fact);
      home.original ??= c.original;
    } else clusters.push({ facts: [c.fact], original: c.original });
  }
  const used = new Set<string>();
  return clusters.map((k) => {
    const f = k.facts[0]!;
    let subject = f.date.sort ? `report|${f.kind}|${examWords(f).modality}|${dateSeg(f.date)}` : f.id;
    if (used.has(subject)) subject = `${subject}|${f.id}`;
    used.add(subject);
    return { subject, facts: k.facts, original: k.original };
  });
}

function missingReports(input: RuleInput, options: CaseRuleOptions, covered: Check["covered"], unreadable: CheckPage[]): { alerts: Alert[]; checks: Check[] } {
  const reports = citedReports(input.facts, input.sources);
  const checks: Check[] = reports.map((r) => ({
    id: `chk-report-${fnv1a32(r.subject)}`,
    looks_for: "original_report",
    expected: { of_fact: r.facts[0]!.id },
    covered,
    unreadable,
    result: r.original ? "found" : "nothing_found",
  }));
  const missing = reports.filter((r) => !r.original);
  const above = options.groupMissingReportsAbove ?? 3;
  const ids = (r: CitedReport) => r.facts.map((f) => f.id);
  const alerts =
    missing.length > above
      ? [alert("original_reports_missing", "cited_exams", "missing", missing.flatMap(ids), { id: messageId("original_reports_missing"), args: { count: missing.length } })]
      : missing.map((r) => alert("original_report_missing", r.subject, "missing", ids(r), { id: messageId("original_report_missing"), args: { fact: r.facts[0]!.id } }));
  return { alerts, checks };
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests without a result

// What was requested: the kind of exam (modality or body) and the other words (the region). Generic words
// ("doplnit výsledek", "projednání") say nothing about what.
const GENERIC = new Set(["na", "pro", "za", "ve", "do", "a", "s", "k", "z", "doplnit", "vysledek", "vysledku", "projednani", "vysetreni", "zadost", "pozadavek", "zadanka", "odeslan", "odeslana", "pripadu", "nalezu", "kontrolni", "kontrola"]);
const MODALITIES = ["ct", "mr", "mri", "pet", "rtg", "usg", "uz", "scint", "kolonosk", "gastrosk", "bronchosk", "endosk", "mamogr", "spirom", "ekg", "echo", "histolog", "biops", "seminar", "konzil", "genetick"];
const words = (s: string) => fold(s).split(/[^\p{L}\d]+/u).filter((w) => w.length >= 2 && !GENERIC.has(w));
const modalityOf = (t: string) => MODALITIES.find((m) => t === m || (m.length > 3 && t.startsWith(m)));

function asked(text: string) {
  const ts = words(text);
  const modalities = new Set(ts.map(modalityOf).filter((m): m is string => !!m));
  const region = new Set(ts.filter((t) => !modalityOf(t) && t.length >= 4).map((t) => t.slice(0, 5)));
  return { modalities, region };
}

// A result answers a request when it is the same kind of exam and, if the request names a region, shares it: "CT
// mozku" is not answered by "CT hrudníku". A request that names neither is never linked.
function answers(req: ReturnType<typeof asked>, result: string): boolean {
  const r = asked(result);
  if (!req.modalities.size) return false;
  if (![...req.modalities].some((m) => r.modalities.has(m))) return false;
  return !req.region.size || [...req.region].some((w) => r.region.has(w));
}

/** The words a result fact states, for matching it to a request; a histology fact names its kind, as a request does. */
const resultText = (f: Fact) => `${f.kind === "histology" ? "histologie " : ""}${valueText(f.value)}`;

/**
 * Requests with no result in the case (CLAUDE.md failure case: "a referral with no result"; a sent request is not a
 * done exam). A request counts as answered when its fact names a result (`result_fact`), or a later done exam of the
 * same kind and region exists anywhere in the case, so a request in one document and its result in another meet here.
 * Doubtful pairs stay unlinked, so the alert errs toward "the result is missing", which a doctor can dismiss; a wrong
 * link would hide a gap. A decision answers only a consultation, never an exam. The referral to the MDT itself is what
 * the case is being prepared for, so it raises nothing.
 */
export function requestsWithoutResult(facts: readonly Fact[]): Alert[] {
  const own = usable(facts);
  const out: { alert: Alert; date: string | null; what: ReturnType<typeof asked> }[] = [];
  for (const r of own) {
    if (r.kind !== "request" || r.status !== "requested" || r.value.result_fact) continue;
    if (r.value.request_kind === "mdt") continue;
    const what = asked(r.value.what);
    const since = r.date.sort;
    const resultKinds = r.value.request_kind === "exam" ? ["imaging", "procedure", "histology"] : ["imaging", "procedure", "histology", "decision"];
    const result = own.find((f) => resultKinds.includes(f.kind) && f.status === "done" && !!f.date.sort && !!since && compareSort(f.date.sort, since) >= 0 && answers(what, resultText(f)));
    if (result) continue;
    // The same dated request mentioned twice ("odeslána žádanka na CT" and "doplnit výsledek CT (žádanka 7.10.)") is
    // one alert resting on both facts, not two warnings. Undated requests are never merged.
    const twin = since ? out.find((o) => o.date === since && answers(o.what, r.value.what)) : undefined;
    if (twin) {
      twin.alert.facts.push(r.id);
      continue;
    }
    out.push({ date: since, what, alert: alert("request_without_result", r.id, "missing", [r.id], { id: messageId("request_without_result"), args: { fact: r.id } }) });
  }
  return out.map((o) => o.alert);
}

// ---------------------------------------------------------------------------------------------------------------------
// Contradictions: like with like

/**
 * One comparison: which facts are alike (`slot`: same kind of value about the same thing, null when the fact cannot be
 * placed, for example an undated stage), and when two alike facts disagree. A clinical and a pathological stage are
 * different slots, so they are never compared (CLAUDE.md: compare like with like over time).
 */
interface Comparison {
  rule: CaseRule;
  kind: FactKind;
  slot: (f: Fact) => string | null;
  differs: (a: Fact, b: Fact) => boolean;
  /** Undated pairs in one slot are alike but not provably of the same time: they raise "unclear", not "contradiction". */
  undated?: boolean;
}

const compact = (s: string | null | undefined) => (s == null ? null : fold(s).replace(/\s+/g, ""));
const both = <T>(a: T | null | undefined, b: T | null | undefined): a is T => a != null && b != null;
/** A dated slot: the date at its own precision, or null for an undated fact (it cannot be placed in time). */
const when = (f: Fact) => (f.date.sort ? dateSeg(f.date) : null);
const HAS_TIME = /\d{1,2}:\d{2}/;

/**
 * The categories of a normalised TNM, T, N and M with their values, the prefix (c, p, yp, r) dropped because the slot
 * already holds the stage kind: "pT2a pN1 M0" gives T 2a, N 1, M 0. Other tokens (G2, L0) count under their letter.
 */
function tnmCategories(tnm: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const token of tnm.split(/\s+/)) {
    const m = /^(?:y?[cpra]|y)?([TNMGLVR])(.+)$/.exec(token);
    if (m) out.set(m[1]!, m[2]!.toLowerCase());
    else if (token) out.set(token.toLowerCase(), "");
  }
  return out;
}

const COMPARISONS: Comparison[] = [
  {
    // Same analyte and the same draw: a draw written with its time, or the same requisition. Two values of one day
    // without a time may be two draws, so they are not compared. Different units are not compared either: the values
    // would need a conversion, which is a clinical judgement the rule does not make.
    rule: "lab_value_differs",
    kind: "lab_result",
    slot: (f) => {
      if (f.kind !== "lab_result") return null;
      const v = f.value;
      const code = f.codes.find((c) => c.assigned_by === "source")?.code ?? normText(v.name_as_written);
      const draw = v.draw.as_written && HAS_TIME.test(v.draw.as_written) ? normText(v.draw.as_written) : f.date.precision === "minute" ? f.date.sort : null;
      const req = v.draw.requisition ? `req:${normText(v.draw.requisition)}` : null;
      if (!draw && !req) return null;
      return [code, draw ?? "", req ?? "", compact(v.unit ?? v.unit_as_written) ?? ""].join("|");
    },
    differs: (a, b) => {
      if (a.kind !== "lab_result" || b.kind !== "lab_result") return false;
      if (both(a.value.value_numeric, b.value.value_numeric)) return a.value.value_numeric !== b.value.value_numeric;
      return compact(a.value.value_as_written) !== compact(b.value.value_as_written);
    },
  },
  {
    rule: "stage_differs",
    kind: "stage",
    slot: (f) => (f.kind === "stage" && when(f) ? `${f.value.stage_kind}|${when(f)}` : null),
    // Only normalised TNM is compared ("MO" against "M0" in the written form is a misreading, not a disagreement), and
    // only the categories both state: "cT3b cN1" and "cT3b cN1 M0" say the same, one of them leaves M out.
    differs: (a, b) => {
      if (a.kind !== "stage" || b.kind !== "stage" || !a.value.tnm || !b.value.tnm) return false;
      const pa = tnmCategories(a.value.tnm);
      const pb = tnmCategories(b.value.tnm);
      return [...pa].some(([cat, v]) => pb.has(cat) && pb.get(cat) !== v);
    },
  },
  {
    // A drug's dosing or strength stated twice for the same start. A planned change has its own start date, so "5 mg"
    // now and "10 mg od 19.9.2026" are different slots; a stopped medication is history, not a current statement.
    rule: "dosing_differs",
    kind: "medication",
    slot: (f) => (f.kind === "medication" && (f.status === "documented" || f.status === "done") ? `${normText(f.value.drug)}|${when(f) ?? "undated"}` : null),
    differs: (a, b) =>
      a.kind === "medication" &&
      b.kind === "medication" &&
      ((both(a.value.dosing, b.value.dosing) && compact(a.value.dosing) !== compact(b.value.dosing)) ||
        (both(a.value.strength, b.value.strength) && compact(a.value.strength) !== compact(b.value.strength))),
    undated: true,
  },
  {
    rule: "performance_status_differs",
    kind: "performance_status",
    slot: (f) => (f.kind === "performance_status" && when(f) ? `${normText(f.value.scale)}|${when(f)}` : null),
    differs: (a, b) => a.kind === "performance_status" && b.kind === "performance_status" && compact(a.value.value_as_written) !== compact(b.value.value_as_written),
  },
  {
    // "Metastasis in the liver" and "no metastasis in the liver" on the same date: one of them is misread or wrong
    // (CLAUDE.md failure case: a negation read as positive). Suspected against confirmed is a change of certainty, not a
    // disagreement.
    rule: "metastasis_status_differs",
    kind: "metastasis",
    slot: (f) => (f.kind === "metastasis" && when(f) ? `${normText(f.value.site)}|${when(f)}` : null),
    differs: (a, b) => a.kind === "metastasis" && b.kind === "metastasis" && (a.value.status === "excluded") !== (b.value.status === "excluded"),
  },
  {
    // Only the grade: the tumour type is worded too freely across reports to compare as text.
    rule: "histology_grade_differs",
    kind: "histology",
    slot: (f) => (f.kind === "histology" && when(f) ? `${normText(f.value.specimen)}|${when(f)}` : null),
    differs: (a, b) => a.kind === "histology" && b.kind === "histology" && both(a.value.grade, b.value.grade) && compact(a.value.grade) !== compact(b.value.grade),
  },
];

/** Every pair of alike facts that disagree, one alert per pair. */
function contradictions(facts: readonly Fact[]): Alert[] {
  const own = usable(facts).filter((f) => f.certainty !== "unreadable");
  const out: Alert[] = [];
  for (const c of COMPARISONS) {
    const slots = new Map<string, Fact[]>();
    for (const f of own) {
      if (f.kind !== c.kind) continue;
      const s = c.slot(f);
      if (s === null) continue;
      slots.set(s, [...(slots.get(s) ?? []), f]);
    }
    for (const group of slots.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (!c.differs(a, b)) continue;
          const dated = !!a.date.sort && !!b.date.sort;
          out.push(pairAlert(c.rule, dated || !c.undated ? "contradiction" : "unclear", a, b));
        }
      }
    }
  }
  out.push(...responseAssessments(own));
  return out;
}

/**
 * Two response assessments of what may be one exam (same modality and region, or not stated) that disagree: "PD" and
 * "iUPD" for CT 11/2025. When both give the same day and the same response system, it is a contradiction. When one date
 * is partial ("11/2025" against "10.11.2025") or the systems differ (RECIST against iRECIST), it is not provably like
 * with like, so it is raised as unclear: the doctor sees both, the assistant does not call it a contradiction.
 */
function responseAssessments(facts: readonly Fact[]): Alert[] {
  const imaging = facts.filter((f): f is Extract<Fact, { kind: "imaging" }> => f.kind === "imaging" && !!f.value.response && !f.negated);
  const out: Alert[] = [];
  for (let i = 0; i < imaging.length; i++) {
    for (let j = i + 1; j < imaging.length; j++) {
      const a = imaging[i]!;
      const b = imaging[j]!;
      const rel = dateRelation(a.date, b.date);
      if (rel !== "same" && rel !== "within") continue;
      const ma = modalityWord(a.value.modality);
      const mb = modalityWord(b.value.modality);
      if (ma && mb && ma !== mb) continue;
      if (!compatible(a.value.region, b.value.region)) continue;
      const ra = a.value.response!;
      const rb = b.value.response!;
      if (compact(ra.category) === compact(rb.category)) continue;
      const like = rel === "same" && compact(ra.system) === compact(rb.system);
      out.push(pairAlert("response_assessment_differs", like ? "contradiction" : "unclear", a, b));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chronology

/** Kinds that record something that happened, so their date cannot lie after the run was made. */
const EVENT_KINDS: ReadonlySet<FactKind> = new Set(["imaging", "histology", "procedure", "systemic_therapy", "radiotherapy", "lab_result", "decision", "visit"]);

/**
 * Dates that cannot be in this order (CLAUDE.md failure case: a wrong or outdated date): a therapy stopped before it
 * started, an exam done after the run was made (a misread year, "2062" for "2026"), a result older than its request.
 * Dates are compared at the coarser of their precisions, so "8/2026" is never before "27.8.2026".
 */
function chronology(facts: readonly Fact[], createdAt: string): Alert[] {
  const own = usable(facts);
  const byId = new Map(own.map((f) => [f.id, f]));
  const today = createdAt.slice(0, 10);
  const out: Alert[] = [];
  for (const f of own) {
    if (f.kind === "systemic_therapy") {
      const start = writtenSort(f.value.start) ?? f.date.sort;
      const stop = writtenSort(f.value.stop);
      if (start && stop && compareSort(stop, start) < 0) {
        out.push(alert("therapy_stop_before_start", f.id, "chronology", [f.id], { id: messageId("therapy_stop_before_start"), args: { fact: f.id } }));
      }
    }
    // Planned and requested facts may lie ahead; "documented" may be a plan in prose, so only performed events count.
    const happened = f.status === "done" || f.status === "stopped" || f.status === "interrupted" || (f.status === "documented" && (f.kind === "imaging" || f.kind === "histology" || f.kind === "lab_result"));
    if (EVENT_KINDS.has(f.kind) && happened && f.date.sort && compareSort(f.date.sort, today) > 0) {
      out.push(alert("date_after_processing", f.id, "chronology", [f.id], { id: messageId("date_after_processing"), args: { fact: f.id } }));
    }
    if (f.kind === "request" && f.value.result_fact && f.date.sort) {
      const result = byId.get(f.value.result_fact);
      if (result?.date.sort && compareSort(result.date.sort, f.date.sort) < 0) {
        out.push(alert("result_before_request", pairSubject(f.id, result.id), "chronology", [f.id, result.id], { id: messageId("result_before_request"), args: { fact_a: result.id, fact_b: f.id } }));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Superseded values

/**
 * What identifies "the same value over time" per kind: the performance status on one scale, the status of a metastasis
 * at one site, the stage of one kind, a diagnosis by code, a vital sign by what was measured. A newer fact in the same
 * slot replaces the older one in a view of the current state; the older stays as history (timeline, source viewer).
 * Facts without a date cannot be ordered and are never superseded or superseding.
 */
function supersessionSlot(f: Fact): string | null {
  switch (f.kind) {
    case "performance_status":
      return `ps|${normText(f.value.scale)}`;
    case "metastasis":
      return `met|${normText(f.value.site)}`;
    case "stage":
      // A clinical stage replaces an earlier clinical stage, never a pathological one (CLAUDE.md: the stage at
      // diagnosis is not the current stage, and the kinds stay apart).
      return `stage|${f.value.stage_kind}`;
    case "diagnosis": {
      const code = f.codes.find((c) => c.assigned_by === "source")?.code;
      return `dx|${code ?? normText(f.value.text)}`;
    }
    case "vital_sign":
      return `vital|${f.value.what === "other" ? normText(f.value.label_as_written) : f.value.what}`;
    default:
      return null;
  }
}

/**
 * For each fact a newer fact replaces, the ID of the newest one in its slot. Only documented statements take part:
 * a plan or a request does not replace a finding. Two facts of the same date (at the coarser precision) do not replace
 * each other; when they disagree, the contradiction rule says so.
 */
export function supersededFacts(facts: readonly Fact[]): Map<string, string> {
  const slots = new Map<string, Fact[]>();
  for (const f of usable(facts)) {
    if (!f.date.sort || f.subject !== "patient" || f.status === "planned" || f.status === "requested") continue;
    const s = supersessionSlot(f);
    if (s) slots.set(s, [...(slots.get(s) ?? []), f]);
  }
  const out = new Map<string, string>();
  for (const group of slots.values()) {
    const newest = group.reduce((x, y) => (compareSort(y.date.sort!, x.date.sort!) > 0 ? y : x));
    for (const f of group) if (compareSort(newest.date.sort!, f.date.sort!) > 0) out.set(f.id, newest.id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry points

/**
 * The case rules over one run's facts: the alerts they raise, in a fixed order (by rule, then subject), and the checks
 * that say what they looked at, so "no contradiction found" and "not checked" stay apart.
 */
export function caseRules(input: RuleInput, options: CaseRuleOptions = {}): { alerts: Alert[]; checks: Check[] } {
  const covered = input.documents.map((d) => ({ document_id: d.document_id, part: null }));
  // An original report or a disagreeing value may sit on a page nobody could read: the checks carry the unreadable
  // pages the extraction recorded, so "nothing found, but page 4 was unreadable" stays visible.
  const seen = new Set<string>();
  const unreadable: CheckPage[] = [];
  for (const c of input.checks) {
    for (const p of c.unreadable) {
      const k = `${p.document_id}|${p.part ?? ""}|${p.page}`;
      if (!seen.has(k)) {
        seen.add(k);
        unreadable.push(p);
      }
    }
  }
  const reports = missingReports(input, options, covered, unreadable);
  const contra = contradictions(input.facts);
  const chrono = chronology(input.facts, input.run.created_at);
  const alerts = [...reports.alerts, ...requestsWithoutResult(input.facts), ...contra, ...chrono];
  const order = new Map<string, number>(CASE_RULES.map((r, i) => [r, i]));
  alerts.sort((a, b) => order.get(a.rule)! - order.get(b.rule)! || a.subject.localeCompare(b.subject));
  const checks: Check[] = [
    ...reports.checks,
    { id: "chk-contradiction", looks_for: "contradiction", expected: null, covered, unreadable, result: contra.length ? "found" : "nothing_found" },
    { id: "chk-chronology", looks_for: "chronology", expected: null, covered, unreadable, result: chrono.length ? "found" : "nothing_found" },
  ];
  return { alerts, checks };
}

/**
 * The run with the case rules applied: their alerts and checks replace any earlier ones of the same rules (a
 * per-document request_without_result, for example), every other alert and check stays, and the run's stages record
 * the rules engine. Call it after prepareRun, on final fact IDs, and before storeRun, which validates the result.
 */
export function applyCaseRules<R extends ExtractionRun>(run: R, options: CaseRuleOptions = {}): R {
  const { alerts, checks } = caseRules(run, options);
  const ownedRules = new Set<string>(CASE_RULES);
  const ownedChecks = new Set<string>(CASE_RULE_CHECKS);
  return {
    ...run,
    run: { ...run.run, stages: [...run.run.stages.filter((s) => s.name !== "rules"), { name: "rules", engine: RULES_ENGINE }] },
    alerts: [...run.alerts.filter((a) => !ownedRules.has(a.rule)), ...alerts],
    checks: [...run.checks.filter((c) => !ownedChecks.has(c.looks_for)), ...checks],
  };
}
