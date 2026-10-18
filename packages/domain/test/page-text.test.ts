// Cutting the page transcription into lines, table rows and marked pieces (synthetic Czech text).
import { describe, expect, it } from "vitest";
import { segmentPage, type Block, type Piece } from "../src/page-text";
import { verifyOf } from "../src/quote-match";

const textOf = (ps: Piece[]) => ps.map((p) => p.text).join("");
const line = (b: Block | undefined) => {
  if (!b || b.kind !== "line") throw new Error("not a line");
  return b;
};

describe("segmentPage", () => {
  it("keeps headings and hides Markdown asterisks", () => {
    const b = segmentPage("# **Ambulantní vyšetření**\n\n**Objektivní nález:** TK 155/70", null, []);
    expect(b).toHaveLength(3);
    expect(line(b[0])).toMatchObject({ heading: true });
    expect(textOf(line(b[0]).pieces)).toBe("Ambulantní vyšetření");
    expect(line(b[1]).pieces).toEqual([]);
    expect(textOf(line(b[2]).pieces)).toBe("Objektivní nález: TK 155/70");
  });

  it("turns Markdown table rows into cells and drops the separator row", () => {
    const b = segmentPage("Laboratoř\n| Test | Hodnota |\n|---|:--:|\n| Kreatinin | 107 |\nKonec", null, []);
    expect(b.map((x) => x.kind)).toEqual(["line", "table", "line"]);
    const t = b[1]!;
    if (t.kind !== "table") throw new Error();
    expect(t.rows.map((r) => r.map((c) => textOf(c).trim()))).toEqual([
      ["Test", "Hodnota"],
      ["Kreatinin", "107"],
    ]);
  });

  it("keeps a last cell without a closing bar", () => {
    const t = segmentPage("| Hb | 120", null, [])[0]!;
    if (t.kind !== "table") throw new Error();
    expect(t.rows[0]!.map((c) => textOf(c).trim())).toEqual(["Hb", "120"]);
  });

  it("marks a run of unreadable characters as one unreadable piece", () => {
    const p = line(segmentPage("Dg: C���.9 vlevo", null, [])[0]).pieces;
    const u = p.filter((x) => x.unreadable);
    expect(u).toHaveLength(1);
    expect(u[0]!.text).toBe("���");
  });

  it("marks a transcriber note without digits, but not a printed lab range", () => {
    const text = "[razítko: SK] Kreatinin 107 µmol/l [59 ... 104] [mmHg]";
    const p = line(segmentPage(text, null, [])[0]).pieces;
    expect(p.filter((x) => x.note).map((x) => x.text)).toEqual(["[razítko: SK]", "[mmHg]"]);
    expect(p.find((x) => x.text.includes("59 ... 104"))!.note).toBe(false);
  });

  it("marks the cited passage, flags only its first piece, and attaches verify items", () => {
    const text = "Stadium cT2 N1 M0, bez progrese.";
    const v = verifyOf([{ start: 15, end: 17, reason: "disagree", tess: "MO" }]);
    const p = line(segmentPage(text, [8, 18], v)[0]).pieces;
    const hits = p.filter((x) => x.hit);
    expect(hits.map((x) => x.text).join("")).toBe("cT2 N1 M0,");
    expect(hits.filter((x) => x.firstHit)).toHaveLength(1);
    expect(hits[0]!.firstHit).toBe(true);
    const vf = p.find((x) => x.verify)!;
    expect(vf).toMatchObject({ text: "M0", hit: true });
    expect(vf.verify!.tess).toBe("MO");
  });

  it("marks a passage that spans lines in each line, with one first piece", () => {
    const b = segmentPage("první řádek\ndruhý řádek", [6, 17], []);
    const all = b.flatMap((x) => (x.kind === "line" ? x.pieces : []));
    expect(all.filter((x) => x.hit).map((x) => x.text)).toEqual(["řádek", "druhý"]);
    expect(all.filter((x) => x.firstHit)).toHaveLength(1);
  });
});
