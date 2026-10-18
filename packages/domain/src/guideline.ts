// The guideline layer's pure rules (F-27 in docs/design/PRODUCT.md): the common strength scale, the order of the
// statements and which quotes the screen may clamp. A statement is a verbatim quote from a guideline; nothing here
// changes or shortens its text, it only decides how the screen orders and labels it.

// A statement as the guidance reply sends it. Only the fields these rules read are typed.
export type GuidelineStatement = { type?: string; evidence?: string | null };
export type Guideline = { field?: string | null };

// Strength of a recommendation on one common scale (round 19), so statements from different grading systems can be
// listed strongest first. The index is the sort key and the CSS class (tier-0 ... tier-3); the code picks the label
// from the catalog. The original label is always shown next to the tier.
export const TIERS = ["strong", "moderate", "weak", "unstated"] as const;
export type TierCode = (typeof TIERS)[number];
export type Tier = 0 | 1 | 2 | 3;

const ESMO_GRADE: Record<string, Tier> = { A: 0, B: 1, C: 2 };
const ESC_CLASS: Record<string, Tier> = { I: 0, IIa: 1, IIb: 2, III: 0 };

// Read only from the statement's own `evidence` text. Mapping (also in docs/design/PRODUCT.md, "Feedback round 19"):
// - ESMO and EANO (level I-V, grade A-E): grade A = strong, B = moderate, C = weak. D and E (evidence against) do not
//   occur in our data and fall to "unstated" rather than being guessed.
// - Modrá kniha ČOS and NCCN categories (1, 2A, 2B, 3) state the level of evidence and the panel's consensus, not
//   the strength of the recommendation, so they map to "unstated"; the opened entry names the category.
// - GRADE wording (ASTRO, EASL): "strong recommendation" = strong, "conditional" or "weak recommendation" = weak.
//   The level of evidence (EASL "LoE") is not the strength and is ignored.
// - ESC classes: I = strong, IIa = moderate, IIb = weak, III (not recommended) = strong, because III is a firm
//   statement against.
// - Chapter text without a grade, or a grade the abstract does not state: unstated.
// A statement graded more than once (EANO and ESMO, or one grade per drug) keeps every tier, sorted strongest first,
// so the label can show the range and never hide a weaker grade.
export function tiersOf(st: GuidelineStatement): Tier[] {
  if (st.type === "guideline_text") return [3];
  const e = String(st.evidence || "");
  const t: Tier[] = [];
  for (const m of e.matchAll(/\b(?:EANO|ESMO):\s*[IV]+,\s*([A-E]|n\/a)/g)) {
    const g = ESMO_GRADE[m[1]!];
    if (g !== undefined) t.push(g);
  }
  if (/\bstrong recommendation\b/i.test(e)) t.push(0);
  if (/\b(conditional|weak) recommendation\b/i.test(e)) t.push(2);
  const esc = e.match(/\bClass (IIa|IIb|III|I)\b/);
  if (esc) t.push(ESC_CLASS[esc[1]!]!);
  return t.length ? [...new Set(t)].sort() : [3];
}

// The tier codes for the label: one code, or the strongest and the weakest for a range ("střední až slabé").
export function tierCodes(st: GuidelineStatement): { from: TierCode; to: TierCode | null } {
  const t = tiersOf(st);
  return { from: TIERS[t[0]!], to: t.length > 1 ? TIERS[t[t.length - 1]!] : null };
}

// ČOS and NCCN categories of a statement, in the order given ("2A, 2B" for a list graded per drug), without repeats.
export function categoriesOf(st: GuidelineStatement): string[] {
  const cos = String(st.evidence || "").match(/(?:ČOS|NCCN)[^0-9]*((?:\b(?:1|2A|2B|3)\b[,\s]*)+)/);
  return cos ? [...new Set([...cos[1]!.matchAll(/\b(1|2A|2B|3)\b/g)].map((m) => m[1]!))] : [];
}

// Strongest first; a range sorts after a single tier of the same strength, then the data's order. Never an order of
// options for the patient: the screen says so next to the list.
export function byTier<S extends GuidelineStatement>(xs: S[]): S[] {
  return xs
    .map((x, i) => ({ x, i, t: tiersOf(x) }))
    .sort((a, b) => a.t[0]! - b.t[0]! || a.t[a.t.length - 1]! - b.t[b.t.length - 1]! || a.i - b.i)
    .map((o) => o.x);
}

// The field a guideline belongs to; the data names it only for fields other than oncology.
export const fieldOf = (g: Guideline | null | undefined): string => g?.field || "oncology";
export const isOncology = (g: Guideline | null | undefined): boolean => /oncology/.test(fieldOf(g));

// Only long quotes may be clamped on screen, and never one with a condition word: cutting "... only if X" after the
// first clause turns a conditional statement into an unconditional one. The text itself is never shortened.
export const CLAMP_MIN = 160;
export const COND_RE = /(^|[^\p{L}])(provided|unless|if|except|pokud|při|kromě)(?![\p{L}])/iu;
export const clampable = (q: string | null | undefined): boolean => String(q || "").length > CLAMP_MIN && !COND_RE.test(String(q || ""));

// The page text with the quote found in it, as parts the drawer renders (the hit is marked). Whitespace in the quote
// may be any whitespace in the page (line breaks of the PDF text). No match: the page unmarked, never a guessed hit.
export function markQuote(text: string, quote: string | null | undefined): { before: string; hit: string | null; after: string } {
  const words = String(quote || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { before: text, hit: null, after: "" };
  const pat = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  let m: RegExpExecArray | null = null;
  try {
    m = new RegExp(pat).exec(text);
  } catch {
    m = null;
  }
  if (!m) return { before: text, hit: null, after: "" };
  return { before: text.slice(0, m.index), hit: m[0], after: text.slice(m.index + m[0].length) };
}

// The language of a guideline's verbatim text, for the lang attribute of its quotes. The data names no language, so it
// is read from the region the guideline comes from: Czech national guidelines (ČOS) are Czech, the European and US
// societies in our data publish in English. A guideline without a region (the older ČOS editions of past decisions)
// gets no attribute rather than a guessed one.
export type GuidelineOrigin = { lang?: string | null; region?: string | null };
export function quoteLang(g: GuidelineOrigin | null | undefined): string | undefined {
  if (g?.lang) return g.lang;
  if (g?.region === "CZ") return "cs";
  if (g?.region === "EU" || g?.region === "US") return "en";
  return undefined;
}
