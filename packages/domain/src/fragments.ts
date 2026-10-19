// One case run from per-document fragments (docs/research/2026-10-20-case-merge-contract.md, streams B and D). Each
// producer writes, per document, the run content it found there: drafted facts (no key or ID yet), their sources,
// checks and alerts. The case merge composes the latest fragment of every producer for every current document into
// one drafted run, which the API's prepareRun and storeRun then turn into the stored codebridge.extraction/2 run.
// Pure: no I/O, no interface text beyond the Czech reasons a fact carries in the content language.
//
// This module also builds stream B's own fragment ("pipeline"): the lab values the page reader parsed from lab
// sheets, the document's readability, and the identity of each page.
import { FACT_KINDS, type Alert, type Check, type CheckPage, type CheckPart, type DocumentSource, type DraftFact, type FactDate, type IdentityResult, type LabResultValue, type RunStage, type Source } from "./extraction/types";
import { sourceIdFor } from "./extraction/keys";

export const FRAGMENT_SCHEMA = "codebridge.fragment/1";

/** A drafted fact with the ID the fragment's alerts and checks use for it ("<producer>:<document>:<n>"). */
export type FragmentFact = DraftFact & { draft_id: string };

/**
 * What one producer found in one document. Stored as <pipeline run prefix>fragment-<producer>.json. The NIS import
 * (producer "nis", issue #22) writes one fragment per case instead, with document_id "nis" (no document), stored as
 * org/<org>/nis/<case>/fragment-nis.json.
 */
export type Fragment = {
  schema: typeof FRAGMENT_SCHEMA;
  producer: "pipeline" | "ai" | "nis";
  document_id: string;
  document_sha256: string | null;
  /** The pipeline run (pipeline_runs.id) whose outputs the fragment rests on. */
  pipeline_run: string;
  /** The document's stable part IDs ("<document>/p<ordinal>"); empty when it was not split. */
  parts: string[];
  stages: RunStage[];
  /** Source IDs from keys.ts sourceIdFor, so the same passage has the same ID whoever cites it. */
  sources: Source[];
  facts: FragmentFact[];
  /** One check per kind the producer looked for in this document; kinds it does not look for are left out. */
  checks: Check[];
  /** Alerts without IDs (prepareRun derives them from rule and subject); facts by draft_id. */
  alerts: Omit<Alert, "id">[];
};

// ---------- stream B's fragment ----------

/** The lab parser's output (pipeline/page_reader/labs.py), the parts the Workflow reads. */
export type ParsedLabs = {
  draws: { date: string | null; time: string | null; source?: { page: number; quote: string } | null; certainty?: string | null; requisition_quote?: string | null }[];
  tests: {
    code: string;
    reference_low: number | null;
    reference_high: number | null;
    points: (null | {
      value: string;
      unit: string;
      reference_range: string;
      out_of_range: "high" | "low" | null;
      flagged_in_document: boolean | null;
      flag_as_written?: string | null;
      date: string | null;
      time: string | null;
      certainty: "documented" | "unclear_ocr";
      verify_reasons?: string[];
      code_as_written?: string;
      readings?: Record<string, string>;
      source: { page: number; quote: string };
    })[];
  }[];
};

export type PipelineFragmentInput = {
  documentId: string;
  sha256: string | null;
  pipelineRun: string;
  /** "tesseract 5.3.0" from the run's container versions; null when unknown. */
  engine: string | null;
  parts: { part_id: string; pages: number[] }[];
  /** Readability per page: good, fair, poor, empty. */
  pages: { n: number; level: string }[];
  /** The identity check per page; a page missing here could not be verified. */
  identity: { n: number; result: IdentityResult }[];
  /**
   * The document's identity as D1 keeps it (documents.identity): the fixture registry's result, or a conflict an
   * earlier reading found and no later one may clear. A conflict here with no page named holds back every page.
   */
  documentIdentity: IdentityResult | null;
  labs: ParsedLabs | null;
};

// The lab parser's reasons for "ověřit", in the doctor's words (the content language, Czech).
const VERIFY_CS: Record<string, string> = {
  disagree: "čtení se liší od textové vrstvy PDF",
  only_tesseract: "hodnotu má jen jedno čtení",
  low_conf: "nízká jistota čtení",
  page_poor: "stránka je špatně čitelná",
  readability_unknown: "čitelnost stránky nebyla posouzena",
  draw_date_unreadable: "datum odběru nečitelné",
  draw_on_previous_page: "datum odběru je na předchozí straně",
  draw_time_unreadable: "čas odběru nečitelný",
  draw_date_unconfirmed: "datum odběru potvrzuje jen jedno čtení",
  draw_date_differs: "datum odběru se v čteních liší",
};

// "7,42" and "7.42" are numbers; "<0,5" is a detection limit and "neg." a word, which no chart may plot.
const numeric = (s: string): number | null => (/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(s) ? Number(s.trim().replace(",", ".")) : null);

// The draw's date as the sheet prints it ("10.3.2026 07:25"), cut out of the header quote, never rebuilt.
function drawAsWritten(quote: string | null | undefined): string | null {
  const m = /\d{1,2}\.\s?\d{1,2}\.\s?\d{4}(?:\s+\d{1,2}:\d{2})?/.exec(quote ?? "");
  return m ? m[0] : null;
}

function drawDate(date: string | null, time: string | null, asWritten: string | null): FactDate {
  if (!date) return { as_written: asWritten, precision: null, sort: null };
  return time ? { as_written: asWritten, precision: "minute", sort: `${date}T${time}` } : { as_written: asWritten, precision: "day", sort: date };
}

/**
 * The pipeline's fragment for one document: every lab value the parser found, as a lab_result fact with its passage;
 * a lab_result check (found, or not_run: the parser reads only FNO-format lab sheets, so it can never say a document
 * holds no lab values); the poor-copy alert when a page reads poor or empty; and the identity alert when a page shows
 * another patient, whose facts are quarantined (kept, never shown).
 */
export function pipelineFragment(i: PipelineFragmentInput): Fragment {
  const partOf = (n: number) => i.parts.find((p) => p.pages.includes(n))?.part_id ?? null;
  // A conflict is never cleared here: the document's own conflict (the registry's, or one an earlier reading found)
  // stands for the pages it names, and for every page when this reading names none.
  const namedConflicts = i.identity.filter((x) => x.result === "conflicts").map((x) => x.n);
  const allConflict = i.documentIdentity === "conflicts" && !namedConflicts.length;
  const identityOf = (n: number): IdentityResult => (allConflict ? "conflicts" : i.identity.find((x) => x.n === n)?.result ?? "cannot_verify");
  const sources: Source[] = [];
  const taken = new Set<string>();
  const sourceFor = (src: Omit<DocumentSource, "id">) => {
    const id = sourceIdFor(src);
    if (!taken.has(id)) {
      taken.add(id);
      sources.push({ ...src, id });
    }
    return id;
  };
  const facts: FragmentFact[] = [];
  for (const t of i.labs?.tests ?? []) {
    t.points.forEach((pt, k) => {
      if (!pt) return;
      const draw = i.labs!.draws[k];
      const asWritten = drawAsWritten(draw?.source?.quote);
      // The parser's draw certainty is null only when no draw header exists at all ("not stated"); an unreadable or
      // earlier-page header is stated, just not readable here, and is marked "ověřit" instead.
      const drawMissing = !pt.date && (draw?.certainty === null || draw?.certainty === undefined) && !draw?.source;
      const verify = pt.certainty !== "documented";
      const page = pt.source.page;
      const readings = pt.readings ? Object.entries(pt.readings) : [];
      const src = sourceFor({
        type: "document",
        document_id: i.documentId,
        part: partOf(page),
        page,
        quote: pt.source.quote,
        quote_text: "tesseract",
        anchor: null,
        reported_as: "original",
        identity: identityOf(page),
        // Both readings of a value that differ are kept, so the doctor sees what each read.
        reading_check: readings.length
          ? { mark: verify, tokens: [{ tesseract: pt.readings!.text_of_record ?? null, pdf_text: readings.find(([k2]) => k2 !== "text_of_record")?.[1] ?? null, rule: "differ" }] }
          : null,
      });
      // A printed H or L is the document's own flag and wins; otherwise a direction computed from the range is ours.
      // A printed mark without a direction ("*") is kept in the note, never turned into one.
      const printed = (pt.flag_as_written ?? "").trim().toUpperCase();
      const printedDir = printed === "H" || printed === "+" ? "high" : printed === "L" || printed === "-" ? "low" : null;
      const out = printedDir ?? pt.out_of_range ?? null;
      const value: LabResultValue = {
        // The sheet prints the code, not a name; our label for the code is the view's business.
        name_as_written: pt.code_as_written ?? t.code,
        value_as_written: pt.value,
        value_numeric: numeric(pt.value),
        unit_as_written: pt.unit || null,
        // "unit" is the corrected unit; the pipeline corrects nothing, so it repeats a unit only on a clear reading.
        unit: !verify && pt.unit ? pt.unit : null,
        reference_range: pt.reference_range || null,
        reference_low: t.reference_low ?? null,
        reference_high: t.reference_high ?? null,
        out_of_range: out,
        out_of_range_origin: printedDir ? "document" : out ? "assistant" : null,
        draw: { as_written: asWritten, requisition: draw?.requisition_quote ?? null, specimen: null },
      };
      const markNote = printed && !printedDir ? `Na listu označeno „${printed}“.` : null;
      const reasons = (pt.verify_reasons ?? []).map((r) => VERIFY_CS[r]).filter(Boolean);
      facts.push({
        draft_id: `pipeline:${i.documentId}:${facts.length}`,
        kind: "lab_result",
        subject: "patient",
        value,
        date: drawDate(pt.date, pt.time, asWritten),
        status: "documented",
        negated: false,
        not_stated: drawMissing ? ["draw"] : [],
        origin: "document",
        certainty: verify ? "verify" : "clear",
        certainty_reason: verify ? { code: pt.verify_reasons?.[0] ?? "unclear_ocr", text: `${reasons.join("; ") || "hodnota přečtena nejistě"}; ověřte v originálu.` } : null,
        codes: [{ system: "fno-local-lab", code: t.code, assigned_by: "source" }],
        note: markNote,
        // A value on a page of another patient is kept but never shown, and never used by the rules.
        quarantined: identityOf(page) === "conflicts",
        sources: [src],
      } as FragmentFact);
    });
  }

  const covered: CheckPart[] = i.parts.length ? i.parts.map((p) => ({ document_id: i.documentId, part: p.part_id })) : [{ document_id: i.documentId, part: null }];
  const unreadable: CheckPage[] = i.pages.filter((p) => p.level === "poor" || p.level === "empty").map((p) => ({ document_id: i.documentId, part: partOf(p.n), page: p.n }));
  // A check that did not run covers nothing: listing the parts would claim a reading that did not happen.
  const checks: Check[] = [
    { id: `chk-pl-${i.documentId}-lab-result`, looks_for: "lab_result", expected: null, covered: facts.length ? covered : [], unreadable, result: facts.length ? "found" : "not_run" },
  ];

  const alerts: Omit<Alert, "id">[] = [];
  const pageList = (ns: number[]) => [...new Set(ns)].sort((a, b) => a - b).join(", ");
  if (unreadable.length)
    alerts.push({ rule: "poor_copy", subject: i.documentId, kind: "poor_copy", facts: [], message: { id: "alert-poor-copy", args: { document: i.documentId } }, note: null });
  const conflicts = allConflict ? i.pages.map((p) => p.n) : namedConflicts;
  if (conflicts.length)
    alerts.push({
      rule: "identity_conflict",
      subject: i.documentId,
      kind: "identity",
      facts: facts.filter((f) => f.quarantined).map((f) => f.draft_id),
      message: { id: "alert-identity-conflict", args: { document: i.documentId, page: pageList(conflicts) } },
      note: null,
    });

  return {
    schema: FRAGMENT_SCHEMA,
    producer: "pipeline",
    document_id: i.documentId,
    document_sha256: i.sha256,
    pipeline_run: i.pipelineRun,
    parts: i.parts.map((p) => p.part_id),
    stages: [{ name: "page_reader", engine: i.engine ?? "page reader" }],
    sources,
    facts,
    checks,
    alerts,
  };
}

// ---------- the case merge ----------

/** The drafted run the API's prepareRun takes (store/runs.ts DraftRun), built from fragments. */
export type ComposedDraft = {
  schema: "codebridge.extraction/2";
  case_id: string;
  content_language: string;
  run: { id: string; producer: "pipeline" | "nis"; created_at: string; stages: RunStage[] };
  documents: { document_id: string; sha256: string | null; parts: string[] }[];
  sources: Source[];
  facts: FragmentFact[];
  checks: Check[];
  alerts: Omit<Alert, "id">[];
  brief: null;
  question_draft: null;
};

const RANK: Record<Check["result"], number> = { not_run: 0, nothing_found: 1, found: 2 };
const uniq = <T>(xs: T[], key: (x: T) => string) => xs.filter((x, i) => xs.findIndex((y) => key(y) === key(x)) === i);

/**
 * One drafted run from the latest fragments of the case's current documents (the caller picks which: current
 * documents only, the latest of each producer). Sources, facts and alerts are concatenated (the producers never find
 * the same fact: the pipeline reads lab sheets only, the AI extraction everything else). Checks are merged per kind:
 * covered and unreadable are unions, and "found" wins over "nothing found", which wins over "not run". Every fact kind
 * gets a check, so a kind nobody looked for says "not run", never "not stated".
 */
export function composeFragments(caseId: string, runId: string, createdAt: string, all: readonly Fragment[]): ComposedDraft {
  // Only fragments of this format and a known producer: a newer format or a half-written file is left out, not read
  // as this one.
  const fragments = all.filter((f) => f.schema === FRAGMENT_SCHEMA && (f.producer === "pipeline" || f.producer === "ai" || f.producer === "nis"));
  // The NIS fragment is no document: it adds no entry to the run's documents and no vote on "nothing found".
  const nis = fragments.filter((f) => f.producer === "nis");
  const docs = new Map<string, { document_id: string; sha256: string | null; parts: string[] }>();
  for (const f of fragments) {
    if (f.producer === "nis") continue;
    const d = docs.get(f.document_id) ?? { document_id: f.document_id, sha256: f.document_sha256, parts: [] };
    for (const p of f.parts) if (!d.parts.includes(p)) d.parts.push(p);
    docs.set(f.document_id, d);
  }
  const sources = new Map<string, Source>();
  for (const f of fragments) for (const s of f.sources) if (!sources.has(s.id)) sources.set(s.id, s);
  const stages: RunStage[] = [];
  for (const f of fragments)
    for (const s of f.stages)
      if (!stages.some((x) => x.name === s.name && x.engine === s.engine && x.model === s.model && x.prompt === s.prompt && x.prompt_sha256 === s.prompt_sha256)) stages.push(s);

  // Per kind: "found" when any document found facts; "nothing found" only when every document of the run reported
  // nothing found for it (a document whose AI reading is still pending has not looked yet, so "-" with "neuvedeno"
  // would be false); otherwise "not run".
  const byKind = new Map<string, Check>();
  const said = new Map<string, Map<string, Check["result"]>>();
  // The NIS says only "found" or "not run" (EXTRACTION-FORMAT.md, "Decisions"): a kind it found is found, and
  // otherwise the kind is left to the documents.
  // Taken from the NIS facts themselves, not only its checks: a kind the NIS holds facts of is found, also when part
  // of its records was cut off (the NIS's own check then says "not run"), so "nothing found" never sits next to them.
  const nisFound = new Set<string>([
    ...nis.flatMap((f) => f.checks.filter((c) => !c.expected && c.result === "found").map((c) => c.looks_for)),
    ...nis.flatMap((f) => f.facts.map((x) => x.kind)),
  ]);
  for (const f of fragments)
    for (const c of f.producer === "nis" ? [] : f.checks) {
      if (c.expected) continue; // a document check (an expected report) is the case rules' to make, per case
      const prev = byKind.get(c.looks_for);
      const perDoc = said.get(c.looks_for) ?? new Map<string, Check["result"]>();
      const before = perDoc.get(f.document_id);
      perDoc.set(f.document_id, before && RANK[before] > RANK[c.result] ? before : c.result);
      said.set(c.looks_for, perDoc);
      byKind.set(c.looks_for, {
        id: `chk-${c.looks_for.replace(/_/g, "-")}`,
        looks_for: c.looks_for,
        expected: null,
        // Each part and page once, however many producers listed it.
        covered: uniq([...(prev?.covered ?? []), ...c.covered], (x) => `${x.document_id}|${x.part ?? ""}`),
        unreadable: uniq([...(prev?.unreadable ?? []), ...c.unreadable], (x) => `${x.document_id}|${x.part ?? ""}|${x.page}`),
        result: "not_run",
      });
    }
  for (const k of nisFound)
    if (!byKind.has(k)) byKind.set(k, { id: `chk-${k.replace(/_/g, "-")}`, looks_for: k, expected: null, covered: [], unreadable: [], result: "not_run" });
  for (const [kind, c] of byKind) {
    const perDoc = said.get(kind) ?? new Map<string, Check["result"]>();
    const results = [...docs.keys()].map((d) => perDoc.get(d) ?? "not_run");
    // "Nothing found" needs at least one document that said so: a run of the NIS alone never says it.
    c.result =
      nisFound.has(kind) || results.includes("found") ? "found" : results.length && results.every((r) => r === "nothing_found") ? "nothing_found" : "not_run";
  }
  for (const k of FACT_KINDS) if (!byKind.has(k)) byKind.set(k, { id: `chk-${k.replace(/_/g, "-")}`, looks_for: k, expected: null, covered: [], unreadable: [], result: "not_run" });

  // One identity alert per document, from the pipeline's identity check, listing the quarantined facts of every
  // producer in that document (the AI extraction marks its own facts from the same per-page result and raises no
  // identity alert of its own). A document whose facts are quarantined without such an alert gets one, so the
  // doctor always learns why something is held back.
  const facts = fragments.flatMap((f) => f.facts);
  const docOfFact = (f: FragmentFact) => {
    const s = sources.get(f.sources[0] ?? "");
    return s?.type === "document" ? s.document_id : null;
  };
  // One alert per rule and subject (their IDs come from both): two producers raising the same one is one alert.
  const alerts: Omit<Alert, "id">[] = [];
  for (const a of fragments.flatMap((f) => f.alerts))
    if (a.rule !== "identity_conflict" && !alerts.some((x) => x.rule === a.rule && x.subject === a.subject)) alerts.push(a);
  for (const docId of docs.keys()) {
    const held = facts.filter((f) => f.quarantined && docOfFact(f) === docId);
    const own = fragments.flatMap((f) => f.alerts).find((a) => a.rule === "identity_conflict" && a.subject === docId);
    if (!own && !held.length) continue;
    const pages = [...new Set(held.flatMap((f) => f.sources.map((s) => sources.get(s)).filter((s): s is DocumentSource => s?.type === "document" && s.identity === "conflicts").map((s) => s.page)))].sort((a, b) => a - b);
    alerts.push(
      own
        ? { ...own, facts: held.map((f) => f.draft_id) }
        : { rule: "identity_conflict", subject: docId, kind: "identity", facts: held.map((f) => f.draft_id), message: { id: "alert-identity-conflict", args: { document: docId, page: pages.join(", ") } }, note: null },
    );
  }

  return {
    schema: "codebridge.extraction/2",
    case_id: caseId,
    content_language: "cs",
    // A run with any document is the pipeline's; the NIS alone makes a NIS run.
    run: { id: runId, producer: docs.size || !nis.length ? "pipeline" : "nis", created_at: createdAt, stages: [...stages, { name: "case_merge", engine: "codebridge compose-fragments@1" }] },
    documents: [...docs.values()],
    sources: [...sources.values()],
    facts,
    checks: [...byKind.values()],
    alerts,
    brief: null,
    question_draft: null,
  };
}
