// Composed views (EXTRACTION-FORMAT.md, "Composed views"): the backing rule against the vectors shared with Python,
// the line IDs, and the validator's rules for view lines and brief sentences.
import { describe, expect, it } from "vitest";
import { alertId, backingProblems, validateRun, viewLineId, type BackingProblem, type ExtractionRun } from "../src/extraction/index";
import exampleJson from "../schema/examples/worked-examples.json";
import backingJson from "./extraction-backing-vectors.json";
import run10Json from "../../../fixtures/data/runs/NO-010.json";

const example = (): ExtractionRun => JSON.parse(JSON.stringify(exampleJson));
const codes = (run: ExtractionRun) => validateRun(run).issues.map((i) => i.code);
const cases = (backingJson as { cases: { name: string; text: string; texts: string[]; negated: boolean; all_negated?: boolean; want: BackingProblem[] }[] }).cases;

describe("backing vectors (same file as the Python tests)", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    expect(backingProblems(c.text, { texts: c.texts, negated: c.negated, allNegated: c.all_negated })).toEqual(c.want);
  });
});

describe("view line IDs", () => {
  it("follow the view and the set of facts, not their order", () => {
    expect(viewLineId("onco_lines", ["f-b", "f-a"])).toBe(viewLineId("onco_lines", ["f-a", "f-b"]));
    expect(viewLineId("onco_lines", ["f-a"])).not.toBe(viewLineId("timeline", ["f-a"]));
    expect(viewLineId("onco_lines", ["f-a"])).not.toBe(viewLineId("onco_lines", ["f-a", "f-b"]));
    expect(viewLineId("onco_lines", ["f-a"])).toMatch(/^vl-[0-9a-f]{8}$/);
  });
});

describe("validator: composed views", () => {
  it("accepts the worked examples' views, and a run without views", () => {
    expect(codes(example())).toEqual([]);
    const run = example();
    delete run.views;
    expect(codes(run)).toEqual([]);
  });

  it("rejects a line without facts (the schema), an unknown fact and an ID not derived from the facts", () => {
    const empty = example();
    empty.views!.onco_lines![0]!.facts = [];
    expect(validateRun(empty).issues.map((i) => [i.code, i.path])).toEqual([["schema", "/views/onco_lines/0/facts"]]);
    const run = example();
    run.views!.timeline![0]!.facts.push("f-000000");
    expect(codes(run).sort()).toEqual(["unknown_fact", "view_line_id_mismatch"]);
  });

  it("rejects two lines of one view on the same facts", () => {
    const run = example();
    run.views!.onco_lines!.push({ ...run.views!.onco_lines![0]! });
    expect(codes(run)).toEqual(["duplicate_view_line_id"]);
  });

  it("rejects a date, number, negation or side the line's facts do not hold, in text, title and detail", () => {
    const run = example();
    const line = run.views!.onco_lines![0]!;
    line.text = "pT2a pN1 M0 vlevo, 3.6.2022, bez progrese, 7 uzlin";
    expect(validateRun(run).issues.map((i) => [i.code, i.path, i.message])).toEqual([
      ["view_line_unbacked", "/views/onco_lines/0/text", "a date in the line's text is not in its facts"],
      ["view_line_unbacked", "/views/onco_lines/0/text", "a number in the line's text is not in its facts"],
      ["view_line_unbacked", "/views/onco_lines/0/text", "a negation in the line's text is not in its facts"],
      ["view_line_unbacked", "/views/onco_lines/0/text", "a side in the line's text is not in its facts"],
    ]);
    const card = example();
    card.views!.timeline![0]!.title = "Seminář 12.10.2026";
    card.views!.timeline![0]!.detail = "Nález vpravo.";
    expect(validateRun(card).issues.map((i) => i.path)).toEqual(["/views/timeline/0/title", "/views/timeline/0/detail"]);
  });

  it("rejects a line date whose sort form is more precise than the date", () => {
    const run = example();
    run.views!.onco_lines![0]!.date = { as_written: "6/2022", precision: "month", sort: "2022-06-02" };
    expect(codes(run)).toEqual(["date_precision"]);
  });

  it("rejects a line filed under a date none of its facts has, and a planned line over facts that are not", () => {
    const run = example();
    const line = run.views!.onco_lines![0]!;
    line.date = { as_written: "3.6.2022", precision: "day", sort: "2022-06-03" };
    line.status = "planned";
    expect(codes(run)).toEqual(["view_line_date_unbacked", "view_line_status_mismatch"]);
    // The timeline card over a request is requested, so a "done" card would read as performed.
    const card = example();
    card.views!.timeline![0]!.status = "done";
    expect(codes(card)).toEqual(["view_line_status_mismatch"]);
  });

  it("rejects a quarantined fact in a line", () => {
    const run = example();
    (run.sources[0] as { identity: string }).identity = "conflicts";
    run.facts[0]!.quarantined = true;
    const subject = "10_pacient/p2#3";
    run.alerts.push({ id: alertId({ rule: "page_identity_conflict", subject }), rule: "page_identity_conflict", subject, kind: "identity", facts: ["f-8d41c2"], message: { id: "alert-identity-conflict", args: {} }, note: null });
    expect(codes(run)).toEqual([]);
    const line = run.views!.onco_lines![0]!;
    line.facts.push("f-8d41c2");
    line.id = viewLineId("onco_lines", line.facts);
    expect(codes(run)).toEqual(["quarantined_in_use"]);
  });

  it("rejects unknown fields and categories through the schema", () => {
    const run = example() as unknown as { views: { timeline: Record<string, unknown>[] } };
    run.views.timeline[0]!.category = "visit";
    run.views.timeline[0]!.colour = "red";
    expect(validateRun(run).issues.map((i) => i.path).sort()).toEqual(["/views/timeline/0/category", "/views/timeline/0/colour"]);
  });
});

describe("validator: case 10's composed lines", () => {
  const run10 = (): ExtractionRun => JSON.parse(JSON.stringify(run10Json));

  it("pass, and a line that loses the fact holding its dose fails", () => {
    const run = run10();
    expect(codes(run)).toEqual([]);
    const line = run.views!.onco_lines!.find((l) => l.text.startsWith("3. paliativní linie everolimus 5 mg"))!;
    const dose = run.facts.find((f) => f.kind === "medication" && f.value.strength === "5 mg" && f.value.dosing === "1-0-0")!;
    line.facts = line.facts.filter((id) => id !== dose.id);
    line.id = viewLineId("onco_lines", line.facts);
    expect(validateRun(run).issues.map((i) => i.message)).toEqual(["a number in the line's text is not in its facts"]);
  });

  it("a negation stays backed by the same word in another of its facts (the CT text says \"bez plicní embolie\")", () => {
    const run = run10();
    const line = run.views!.onco_lines!.find((l) => l.text.startsWith("CT angiografie plicnice: bez plicní embolie"))!;
    line.facts = line.facts.filter((id) => !run.facts.find((f) => f.id === id)!.negated);
    line.id = viewLineId("onco_lines", line.facts);
    expect(codes(run)).toEqual([]);
  });
});

describe("validator: brief sentences are backed by their facts", () => {
  it("rejects a sentence with a date its facts do not hold", () => {
    const run = example();
    run.brief!.sentences[0]!.text = "Patologické stadium pT2a pN1 M0 z 3.6.2022.";
    expect(codes(run)).toEqual(["sentence_unbacked"]);
  });

  it("reports a sentence without facts once, without judging its text", () => {
    const run = example();
    run.brief!.sentences.push({ text: "Bez zdroje 1.1.2020.", facts: [] });
    expect(codes(run)).toEqual(["sentence_without_facts"]);
  });
});
