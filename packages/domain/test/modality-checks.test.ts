import { describe, expect, it } from "vitest";
import { unprocessedCase, type CaseData } from "../src/case-data";
import { modalityChecksOf } from "../src/modality-checks";

const base = unprocessedCase("T_pacient.pdf", "T");
const cd = (over: Partial<NonNullable<CaseData["record"]>>, labs: CaseData["labs"] = null): CaseData => ({
  ...base,
  refs: [{ page: 1, quote: "q" }],
  record: { onco_compact: null, onco_detailed: [], status_praesens: null, timeline: [], timeline_source: [], anamnesis: null, sections: null, patient: {}, diagnosis: null, mdt_question: {}, ocr_quality_note: null, ...over },
  labs,
});
const fact = (term_cs: string, comment_cs = "", extra: Record<string, unknown> = {}) => ({ term_cs, comment_cs, refs: [0], ...extra });
const mods = (c: CaseData) => modalityChecksOf(c).checks.map((x) => [x.modality, x.findings.map((f) => f.rule)]);

describe("modality checks", () => {
  it("finds an autoimmune disease for immunotherapy, with its source", () => {
    const r = modalityChecksOf(cd({ anamnesis: { OA: [fact("Autoimunitní cholangoitida")] } }));
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]!.modality).toBe("immuno");
    expect(r.checks[0]!.findings[0]).toMatchObject({ rule: "autoimmune", text: "Autoimunitní cholangoitida", source: { page: 1 } });
  });

  it("reads EF and spirometry values and applies the shown limits", () => {
    const c = cd({ timeline: [{ i: 1, title_cs: "Echokardiografie: EF LK 30 %", text_cs: "", category: "imaging" }, { i: 2, title_cs: "Spirometrie: FEV1 52 % N, DLCO 48 %", text_cs: "", category: "laboratory" }] as never });
    expect(mods(c)).toEqual([["chemo", ["ef-low"]], ["radio", ["fev1-low", "dlco-low"]], ["surgery", ["ef-low", "fev1-low", "dlco-low"]]]);
    expect(modalityChecksOf(c).missing).toEqual(["kidney"]);
  });

  it("does not match a normal value, or a negated fact", () => {
    const c = cd({ anamnesis: { OA: [fact("Autoimunitní onemocnění", "", { negation_label: true })] }, timeline: [{ i: 1, title_cs: "EF LK 62 %", text_cs: "" }] as never });
    expect(mods(c)).toEqual([]);
  });

  it("lists data the documentation lacks as missing, and says nothing of a clean record", () => {
    const r = modalityChecksOf(cd({ anamnesis: { OA: [fact("Hypertenzní nemoc")] } }));
    expect(r.checks).toEqual([]);
    expect(r.missing).toEqual(["ef", "spirometry", "kidney"]);
    expect(modalityChecksOf(base)).toEqual({ checks: [], missing: [] });
  });

  it("uses the document's own out-of-range flag for labs, and PS 2 or worse", () => {
    const labs = { note_cs: null, series: null, values: [{ name_cs: "eGFR", value: "0,7", unit: "ml/s", out_of_range: "low", source: { page: 1 } }, { name_cs: "Neutrofily", value: "4", unit: "", out_of_range: null, source: { page: 1 } }] } as never;
    const c = cd({ status_praesens: { items: [{ what: "ecog", text_cs: "ECOG 2", refs: [0] }] } as never }, labs);
    expect(mods(c)).toEqual([["immuno", ["ps"]], ["chemo", ["ps", "kidney"]], ["surgery", ["ps"]]]);
    expect(modalityChecksOf(c).missing).toEqual(["ef", "spirometry"]);
  });

  it("ignores a negation written in the comment, family history, and look-alike words", () => {
    const c = cd({
      anamnesis: {
        OA: [fact("Autoimunitní onemocnění", "neguje"), fact("Kardiomyopatie", "bez srdečního selhání"), fact("Lupus antikoagulans"), fact("Steatohepatitida")],
        RA: [fact("Revmatoidní artritida", "otec")],
      },
    });
    expect(mods(c)).toEqual([]);
  });

  it("reads EF ranges and keeps unrelated percentages out", () => {
    const low = cd({ timeline: [{ i: 1, title_cs: "Echo: EF 30-35 %", text_cs: "" }] as never });
    expect(mods(low)[0]).toEqual(["chemo", ["ef-low"]]);
    const other = cd({ timeline: [{ i: 1, title_cs: "EF nezměřena, hematokrit 30 %", text_cs: "" }] as never });
    expect(mods(other)).toEqual([]);
    expect(modalityChecksOf(other).missing).toContain("ef");
    const ratio = cd({ timeline: [{ i: 1, title_cs: "FEV1/FVC 55 %", text_cs: "" }] as never });
    expect(mods(ratio)).toEqual([]);
  });

  it("marks a suspicion as one, and carries the date", () => {
    const c = cd({ anamnesis: { OA: [fact("Podezření na intersticiální plicní postižení", "", { date: "22.5.2026" })] } });
    const f = modalityChecksOf(c).checks[0]!.findings[0]!;
    expect(f.why_cs).toContain("podezření");
    expect(f.date).toBe("22.5.2026");
  });
});
