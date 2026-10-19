// Fact IDs carried over from the previous run of the same case (EXTRACTION-FORMAT.md, "Fact identity").
//
// Doctor confirmations, edits and alert acknowledgements live in D1 under fact and alert IDs. A new run must reuse the
// previous run's ID for the same fact, or those links break. Three steps:
//   1. the same key: reuse the ID;
//   2. no key match: the previous fact of the same kind with the most similar value and sources, when it is clearly
//      the same fact (above a threshold, clearly ahead of the runner-up, and the best match in both directions);
//   3. otherwise a new ID.
// A wrong reuse would move a doctor's confirmation onto another fact, which is worse than a lost link (the view lists
// a lost one under "potvrzeno dříve, v novém zpracování chybí"), so step 2 is strict.
import { assignKeys, dateSeg, mintFactId, normText, valueText } from "./keys";
import type { DraftFact, ExtractionRun, Fact, Source } from "./types";

/** How a fact got its ID, for the run's log and the tests. */
export type MatchHow = "key" | "similar" | "new";

export interface MatchResult {
  facts: Fact[];
  how: Map<string, MatchHow>;
  /** Previous fact IDs with no fact in this run: their confirmations show as missing from the new processing. */
  dropped: string[];
}

/** Similarity at or above which a previous fact counts as the same fact. */
export const MATCH_THRESHOLD = 0.75;
/** The best candidate must beat the runner-up by this much, or the match is ambiguous and a new ID is safer. */
export const MATCH_MARGIN = 0.15;

function tokens(text: string): Set<string> {
  return new Set(normText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const t of a) if (b.has(t)) both++;
  return both / (a.size + b.size - both);
}

/**
 * Whether two facts can be the same fact at all. Negation, subject, status and date sit outside `value`, so the view's
 * "same ID, different value" check would not see them change: "no headache" confirmed must never turn into "headache"
 * confirmed, a relative's disease never into the patient's, a sent request never into a done exam, and a stage
 * confirmed for 2022 never into one for 2026. A change in any of them gives a new ID, and the earlier confirmation shows
 * as missing from the new processing. Dates compare as key segments, so "2.6.2022" and "02.06.2022" are the same.
 */
export function sameFrame(a: DraftFact | Fact, b: DraftFact | Fact): boolean {
  return (
    a.kind === b.kind &&
    a.negated === b.negated &&
    a.subject === b.subject &&
    a.status === b.status &&
    dateSeg(a.date) === dateSeg(b.date)
  );
}

/** Where a fact's evidence is, comparable across runs (source IDs may differ): document and quote, or NIS record. */
function evidence(fact: { sources: string[] }, sources: ReadonlyMap<string, Source>): Set<string> {
  const out = new Set<string>();
  for (const id of fact.sources) {
    const s = sources.get(id);
    if (!s) continue;
    out.add(s.type === "document" ? `${s.document_id}|${normText(s.quote)}` : `nis|${s.resource}`);
  }
  return out;
}

/** 0..1: value text weighs more than sources, because a re-read page may quote the same fact differently. */
export function similarity(
  a: DraftFact | Fact,
  aSources: ReadonlyMap<string, Source>,
  b: Fact,
  bSources: ReadonlyMap<string, Source>,
): number {
  if (!sameFrame(a, b)) return 0;
  const v = jaccard(tokens(`${valueText(a.value)} ${a.date.as_written ?? ""}`), tokens(`${valueText(b.value)} ${b.date.as_written ?? ""}`));
  const ea = evidence(a, aSources);
  const eb = evidence(b, bSources);
  // Without sources on either side (assistant facts), only the value counts.
  if (!ea.size || !eb.size) return v;
  return 0.7 * v + 0.3 * jaccard(ea, eb);
}

type Drafted = DraftFact & { draft_id?: string };

interface RoundState {
  caseId: string;
  prevFacts: Fact[];
  prevByKey: Map<string, Fact>;
  prevSrc: Map<string, Source>;
  curSrc: Map<string, Source>;
  usedPrev: Set<string>;
  taken: Set<string>;
  how: Map<string, MatchHow>;
}

/** One round of the three steps over a group of drafts; returns the final ID of each draft, in order. */
function matchRound(drafts: readonly Drafted[], sources: readonly Source[], st: RoundState): { keys: string[]; ids: string[] } {
  const keyed = assignKeys(drafts, sources);
  const ids: (string | null)[] = keyed.map(() => null);

  // 1. Same key.
  keyed.forEach((f, i) => {
    const p = st.prevByKey.get(f.key);
    if (p && sameFrame(p, f) && !st.usedPrev.has(p.id)) {
      ids[i] = p.id;
      st.usedPrev.add(p.id);
      st.how.set(p.id, "key");
    }
  });

  // 2. Similar value and sources, same kind. Scores for every open pair, then greedy from the best, so each previous
  //    fact is reused at most once and the clearest pairs win first.
  const openPrev = st.prevFacts.filter((p) => !st.usedPrev.has(p.id));
  const scores: { i: number; p: Fact; s: number }[] = [];
  keyed.forEach((f, i) => {
    if (ids[i]) return;
    for (const p of openPrev) if (p.kind === f.kind) scores.push({ i, p, s: similarity(f, st.curSrc, p, st.prevSrc) });
  });
  scores.sort((x, y) => y.s - x.s);
  for (const cand of scores) {
    if (cand.s < MATCH_THRESHOLD) break;
    if (ids[cand.i] || st.usedPrev.has(cand.p.id)) continue;
    // Clearly ahead of the runner-up on both sides: for this new fact among open previous facts, and for this previous
    // fact among open new facts. Two near-identical candidates mean we cannot tell which one the doctor confirmed.
    let runnerUp = 0;
    for (const x of scores) {
      if (x === cand) continue;
      const rivalPrev = x.i === cand.i && !st.usedPrev.has(x.p.id);
      const rivalCur = x.p.id === cand.p.id && !ids[x.i];
      if (rivalPrev || rivalCur) runnerUp = Math.max(runnerUp, x.s);
    }
    if (cand.s - runnerUp < MATCH_MARGIN) continue;
    ids[cand.i] = cand.p.id;
    st.usedPrev.add(cand.p.id);
    st.how.set(cand.p.id, "similar");
  }

  // 3. New IDs. Previous IDs (and, with options.issuedIds, all IDs ever issued) count as taken, so an ID retired from
  // one fact is not handed to a different one.
  for (const id of ids) if (id) st.taken.add(id);
  keyed.forEach((f, i) => {
    if (ids[i]) return;
    const id = mintFactId(st.caseId, f.key, st.taken);
    st.taken.add(id);
    ids[i] = id;
    st.how.set(id, "new");
  });
  return { keys: keyed.map((f) => f.key), ids: ids as string[] };
}

/**
 * Keys and IDs for a new run's facts. `previous` is the case's current run, or null for the first run.
 *
 * A producer links facts before their IDs exist (based_on, result_fact, the two ends of an interval) by giving each
 * draft a `draft_id` and using those in the references; they are rewritten to the final IDs here. Intervals are keyed
 * by the IDs of their two ends, so they get their IDs in a second round, after the facts they point at.
 */
export interface MatchOptions {
  /**
   * Documents marked superseded or withdrawn since the previous run. A previous fact that rests only on them is not
   * matched, even when a current document says the same: its confirmation was given on that document and shows as
   * missing from the new processing instead of moving to another document's fact.
   */
  retiredDocuments?: Iterable<string>;
  /** Every fact ID ever issued for the case (from D1), so a new fact never takes an ID retired in an older run. */
  issuedIds?: Iterable<string>;
}

export function assignFactIds(
  caseId: string,
  drafts: readonly Drafted[],
  sources: readonly Source[],
  previous: Pick<ExtractionRun, "facts" | "sources"> | null,
  options: MatchOptions = {},
): MatchResult {
  const allPrev = previous?.facts ?? [];
  const prevSrc = new Map((previous?.sources ?? []).map((s) => [s.id, s]));
  const retired = new Set(options.retiredDocuments ?? []);
  const onRetired = (f: Fact) =>
    f.sources.length > 0 &&
    f.sources.every((id) => {
      const s = prevSrc.get(id);
      return s?.type === "document" && retired.has(s.document_id);
    });
  const prevFacts = allPrev.filter((f) => !onRetired(f));
  const st: RoundState = {
    caseId,
    prevFacts,
    prevByKey: new Map(prevFacts.map((f) => [f.key, f])),
    prevSrc,
    curSrc: new Map(sources.map((s) => [s.id, s])),
    usedPrev: new Set(),
    taken: new Set([...allPrev.map((p) => p.id), ...(options.issuedIds ?? [])]),
    how: new Map(),
  };
  const finals: { key: string; id: string }[] = new Array(drafts.length);
  const draftToFinal = new Map<string, string>();
  const remap = (x: string) => draftToFinal.get(x) ?? x;

  const firstIdx = drafts.map((_, i) => i).filter((i) => drafts[i]!.kind !== "interval");
  const r1 = matchRound(firstIdx.map((i) => drafts[i]!), sources, st);
  firstIdx.forEach((i, n) => {
    finals[i] = { key: r1.keys[n]!, id: r1.ids[n]! };
    const d = drafts[i]!.draft_id;
    if (d) draftToFinal.set(d, r1.ids[n]!);
  });

  const secondIdx = drafts.map((_, i) => i).filter((i) => drafts[i]!.kind === "interval");
  const intervals = secondIdx.map((i) => {
    const d = drafts[i]! as Extract<Drafted, { kind: "interval" }>;
    return { ...d, value: { ...d.value, from_fact: remap(d.value.from_fact), to_fact: remap(d.value.to_fact) } };
  });
  const r2 = matchRound(intervals, sources, st);
  secondIdx.forEach((i, n) => {
    finals[i] = { key: r2.keys[n]!, id: r2.ids[n]! };
    const d = drafts[i]!.draft_id;
    if (d) draftToFinal.set(d, r2.ids[n]!);
  });

  const facts = drafts.map((f, i) => {
    const { draft_id: _drop, ...rest } = f;
    const out = { ...rest, key: finals[i]!.key, id: finals[i]!.id } as Fact;
    if (out.based_on) out.based_on = out.based_on.map(remap);
    if (out.kind === "request" && out.value.result_fact) out.value = { ...out.value, result_fact: remap(out.value.result_fact) };
    if (out.kind === "interval") out.value = { ...out.value, from_fact: remap(out.value.from_fact), to_fact: remap(out.value.to_fact) };
    return out;
  });
  const dropped = allPrev.filter((p) => !st.usedPrev.has(p.id)).map((p) => p.id);
  return { facts, how: st.how, dropped };
}
