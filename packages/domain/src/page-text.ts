// The page transcription as the source viewer's "Přepis stránky" tab shows it. The
// vision transcription is Markdown: it is shown as text with headings and tables kept, and with the cited passage,
// the "ověřit" tokens, the transcriber's own [notes] and unreadable characters marked by character ranges. This
// module only cuts the text into pieces; the component renders them as text nodes, so the transcription is never
// injected as HTML.
import type { Verify } from "./quote-match";

export type Piece = {
  text: string;
  // A run of U+FFFD the reader could not read: shown as "?" with its length, never filled in.
  unreadable: boolean;
  // The "ověřit" item this piece belongs to, if any.
  verify: Verify | null;
  // A transcriber's note ("[razítko: SK]"), not printed text.
  note: boolean;
  // Part of the cited passage; `firstHit` is the piece the viewer scrolls to.
  hit: boolean;
  firstHit: boolean;
};
export type Block = { kind: "line"; heading: boolean; pieces: Piece[] } | { kind: "table"; rows: Piece[][][] };

type Span = { s: number; e: number; k: "hit" | "vf" | "vm" | "unr"; v?: Verify };

export function segmentPage(text: string, hit: [number, number] | null, verify: Verify[]): Block[] {
  const spans: Span[] = [];
  if (hit) spans.push({ s: hit[0], e: hit[1], k: "hit" });
  verify.forEach((v) => v.at && spans.push({ s: v.at[0], e: v.at[1], k: "vf", v }));
  // Transcriber notes ("[razítko: SK]", "[?]") have no digits; a bracket with a digit is a printed lab range.
  for (const m of text.matchAll(/\[[^\]\n\d]{1,160}\]/g)) spans.push({ s: m.index, e: m.index + m[0].length, k: "vm" });
  for (const m of text.matchAll(/�+/g)) spans.push({ s: m.index, e: m.index + m[0].length, k: "unr" });
  let firstHit = true;

  const seg = (a: number, b: number): Piece[] => {
    const cuts = new Set([a, b]);
    spans.forEach((sp) => {
      if (sp.s > a && sp.s < b) cuts.add(sp.s);
      if (sp.e > a && sp.e < b) cuts.add(sp.e);
    });
    const pts = [...cuts].sort((x, y) => x - y);
    const out: Piece[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const s = pts[i]!;
      const e = pts[i + 1]!;
      const on = spans.filter((sp) => sp.s <= s && sp.e >= e);
      // Markdown emphasis markers are not printed text; they are hidden, not "corrected".
      const piece = text.slice(s, e).replace(/\*/g, "");
      if (!piece) continue;
      const isHit = on.some((x) => x.k === "hit");
      out.push({
        text: piece,
        unreadable: on.some((x) => x.k === "unr"),
        verify: on.find((x) => x.k === "vf")?.v ?? null,
        note: on.some((x) => x.k === "vm"),
        hit: isHit,
        firstHit: isHit && firstHit,
      });
      if (isHit) firstHit = false;
    }
    return out;
  };

  const blocks: Block[] = [];
  let rows: Piece[][][] = [];
  let pos = 0;
  const flush = () => {
    if (rows.length) blocks.push({ kind: "table", rows });
    rows = [];
  };
  for (const line of text.split("\n")) {
    const s = pos;
    const e = pos + line.length;
    pos = e + 1;
    if (/^\s*\|/.test(line)) {
      // The separator row under a table header is layout, not text.
      if (/^[\s|:-]+$/.test(line)) continue;
      const bars = [...line.matchAll(/\|/g)].map((m) => s + m.index);
      const cells: Piece[][] = [];
      for (let k = 0; k < bars.length - 1; k++) cells.push(seg(bars[k]! + 1, bars[k + 1]!));
      if (!line.trim().endsWith("|")) cells.push(seg(bars[bars.length - 1]! + 1, e));
      rows.push(cells);
      continue;
    }
    flush();
    const h = line.match(/^(#{1,6})\s+/);
    blocks.push(h ? { kind: "line", heading: true, pieces: seg(s + h[0].length, e) } : { kind: "line", heading: false, pieces: line.trim() ? seg(s, e) : [] });
  }
  flush();
  return blocks;
}
