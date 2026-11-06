import { describe, expect, it } from "vitest";
import { unprocessedCase, type CaseData } from "../src/case-data";
import { abbreviateCs } from "../src/abbreviate";
import { panelFlagsOf } from "../src/modality-checks";

const fact = (kind: string, value: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: `f-${Math.random()}`, kind, subject: "patient", value, date: { as_written: null, sort: null }, status: "documented", negated: false, certainty: "clear", origin: "document", sources: ["s1"], ...extra });
const cd = (...facts: ReturnType<typeof fact>[]): CaseData => ({
  ...unprocessedCase("T_pacient.pdf", "T"),
  refs: [{ page: 1, quote: "q" }],
  run: { run_id: "r", producer: "pipeline", facts: Object.fromEntries(facts.map((f) => [f.id, f])), view_line_ids: [], source_index: { s1: 0 }, shown_keys: [], checks: {} } as never,
});
const rules = (c: CaseData) => panelFlagsOf(c).flags.map((f) => f.rule);
const labels = (c: CaseData) => panelFlagsOf(c).flags.map((f) => f.label);
const dated = (as_written: string, sort: string) => ({ date: { as_written, sort } });

describe("panel flags", () => {
  it("names autoimmune cholangitis and primary biliary cholangitis, with source; a bacterial cholangitis is not one", () => {
    const f = panelFlagsOf(cd(fact("comorbidity", { text: "Primární biliární cholangitida, na ursodiolu" }))).flags[0]!;
    expect(f).toMatchObject({ rule: "autoimmune", label: "Primární biliární cholangitida", modalities: ["immuno"], source: { page: 1 } });
    expect(rules(cd(fact("comorbidity", { text: "Autoimunitní cholangoitida" })))).toEqual(["autoimmune"]);
    expect(rules(cd(fact("comorbidity", { text: "Akutní bakteriální cholangitida" })))).toEqual([]);
  });

  it("shows a low EF, FEV1 and DLCO as values, with no verdict in the label", () => {
    const c = cd(fact("imaging", { modality: "ECHO", region: "srdce", finding_text: "EF LK 30 %" }), fact("exam_finding", { text: "Spirometrie: FEV1 52 %, DLCO 48 %" }));
    expect(labels(c)).toEqual(["EF 30 %", "FEV1 52 %", "DLCO 48 %"]);
    expect(panelFlagsOf(c).missing).toEqual(["kidney"]);
  });

  it("reads FEV1 written with litres first", () => {
    expect(labels(cd(fact("exam_finding", { text: "Spirometrie 23.9.2026: FEV1 1,41 l (52 % n. h.), DLCO 48 % n. h." })))).toEqual(["FEV1 52 %", "DLCO 48 %"]);
  });

  it("lets the newest measurement decide: a recovered EF is not red, a fallen one is", () => {
    const old = fact("imaging", { finding_text: "EF 35 %" }, dated("3/2024", "2024-03"));
    const now = fact("imaging", { finding_text: "EF 60 %" }, dated("3/2026", "2026-03"));
    expect(rules(cd(old, now))).toEqual([]);
    expect(labels(cd(fact("imaging", { finding_text: "EF 60 %" }, dated("3/2024", "2024-03")), fact("imaging", { finding_text: "EF 35-40 %" }, dated("3/2026", "2026-03"))))).toEqual(["EF 35 %"]);
  });

  it("keeps unrelated percentages out", () => {
    const c = cd(fact("exam_finding", { text: "EF nezměřena, hematokrit 30 %" }), fact("exam_finding", { text: "FEV1/FVC 55 %" }));
    expect(rules(c)).toEqual([]);
    expect(panelFlagsOf(c).missing).toEqual(["ef", "lung", "kidney"]);
  });

  it("skips a negated fact, a denial in the clause, a relative's disease, a plan and look-alike words", () => {
    expect(rules(cd(
      fact("comorbidity", { text: "Autoimunitní onemocnění" }, { negated: true }),
      fact("comorbidity", { text: "Autoimunitní onemocnění neguje" }),
      fact("comorbidity", { text: "bez srdečního selhání" }),
      fact("family_history", { relation: "otec", condition: "revmatoidní artritida" }, { subject: "relative" }),
      fact("comorbidity", { text: "Revmatoidní artritida" }, { subject: "relative" }),
      fact("comorbidity", { text: "Lupus antikoagulans" }),
      fact("comorbidity", { text: "Steatohepatitida" }),
      fact("comorbidity", { text: "Podkožní emfyzém" }),
      fact("comorbidity", { text: "Infarkt sleziny" }),
    ))).toEqual([]);
  });

  it("keeps a real condition whose negation is about something else", () => {
    expect(rules(cd(fact("comorbidity", { text: "CHOPN, bez exacerbace" })))).toEqual(["copd"]);
  });

  it("flags toxicity of an earlier immunotherapy by the documents' link to the drug, and a positive HBsAg", () => {
    const c = cd(fact("adverse_event", { text: "plicní toxicita (IPP) 1.-2. stupně po 2. cyklu", grade: "1-2", related_therapy: "nivolumab + ipilimumab" }), fact("risk_factor", { type: "epidemiology", text: "HBsAg pozitivní" }));
    expect(rules(c)).toEqual(["immune-tox", "viral-hepatitis"]);
    expect(labels(c)[0]).toBe("plicní toxicita");
  });

  it("does not count a stopped drug, and counts a current one", () => {
    expect(rules(cd(fact("medication", { drug: "prednison", strength: "1 mg/kg" }, { status: "stopped" })))).toEqual([]);
    expect(rules(cd(fact("medication", { drug: "Eliquis", strength: "5 mg" })))).toEqual(["anticoagulant"]);
  });

  it("uses the document's own flag for the newest lab, and shortens only the unit", () => {
    const low = fact("lab_result", { name_as_written: "eGFR CKD-EPI", value_as_written: "1,01", unit: "ml/s/1,73 m2", out_of_range: "low" }, dated("1.1.2026", "2026-01-01"));
    expect(labels(cd(low))).toEqual(["eGFR 1,01 ml/s"]);
    const later = fact("lab_result", { name_as_written: "eGFR CKD-EPI", value_as_written: "1,4", unit: "ml/s", out_of_range: null }, dated("1.2.2026", "2026-02-01"));
    expect(rules(cd(low, later))).toEqual([]);
  });

  it("shows PS or Karnofsky as written, marked low at PS 2 or KPS 60, with a range by its worse end", () => {
    const ps = (scale: string, v: string) => panelFlagsOf(cd(fact("performance_status", { scale, value_as_written: v }))).performance;
    expect(ps("ECOG", "1")).toMatchObject({ label: "PS 1", low: false });
    expect(ps("ECOG", "1-2")).toMatchObject({ label: "PS 1-2", low: true });
    expect(ps("Karnofsky", "80")).toMatchObject({ label: "KPS 80", low: false });
    expect(ps("Karnofsky", "60")).toMatchObject({ label: "KPS 60", low: true });
  });

  it("takes a denial in any following clause, 'bez' only before the match, and labels a suspicion", () => {
    expect(rules(cd(fact("comorbidity", { text: "Revmatoidní artritida, vyloučena" })))).toEqual([]);
    expect(rules(cd(fact("comorbidity", { text: "Neguje DM, CHOPN" })))).toEqual([]);
    expect(rules(cd(fact("comorbidity", { text: "CHOPN bez exacerbací" })))).toEqual(["copd"]);
    expect(labels(cd(fact("comorbidity", { text: "Autoimunitní hepatitida, susp." })))).toEqual(["susp. Autoimunitní hepatitida"]);
    expect(labels(cd(fact("diagnosis", { text: "Sarkoidóza", disease_status: "suspected" })))).toEqual(["susp. Sarkoidóza"]);
  });

  it("counts an undated low value, reads the last value of a text, and ignores ratios", () => {
    expect(labels(cd(fact("imaging", { finding_text: "EF 30 %" }), fact("imaging", { finding_text: "EF 60 %" }, dated("3/2024", "2024-03"))))).toEqual(["EF 30 %"]);
    expect(labels(cd(fact("exam_finding", { text: "dříve EF 60 %, nyní EF 35 %" })))).toEqual(["EF 35 %"]);
    expect(rules(cd(fact("exam_finding", { text: "DLCO/VA 55 %" })))).toEqual([]);
  });

  it("keeps a dose whole, and catches and leaves the look-alikes the review found", () => {
    expect(labels(cd(fact("medication", { drug: "Eliquis", strength: "2,5 mg" })))).toEqual(["Eliquis 2,5 mg"]);
    const flagged = (text: string, kind = "comorbidity") => rules(cd(fact(kind, { text })));
    expect(flagged("ICHS")).toEqual(["heart-disease"]);
    expect(flagged("Tachyfibrilace síní")).toEqual(["heart-disease"]);
    expect(flagged("transplantace ledviny 2019", "procedure")).toEqual(["transplant"]);
    expect(flagged("HBsAg: pozitivní", "risk_factor")).toEqual(["viral-hepatitis"]);
    expect(flagged("Tubulointersticiální nefritida")).toEqual([]);
    expect(flagged("stav po infarktu sleziny")).toEqual([]);
    expect(flagged("anti-HCV neg.")).toEqual([]);
    expect(rules(cd(fact("comorbidity", { text: "CHOPN" }, { origin: "assistant" })))).toEqual([]);
  });

  it("does not hide cirrhosis behind a raised bilirubin, and folds words about the kidney into its value", () => {
    const bili = fact("lab_result", { name_as_written: "Bilirubin", value_as_written: "40", unit: "umol/l", out_of_range: "high" });
    expect(rules(cd(bili, fact("comorbidity", { text: "Jaterní cirhóza" })))).toEqual(["liver-lab", "liver"]);
    const egfr = fact("lab_result", { name_as_written: "eGFR", value_as_written: "0,7", unit: "ml/s", out_of_range: "low" });
    const f = panelFlagsOf(cd(egfr, fact("comorbidity", { text: "Chronické onemocnění ledvin" }))).flags;
    expect(f.map((x) => x.rule)).toEqual(["kidney-lab"]);
    expect(f[0]!.more).toBe(1);
    expect(f[0]!.dated).toBe(true);
  });

  it("reads PS from what is written: a date is no score, scales keep their names", () => {
    const ps = (v: Record<string, unknown>, extra = {}) => panelFlagsOf(cd(fact("performance_status", v, extra))).performance;
    expect(ps({ scale: "ECOG", value_as_written: "0 (12.3.2026)" })).toMatchObject({ low: false });
    expect(ps({ scale: "Karnofského index", value_as_written: "80 %", value_numeric: 80 })).toMatchObject({ label: "KPS 80 %", low: false });
    expect(ps({ scale: "Karnofsky", value_as_written: "KPS 70 %, ECOG 2" })).toMatchObject({ label: "KPS 70 %, ECOG 2", low: true });
    // The undated value leads: the current exam is rarely dated.
    const both = panelFlagsOf(cd(fact("performance_status", { scale: "ECOG", value_as_written: "0" }, dated("3/2024", "2024-03")), fact("performance_status", { scale: "ECOG", value_as_written: "2" }))).performance;
    expect(both).toMatchObject({ label: "PS 2", low: true });
  });

  it("gives nothing for a case without a run", () => {
    expect(panelFlagsOf(unprocessedCase("f.pdf", "X"))).toEqual({ performance: null, flags: [], missing: [] });
  });
});

describe("abbreviations", () => {
  it("says the common names short, and keeps the suspicion", () => {
    expect(abbreviateCs("Chronická obstrukční plicní nemoc")).toBe("CHOPN");
    expect(abbreviateCs("Podezření na intersticiální plicní postižení")).toBe("susp. IPP");
    expect(abbreviateCs("ACE inhibitory při léčbě everolimem")).toBe("ACEi při th. everolimem");
  });
  it("writes nodes as pN1 (3/5)", () => {
    expect(abbreviateCs("(pT2a pN1, 3 z 5 lymfatických uzlin pozitivní, M0)")).toBe("(pT2a pN1 (3/5), M0)");
  });
  it("does not touch longer words, other wordings or a number after ca", () => {
    expect(abbreviateCs("ústavu po výkonu; stav počáteční; zhoršení stavu po léčení; adenokarcinom; Reziduum karcinomu 12 mm")).toBe("ústavu po výkonu; stav počáteční; zhoršení stavu po léčení; adenokarcinom; Reziduum karcinomu 12 mm");
  });
  it("shortens common words only, and keeps values, dates and negations", () => {
    const s = "Stav po nefrektomii 6/2022, 3 z 5 lymfatických uzlin pozitivní; ložisko vlevo, suspektní z metastázy; bez metastáz, neguje závratě; chemoterapie od 1.1.2026, FEV1 52 %.";
    const out = abbreviateCs(s);
    expect(out).toBe("St.p. nefrektomii 6/2022, 3 z 5 LU pozitivní; ložisko l. sin., susp. z meta; bez meta, neguje závratě; CHT od 1.1.2026, FEV1 52 %.");
  });
  it("leaves other diseases written out, and words that only contain an entry", () => {
    expect(abbreviateCs("Hypertenzní nemoc, zleva, vlevo-")).toBe("Hypertenzní nemoc, zleva, l. sin.-");
  });
});
