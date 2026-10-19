// Whether a composed text (a view line, a brief sentence) says only what its facts say (EXTRACTION-FORMAT.md,
// "Composed views").
//
// A producer may word a line freely, but a doctor reads it as the documents' content, so every date, number, negation
// and side in it must appear in the facts it points at: in their values, their dates or the passages they quote. A
// fact's note and certainty reason are the assistant's words and back nothing. Drug names are not checked (there is no
// drug list in the format). The check is a guard against invented content, not a proof: a cue word or a number may be
// backed by another statement among the same facts. The Python mirror (pipeline/extraction_format/backing.py) gives
// the same answers; both are tested against packages/domain/test/extraction-backing-vectors.json.

/** What a text may rest on: the texts of its facts, and whether any of them, or all of them, are recorded negatives. */
export interface Evidence {
  texts: string[];
  negated: boolean;
  /** Every fact is a recorded negative: the text must then say so. Absent means false. */
  allNegated?: boolean;
}

export type BackingProblem = "date" | "number" | "negation" | "side";

type Ymd = { y: number | null; m: number | null; d: number | null };

// A letter (as Python's [^\W\d_] counts them: letters and non-decimal numerals such as "Ⅳ") on either side means the
// digits belong to a word or a code ("G2", "pT2a", "C64"), not a number.
const L = "\\p{L}\\p{Nl}\\p{No}";
const NOT_LETTER_BEFORE = `(?<![${L}])`;
const NOT_LETTER_AFTER = `(?![${L}])`;

// Units after a number: "5 mg" must be backed by a 5 with the same unit, so "3. linie" does not back "3 mg". A
// four-digit number before a unit ("2000 mg") is a dose, not a year.
const UNIT = "mg|g|kg|µg|mcg|ml|l|mm|cm|m2|m²|%|mmhg|mmol\\/l|µmol\\/l|umol\\/l|g\\/l|iu|ij|gy|cykl\\p{L}*|týdn\\p{L}*|dn\\p{L}*|měsíc\\p{L}*|let|rok\\p{L}*";
const UNIT_AFTER = new RegExp(`^\\s?(${UNIT})(?![${L}])`, "iu");

const year = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

// Czech month names in every case the documents use ("v září 2026", "od října 2025").
const MONTHS: [RegExp, number][] = [
  [/^led(en|na|nu)$/, 1],
  [/^únor(a|u)?$/, 2],
  [/^břez(en|na|nu)$/, 3],
  [/^dub(en|na|nu)$/, 4],
  [/^květ(en|na|nu)$/, 5],
  [/^červ(en|na|nu)$/, 6],
  [/^červen(ec|ce|ci)$/, 7],
  [/^srp(en|na|nu)$/, 8],
  [/^září$/, 9],
  [/^říj(en|na|nu)$/, 10],
  [/^listopad(u)?$/, 11],
  [/^prosin(ec|ce|ci)$/, 12],
];
const monthOf = (w: string) => MONTHS.find(([re]) => re.test(w.toLowerCase()))?.[1] ?? null;

/** The dates in a text, and the text with them taken out (so their digits are not read as numbers). */
function datesIn(text: string): { dates: Ymd[]; rest: string } {
  const dates: Ymd[] = [];
  let rest = text;
  const take = (re: RegExp, f: (m: string[]) => Ymd | null) => {
    rest = rest.replace(re, (...args: unknown[]) => {
      const m = args.slice(0, -2).map((x) => (x === undefined ? "" : String(x)));
      const v = f(m);
      if (!v) return m[0]!;
      dates.push(v);
      return " ";
    });
  };
  // ISO, as the fact dates' sort form gives it.
  take(/(\d{4})-(\d{2})(?:-(\d{2}))?/g, (m) => ({ y: Number(m[1]), m: Number(m[2]), d: m[3] ? Number(m[3]) : null }));
  // "14.9.2026", "14. 9. 2026", "22,5,2026" (as OCR gives it), "14.9.25".
  take(/(?<![\d.,])(\d{1,2})\s?[.,]\s?(\d{1,2})\s?[.,]\s?(\d{4}|\d{2})(?![\d])/g, (m) => ({ y: year(m[3]!), m: Number(m[2]), d: Number(m[1]) }));
  // "14.9." without a year.
  take(/(?<![\d.,])(\d{1,2})\.\s?(\d{1,2})\.(?!\s?\d)/g, (m) => (Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { y: null, m: Number(m[2]), d: Number(m[1]) } : null));
  // "9/2026", "9/23".
  take(/(?<![\d/])(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g, (m) => (Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { y: year(m[2]!), m: Number(m[1]), d: null } : null));
  // "září 2026".
  take(new RegExp(`${NOT_LETTER_BEFORE}([${L}]+)\\s+(\\d{4})(?!\\d)`, "gu"), (m) => {
    const mo = monthOf(m[1]!);
    return mo ? { y: Number(m[2]), m: mo, d: null } : null;
  });
  // A year alone, unless a unit follows ("2000 mg").
  take(new RegExp(`${NOT_LETTER_BEFORE}(?<!\\d)((?:19|20)\\d{2})(?!\\d)(?!\\s?(?:${UNIT})(?![${L}]))`, "giu"), (m) => ({ y: Number(m[1]), m: null, d: null }));
  return { dates, rest };
}

const norm = (n: string) => String(Number(n.replace(",", ".")));

/** The numbers in a text, each with the unit that follows it ("" for none). */
function numbersIn(text: string): { n: string; unit: string }[] {
  const re = new RegExp(`${NOT_LETTER_BEFORE}(?<![\\d.,])\\d+(?:[.,]\\d+)?`, "gu");
  const out: { n: string; unit: string }[] = [];
  for (const m of text.matchAll(re)) {
    const after = text.slice(m.index! + m[0].length);
    const u = UNIT_AFTER.exec(after);
    out.push({ n: norm(m[0]), unit: u ? u[1]!.toLowerCase() : "" });
  }
  return out;
}

/** Every number the evidence holds, as plain values and with their units; integer parts of decimals count too. */
function evidenceNumbers(ev: string): { plain: Set<string>; withUnit: Set<string> } {
  const plain = new Set<string>();
  for (const m of ev.matchAll(/\d+(?:[.,]\d+)?/g)) {
    plain.add(norm(m[0]));
    for (const part of m[0].split(/[.,]/)) plain.add(norm(part));
  }
  const withUnit = new Set(numbersIn(ev).filter((x) => x.unit).map((x) => `${x.n} ${x.unit}`));
  return { plain, withUnit };
}

// Czech negation cues, each read as its stem, so "žádná" backs "ŽÁDNÉ" and "nebyla" backs "nebyl".
const NEGATION: [string, string][] = [
  ["bez", "bez"],
  ["není", "není"],
  ["nejsou", "nejsou"],
  ["nebyl[aoiy]?", "nebyl"],
  ["neguje", "neguje"],
  ["negativn\\p{L}*", "negativn"],
  ["nemá", "nemá"],
  ["nezvrací", "nezvrací"],
  ["nepřibyl[aoiy]?", "nepřibyl"],
  ["vyloučen\\p{L}*", "vyloučen"],
  ["nevyšetřen\\p{L}*", "nevyšetřen"],
  ["neprokázán\\p{L}*", "neprokázán"],
  ["nenalezen\\p{L}*", "nenalezen"],
  ["nezjištěn\\p{L}*", "nezjištěn"],
  ["nezvětšen\\p{L}*", "nezvětšen"],
  ["nehmatn\\p{L}*", "nehmatn"],
  ["nepřítomn\\p{L}*", "nepřítomn"],
  ["žádn\\p{L}*", "žádn"],
  ["nikoli", "nikoli"],
];
const NEGATION_RE = NEGATION.map(([p, stem]) => [new RegExp(`${NOT_LETTER_BEFORE}${p}${NOT_LETTER_AFTER}`, "iu"), stem] as const);

/** The negation cues a text holds, as stems. */
export function negationCues(text: string): Set<string> {
  return new Set(NEGATION_RE.filter(([re]) => re.test(text)).map(([, stem]) => stem));
}

// Sides: right, left, both. "pravidelná" (regular) is not a side, so only the side forms are listed.
const SIDES: [string, RegExp][] = [
  ["right", new RegExp(`${NOT_LETTER_BEFORE}(vpravo|pravostrann\\p{L}*|prav(?:ý|á|é|ého|ém|ou|ých|ým|ými|ému))${NOT_LETTER_AFTER}`, "iu")],
  ["left", new RegExp(`${NOT_LETTER_BEFORE}(vlevo|levostrann\\p{L}*|lev(?:ý|á|é|ého|ém|ou|ých|ým|ými|ému))${NOT_LETTER_AFTER}`, "iu")],
  ["both", new RegExp(`${NOT_LETTER_BEFORE}(oboustrann\\p{L}*|bilaterál\\p{L}*)${NOT_LETTER_AFTER}`, "iu")],
];

const sidesIn = (text: string) => new Set(SIDES.filter(([, re]) => re.test(text)).map(([s]) => s));

/** What in `text` its evidence does not back, one entry per kind of problem, in a fixed order. */
export function backingProblems(text: string, evidence: Evidence): BackingProblem[] {
  const ev = evidence.texts.join("\n");
  const out: BackingProblem[] = [];
  const t = datesIn(text);
  const e = datesIn(ev);
  const dateBacked = (x: Ymd) => e.dates.some((y) => (x.y === null || y.y === x.y) && (x.m === null || y.m === x.m) && (x.d === null || y.d === x.d));
  if (!t.dates.every(dateBacked)) out.push("date");
  // A number with a unit needs the same number with the same unit; a bare number needs the number anywhere.
  const evn = evidenceNumbers(ev);
  if (!numbersIn(t.rest).every((x) => (x.unit ? evn.withUnit.has(`${x.n} ${x.unit}`) : evn.plain.has(x.n)))) out.push("number");
  // A cue needs a negated fact or the same cue in the facts' own text; a text over recorded negatives only must say so.
  const cues = negationCues(text);
  const evCues = negationCues(ev);
  if ((!evidence.negated && ![...cues].every((c) => evCues.has(c))) || (evidence.allNegated && cues.size === 0)) out.push("negation");
  const evSides = sidesIn(ev);
  if (![...sidesIn(text)].every((s) => evSides.has(s))) out.push("side");
  return out;
}
