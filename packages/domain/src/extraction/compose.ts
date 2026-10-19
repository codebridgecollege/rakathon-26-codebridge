// Composed views for a run that has none (EXTRACTION-FORMAT.md, "Composed views"; issue #21).
//
// The fixtures carry hand-written summary lines; a new patient's run is shown fact by fact, which splits one event
// into several lines (a therapy, its stop and its toxicity; a surgery and its histology). composeViews groups the facts
// that belong to one event into one line, deterministically, in words taken from the facts themselves, so every date,
// number, negation and side of a line is backed by its facts and passes the validator's backing check (backing.ts).
// It adds only joining words ("od", "do", "dále", "histologie:", "toxicita:", "důvod ukončení:"), status labels
// ("suspektní", "(negativní nález)", "(podezření)") and the fixed gap wording, never a clinical judgement.
//
// The case merge (stream B's ProcessCaseWorkflow, through withCaseRulesAndViews) calls it after applyCaseRules and before
// storeRun, which validates every line.
import { negationCues } from "./backing";
import { dateSeg, viewLineId } from "./keys";
import { applyCaseRules, supersededFacts, writtenSort } from "./rules";
import type { ComposedViews, ExtractionRun, Fact, FactStatus, ViewCategory, ViewLine } from "./types";

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
/** Plain code-unit order, the same in every runtime. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byDate = (a: Fact, b: Fact) => cmp(a.date.sort ?? "￿", b.date.sort ?? "￿") || cmp(a.id, b.id);
const sameDay = (a: Fact, b: Fact) => !!a.date.sort && !!b.date.sort && dateSeg(a.date) === dateSeg(b.date);
/** Planned and requested facts lie ahead: they never share a line with what was done, so they never read as done. */
const ahead = (f: Fact) => f.status === "planned" || f.status === "requested";

/**
 * A fact in its own words. A recorded negative whose words hold no negation gets "(negativní nález)", the view's own
 * label, so "plicní embolie" recorded as absent never reads as present inside a composed line.
 */
export function factWords(f: Fact): string {
  const text = ownWords(f);
  return f.negated && negationCues(text).size === 0 ? `${text} (negativní nález)` : text;
}

const SUSPECTED = /susp|podezř|podezr|nejist|možn/iu;

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
    case "metastasis": {
      // A site alone ("mozeček vpravo") would read as a finding of unknown nature: the status the document gives is
      // part of the words, so a suspicion never reads as a confirmed metastasis.
      const text = str(f.value.text);
      if (f.value.status === "suspected") return text && SUSPECTED.test(text) ? text : `suspektní metastáza: ${text ?? f.value.site}`;
      if (f.value.status === "excluded") return text && negationCues(text).size ? text : `metastáza vyloučena: ${text ?? f.value.site}`;
      return text ?? `metastáza: ${f.value.site}`;
    }
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
      // A suspected diagnosis is labelled as one when its own words do not say so (CLAUDE.md: a suspicion is not a
      // diagnosis).
      return f.value.disease_status === "suspected" && !SUSPECTED.test(f.value.text) ? `${f.value.text} (podezření)` : f.value.text;
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

// Five-letter stems of the words around a drug name in Czech treatment lines ("denně", "udržovací", "neoadjuvantní",
// "snížení dávky", "léčba ... ukončena"): what is left are the drugs.
const NOT_DRUG = new Set([
  "denne", "udrzo", "rezim", "cyklu", "linie", "palia", "table", "kombi", "davka", "davky", "davko", "reduk", "navys",
  "ukonc", "lecba", "lecby", "lecbu", "lecbo", "terap", "mesic", "dalsi", "podan", "podav", "zahaj", "neoad", "adjuv",
  "konko", "chemo", "radio", "imuno", "syste", "onkol", "snize", "preru", "vysaz", "pokra", "zmena", "zmeny", "indik",
  "dopor", "postu", "tyden",
]);
// Endings of international drug names (INN), with up to four letters of Czech declension after them ("sunitinibem",
// "temozolomidu"): a word that ends so is a drug whatever words surround it.
export const INN = /(?:mab|nib|lib|rolim|platin[a-z]?|taxel|rubicin|citabin|zolomid|mustin|trexat|parib|ciclib|lutamid|relin|rozol|xifen|fosfamid|tecan|posid|mycin|uracil|kinib|stat|cept)[a-z]{0,4}$/;
/**
 * The drugs a regimen names, as five-letter stems: the words that look like drug names (INN endings), else every word
 * that is not a known word around a drug (an abbreviation such as "FOLFOX").
 */
function drugs(regimen: string): Set<string> {
  const ws = fold(regimen).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);
  const inn = ws.filter((w) => INN.test(w));
  return new Set((inn.length ? inn : ws.filter((w) => !NOT_DRUG.has(w.slice(0, 5)))).map((w) => w.slice(0, 5)));
}
const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
/** A combination: two drugs or a "+" ("nivolumab + ipilimumab"). Prose such as "4., 5. a 6. cyklus" is not one. */
const isCombo = (r: string) => drugs(r).size >= 2 || /\+|kombinac/iu.test(r);

/** The latest stop a therapy fact writes, as a sort form, or null. */
const stopOf = (f: Of<"systemic_therapy">) => writtenSort(f.value.stop, true);

/**
 * Whether a later fact continues a treatment line: the same drugs (one statement may name fewer, "léčba sunitinibem
 * ukončena"), the same combination or single drug, the same line number when both give one, and dated before the
 * line's documented stop, so a rechallenge years later stays its own line.
 */
function continues(a: Of<"systemic_therapy">, b: Of<"systemic_therapy">): boolean {
  if (a.value.line !== null && b.value.line !== null && a.value.line !== b.value.line) return false;
  if (isCombo(a.value.regimen) !== isCombo(b.value.regimen)) return false;
  const da = drugs(a.value.regimen);
  const db = drugs(b.value.regimen);
  if (!da.size || !db.size || !(subset(da, db) || subset(db, da))) return false;
  if (a.date.sort && b.date.sort && b.date.sort < a.date.sort) return false;
  const stop = stopOf(a);
  return !(stop && b.date.sort && b.date.sort > stop);
}

/**
 * Whether an undated therapy statement could belong to two different lines of its drugs (a concomitant and an
 * adjuvant phase): then it stays on its own line rather than on a guessed one.
 */
function ambiguous(f: Of<"systemic_therapy">, own: readonly Fact[]): boolean {
  const homes = own.filter((d): d is Of<"systemic_therapy"> => d.kind === "systemic_therapy" && d !== f && !!d.date.sort && continues(d, f));
  return homes.some((x) => homes.some((y) => x.date.sort! < y.date.sort! && !continues(x, y)));
}

interface Group {
  anchor: Fact;
  facts: Fact[];
}

const ANCHORS: ReadonlySet<Fact["kind"]> = new Set(["procedure", "systemic_therapy", "radiotherapy", "imaging", "decision", "plan"]);

/**
 * The events of the oncology summary and the timeline, each with the facts that belong to it:
 * - a treatment line with its dose changes and its stop, and the adverse events the documents relate to it;
 * - a surgery or biopsy with the histology of the same day whose specimen it names;
 * - an imaging exam or a procedure with the metastasis findings of the same day at a site its words name.
 * A planned or requested fact joins only a planned or requested event. A fact no event takes stands on its own. Each
 * fact joins at most one event, the first in date order.
 */
function groups(facts: readonly Fact[]): Group[] {
  const own = facts.filter((f) => !f.quarantined && f.subject === "patient").sort(byDate);
  const taken = new Set<string>();
  const out: Group[] = [];
  const take = (g: Group, f: Fact) => {
    g.facts.push(f);
    taken.add(f.id);
  };
  const procedures = own.filter((f): f is Of<"procedure"> => f.kind === "procedure");
  for (const a of own) {
    if (!ANCHORS.has(a.kind) || taken.has(a.id)) continue;
    const g: Group = { anchor: a, facts: [a] };
    taken.add(a.id);
    out.push(g);
    const joinable = (f: Fact) => !taken.has(f.id) && ahead(f) === ahead(a);
    if (a.kind === "systemic_therapy") {
      for (const f of own) if (f.kind === "systemic_therapy" && joinable(f) && continues(a, f) && !(f.date.sort === null && ambiguous(f, own))) take(g, f);
    }
    if (a.kind === "procedure") {
      const said = stems(`${a.value.name} ${a.value.region ?? ""} ${a.value.text ?? ""}`);
      const sameDayProcedures = procedures.filter((p) => sameDay(a, p)).length;
      for (const f of own) {
        if (f.kind !== "histology" || !joinable(f) || !sameDay(a, f)) continue;
        // The specimen must be one the procedure names; without a specimen, only when it is the day's one procedure.
        const spec = stems(f.value.specimen);
        if (spec.size ? overlaps(spec, said) : sameDayProcedures === 1) take(g, f);
      }
    }
    if (a.kind === "procedure" || a.kind === "imaging") {
      const region = a.kind === "imaging" ? stems(`${a.value.region ?? ""} ${a.value.finding_text}`) : stems(`${a.value.name} ${a.value.region ?? ""} ${a.value.text ?? ""}`);
      for (const f of own) {
        if (f.kind !== "metastasis" || !joinable(f) || !sameDay(a, f)) continue;
        // A metastasis finding of the same day joins the exam only when the exam's words name its site, so a CT of the
        // chest does not take a brain finding from an MR of the same day.
        if (overlaps(stems(f.value.site), region)) take(g, f);
      }
    }
  }
  attachAdverseEvents(own, out, taken);
  for (const f of own) {
    if (taken.has(f.id)) continue;
    if (f.kind === "histology" || f.kind === "metastasis" || f.kind === "diagnosis" || f.kind === "request" || f.kind === "visit") out.push({ anchor: f, facts: [f] });
  }
  return out.sort((x, y) => byDate(x.anchor, y.anchor));
}

/**
 * An adverse event joins the treatment line the document relates it to: the line whose drugs are exactly the related
 * therapy's, else the only line that holds them all, and never a line it is dated outside of. An event that fits no
 * line, or several equally, stays off the lines (as in the fact-by-fact view) rather than on the wrong therapy.
 */
function attachAdverseEvents(own: Fact[], out: Group[], taken: Set<string>): void {
  const lines = out.filter((g) => g.anchor.kind === "systemic_therapy");
  for (const f of own) {
    if (f.kind !== "adverse_event" || taken.has(f.id) || !f.value.related_therapy) continue;
    const rel = drugs(f.value.related_therapy);
    if (!rel.size) continue;
    const fits = lines.filter((g) => {
      const a = g.anchor as Of<"systemic_therapy">;
      if (ahead(a) || !subset(rel, drugs(a.value.regimen))) return false;
      if (!f.date.sort) return true;
      const stop = g.facts.map((x) => (x.kind === "systemic_therapy" ? stopOf(x) : null)).find(Boolean);
      return (!a.date.sort || f.date.sort >= a.date.sort) && (!stop || f.date.sort <= stop);
    });
    const exact = fits.filter((g) => {
      const d = drugs((g.anchor as Of<"systemic_therapy">).value.regimen);
      return d.size === rel.size && subset(d, rel);
    });
    const home = exact.length === 1 ? exact[0] : exact.length === 0 && fits.length === 1 ? fits[0] : undefined;
    if (home) {
      home.facts.push(f);
      taken.add(f.id);
    }
  }
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

/** The line's status: planned or requested when its facts are, stopped when the line was stopped. */
function statusOf(g: Group): FactStatus {
  const s = g.facts.map((f) => f.status);
  if (s.every((x) => x === "planned")) return "planned";
  if (s.every((x) => x === "planned" || x === "requested")) return "requested";
  if (s.includes("stopped")) return "stopped";
  if (s.includes("interrupted")) return "interrupted";
  return g.anchor.status;
}

/** A treatment line: its regimen with start and stop, the dose changes, the reason for stopping, the toxicity. */
function therapyText(g: Group): { head: string; rest: string; note: string | null } {
  const lines = g.facts.filter((f): f is Of<"systemic_therapy"> => f.kind === "systemic_therapy");
  const first = lines[0]!;
  // The stop comes from the line's own facts and only when it is a date: "po ukončení" is not a stop date.
  const stop = lines.map((l) => (stopOf(l) ? l.value.stop : null)).find(Boolean) ?? null;
  const reason = lines.map((l) => l.value.reason_stopped).find(Boolean) ?? null;
  const head = joinNonEmpty(", ", first.value.line ? `${first.value.line}. linie ${first.value.regimen}` : first.value.regimen, first.value.start ? `od ${first.value.start}` : null, stop ? `do ${stop}` : null);
  const changes = lines.slice(1).map((l) => joinNonEmpty(" ", l.value.regimen, l.value.start ? `od ${l.value.start}` : null));
  const tox = g.facts.filter((f) => f.kind === "adverse_event").map(factWords);
  const rest = joinNonEmpty("; ", changes.length ? `dále ${changes.join(", ")}` : null, reason ? `důvod ukončení: ${reason}` : null, tox.length ? `toxicita: ${tox.join(", ")}` : null);
  // A stopped line whose stop date no fact gives says so in the fixed gap wording, as the assistant's note. An
  // interruption is not a stop, so it gets no such note.
  const stopped = lines.some((l) => l.status === "stopped");
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
    title = factWords(a);
    const others = g.facts.filter((f) => f !== a);
    const hist = others.filter((f) => f.kind === "histology").map(factWords);
    // A metastasis finding the exam's own words already name ("suspektní metastáza v paraaortální uzlině") is linked to
    // the line for its sources and confirmation, but not repeated; the exam's text says it as the report does.
    const said = stems(`${title} ${hist.join(" ")}`);
    const mets = others.filter((f) => f.kind === "metastasis" && !(f.value.site && [...stems(f.value.site)].every((w) => said.has(w)))).map(factWords);
    rest = joinNonEmpty("; ", hist.length ? `histologie: ${hist.join(", ")}` : null, mets.length ? mets.join(", ") : null);
  }
  // Only the event's own value can be replaced: a newer metastasis finding at a site the exam mentions does not make
  // the whole exam outdated.
  const newer = superseded.get(a.id);
  if (newer) {
    const when = byId.get(newer)?.date.as_written;
    // The older value stays on the timeline as history; the note points at the newer one, never judges the change.
    note = joinNonEmpty(" ", note, when ? `Novější údaj téhož druhu z ${when}.` : "Novější údaj téhož druhu existuje.");
  }
  // The facts' own notes stay visible: the view shows a composed line's note in place of its facts' notes.
  const factNotes = g.facts.map((f) => f.note).filter((x): x is string => !!str(x));
  return { title, text: rest, note: joinNonEmpty(" ", note, ...[...new Set(factNotes)]) || null };
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

/**
 * The kinds the oncology summary lists, as the fact-by-fact view does (run-view.ts ONCO_KINDS); a histology appears
 * there on its procedure's line, and on its own on the timeline.
 */
const ONCO: ReadonlySet<Fact["kind"]> = new Set(["procedure", "systemic_therapy", "radiotherapy", "imaging", "metastasis", "decision", "plan"]);

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

/**
 * The synchronous part of finishing a case run, for the case merge (stream B's composeCaseRun `rules`): the case
 * rules, then the composed views over the same facts. The brief needs the model and runs as its own step after this.
 */
export function withCaseRulesAndViews<R extends ExtractionRun>(run: R): R {
  const ruled = applyCaseRules(run);
  return { ...ruled, views: composeViews(ruled) };
}
