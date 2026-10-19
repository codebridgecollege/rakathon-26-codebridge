import { describe, expect, it } from "vitest";
import { docTitle, fromExtraction, nrOf, sectionsOf, tabsFor, unprocessedCase } from "../src/case-data";
import type { ExtractionRun } from "../src/extraction/types";
import run10 from "../../../fixtures/data/runs/NO-010.json";
import runS01 from "../../../fixtures/data/runs/NO-S01.json";

// Synthetic values only (the converted fixtures of case 10 and S01).
const full = () =>
  fromExtraction("10_pacient.pdf", "NO-010", run10 as unknown as ExtractionRun, [
    { id: "10_pacient", file: "10_pacient.pdf", page_count: 5, note_cs: null, parts: [{ title_cs: "Zpráva", pages: [1, 2] }] },
  ]);

describe("case data", () => {
  it("builds a full case from a run", () => {
    const cd = full();
    expect(cd.level).toBe("full");
    expect(cd.brief?.text_cs).toMatch(/^Pacient s metastatickým/);
    expect(cd.brief?.reason_cs).toBeNull();
    expect(cd.documents?.pages).toBe(5);
  });

  it("a run that looked only at labs and requests has no record, so nothing reads as 'nothing found'", () => {
    const cd = fromExtraction("S01_pacient.pdf", "NO-S01", runS01 as unknown as ExtractionRun);
    expect(cd.level).toBe("partial");
    expect(cd.record).toBeNull();
    expect(cd.labs?.series?.draws).toHaveLength(4);
  });

  it("treats a case without a run as unprocessed, never as 'nothing found'", () => {
    const cd = fromExtraction("2_pacient.pdf", "NO-002", null);
    expect(cd).toEqual(unprocessedCase("2_pacient.pdf", "NO-002"));
    expect(sectionsOf(cd).alerts).toBe(false);
    expect(tabsFor(sectionsOf(cd))).toEqual(["prognosis"]);
  });

  it("shows the tabs the data supports, in the fixed order", () => {
    expect(tabsFor(sectionsOf(full()))).toEqual(["overview", "anamnesis", "documents", "labs", "alerts", "next", "dev", "prognosis"]);
    const syn = fromExtraction("S01_pacient.pdf", "NO-S01", runS01 as unknown as ExtractionRun);
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
