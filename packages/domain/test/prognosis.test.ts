import { describe, expect, it } from "vitest";
import { factsDiffer, findSaved, isIsoDay, isMissing, pgDimensions, pgLayout, pgUrl, type PgRow } from "../src/prognosis";

describe("pgUrl", () => {
  it("keeps https links only", () => {
    expect(pgUrl("https://pubmed.ncbi.nlm.nih.gov/26406150/")).toBe("https://pubmed.ncbi.nlm.nih.gov/26406150/");
    for (const bad of ["http://pubmed.ncbi.nlm.nih.gov/1", "javascript:alert(1)", "data:text/html,x", "ftp://x.org/a", "not a url", "", null, undefined, 42])
      expect(pgUrl(bad), String(bad)).toBe("");
  });

  it("refuses links carrying credentials", () => {
    expect(pgUrl("https://user:pw@example.org/")).toBe("");
    expect(pgUrl("https://user@example.org/")).toBe("");
  });
});

const study = (extra: Partial<PgRow> = {}): PgRow => ({ study_title: "Study A", arm: "Arm 1", endpoints: {}, ...extra });

describe("reference numbering", () => {
  it("numbers values in reading order and reuses a number for the same passage of the same study", () => {
    const quote = "Median PFS was 7.4 months and ORR 17%.";
    const rows = [
      study({
        endpoints: {
          pfs: { value: 7.4, unit: "months", quote, source_url: "https://x.org/a" },
          orr: { value: 17, unit: "%", quote, source_url: "https://x.org/a" },
          os_12: { value: 60, unit: "%", quote: "OS at 12 months 60%", source_url: "https://x.org/a" },
        },
      }),
      // The same passage in another study is another reference.
      study({ study_title: "Study B", endpoints: { pfs: { value: 7.4, unit: "months", quote, source_url: "https://x.org/a" } } }),
    ];
    const l = pgLayout(rows);
    // os_12 is read before pfs and orr (column order).
    expect(l.rows[0]!.cells).toMatchObject({ os_12: 1, pfs: 2, orr: 2 });
    expect(l.rows[1]!.cells.pfs).toBe(3);
    expect(l.refs).toHaveLength(3);
    expect(l.refs[1]!.what).toEqual([
      { arm: "Arm 1", name: { key: "pfs" }, value: "7.4", unit: "months" },
      { arm: "Arm 1", name: { key: "orr" }, value: "17", unit: "%" },
    ]);
  });

  it("numbers the conflict values before the endpoint cells and names unknown fields as sent", () => {
    const l = pgLayout([
      study({
        endpoints: { pfs: { value: 5, unit: "months", quote: "q2" } },
        conflicts: [{ field: "odd_field", values: [{ value: 3, quote: "q1" }, { value: null, quote: "q3" }] }],
      }),
    ]);
    expect(l.rows[0]!.conflicts).toEqual([[1, null]]);
    expect(l.rows[0]!.cells.pfs).toBe(2);
    expect(l.refs[0]!.what[0]!.name).toEqual({ raw: "odd_field" });
  });

  it("keeps missing values missing: no number, no reference, no zero", () => {
    expect(isMissing(null)).toBe(true);
    expect(isMissing({ value: "" })).toBe(true);
    expect(isMissing({ value: 0 })).toBe(false);
    const l = pgLayout([study({ endpoints: { os_6: null, os_60: { value: null, quote: "x" }, pfs: { value: "" } } })]);
    expect(l.refs).toEqual([]);
    expect(Object.values(l.rows[0]!.cells).every((n) => n === null)).toBe(true);
  });

  it("gives each similarity and variant its own panel, in row order", () => {
    const s1 = { score: 71 }, s2 = { score: 40 }, s3 = { score: 10 };
    const l = pgLayout([study({ similarity: s1, similarity_variants: [{ similarity: s2 }, { similarity: null }] }), study({ similarity: null }), study({ similarity: s3 })]);
    // A variant without a nested similarity is itself the similarity.
    expect(l.rows.map((r) => r.panel)).toEqual([0, null, 3]);
    expect(l.rows[0]!.variantPanels).toEqual([1, 2]);
    expect(l.panels.map((p) => p.similarity)).toEqual([s1, s2, { similarity: null }, s3]);
  });
});

describe("similarity dimensions", () => {
  it("reads a list and an object map into one shape", () => {
    const list = pgDimensions({ dimensions: [{ key: "histology", status: "match", explanation: "Shodná histologie.", patient_quote: "ccRCC" }] });
    expect(list[0]).toEqual({ label: null, key: "histology", name: "", status: "match", reason: "Shodná histologie.", patient_quote: "ccRCC", study_quote: null });
    const map = pgDimensions({ dimensions: { stage: "unknown", age: { status: "mismatch", reason: "r" } } });
    expect(map.map((d) => [d.name, d.status, d.reason])).toEqual([["stage", "unknown", null], ["age", "mismatch", "r"]]);
    expect(pgDimensions(null)).toEqual([]);
  });

  it("keeps an unknown status missing rather than guessing one", () => {
    expect(pgDimensions({ dimensions: [{ key: "stage" }] })[0]!.status).toBeNull();
  });
});

describe("saved searches", () => {
  const saved = [
    { patient_id: "10_pacient.pdf", scheduled_date: "2026-10-22", result: { rows: [{}], profile: { facts: [1] } } },
    { patient_id: "10_pacient.pdf", scheduled_date: "2026-10-29", result: { rows: [] } },
  ];
  it("matches patient and day, and a search with no rows is none", () => {
    expect(findSaved(saved, "10_pacient.pdf", "2026-10-22")).toBe(saved[0]);
    expect(findSaved(saved, "10_pacient.pdf", "2026-10-29")).toBeNull();
    expect(findSaved(saved, "10_pacient.pdf", undefined)).toBeNull();
    expect(findSaved(saved, "11_pacient.pdf", "2026-10-22")).toBeNull();
  });
  it("compares facts as sent", () => {
    expect(factsDiffer([{ a: 1 }], [{ a: 1 }])).toBe(false);
    expect(factsDiffer([{ a: 1 }], [{ a: 2 }])).toBe(true);
  });
  it("formats full ISO days only", () => {
    expect(isIsoDay("2015-09-25")).toBe(true);
    expect(isIsoDay("2015-09")).toBe(false);
  });
});
