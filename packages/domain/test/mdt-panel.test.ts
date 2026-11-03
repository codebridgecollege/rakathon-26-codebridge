import { describe, expect, it } from "vitest";
import { mdtPanelOf } from "../src/mdt-panel";
import { unprocessedCase, type CaseData } from "../src/case-data";

const ref = { page: 1, quote: "q" };
const caseWith = (record: Partial<NonNullable<CaseData["record"]>>): CaseData => ({ ...unprocessedCase("f.pdf", "NO-1"), refs: [ref], record: record as CaseData["record"] });

describe("MDT side panel", () => {
  it("has nothing to show for an unprocessed case: every part is missing, never empty", () => {
    expect(mdtPanelOf(unprocessedCase("f.pdf", "NO-1"))).toEqual({ ps: null, exams: null, treatments: null, contraindications: null, comorbidities: null, allergies: null });
    expect(mdtPanelOf(null).ps).toBeNull();
  });

  it("splits the timeline into exams and treatment, newest first, undated last, and keeps partial dates", () => {
    const p = mdtPanelOf(
      caseWith({
        timeline: [
          { date: "4/2022", date_sort: "2022-04", category: "imaging", title_cs: "CT", text_cs: "" },
          { date: "2.6.2022", date_sort: "2022-06-02", category: "surgery", title_cs: "Nefrektomie", text_cs: "" },
          { date: null, date_sort: null, category: "imaging", title_cs: "RTG", text_cs: "" },
          { date: "1.1.2023", date_sort: "2023-01-01", category: "pathology", title_cs: "Histologie", text_cs: "" },
          { date: "1.1.2027", date_sort: "2027-01-01", category: "systemic", title_cs: "Everolimus", text_cs: "", status: "planned" },
          { date: "1.2.2023", date_sort: "2023-02-01", category: "clinical", title_cs: "Kontrola", text_cs: "" },
        ],
      }),
    );
    expect(p.exams?.map((e) => e.title)).toEqual(["Histologie", "CT", "RTG"]);
    expect(p.exams?.[1]?.date).toBe("4/2022");
    expect(p.treatments?.map((e) => [e.title, e.planned])).toEqual([["Everolimus", true], ["Nefrektomie", false]]);
  });

  it("reads the performance status from the exam, with its source, and says nothing when it is not stated", () => {
    expect(mdtPanelOf(caseWith({ status_praesens: { items: [{ what: "ecog", text_cs: "PS (ECOG) 1", refs: [0] }] } })).ps).toMatchObject({ text: "PS (ECOG) 1", source: ref });
    expect(mdtPanelOf(caseWith({ status_praesens: { items: [] } })).ps).toBeNull();
  });

  it("lists contraindications, comorbidities and allergies; an unextracted anamnesis stays missing", () => {
    const p = mdtPanelOf(
      caseWith({
        anamnesis: {
          FA_warnings: [{ term_cs: "Nesteroidní antiflogistika", comment_cs: "", refs: [0] }],
          OA: [{ term_cs: "Srdeční selhání", comment_cs: "EF 30 %", refs: [0] }, { term_cs: "Hypertenze", comment_cs: "", refs: [] }],
          AA: [],
        },
      }),
    );
    expect(p.contraindications?.[0]).toMatchObject({ text: "Nesteroidní antiflogistika", source: ref });
    expect(p.comorbidities?.map((c) => c.text)).toEqual(["Srdeční selhání", "Hypertenze"]);
    expect(p.allergies).toEqual([]);
    expect(mdtPanelOf(caseWith({ anamnesis: null })).comorbidities).toBeNull();
  });

  it("keeps what the documents deny marked as denied: contraindications, comorbidities and timeline events", () => {
    const denied = { term_cs: "Lupus", comment_cs: "", negation_label: true, refs: [] };
    const p = mdtPanelOf(
      caseWith({
        anamnesis: { FA_warnings: [denied], OA: [denied] },
        timeline: [{ date: "1.1.2023", date_sort: "2023-01-01", category: "imaging", title_cs: "MTS", text_cs: "", negation_label: true }],
      }),
    );
    expect(p.contraindications?.[0]?.negated).toBe(true);
    expect(p.comorbidities?.[0]?.negated).toBe(true);
    expect(p.exams?.[0]?.negated).toBe(true);
  });
});
