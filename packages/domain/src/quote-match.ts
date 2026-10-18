// Quote matching for the source viewer (PRODUCT.md F-18): where a source reference's quote sits on the page image
// (Tesseract's word boxes) and in the page transcription (character offsets). It runs in the browser on the page the Worker sent, so the
// quote (which can contain names) never travels to the server or its logs.
//
// Source references carry a quote from the PDF's old text layer, with its OCR errors ("MO" for "M0", "lmg/kg",
// "1112023"). The page now shows the vision transcription and Tesseract's words, so the quote is matched tolerantly:
// tokens compared without case, accents or punctuation, with the usual O/0 and l/1/i confusions folded together. An
// exact run of tokens wins; otherwise the best window by a weighted in-order alignment, accepted when it covers at
// least 60 % of the quote.

export type Box = [number, number, number, number];
export type Word = { t: string; b: Box; c?: number };
export type MatchMethod = "exact" | "overlap";
export type ImageMatch = { method: MatchMethod; score: number; ambiguous: boolean; words: [number, number]; boxes: Box[] };
export type TextMatch = { method: MatchMethod; score: number; ambiguous: boolean; range: [number, number] };
// One "ověřit" item of a page: a token the two readings disagree on. Pages read with AI carry "vision" (the language
// model's reading) and "tess"; pages read without AI carry "layer" (the PDF text layer) instead of "vision".
export type VerifyItem = {
  start?: number | null;
  end?: number | null;
  box?: Box | null;
  reason?: string;
  tess?: string;
  vision?: string;
  layer?: string;
  conf?: number | null;
};
export type Verify = VerifyItem & { at: [number, number] | null };

type Tok = { c: string };
type Window = { from: number; to: number; score: number; method: MatchMethod; ambiguous: boolean };

export const isEmptyPage = (text: string) => /^\s*\[prázdná stránka\]\s*$/.test(text);

export const canon = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/o/g, "0")
    .replace(/[il]/g, "1");

export function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

// Partial credit for a token misread by one or two characters ("vyš" read as "wš", "CT" as "CI"), or cut short by
// the OCR ("pánev" read as "pá").
export function sim(a: string, b: string): number {
  if (a === b) return 1;
  const short = Math.min(a.length, b.length);
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (short < 2) return 0;
  if (Math.abs(a.length - b.length) <= 2) {
    const d = lev(a, b);
    if (short >= 3 && d <= 1) return 0.7;
    if ((short >= 5 && d <= 2) || (short === 2 && d <= 1)) return 0.5;
    if (short >= 4 && d <= 2) return 0.4;
  }
  return s.length / l.length >= 0.4 && (l.startsWith(s) || l.endsWith(s)) ? 0.4 : 0;
}

export const MIN_OVERLAP = 0.6;

// Weighted longest common subsequence of the quote and the text window toks[i, i+L): the score is the share of the
// quote found in order, and from/to are the first and last matched tokens.
export function align(q: string[], toks: Tok[], i: number, L: number): { score: number; from: number; to: number } | null {
  const m = q.length;
  const W = Math.min(L, toks.length - i);
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(W + 1));
  const sm = Array.from({ length: m }, () => new Float64Array(W));
  for (let k = 1; k <= m; k++)
    for (let x = 1; x <= W; x++) {
      const s = (sm[k - 1]![x - 1] = sim(q[k - 1]!, toks[i + x - 1]!.c));
      dp[k]![x] = Math.max(dp[k - 1]![x]!, dp[k]![x - 1]!, s ? dp[k - 1]![x - 1]! + s : 0);
    }
  let k = m;
  let x = W;
  let first = -1;
  let last = -1;
  while (k > 0 && x > 0) {
    const s = sm[k - 1]![x - 1]!;
    if (s && Math.abs(dp[k]![x]! - (dp[k - 1]![x - 1]! + s)) < 1e-9) {
      if (last < 0) last = i + x - 1;
      first = i + x - 1;
      k--;
      x--;
    } else if (dp[k - 1]![x]! >= dp[k]![x - 1]!) k--;
    else x--;
  }
  return first < 0 ? null : { score: dp[m]![W]! / m, from: first, to: last };
}

export function bestWindow(q: string[], toks: Tok[]): Window | null {
  const m = q.length;
  const n = toks.length;
  if (!m || !n) return null;
  const exact: number[] = [];
  for (let i = 0; i + m <= n; i++) {
    let k = 0;
    while (k < m && toks[i + k]!.c === q[k]) k++;
    if (k === m) exact.push(i);
  }
  // A repeated quote is highlighted at its first place, and the doctor is told it occurs more than once.
  if (exact.length) return { from: exact[0]!, to: exact[0]! + m - 1, score: 1, method: "exact", ambiguous: exact.length > 1 };
  // Among windows, prefer the one that contains the quote's numbers: lab rows share words ("[0 ... 0.7]", "ukat/l")
  // and differ only in the test name and the value.
  const qd = q.filter((t) => /\d/.test(t));
  const cands: { score: number; from: number; to: number; rank: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = align(q, toks, i, m + 4);
    if (!a) continue;
    const span = toks.slice(a.from, a.to + 1).map((t) => t.c);
    const rank = a.score + 0.1 * (qd.length ? qd.filter((d) => span.includes(d)).length / qd.length : 1);
    cands.push({ ...a, rank });
  }
  cands.sort((x, y) => y.rank - x.rank || x.to - x.from - (y.to - y.from));
  const best = cands[0];
  if (!best || best.score < MIN_OVERLAP) return null;
  const rival = cands.find((c) => c.score >= MIN_OVERLAP && (c.to < best.from || c.from > best.to) && best.rank - c.rank < 0.05);
  return { from: best.from, to: best.to, score: Math.round(best.score * 100) / 100, method: "overlap", ambiguous: !!rival };
}

export const quoteTokens = (quote: string) => String(quote).split(/\s+/).map(canon).filter(Boolean);

// One box per printed line, so a highlight spanning two lines does not cover the space between them.
export function lineBoxes(words: Pick<Word, "b">[]): Box[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const wd of words) {
    const [x, y, bw, bh] = wd.b;
    const cur = out[out.length - 1];
    if (cur && x >= cur.x - 4 && Math.abs(y + bh / 2 - (cur.y + cur.h / 2)) < Math.max(bh, cur.h) * 0.6) {
      const r = Math.max(cur.x + cur.w, x + bw);
      const b = Math.max(cur.y + cur.h, y + bh);
      cur.y = Math.min(cur.y, y);
      cur.w = r - cur.x;
      cur.h = b - cur.y;
    } else out.push({ x, y, w: bw, h: bh });
  }
  return out.map((r) => [r.x - 3, r.y - 2, r.w + 6, r.h + 4]);
}

export function matchImage(quote: string, words: Word[]): ImageMatch | null {
  const toks = words.map((w, i) => ({ c: canon(w.t), i })).filter((t) => t.c);
  const win = bestWindow(quoteTokens(quote), toks);
  if (!win) return null;
  const a = toks[win.from]!.i;
  const b = toks[win.to]!.i;
  return { method: win.method, score: win.score, ambiguous: win.ambiguous, words: [a, b], boxes: lineBoxes(words.slice(a, b + 1)) };
}

export function matchText(quote: string, text: string): TextMatch | null {
  const toks = [...String(text).matchAll(/\S+/g)].map((m) => ({ c: canon(m[0]), s: m.index, e: m.index + m[0].length })).filter((t) => t.c);
  const win = bestWindow(quoteTokens(quote), toks);
  return win ? { method: win.method, score: win.score, ambiguous: win.ambiguous, range: [toks[win.from]!.s, toks[win.to]!.e] } : null;
}

// Each "ověřit" item carries its character offsets in the transcription from scripts/build_page_index.py, which
// aligned the two readings word by word; the text tab marks exactly that place.
export const verifyOf = (verify: VerifyItem[] | null | undefined): Verify[] =>
  (verify || []).map((v) => ({ ...v, at: Number.isInteger(v.start) && Number.isInteger(v.end) ? [v.start as number, v.end as number] : null }));
