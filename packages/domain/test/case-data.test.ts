import { describe, expect, it } from "vitest";
import { docTitle, fromExtraction, fromFullExtraction, fromSyn, nrOf, sectionsOf, tabsFor, unprocessedCase } from "../src/case-data";

// Synthetic values only.
const full = () =>
  fromFullExtraction(
    "10_pacient.pdf",
    "NO-010",
    { page_count: 5, labs: [{ name_cs: "Kreatinin", value: "107", source: { file: "10_pacient.pdf", page: 3 } }], flags: [{ kind: "missing", text_cs: "Chybí MR." }], sections: { imaging: [] }, timeline: [{ type: "diagnosis", label_cs: "Diagnóza", date: "4/2022" }] },
    { onco_summary_v3_cs: "Souhrn [1].", onco_summary_v3_refs: [{ file: "10_pacient.pdf", page: 1, quote: "q" }], refs: [{ file: "10_pacient.pdf", page: 1, quote: "r" }], data_gaps_v3: [{ kind: "missing", text_cs: "Věk neuveden." }], documents: [{ title_cs: "Zpráva", pages: [1, 2] }] },
  );

describe("case data", () => {
  it("maps a full extraction, keeping a missing part null rather than empty", () => {
    const cd = full();
    expect(cd.level).toBe("full");
    expect(cd.brief?.text_cs).toBe("Souhrn [1].");
    expect(cd.brief?.reason_cs).toBeNull();
    expect(cd.record?.status_praesens).toBeNull();
    expect(cd.record?.anamnesis).toBeNull();
    expect(cd.alerts?.gaps).toHaveLength(1);
    expect(cd.documents?.pages).toBe(5);
  });

  it("maps the older timeline shape once, so every reader sees one event shape", () => {
    const ev = full().record!.timeline[0]!;
    expect(ev).toMatchObject({ kind: "diagnosis", title_cs: "Diagnóza", text_cs: "Diagnóza", status: "done", date: "4/2022" });
  });

  it("never lets a synthetic or single-draw lab series into the case data, so no chart is invented", () => {
    const draws = [{ date: "2026-01-08" }, { date: "2026-05-12" }];
    expect(fromSyn({ labs_series: { draws, tests: [] } }, "S01_pacient.pdf", "NO-S01").labs?.series).toBeTruthy();
    expect(fromSyn({ labs_series: { draws, tests: [], synthetic: true } }, "S01_pacient.pdf", "NO-S01").labs).toBeNull();
    expect(fromSyn({ labs_series: { draws: draws.slice(0, 1), tests: [] } }, "S01_pacient.pdf", "NO-S01").labs).toBeNull();
  });

  it("treats a case without a run as unprocessed, never as 'nothing found'", () => {
    const cd = fromExtraction("2_pacient.pdf", "NO-002", null);
    expect(cd).toEqual(unprocessedCase("2_pacient.pdf", "NO-002"));
    expect(sectionsOf(cd).alerts).toBe(false);
    expect(tabsFor(sectionsOf(cd))).toEqual(["prognosis"]);
  });

  it("shows the tabs the data supports, in the fixed order", () => {
    expect(tabsFor(sectionsOf(full()))).toEqual(["documents", "labs", "alerts", "next", "dev", "prognosis"]);
    const syn = fromSyn({ documents: [{ title_cs: "A" }], data_gaps: [], labs_series: { draws: [{ date: "a" }, { date: "b" }], tests: [] } }, "S01_pacient.pdf", "NO-S01");
    expect(tabsFor(sectionsOf(syn))).toEqual(["documents", "labs", "alerts", "prognosis"]);
  });

  it("names a reference by the document holding its page, else by its file", () => {
    const cd = full();
    const docs = (f: string) => (f === "10_pacient.pdf" ? cd.documents : null);
    expect(docTitle({ file: "10_pacient.pdf", page: 2 }, docs, "10_pacient.pdf")).toBe("Zpráva");
    expect(docTitle({ file: "10_pacient.pdf", page: 5 }, docs, "10_pacient.pdf")).toBe("10_pacient.pdf");
    // A reference without a file points into the open case.
    expect(docTitle({ page: 1 }, docs, "10_pacient.pdf")).toBe("Zpráva");
  });

  it("derives the link number of a case", () => {
    expect(nrOf("10_pacient.pdf")).toBe("10");
    expect(nrOf("S01_pacient.pdf")).toBe("S01");
  });
});
