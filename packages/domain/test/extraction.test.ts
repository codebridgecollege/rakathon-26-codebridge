import { describe, expect, it } from "vitest";
import {
  alertId,
  assignFactIds,
  assignKeys,
  buildFactKey,
  dateSeg,
  fnv1a32,
  normText,
  pairSubject,
  validateRun,
  type DraftFact,
  type ExtractionRun,
  type Fact,
  type Source,
} from "../src/extraction/index";
import exampleJson from "../schema/examples/worked-examples.json";
import vectorsJson from "./extraction-key-vectors.json";

// A fresh copy per test, so a test that breaks the run does not break the next one.
const example = (): ExtractionRun => JSON.parse(JSON.stringify(exampleJson));
const vectors = vectorsJson as unknown as {
  fnv1a32: [string, string][];
  norm_text: [string, string][];
  date_seg: [Fact["date"], string][];
  fact_keys: { fact: DraftFact; sources: Source[]; key: string }[];
  alert_ids: [{ rule: string; subject: string }, string][];
};
const codes = (run: ExtractionRun) => validateRun(run).issues.map((i) => i.code);

describe("shared key vectors (same file as the Python tests)", () => {
  it("fnv1a32", () => {
    for (const [text, hash] of vectors.fnv1a32) expect(fnv1a32(text), text).toBe(hash);
  });
  it("normText", () => {
    for (const [text, norm] of vectors.norm_text) expect(normText(text), text).toBe(norm);
  });
  it("dateSeg", () => {
    for (const [date, seg] of vectors.date_seg) expect(dateSeg(date)).toBe(seg);
  });
  it("fact keys per kind", () => {
    for (const v of vectors.fact_keys) {
      expect(buildFactKey(v.fact, new Map(v.sources.map((s) => [s.id, s]))), v.fact.kind).toBe(v.key);
    }
  });
  it("alert IDs", () => {
    for (const [a, id] of vectors.alert_ids) expect(alertId(a)).toBe(id);
  });
});

describe("fact keys", () => {
  const src = new Map(example().sources.map((s) => [s.id, s]));
  it("reproduce the spec's worked examples", () => {
    const facts = example().facts;
    expect(buildFactKey(facts[0]!, src)).toBe("lab_result|S_HSCRP|draw:undated|doc:10_pacient");
    expect(buildFactKey(facts[1]!, src)).toBe("stage|pathological|2022-06-02");
  });
  it("never contain a page number: the same lab value on another page keeps its key", () => {
    const moved = new Map(src);
    moved.set("src-7c1e", { ...(src.get("src-7c1e") as Extract<Source, { type: "document" }>), page: 5 });
    expect(buildFactKey(example().facts[0]!, moved)).toBe(buildFactKey(example().facts[0]!, src));
  });
  it("a partial date stays a month", () => {
    expect(dateSeg({ as_written: "03/2024", precision: "month", sort: "2024-03" })).toBe("2024-03");
    expect(dateSeg({ as_written: "03/2024", precision: null, sort: null })).toBe("03/2024");
  });
  it("a dose change starts a new medication fact", () => {
    const base = example().facts[0]!;
    const med = (date: Fact["date"], strength: string): DraftFact => ({
      ...base,
      kind: "medication",
      date,
      value: { drug: "Afinitor", strength, dosing: "1-0-0", change: null, indication: null, text: null },
      codes: [],
    }) as DraftFact;
    const a = buildFactKey(med({ as_written: null, precision: null, sort: null }, "5 mg"), src);
    const b = buildFactKey(med({ as_written: "19.9.2026", precision: "day", sort: "2026-09-19" }, "10 mg"), src);
    expect(a).toBe("medication|afinitor|start:undated");
    expect(b).toBe("medication|afinitor|start:2026-09-19");
  });
  it("two draws of one test on one day without a time get a suffix in source order", () => {
    const run = example();
    const lab = run.facts[0]!;
    const second = { ...lab, sources: ["src-0001"] };
    // The copy is listed first, but its source (src-0001) comes after the original's (src-7c1e) in the run's source
    // list, so the original keeps the plain key. Only the document counts in a lab key, so both share it.
    const keyed = assignKeys([second, lab], run.sources);
    expect(keyed[1]!.key).toBe("lab_result|S_HSCRP|draw:undated|doc:10_pacient");
    expect(keyed[0]!.key).toBe("lab_result|S_HSCRP|draw:undated|doc:10_pacient#2");
  });
  it("pair subjects do not depend on the order of comparison", () => {
    expect(pairSubject("f-b", "f-a")).toBe(pairSubject("f-a", "f-b"));
  });
});

const drafts = (run: ExtractionRun): DraftFact[] => run.facts.map(({ id: _i, key: _k, ...rest }) => rest as DraftFact);

describe("fact IDs against the previous run", () => {
  it("the same key keeps the ID even when the facts are reordered", () => {
    const prev = example();
    const res = assignFactIds("NO-010", [...drafts(prev)].reverse(), prev.sources, prev);
    const byKey = new Map(prev.facts.map((f) => [f.key, f.id]));
    for (const f of res.facts) expect(f.id).toBe(byKey.get(f.key));
    expect(res.dropped).toEqual([]);
  });

  it("a reworded fact whose key changed keeps its ID by similarity", () => {
    const prev = example();
    const d = drafts(prev);
    // The request's wording changed slightly (a trailing "FNO"): a new key, but clearly the same fact.
    const req = d[2] as Extract<DraftFact, { kind: "request" }>;
    d[2] = { ...req, value: { ...req.value, what: "projednání nálezu MR mozku na neurochirurgickém semináři FNO" } };
    const res = assignFactIds("NO-010", d, prev.sources, prev);
    expect(res.facts[2]!.id).toBe("f-3c90de");
    expect(res.how.get("f-3c90de")).toBe("similar");
  });

  it("an ambiguous match gets a new ID instead of moving a confirmation onto the wrong fact", () => {
    const prev = example();
    const req = prev.facts[2] as Extract<Fact, { kind: "request" }>;
    const twin = { ...req, id: "f-3c90df", key: "request|projednání nálezu mr mozku na neurochirurgickém semináři|1.10.2026", date: { as_written: "1.10.2026", precision: null, sort: null } };
    prev.facts.push(twin);
    const d = drafts(prev).slice(0, 6);
    const r = d[2] as Extract<DraftFact, { kind: "request" }>;
    d[2] = { ...r, value: { ...r.value, what: "projednání nálezu MR mozku na neurochirurgickém semináři" }, date: { as_written: "2.10.2026", precision: null, sort: null } };
    const res = assignFactIds("NO-010", d, prev.sources, prev);
    expect(["f-3c90de", "f-3c90df"]).not.toContain(res.facts[2]!.id);
    expect(res.how.get(res.facts[2]!.id)).toBe("new");
  });

  it("a fact missing from the new run is reported as dropped, never silently lost", () => {
    const prev = example();
    const d = drafts(prev).filter((f) => f.kind !== "metastasis");
    const res = assignFactIds("NO-010", d, prev.sources, prev);
    expect(res.dropped).toEqual(["f-5a0b12"]);
  });

  it("a new fact never takes a retired ID", () => {
    const prev = example();
    const taken = new Set(prev.facts.map((f) => f.id));
    const res = assignFactIds("NO-010", drafts(prev).map((f) => ({ ...f, date: { as_written: "1.1.2030", precision: null, sort: null } }) as DraftFact), prev.sources, { facts: [], sources: [] });
    for (const f of res.facts) expect(f.id).toMatch(/^f-[0-9a-f]{8}$/);
    const res2 = assignFactIds("NO-010", drafts(prev), prev.sources, null);
    for (const f of res2.facts) expect(taken.has(f.id)).toBe(false);
  });

  it("draft references and interval ends are rewritten to the final IDs", () => {
    const prev = example();
    const d = drafts(prev).map((f, i) => ({ ...f, draft_id: `d${i}` }));
    const interval = d[6] as Extract<DraftFact, { kind: "interval" }> & { draft_id: string };
    d[6] = { ...interval, value: { ...interval.value, from_fact: "d1", to_fact: "d5" }, based_on: ["d1", "d5"] };
    const res = assignFactIds("NO-010", d, prev.sources, null);
    const iv = res.facts[6] as Extract<Fact, { kind: "interval" }>;
    expect(iv.value.from_fact).toBe(res.facts[1]!.id);
    expect(iv.value.to_fact).toBe(res.facts[5]!.id);
    expect(iv.based_on).toEqual([res.facts[1]!.id, res.facts[5]!.id]);
    expect(iv.key).toBe(`interval|${res.facts[1]!.id}|${res.facts[5]!.id}`);
  });
});

describe("validator", () => {
  it("accepts the worked examples", () => {
    expect(validateRun(example()).issues).toEqual([]);
  });

  it("rejects unknown fields and wrong enums through the schema", () => {
    const run = example() as unknown as { facts: Record<string, unknown>[] };
    run.facts[0]!.certanity = "clear";
    (run.facts[1]!.value as Record<string, unknown>).stage_kind = "radiological";
    const issues = validateRun(run).issues;
    expect(issues.map((i) => i.path)).toEqual(["/facts/0/certanity", "/facts/1/value/stage_kind"]);
    expect(issues[0]!.message).toBe("unknown field certanity");
  });

  it("rejects an unknown fact kind with a clear issue", () => {
    const run = example();
    (run.facts[0] as { kind: string }).kind = "tumour_board";
    expect(codes(run)).toContain("unknown_kind");
  });

  it("rejects duplicate fact IDs", () => {
    const run = example();
    run.facts[1]!.id = run.facts[0]!.id;
    expect(codes(run)).toContain("duplicate_fact_id");
  });

  it("rejects a fact without sources, unless it is an assistant fact with based_on", () => {
    const run = example();
    run.facts[0]!.sources = [];
    expect(codes(run)).toEqual(["fact_without_sources"]);
    const ok = example();
    expect(ok.facts[6]!.sources).toEqual([]);
    expect(codes(ok)).toEqual([]);
    delete ok.facts[6]!.based_on;
    expect(codes(ok)).toEqual(["fact_without_sources"]);
  });

  it("rejects unknown source IDs, documents and parts", () => {
    const run = example();
    run.facts[0]!.sources = ["src-nope"];
    (run.sources[0] as { part: string }).part = "10_pacient/p9";
    run.checks[0]!.covered.push({ document_id: "11_pacient", part: null });
    expect(codes(run).sort()).toEqual(["unknown_document", "unknown_part", "unknown_source"]);
  });

  it("rejects an alert whose facts do not exist, and an alert ID not derived from rule and subject", () => {
    const run = example();
    run.alerts[0]!.facts = ["f-000000"];
    run.alerts[0]!.id = "al-anything";
    expect(codes(run).sort()).toEqual(["alert_id_mismatch", "unknown_fact"]);
  });

  it("rejects brief sentences and question bases that point nowhere", () => {
    const run = example();
    run.brief!.sentences.push({ text: "Bez zdroje.", facts: [] });
    run.question_draft!.basis[0]!.facts = ["f-000000"];
    expect(codes(run).sort()).toEqual(["sentence_without_facts", "unknown_fact"]);
  });

  it("rejects a key that does not follow from the fact", () => {
    const run = example();
    run.facts[1]!.key = "stage|pathological|2022-06";
    expect(codes(run)).toEqual(["key_mismatch"]);
    // A collision suffix is allowed on top of the built key.
    run.facts[1]!.key = "stage|pathological|2022-06-02#2";
    expect(codes(run)).toEqual([]);
  });

  it("rejects a contradiction between facts of different kinds", () => {
    const run = example();
    const subject = pairSubject("f-8d41c2", "f-0b19e4");
    run.alerts.push({ id: alertId({ rule: "same_time_disagrees", subject }), rule: "same_time_disagrees", subject, kind: "contradiction", facts: ["f-8d41c2", "f-0b19e4"], message: { id: "alert-contradiction", args: {} }, note: null });
    expect(codes(run)).toEqual(["contradiction_mixed_kinds"]);
  });

  describe("quarantine", () => {
    const conflicting = () => {
      const run = example();
      (run.sources[0] as { identity: string }).identity = "conflicts";
      return run;
    };
    it("a fact from a page that shows another patient must be quarantined", () => {
      expect(codes(conflicting())).toContain("quarantine_missing");
    });
    it("and needs an identity alert", () => {
      const run = conflicting();
      run.facts[0]!.quarantined = true;
      expect(codes(run)).toEqual(["quarantine_without_identity_alert"]);
      run.alerts.push({ id: alertId({ rule: "page_identity_conflict", subject: "10_pacient/p2#3" }), rule: "page_identity_conflict", subject: "10_pacient/p2#3", kind: "identity", facts: ["f-8d41c2"], message: { id: "alert-identity-conflict", args: { page: 3 } }, note: null });
      expect(codes(run)).toEqual([]);
    });
    it("a quarantined fact may not appear in the brief or another alert", () => {
      const run = conflicting();
      run.facts[0]!.quarantined = true;
      run.alerts.push({ id: alertId({ rule: "page_identity_conflict", subject: "p" }), rule: "page_identity_conflict", subject: "p", kind: "identity", facts: ["f-8d41c2"], message: { id: "x", args: {} }, note: null });
      run.brief!.sentences[0]!.facts.push("f-8d41c2");
      run.alerts[0]!.facts.push("f-8d41c2");
      expect(codes(run)).toEqual(["quarantined_in_use", "quarantined_in_use"]);
    });
    it("quarantine without a conflicting source is inconsistent", () => {
      const run = example();
      run.facts[0]!.quarantined = true;
      expect(codes(run)).toContain("quarantine_without_conflict");
    });
  });

  it("an interval is always the assistant's", () => {
    const run = example();
    run.facts[6]!.origin = "document";
    expect(codes(run)).toContain("interval_not_assistant");
  });
});
