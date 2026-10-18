import { describe, expect, it } from "vitest";
import { byTier, categoriesOf, clampable, fieldOf, markQuote, quoteLang, tierCodes, tiersOf } from "../src/guideline";

// Evidence strings as the synthetic guidance data prints them (api/seed/out/objects/guidance/NO-010.json).
const rec = (evidence: string) => ({ type: "recommendation", evidence });

describe("strength tiers", () => {
  it.each([
    ["EANO: I, A; ESMO: I, A", [0]],
    ["EANO: IV, C; ESMO: IV, B", [1, 2]],
    ["EANO: IV, n/a; ESMO: V, B", [1]],
    ["EANO: III, D; ESMO: IV, E", [3]],
    ["Strong recommendation (as stated in the abstract)", [0]],
    ["Conditional recommendation (as stated in the abstract)", [2]],
    ["weak recommendation", [2]],
    ["LoE 1, strong recommendation, strong consensus", [0]],
    ["LoE 3, strong recommendation, strong consensus", [0]],
    ["Class I, Level A", [0]],
    ["Class IIa, Level B", [1]],
    ["Class IIb, Level C", [2]],
    ["Class III, Level A", [0]],
    ["ČOS 2A", [3]],
    ["stupeň ČOS u každého léku: 2A, 2A, 2B, 2B, 2B", [3]],
    ["NCCN category 1", [3]],
    ["Strength and evidence quality are not stated in the abstract", [3]],
    ["", [3]],
  ])("%j maps to %j", (evidence, tiers) => {
    expect(tiersOf(rec(evidence))).toEqual(tiers);
  });

  it("treats chapter text as unstated, whatever its evidence text says", () => {
    expect(tiersOf({ type: "guideline_text", evidence: "Class I, Level A" })).toEqual([3]);
  });

  it("names a statement graded twice as a range from the strongest to the weakest", () => {
    expect(tierCodes(rec("EANO: IV, C; ESMO: IV, B"))).toEqual({ from: "moderate", to: "weak" });
    expect(tierCodes(rec("EANO: I, A; ESMO: I, A"))).toEqual({ from: "strong", to: null });
    expect(tierCodes(rec("ČOS 2A"))).toEqual({ from: "unstated", to: null });
  });
});

describe("ČOS and NCCN categories", () => {
  it("lists each category once, in the order given", () => {
    expect(categoriesOf(rec("stupeň ČOS u každého léku: 2A, 2A, 2B, 2B, 2B"))).toEqual(["2A", "2B"]);
    expect(categoriesOf(rec("ČOS 2A"))).toEqual(["2A"]);
    expect(categoriesOf(rec("NCCN category 1"))).toEqual(["1"]);
    expect(categoriesOf(rec("EANO: I, A; ESMO: I, A"))).toEqual([]);
  });
});

describe("order by strength", () => {
  it("puts the strongest first, a range after a single tier of the same strength, then the data's order", () => {
    const xs = [
      { id: "text", type: "guideline_text", evidence: "" },
      { id: "range", ...rec("EANO: I, A; ESMO: IV, B") },
      { id: "weak", ...rec("Class IIb, Level C") },
      { id: "strong1", ...rec("Class I, Level A") },
      { id: "cos", ...rec("ČOS 2A") },
      { id: "strong2", ...rec("Strong recommendation") },
    ];
    expect(byTier(xs).map((x) => x.id)).toEqual(["strong1", "strong2", "range", "weak", "text", "cos"]);
  });
});

describe("field", () => {
  it("is oncology unless the guideline names another", () => {
    expect(fieldOf({})).toBe("oncology");
    expect(fieldOf(null)).toBe("oncology");
    expect(fieldOf({ field: "hepatology" })).toBe("hepatology");
  });
});

describe("clamping", () => {
  const long = (s: string) => s + " " + "x".repeat(200);
  it("clamps only long quotes", () => {
    expect(clampable("Short quote.")).toBe(false);
    expect(clampable(long("Patients should be treated with SRS"))).toBe(true);
    expect(clampable(null)).toBe(false);
  });

  it.each(["if", "unless", "provided", "except", "pokud", "při", "kromě", "If", "PŘI"])("never clamps a quote with the condition word %j", (w) => {
    expect(clampable(long(`Treatment is recommended ${w} the patient agrees`))).toBe(false);
  });

  it("does not take a word that only contains a condition word for one", () => {
    expect(clampable(long("Specific treatment differs in prices"))).toBe(true);
    expect(clampable(long("Přijetí léčby"))).toBe(true);
  });
});

describe("quote in the page text", () => {
  it("finds the quote across line breaks and keeps the text around it unchanged", () => {
    const r = markQuote("Intro. SRS is\nrecommended (1-4) [EANO: I, A]. Rest.", "SRS is recommended (1-4) [EANO: I, A].");
    expect(r).toEqual({ before: "Intro. ", hit: "SRS is\nrecommended (1-4) [EANO: I, A].", after: " Rest." });
  });

  it("leaves the page unmarked when the quote is not in it", () => {
    expect(markQuote("Other text.", "Missing quote")).toEqual({ before: "Other text.", hit: null, after: "" });
  });
});

describe("quote language", () => {
  it("follows an explicit language, else the region, else names none", () => {
    expect(quoteLang({ lang: "sk", region: "CZ" })).toBe("sk");
    expect(quoteLang({ region: "CZ" })).toBe("cs");
    expect(quoteLang({ region: "EU" })).toBe("en");
    expect(quoteLang({ region: "US" })).toBe("en");
    expect(quoteLang({})).toBeUndefined();
    expect(quoteLang(null)).toBeUndefined();
  });
});
