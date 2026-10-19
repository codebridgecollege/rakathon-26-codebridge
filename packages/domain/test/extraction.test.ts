import { describe, expect, it } from "vitest";
import {
  alertId,
  assignFactIds,
  assignKeys,
  buildFactKey,
  dateSeg,
  datePrecisionProblem,
  valueText,
  type MatchOptions,
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
  value_text: [unknown, string][];
  collisions: { facts: DraftFact[]; sources: Source[]; keys: string[] }[];
  date_precision: [Fact["date"], boolean][];
  matches: {
    name: string;
    previous: ExtractionRun | null;
    drafts: DraftFact[];
    sources: Source[];
    options: MatchOptions;
    expected: { ids: string[]; keys: string[]; how: Record<string, string>; dropped: string[] };
  }[];
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
  it("value text, collisions and date precision", () => {
    for (const [v, text] of vectors.value_text) expect(valueText(v)).toBe(text);
    for (const c of vectors.collisions) expect(assignKeys(c.facts, c.sources).map((f) => f.key)).toEqual(c.keys);
    for (const [d, bad] of vectors.date_precision) expect(datePrecisionProblem(d) !== null).toBe(bad);
  });
  it("matcher scenarios", () => {
    for (const m of vectors.matches) {
      const res = assignFactIds("NO-010", m.drafts, m.sources, m.previous, m.options);
      expect(res.facts.map((f) => f.id), m.name).toEqual(m.expected.ids);
      expect(res.facts.map((f) => f.key), m.name).toEqual(m.expected.keys);
      expect(Object.fromEntries(res.how), m.name).toEqual(m.expected.how);
      expect(res.dropped, m.name).toEqual(m.expected.dropped);
    }
  });
});

describe("fact keys", () => {
  const src = new Map(example().sources.map((s) => [s.id, s]));
  it("reproduce the spec's worked examples", () => {
    const facts = example().facts;
    expect(buildFactKey(facts[0]!, src)).toBe("lab_result|S_HSCRP|draw:undated|doc:10_pacient|src:7e986229");
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
    expect(a).toBe("medication|afinitor|start:undated|part:10_pacient/p2");
    expect(b).toBe("medication|afinitor|start:2026-09-19");
  });
  it("two draws of one test on one day without a time get a suffix by content, never by position", () => {
    const run = example();
    const lab = run.facts[0] as Extract<Fact, { kind: "lab_result" }>;
    const second = { ...lab, value: { ...lab.value, value_as_written: "12,0", value_numeric: 12 } };
    const plain = "lab_result|S_HSCRP|draw:undated|doc:10_pacient|src:7e986229";
    // "12,0" sorts before "9,5", so the second draw keeps the plain key whatever the order of facts or sources.
    for (const [facts, sources] of [
      [[lab, second], run.sources],
      [[second, lab], [...run.sources].reverse()],
    ] as const) {
      const keyed = assignKeys(facts, sources);
      expect(keyed.find((f) => f.value === second.value)!.key).toBe(plain);
      expect(keyed.find((f) => f.value === lab.value)!.key).toBe(`${plain}#2`);
    }
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

describe("guards from the separate review", () => {
  it("a flipped negation, subject or status never keeps the ID a doctor confirmed", () => {
    const prev = example();
    for (const change of [{ negated: false }, { status: "done" }, { subject: "relative" }] as const) {
      const d = drafts(prev);
      const i = "negated" in change ? 4 : 2;
      d[i] = { ...d[i]!, ...change } as DraftFact;
      const res = assignFactIds("NO-010", d, prev.sources, prev);
      expect(res.facts[i]!.id).not.toBe(prev.facts[i]!.id);
      expect(res.dropped).toContain(prev.facts[i]!.id);
    }
  });

  it("a fact from a withdrawn document does not pass its ID to the same statement elsewhere", () => {
    const prev = example();
    const res = assignFactIds("NO-010", drafts(prev), prev.sources, prev, { retiredDocuments: ["10_pacient"] });
    for (const i of [0, 1, 2, 3, 4]) expect(res.facts[i]!.id).not.toBe(prev.facts[i]!.id);
    expect(res.facts[5]!.id).toBe(prev.facts[5]!.id);
    expect(res.dropped).toEqual(["f-8d41c2", "f-0b19e4", "f-3c90de", "f-5a0b11", "f-5a0b12"]);
  });

  it("an ID issued in an older run is never minted again", () => {
    const prev = example();
    const first = assignFactIds("NO-010", drafts(prev), prev.sources, null).facts[0]!.id;
    const again = assignFactIds("NO-010", drafts(prev), prev.sources, null, { issuedIds: [first] }).facts[0]!.id;
    expect(again).not.toBe(first);
  });

  it("rejects a partial date that gained a day, and precision without a sort form", () => {
    const run = example();
    run.facts[1]!.date = { as_written: "6/2022", precision: "month", sort: "2022-06-02" };
    expect(codes(run)).toContain("date_precision");
    run.facts[1]!.date = { as_written: "6/2022", precision: "month", sort: null };
    expect(codes(run)).toContain("date_precision");
  });

  it("rejects a metastasis whose status and negation disagree", () => {
    const run = example();
    run.facts[4]!.negated = false;
    expect(codes(run)).toEqual(["negation_mismatch"]);
  });

  it("rejects a medication with a stated stop that is not stopped", () => {
    const run = example();
    const lab = run.facts[0]!;
    const med = { ...lab, kind: "medication", status: "documented", date: { as_written: "28.4.2023", precision: "day", sort: "2023-04-28" }, codes: [], value: { drug: "Prednison", strength: null, dosing: null, change: null, indication: null, text: null, stop_as_written: "ukončen 26.7.2023" } } as unknown as Fact;
    med.key = buildFactKey(med, new Map(run.sources.map((s) => [s.id, s])));
    med.id = "f-0aa0aa";
    run.facts.push(med);
    expect(codes(run)).toEqual(["stop_without_stopped_status"]);
    med.status = "stopped";
    expect(codes(run)).toEqual([]);
  });

  it("rejects a relative's subject outside family history", () => {
    const run = example();
    run.facts[4]!.subject = "relative";
    expect(codes(run)).toEqual(["subject_mismatch"]);
  });

  it("rejects a check that says nothing found next to facts of its kind, or found with none", () => {
    const run = example();
    run.checks[1]!.result = "nothing_found";
    run.checks[0]!.result = "found";
    expect(codes(run)).toEqual(["check_result_mismatch", "check_result_mismatch"]);
  });

  it("a quarantined fact may not be a check's expected fact or an alert's subject", () => {
    const run = example();
    (run.sources[2] as { identity: string }).identity = "conflicts";
    run.facts[2]!.quarantined = true;
    run.alerts[0]!.facts = [];
    run.question_draft = null;
    // The worked examples' timeline card rests on the same request; composed views are tested in extraction-views.
    run.views = null;
    run.checks.push({ id: "chk-x", looks_for: "original_report", expected: { of_fact: "f-3c90de" }, covered: [], unreadable: [], result: "nothing_found" });
    run.alerts.push({ id: alertId({ rule: "page_identity_conflict", subject: "p" }), rule: "page_identity_conflict", subject: "p", kind: "identity", facts: ["f-3c90de"], message: { id: "x", args: {} }, note: null });
    expect(validateRun(run).issues.map((i) => [i.code, i.path])).toEqual([
      ["quarantined_in_use", "/alerts/0/subject"],
      ["quarantined_in_use", `/checks/${run.checks.length - 1}/expected/of_fact`],
    ]);
  });

  it("reports source errors against the source's own type only, including a missing field", () => {
    const run = example() as unknown as { sources: Record<string, unknown>[] };
    run.sources[0]!.quote_text = "ocr";
    run.sources[1]!.extra = 1;
    delete run.sources[1]!.quote;
    const issues = validateRun(run).issues;
    expect(issues.every((i) => i.code === "schema")).toBe(true);
    expect(issues.map((i) => i.path).sort()).toEqual(["/sources/0/quote_text", "/sources/1", "/sources/1/extra"]);
  });
});
