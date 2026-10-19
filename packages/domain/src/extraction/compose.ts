// Composed views for a run that has none (EXTRACTION-FORMAT.md, "Composed views"; issue #21).
//
// The fixtures carry hand-written summary lines; a new patient's run is shown fact by fact, which splits one event
// into several lines (a therapy, its stop and its toxicity; a surgery and its histology). composeViews groups the facts
// that belong to one event into one line, deterministically, in words taken from the facts themselves, so every date,
// number, negation and side of a line is backed by its facts and passes the validator's backing check (backing.ts).
// It adds only joining words ("od", "do", "histologie:") and the fixed gap wording, never a clinical statement.
//
// The merge step calls it after applyCaseRules: composeViews(run) returns the views, and the run with them goes to
// storeRun, which validates every line.
import { negationCues } from "./backing";
import { supersededFacts } from "./rules";
import type { ComposedViews, ExtractionRun, Fact, FactStatus, ViewCategory, ViewLine } from "./types";
import { dateSeg, viewLineId } from "./keys";

/** The producer name the views record; bump it when the grouping or the wording changes. */
export const COMPOSER = "codebridge compose@1";

/** CLAUDE.md fixed wording for a gap, in the content language of the runs (Czech). */
const GAP = "neuvedeno v dostupné dokumentaci";

type Of<K extends Fact["kind"]> = Extract<Fact, { kind: K }>;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const stems = (s: string | null | undefined) =>
  new Set(
    fold(s ?? "")
      .split(/[^\p{L}\d]+/u)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));
const str = (x: string | null | undefined) => (x && x.trim() ? x.trim() : null);
const joinNonEmpty = (sep: string, ...xs: (string | null | undefined)[]) => xs.map(str).filter(Boolean).join(sep);
const byDate = (a: Fact, b: Fact) => (a.date.sort ?? "￿").localeCompare(b.date.sort ?? "￿") || a.id.localeCompare(b.id);
const sameDay = (a: Fact, b: Fact) => !!a.date.sort && !!b.date.sort && dateSeg(a.date) === dateSeg(b.date);

/**
 * A fact in its own words. A recorded negative whose words hold no negation gets "(negativní nález)", the view's own
 * label, so "plicní embolie" recorded as absent never reads as present inside a composed line.
 */
function words(f: Fact): string {
  const text = ownWords(f);
  return f.negated && negationCues(text).size === 0 ? `${text} (negativní nález)` : text;
}

function ownWords(f: Fact): string {
  switch (f.kind) {
    case "imaging": {
      const head = joinNonEmpty(" ", f.value.modality, f.value.region);
      const resp = f.value.response ? `, ${joinNonEmpty(" ", f.value.response.system, f.value.response.category)}` : "";
      return `${head ? `${head}: ` : ""}${f.value.finding_text}${resp}`;
    }
    case "procedure":
      return str(f.value.text) ?? f.value.name;
    case "histology":
      return joinNonEmpty(", ", f.value.result_text, f.value.grade && !f.value.result_text.includes(f.value.grade) ? f.value.grade : null);
    case "metastasis":
      return str(f.value.text) ?? f.value.site;
    case "systemic_therapy":
      return f.value.regimen;
    case "radiotherapy":
      return joinNonEmpty(", ", f.value.target, f.value.dose, f.value.fractions);
    case "decision":
      return joinNonEmpty(": ", f.value.body_as_written, f.value.text);
    case "plan":
      return joinNonEmpty(", ", f.value.what, f.value.when_as_written);
    case "request":
      return f.value.what;
    case "visit":
      return joinNonEmpty(", ", f.value.type_as_written, f.value.department, f.value.reason);
    case "diagnosis":
    case "adverse_event":
    case "comorbidity":
    case "symptom":
    case "exam_finding":
      return f.value.text;
    case "stage":
      return f.value.tnm ?? f.value.tnm_as_written;
    case "prognostic_score":
      return joinNonEmpty(" ", f.value.score, f.value.value_as_written, f.value.risk_group);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Grouping

/** The drug words of a regimen, for telling one treatment line from another ("nivolumab + ipilimumab" is not "nivolumab"). */
// Five-letter stems of the words around a drug name in Czech treatment lines ("denně", "udržovací", "neoadjuvantní", "léčba ... ukončena").
const NOT_DRUG = new Set(["denne", "udrzo", "rezim", "cyklu", "linie", "palia", "table", "kombi", "davka", "davko", "reduk", "navys", "ukonc", "lecba", "lecby", "lecbu", "terap", "mesic", "dalsi", "podan", "zahaj", "neoad", "adjuv", "konko", "chemo", "radio", "imuno", "syste", "onkol"]);
const firstDrug = (regimen: string) => fold(regimen).split(/[^\p{L}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)).find((w) => !NOT_DRUG.has(w));
function drugs(regimen: string): string[] {
  return [...stems(regimen)].filter((w) => /^\p{L}+$/u.test(w) && !NOT_DRUG.has(w)).sort();
}

/**
 * One treatment line: facts of the same regimen (the same drugs, the same combination) and line number, the later ones
 * a dose change or the stop of the first. The first drug word must agree and a combination stays apart from its single
 * drug, so nivolumab with ipilimumab and nivolumab maintenance are two lines.
 */
function sameLine(a: Of<"systemic_therapy">, b: Of<"systemic_therapy">): boolean {
  if (a.value.line !== null && b.value.line !== null && a.value.line !== b.value.line) return false;
  const da = drugs(a.value.regimen);
  const db = drugs(b.value.regimen);
  if (!da.length || !db.length) return false;
  const combo = (r: string) => /\+|\bs\b|\ba\b|kombinac/iu.test(r);
  if (combo(a.value.regimen) !== combo(b.value.regimen)) return false;
  return firstDrug(a.value.regimen) === firstDrug(b.value.regimen);
}

interface Group {
  anchor: Fact;
  facts: Fact[];
}

const ANCHORS: ReadonlySet<Fact["kind"]> = new Set(["procedure", "systemic_therapy", "radiotherapy", "imaging", "decision", "plan"]);

/**
 * The events of the oncology summary and the timeline, each with the facts that belong to it:
 * - a treatment line with its dose changes, its stop and the adverse events the documents relate to it;
 * - a surgery or biopsy with the histology and the metastasis findings of the same day;
 * - an imaging exam with the metastasis findings of the same day and region.
 * A fact no event takes stands on its own. Each fact joins at most one event, the first in date order.
 */
function groups(facts: readonly Fact[]): Group[] {
  const own = facts.filter((f) => !f.quarantined && f.subject === "patient").sort(byDate);
  const taken = new Set<string>();
  const out: Group[] = [];
  const take = (g: Group, f: Fact) => {
    g.facts.push(f);
    taken.add(f.id);
  };
  for (const a of own) {
    if (!ANCHORS.has(a.kind) || taken.has(a.id)) continue;
    const g: Group = { anchor: a, facts: [a] };
    taken.add(a.id);
    out.push(g);
    if (a.kind === "systemic_therapy") {
      for (const f of own) {
        if (taken.has(f.id)) continue;
        if (f.kind === "systemic_therapy" && sameLine(a, f) && (!a.date.sort || !f.date.sort || f.date.sort >= a.date.sort)) take(g, f);
      }
      for (const f of own) {
        if (taken.has(f.id) || f.kind !== "adverse_event" || !f.value.related_therapy) continue;
        const rel = drugs(f.value.related_therapy);
        if (rel.length && rel.every((d) => drugs(a.value.regimen).includes(d))) take(g, f);
      }
    }
    if (a.kind === "procedure") {
      for (const f of own) {
        if (taken.has(f.id) || !sameDay(a, f)) continue;
        if (f.kind === "histology") take(g, f);
      }
    }
    if (a.kind === "procedure" || a.kind === "imaging") {
      const region = a.kind === "imaging" ? stems(`${a.value.region ?? ""} ${a.value.finding_text}`) : stems(`${a.value.name} ${a.value.region ?? ""} ${a.value.text ?? ""}`);
      for (const f of own) {
        if (taken.has(f.id) || f.kind !== "metastasis" || !sameDay(a, f)) continue;
        // A metastasis finding of the same day joins the exam only when the exam's words name its site, so a CT of the
        // chest does not take a brain finding from an MR of the same day.
        if (overlaps(stems(f.value.site), region)) take(g, f);
      }
    }
  }
  for (const f of own) {
    if (taken.has(f.id)) continue;
    if (f.kind === "histology" || f.kind === "metastasis" || f.kind === "diagnosis" || f.kind === "request" || f.kind === "visit") out.push({ anchor: f, facts: [f] });
  }
  return out.sort((x, y) => byDate(x.anchor, y.anchor));
}

// ---------------------------------------------------------------------------------------------------------------------
// Wording

const CATEGORY: Partial<Record<Fact["kind"], ViewCategory>> = {
  procedure: "surgery",
  systemic_therapy: "systemic",
  radiotherapy: "radiotherapy",
  imaging: "imaging",
  decision: "mdt",
  plan: "clinical",
  histology: "pathology",
  metastasis: "imaging",
  diagnosis: "clinical",
  request: "clinical",
  visit: "clinical",
};

/** The line's status: planned or requested only when every fact is, stopped when the line was stopped. */
function statusOf(g: Group): FactStatus {
  const s = g.facts.map((f) => f.status);
  if (s.every((x) => x === "planned")) return "planned";
  if (s.every((x) => x === "planned" || x === "requested")) return "requested";
  if (s.includes("stopped")) return "stopped";
  if (s.includes("interrupted")) return "interrupted";
  return g.anchor.status === "planned" || g.anchor.status === "requested" ? "documented" : g.anchor.status;
}

/** A treatment line: its regimen with start and stop, the dose changes, the reason for stopping, the toxicity. */
function therapyText(g: Group): { head: string; rest: string; note: string | null } {
  const lines = g.facts.filter((f): f is Of<"systemic_therapy"> => f.kind === "systemic_therapy");
  const first = lines[0]!;
  const stop = lines.map((l) => l.value.stop).find(Boolean) ?? null;
  const reason = lines.map((l) => l.value.reason_stopped).find(Boolean) ?? null;
  const head = joinNonEmpty(", ", first.value.line ? `${first.value.line}. linie ${first.value.regimen}` : first.value.regimen, first.value.start ? `od ${first.value.start}` : null, stop ? `do ${stop}` : null);
  const changes = lines.slice(1).map((l) => joinNonEmpty(" ", l.value.regimen, l.value.start ? `od ${l.value.start}` : null));
  const tox = g.facts.filter((f) => f.kind === "adverse_event").map(words);
  const rest = joinNonEmpty("; ", changes.length ? `dále ${changes.join(", ")}` : null, reason ? `důvod ukončení: ${reason}` : null, tox.length ? `toxicita: ${tox.join(", ")}` : null);
  const stopped = lines.some((l) => l.status === "stopped" || l.status === "interrupted");
  // A stopped line whose stop date no fact gives says so in the fixed gap wording, as the assistant's note.
  const note = stopped && !stop ? `Datum ukončení ${GAP}.` : null;
  return { head, rest, note };
}

function textOf(g: Group, superseded: Map<string, string>, byId: Map<string, Fact>): { title: string; text: string; note: string | null } {
  const a = g.anchor;
  let title: string;
  let rest: string;
  let note: string | null = null;
  if (a.kind === "systemic_therapy") {
    const t = therapyText(g);
    title = t.head;
    rest = t.rest;
    note = t.note;
  } else {
    title = words(a);
    const others = g.facts.filter((f) => f !== a);
    const hist = others.filter((f) => f.kind === "histology").map(words);
    // A metastasis finding the exam's own words already name ("suspektní metastáza v paraaortální uzlině") is linked to
    // the line for its sources and confirmation, but not repeated; the exam's text says it as the report does.
    const said = stems(`${title} ${hist.join(" ")}`);
    const mets = others.filter((f) => f.kind === "metastasis" && !(f.value.site && [...stems(f.value.site)].every((w) => said.has(w)))).map(words);
    rest = joinNonEmpty("; ", hist.length ? `histologie: ${hist.join(", ")}` : null, mets.length ? mets.join(", ") : null);
  }
  const newer = g.facts.map((f) => superseded.get(f.id)).find(Boolean);
  if (newer) {
    const n = byId.get(newer);
    // The older value stays on the timeline as history; the note points at the newer one, never judges the change.
    const when = n?.date.as_written;
    note = joinNonEmpty(" ", note, when ? `Novější údaj téhož druhu z ${when}.` : "Novější údaj téhož druhu existuje.");
  }
  return { title, text: rest, note };
}

function viewLine(view: "onco_lines" | "timeline", g: Group, superseded: Map<string, string>, byId: Map<string, Fact>): ViewLine {
  const facts = g.facts.map((f) => f.id);
  const { title, text, note } = textOf(g, superseded, byId);
  const summary = joinNonEmpty("; ", title, text);
  return {
    id: viewLineId(view, facts),
    text: view === "onco_lines" ? summary : text || title,
    title: view === "timeline" ? title : null,
    detail: null,
    date: g.anchor.date,
    category: CATEGORY[g.anchor.kind] ?? "clinical",
    status: statusOf(g),
    facts,
    note,
  };
}

/** The kinds the oncology summary lists; the timeline lists these and the diagnoses, requests and visits. */
const ONCO: ReadonlySet<Fact["kind"]> = new Set(["procedure", "systemic_therapy", "radiotherapy", "imaging", "metastasis", "decision", "plan", "histology"]);

/**
 * The composed oncology summary and timeline of a run, in date order (undated last). Deterministic: the same facts give
 * the same lines with the same IDs in the same order. Lines rest only on facts that are not quarantined.
 */
export function composeViews(run: Pick<ExtractionRun, "facts">): ComposedViews {
  const gs = groups(run.facts);
  const superseded = supersededFacts(run.facts);
  const byId = new Map(run.facts.map((f) => [f.id, f]));
  return {
    onco_lines: gs.filter((g) => ONCO.has(g.anchor.kind)).map((g) => viewLine("onco_lines", g, superseded, byId)),
    timeline: gs.map((g) => viewLine("timeline", g, superseded, byId)),
    made_by: { model: null, prompt: COMPOSER },
  };
}
