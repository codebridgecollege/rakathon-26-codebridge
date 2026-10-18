// Quote matching on Czech OCR-like text (synthetic). The quote comes from the PDF's old text layer, with its reading
// errors; the match must find the right place or say it found none, never a plausible wrong place.
import { describe, expect, it } from "vitest";
import { canon, isEmptyPage, lineBoxes, matchImage, matchText, quoteTokens, verifyOf, type Box, type Word } from "../src/quote-match";

// Words laid out on one line each, 20 px apart vertically, 10 px per character.
function wordsOf(lines: string[]): Word[] {
  const out: Word[] = [];
  lines.forEach((ln, row) => {
    let x = 100;
    for (const t of ln.split(" ")) {
      out.push({ t, b: [x, 100 + row * 30, t.length * 10, 18] as Box });
      x += t.length * 10 + 8;
    }
  });
  return out;
}

describe("canon", () => {
  it("drops case, accents and punctuation and folds O/0 and l/1/i", () => {
    expect(canon("Žlučník,")).toBe("z1ucn1k");
    expect(canon("MO")).toBe(canon("M0"));
    expect(canon("lmg/kg")).toBe(canon("1mg/kg"));
    expect(quoteTokens("  T2 N1 - MO ")).toEqual(["t2", "n1", "m0"]);
  });
});

describe("matchText", () => {
  const text = "# **Ambulantní vyšetření**\n\nSubj. everolimus toleruje dobře, nemá s ním problém.\nStadium: cT2 N1 M0, bez známek progrese.";

  it("finds an exact quote and returns its character range", () => {
    const m = matchText("everolimus toleruje dobře", text)!;
    expect(m.method).toBe("exact");
    expect(m.ambiguous).toBe(false);
    expect(text.slice(m.range[0], m.range[1])).toBe("everolimus toleruje dobře,");
  });

  it("matches a quote with O/0 and l/1 misreads as exact", () => {
    const m = matchText("cT2 Nl MO", text)!;
    expect(m.method).toBe("exact");
    expect(text.slice(m.range[0], m.range[1])).toBe("cT2 N1 M0,");
  });

  it("matches a misread word approximately with its score", () => {
    const m = matchText("everolimus toleruje dobrže nemá s ním problém", text)!;
    expect(m.method).toBe("overlap");
    expect(m.score).toBeGreaterThanOrEqual(0.9);
    expect(m.score).toBeLessThan(1);
    expect(text.slice(m.range[0], m.range[1])).toBe("everolimus toleruje dobře, nemá s ním problém.");
  });

  it("marks a quote that occurs twice as ambiguous and points at the first place", () => {
    const t = "Bez známek progrese. Kontrola za 3 měsíce. Bez známek progrese.";
    const m = matchText("bez známek progrese", t)!;
    expect(m).toMatchObject({ method: "exact", ambiguous: true, range: [0, 20] });
  });

  it("returns null below 60 % of the quote, instead of a plausible wrong place", () => {
    expect(matchText("pacient odmítá chemoterapii a radioterapii zcela", text)).toBeNull();
    expect(matchText("", text)).toBeNull();
    expect(matchText("everolimus", "")).toBeNull();
  });

  it("picks the lab row with the quoted number when rows differ only in the number", () => {
    const lab = "| S_ALT | 0.45 | ukat/l | [0 ... 0.7] |\n| S_ALT | 0.48 | ukat/l | [0 ... 0.7] |\n| S_ALT | 0.41 | ukat/l | [0 ... 0.7] |";
    // The quote misreads the unit, so no run matches exactly; only the value tells the rows apart.
    const m = matchText("S_ALT 0.48 ukat/ll", lab)!;
    expect(m.method).toBe("overlap");
    const hit = lab.slice(m.range[0], m.range[1]);
    expect(hit).toContain("0.48");
    expect(hit).not.toContain("0.45");
    expect(hit).not.toContain("0.41");
  });
});

describe("matchImage and lineBoxes", () => {
  it("returns the matched word indices and one box per printed line", () => {
    const words = wordsOf(["Závěr: cT2 N1 MO", "bez známek progrese"]);
    const m = matchImage("N1 M0 bez známek", words)!;
    expect(m.method).toBe("exact");
    expect(m.words).toEqual([2, 5]);
    expect(m.boxes).toHaveLength(2);
  });

  it("merges the words of one line into one box with a small margin", () => {
    const boxes = lineBoxes([
      { b: [100, 100, 40, 18] },
      { b: [150, 102, 30, 16] },
      { b: [100, 140, 50, 18] },
    ]);
    expect(boxes).toEqual([
      [97, 98, 86, 22],
      [97, 138, 56, 22],
    ]);
  });

  it("returns null when the words do not hold the quote", () => {
    expect(matchImage("adjuvantní chemoterapie", wordsOf(["Laboratorní výsledky"]))).toBeNull();
  });
});

describe("verifyOf and isEmptyPage", () => {
  it("gives an item its character range only when both offsets are integers", () => {
    const v = verifyOf([{ start: 4, end: 6, reason: "disagree" }, { start: null, end: null, reason: "only_tesseract" }]);
    expect(v.map((x) => x.at)).toEqual([[4, 6], null]);
    expect(verifyOf(undefined)).toEqual([]);
  });

  it("knows the empty page marker", () => {
    expect(isEmptyPage(" [prázdná stránka]\n")).toBe(true);
    expect(isEmptyPage("[prázdná stránka] Kontrola")).toBe(false);
  });
});
