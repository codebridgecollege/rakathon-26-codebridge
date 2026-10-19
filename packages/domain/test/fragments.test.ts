// Fragments and the case merge (fragments.ts): the pipeline's own fragment from the lab parser's output, readability
// and identity per page, and the composition of several producers' fragments into one drafted run. Synthetic values.
import { describe, expect, it } from "vitest";
import { composeFragments, pipelineFragment, type Fragment, type ParsedLabs } from "../src/fragments";
import { FACT_KINDS, type DocumentSource } from "../src/extraction/types";

const point = (value: string, page: number, extra: Record<string, unknown> = {}) => ({
  value,
  unit: "g/l",
  reference_range: "120 ... 160",
  out_of_range: null,
  flagged_in_document: null,
  date: "2026-03-10",
  time: "07:25",
  certainty: "documented" as const,
  verify_reasons: [],
  code_as_written: "B_HB",
  source: { page, quote: `B_HB: ${value} g/l [120 ... 160]` },
  ...extra,
});

const LABS: ParsedLabs = {
  draws: [
    { date: "2026-03-10", time: "07:25", source: { page: 1, quote: "Odběr: 10.3.2026 07:25" } },
    { date: null, time: null, source: null },
  ],
  tests: [
    {
      code: "B_HB",
      reference_low: 120,
      reference_high: 160,
      points: [
        point("108", 1, { out_of_range: "low" }),
        point("13O", 2, { date: null, time: null, certainty: "unclear_ocr", verify_reasons: ["disagree"], readings: { text_of_record: "B_HB: 13O", text_layer: "B_HB: 130" } }),
      ],
    },
  ],
};

const base = {
  documentId: "up-1",
  sha256: "a".repeat(64),
  pipelineRun: "pl-1",
  engine: "tesseract 5.3.0 ces",
  parts: [{ part_id: "up-1/p0", pages: [1] }, { part_id: "up-1/p1", pages: [2] }],
  pages: [{ n: 1, level: "good" }, { n: 2, level: "poor" }],
  identity: [{ n: 1, result: "matches" as const }, { n: 2, result: "conflicts" as const }],
  documentIdentity: null,
  labs: LABS,
};

describe("pipelineFragment", () => {
  it("turns each parsed value into a lab fact with its passage, as written, and never invents a date", () => {
    const f = pipelineFragment(base);
    expect(f.facts).toHaveLength(2);
    const [a, b] = f.facts as any[];
    expect(a.value).toMatchObject({ name_as_written: "B_HB", value_as_written: "108", value_numeric: 108, unit_as_written: "g/l", out_of_range: "low", out_of_range_origin: "assistant", draw: { as_written: "10.3.2026 07:25" } });
    expect(a.date).toEqual({ as_written: "10.3.2026 07:25", precision: "minute", sort: "2026-03-10T07:25" });
    expect(a).toMatchObject({ certainty: "clear", quarantined: false, codes: [{ system: "fno-local-lab", code: "B_HB", assigned_by: "source" }] });
    // An unreadable value stays as written, is marked, has no number, and its missing draw date stays missing.
    expect(b.value).toMatchObject({ value_as_written: "13O", value_numeric: null });
    expect(b.date).toEqual({ as_written: null, precision: null, sort: null });
    // No draw header at all is "not stated"; the unit of an unsure reading is not repeated as the corrected one.
    expect(b.not_stated).toEqual(["draw"]);
    expect(b.value.unit).toBeNull();
    expect(b.certainty).toBe("verify");
    expect(b.certainty_reason.text).toMatch(/textové vrstvy PDF.*ověřte v originálu/);
    const src = new Map(f.sources.map((s) => [s.id, s as DocumentSource]));
    expect(src.get(a.sources[0])).toMatchObject({ document_id: "up-1", part: "up-1/p0", page: 1, quote_text: "tesseract", identity: "matches", reading_check: null });
    expect(src.get(b.sources[0])).toMatchObject({ part: "up-1/p1", page: 2, identity: "conflicts", reading_check: { mark: true, tokens: [{ tesseract: "B_HB: 13O", pdf_text: "B_HB: 130" }] } });
    // The value on the other patient's page is kept but held back, and the identity alert names it.
    expect(b.quarantined).toBe(true);
    expect(f.alerts.map((x) => [x.rule, x.subject, x.facts, x.message])).toEqual([
      ["poor_copy", "up-1", [], { id: "alert-poor-copy", args: { document: "up-1" } }],
      ["identity_conflict", "up-1", [b.draft_id], { id: "alert-identity-conflict", args: { document: "up-1", page: "2" } }],
    ]);
    expect(f.checks).toEqual([
      { id: "chk-pl-up-1-lab-result", looks_for: "lab_result", expected: null, covered: [{ document_id: "up-1", part: "up-1/p0" }, { document_id: "up-1", part: "up-1/p1" }], unreadable: [{ document_id: "up-1", part: "up-1/p1", page: 2 }], result: "found" },
    ]);
  });

  it("says not_run, never nothing_found, when a document has no lab sheet, and raises no alert for a clean copy", () => {
    const f = pipelineFragment({ ...base, labs: { draws: [], tests: [] }, pages: [{ n: 1, level: "good" }], identity: [{ n: 1, result: "matches" }] });
    expect(f.checks[0]!.result).toBe("not_run");
    expect(f.alerts).toEqual([]);
  });
});

describe("composeFragments", () => {
  it("merges checks per kind, lists every kind, and gathers every producer's held-back facts under one identity alert", () => {
    const pl = pipelineFragment(base);
    const ai: Fragment = {
      schema: "codebridge.fragment/1",
      producer: "ai",
      document_id: "up-1",
      document_sha256: base.sha256,
      pipeline_run: "pl-1",
      parts: ["up-1/p0", "up-1/p1"],
      stages: [{ name: "extract_facts", model: "m-1", prompt: "extract@1" }],
      sources: [{ id: "src-ai-up-1-0", type: "document", document_id: "up-1", part: "up-1/p1", page: 2, quote: "cizí nález", quote_text: "vision", anchor: null, reported_as: "original", identity: "conflicts", reading_check: null }],
      facts: [{ draft_id: "ai:up-1:0", kind: "symptom", subject: "patient", value: { text: "cizí nález" }, date: { as_written: null, precision: null, sort: null }, status: "documented", negated: false, not_stated: [], origin: "document", certainty: "clear", codes: [], note: null, quarantined: true, sources: ["src-ai-up-1-0"] } as any],
      checks: [
        { id: "x", looks_for: "symptom", expected: null, covered: [{ document_id: "up-1", part: "up-1/p1" }], unreadable: [], result: "found" },
        { id: "y", looks_for: "lab_result", expected: null, covered: [], unreadable: [], result: "nothing_found" },
      ],
      alerts: [],
    };
    const d = composeFragments("B-NO-A", "pipeline-B-NO-A-1", "2026-10-20T08:00:00Z", [pl, ai]);
    expect(d.documents).toEqual([{ document_id: "up-1", sha256: base.sha256, parts: ["up-1/p0", "up-1/p1"] }]);
    expect(d.facts).toHaveLength(3);
    expect(d.run.stages.map((s) => s.name)).toEqual(["page_reader", "extract_facts", "case_merge"]);
    const byKind = new Map(d.checks.map((c) => [c.looks_for, c]));
    expect(byKind.size).toBe(FACT_KINDS.length);
    // "found" wins over "nothing found"; covered parts are the union; a kind nobody looked for is "not run".
    expect(byKind.get("lab_result")!.result).toBe("found");
    expect(byKind.get("symptom")!.result).toBe("found");
    expect(byKind.get("allergy")!.result).toBe("not_run");
    const identity = d.alerts.filter((a) => a.rule === "identity_conflict");
    expect(identity).toHaveLength(1);
    expect(identity[0]!.facts.sort()).toEqual([pl.facts[1]!.draft_id, "ai:up-1:0"].sort());
    expect(d.alerts.filter((a) => a.rule === "poor_copy")).toHaveLength(1);
  });

  it("raises an identity alert when a producer holds facts back on a document the pipeline found no conflict in", () => {
    const pl = pipelineFragment({ ...base, identity: [] });
    const held = { ...pl, facts: pl.facts.map((f) => ({ ...f, quarantined: true })), alerts: [] };
    held.sources = held.sources.map((s) => ({ ...s, identity: "conflicts" as const }));
    const d = composeFragments("B-NO-A", "r", "2026-10-20T08:00:00Z", [held]);
    expect(d.alerts).toEqual([
      { rule: "identity_conflict", subject: "up-1", kind: "identity", facts: held.facts.map((f) => f.draft_id), message: { id: "alert-identity-conflict", args: { document: "up-1", page: "1, 2" } }, note: null },
    ]);
  });

  it("says nothing found only when every document of the run said so", () => {
    const frag = (doc: string, result: "found" | "nothing_found" | "not_run"): Fragment => ({
      schema: "codebridge.fragment/1", producer: "ai", document_id: doc, document_sha256: null, pipeline_run: "pl", parts: [], stages: [], sources: [], facts: [],
      checks: [{ id: "c", looks_for: "allergy", expected: null, covered: [], unreadable: [], result }], alerts: [],
    });
    const pending = { ...frag("up-2", "not_run"), producer: "pipeline" as const, checks: [] };
    expect(composeFragments("C", "r", "2026-10-20T08:00:00Z", [frag("up-1", "nothing_found"), pending]).checks.find((c) => c.looks_for === "allergy")!.result).toBe("not_run");
    expect(composeFragments("C", "r", "2026-10-20T08:00:00Z", [frag("up-1", "nothing_found"), frag("up-2", "nothing_found")]).checks.find((c) => c.looks_for === "allergy")!.result).toBe("nothing_found");
    expect(composeFragments("C", "r", "2026-10-20T08:00:00Z", [frag("up-1", "nothing_found"), frag("up-2", "found")]).checks.find((c) => c.looks_for === "allergy")!.result).toBe("found");
  });

  it("keeps one alert per rule and subject when two producers raise it", () => {
    const pl = pipelineFragment(base);
    const ai = { ...pl, producer: "ai" as const, facts: [], sources: [], checks: [], alerts: pl.alerts.filter((a) => a.rule === "poor_copy") };
    expect(composeFragments("C", "r", "2026-10-20T08:00:00Z", [pl, ai]).alerts.filter((a) => a.rule === "poor_copy")).toHaveLength(1);
  });
});

describe("pipelineFragment and the document's identity", () => {
  it("holds back every page of a document the registry or an earlier reading found to be another patient's", () => {
    const f = pipelineFragment({ ...base, identity: [], documentIdentity: "conflicts" });
    expect(f.facts.every((x) => x.quarantined)).toBe(true);
    expect(f.alerts.find((a) => a.rule === "identity_conflict")!.message.args).toEqual({ document: "up-1", page: "1, 2" });
    // A later reading that sees no conflict does not clear it either.
    const later = pipelineFragment({ ...base, identity: [{ n: 1, result: "matches" }, { n: 2, result: "matches" }], documentIdentity: "conflicts" });
    expect(later.facts.every((x) => x.quarantined)).toBe(true);
  });

  it("takes a printed H or L as the document's flag, keeps a mark without direction in the note, and marks an unreadable draw date instead of calling it not stated", () => {
    const labs: ParsedLabs = {
      draws: [{ date: null, time: null, source: { page: 1, quote: "Odběr: 1O.3.2026" }, certainty: "unclear_ocr", requisition_quote: "S02-260310-01" }],
      tests: [
        { code: "S_K", reference_low: null, reference_high: null, points: [point("<0,5", 1, { flagged_in_document: true, flag_as_written: "L", date: null, time: null, certainty: "unclear_ocr", verify_reasons: ["draw_date_unreadable"] })] },
        { code: "S_NA", reference_low: null, reference_high: null, points: [point("150", 1, { flagged_in_document: true, flag_as_written: "*", date: null, time: null, certainty: "unclear_ocr", verify_reasons: ["draw_date_unreadable"] })] },
      ],
    };
    const [k, na] = pipelineFragment({ ...base, labs, identity: [] }).facts as any[];
    expect(k.value).toMatchObject({ out_of_range: "low", out_of_range_origin: "document", value_numeric: null, draw: { requisition: "S02-260310-01" } });
    expect(k.not_stated).toEqual([]);
    expect(k.certainty_reason.text).toMatch(/datum odběru nečitelné/);
    expect(na.value).toMatchObject({ out_of_range: null, out_of_range_origin: null });
    expect(na.note).toBe("Na listu označeno „*“.");
  });

  it("leaves out a fragment of another format and lists each part once", () => {
    const pl = pipelineFragment(base);
    const twice = { ...pl, producer: "ai" as const, facts: [], sources: [], alerts: [] };
    const odd = { ...pl, schema: "codebridge.fragment/2" } as unknown as Fragment;
    const d = composeFragments("C", "r", "2026-10-20T08:00:00Z", [pl, twice, odd]);
    expect(d.facts).toHaveLength(pl.facts.length);
    expect(d.checks.find((c) => c.looks_for === "lab_result")!.covered).toEqual(pl.checks[0]!.covered);
  });
});

