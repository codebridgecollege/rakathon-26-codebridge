// Text pseudonymization before any external model call (DATA-PROTECTION.md, "Text sent to a model").
//
// The case patient's name, birth number, birth date, address and phone, and the names of the org's staff, are
// replaced by placeholders such as [PACIENT] or [PERSONAL_2]. The mapping back to the original text stays in the
// Worker's memory (private fields of `Pseudonymized`): it is never part of a prompt, a log line, a Workflow step result
// or an R2 object. The model call runs `detectIdentifiers` again over everything it would send and refuses when
// anything is found (services/model.ts). The same rules, so this catches identifiers in parts that were never
// pseudonymized (the prompt, the schema), not the misses of the rules themselves.
//
// Pseudonymized text is still personal data (GDPR recital 26): diagnoses, dates and places stay, on purpose, because
// they are the medical content.
//
// Matching is done on a folded copy of the text (lowercase, no diacritics) that keeps every character at the same
// offset, so OCR output without diacritics ("Polacek") is matched too, and spans map 1:1 to the original.
//
// Known limits (documented in DATA-PROTECTION.md):
// - An OCR misread inside a name ("Lipcnská") is not matched.
// - A name part alone is matched only when capitalized, because many names are ordinary Czech words ("Malá", "Černý",
//   "Hlava": "malé pánve", "CT hlavy" must stay readable). Two parts of one name together match in any case.
// - Other people's names without a title (relatives, external doctors) are found only after a title (MUDr., ...)
//   or a form label (Jméno:, Pacientka:); there is no Czech name recognizer yet.
// - A phone number without +420 or a label ("tel.") is not matched: it cannot be told from a lab row.

export type CaseIdentity = {
  // The patient as the case record holds them (D1 `patients`); any field may be missing.
  patientNames: string[]; // full_name and name_as_written
  birthNumber: string | null;
  birthDate: string | null; // as written, "12.3.1964"
  // Surnames (and any other name parts) of the org's staff, one entry per person, in a stable order.
  staffNames: string[];
};

export type IdentifierKind =
  | "patient_name"
  | "birth_number"
  | "birth_date"
  | "phone"
  | "email"
  | "address"
  | "name_field"
  | "staff_name"
  | "titled_name";

export type Hit = { start: number; end: number; kind: IdentifierKind; placeholder: string };

// One character in, one character out, so offsets in the folded text are offsets in the original. Czech letters
// decompose to a base letter and one combining mark; anything that would change the length is kept as it is.
export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    // A character outside the basic plane (two code units) is kept as it is.
    const low = ch.length === 1 ? ch.normalize("NFD")[0]!.toLowerCase() : ch;
    out += low.length === ch.length ? low : ch;
  }
  return out;
}

const VOWEL_END = /[aeiouyáéěíóúůý]$/;

// The forms a Czech name takes in the cases it appears in documents (genitive "Poláčka", dative "Lipenské",
// instrumental "Věrou", possessive "Novákova"), folded. Over-generation is harmless: a form that is not a real word
// never occurs in text; a form that is a real word is limited by the capitalization rule for staff.
export function nameForms(name: string): string[] {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return [];
  const forms = new Set<string>([n]);
  const add = (stem: string, ends: string[]) => {
    if (stem.length < 2) return;
    for (const e of ends) forms.add(stem + e);
  };
  const POSSESSIVE = ["ova", "ovo", "ovy", "ovu", "ovou", "ově", "ových", "ovým"];
  if (n.endsWith("á")) add(n.slice(0, -1), ["á", "é", "ou"]); // Lipenská, Svobodová, Malá
  else if (n.endsWith("ý")) add(n.slice(0, -1), ["ý", "ého", "ému", "ém", "ým", "í"]); // Černý
  else if (n.endsWith("í")) add(n.slice(0, -1), ["í", "ího", "ímu", "ím"]); // Krejčí, Jiří
  else if (n.endsWith("a")) {
    // Věra, Svoboda, Jitka: a noun of the a-declension; the consonant before the ending may soften (Jitce, Olze).
    const stem = n.slice(0, -1);
    add(stem, ["a", "y", "e", "ě", "u", "o", "ou", "i", "ovi", ...POSSESSIVE]);
    const soft: [string, string][] = [["k", "c"], ["h", "z"], ["g", "z"], ["ch", "š"], ["r", "ř"]];
    for (const [hard, s] of soft) if (stem.endsWith(hard)) add(stem.slice(0, -hard.length) + s, ["e", "i"]);
  } else if (n.endsWith("e") || n.endsWith("ě")) add(n.slice(0, -1), ["e", "ě", "i", "ím", "ii", "ií", "ete", "eti", "etem", "ovi"]); // Marie, Hrabě
  else if (n.endsWith("o")) add(n.slice(0, -1), ["o", "a", "ovi", "em", "u", ...POSSESSIVE]);
  else if (!VOWEL_END.test(n)) {
    // Novák, Beneš, Šimek, Poláček, Pavel: consonant ending; "e" before the last consonant drops (Šimka, Pavla).
    const ends = ["", "a", "ovi", "em", "e", "u", "i", "ové", "ů", "ům", "y", ...POSSESSIVE];
    add(n, ends);
    const fleeting = /^(.+)[eě]([kclnr])$/.exec(n);
    if (fleeting) add(fleeting[1]! + fleeting[2]!, ends);
  }
  return [...new Set([...forms].map(fold))];
}

// Name parts long enough to be a name; initials and particles are not matched on their own. A double surname
// ("Nováková-Svobodová") is split, because the text is split into words at the hyphen too.
export const nameParts = (names: string[]) =>
  [...new Set(names.flatMap((n) => (n ?? "").split(/[\s,\-]+/)).map((p) => p.replace(/[.()]/g, "").trim()).filter((p) => p.length > 2))];

// The birth date a Czech birth number encodes (yymmdd, women +50 on the month, +20 since 2004), used when the record
// states no birth date. Nine digits: born before 1954.
export function birthDateFromNumber(bn: string | null): string | null {
  const d = (bn ?? "").replace(/\D/g, "");
  if (d.length !== 9 && d.length !== 10) return null;
  const yy = Number(d.slice(0, 2));
  let mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  if (mm > 70) mm -= 70;
  else if (mm > 50) mm -= 50;
  else if (mm > 20) mm -= 20;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = d.length === 9 || yy >= 54 ? 1900 + yy : 2000 + yy;
  return `${dd}.${mm}.${year}`;
}

export const birthDateOf = (id: CaseIdentity) => id.birthDate ?? birthDateFromNumber(id.birthNumber);

// "12.3.1964" -> a pattern that also matches "12. 03. 1964", "12/3/1964", "12.3.64" and "1964-03-12".
function datePattern(asWritten: string): string | null {
  const m = /(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})/.exec(asWritten);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3]!;
  const sep = "\\s*[./]\\s*";
  return `(?:0?${d}${sep}0?${mo}${sep}(?:${y}|${y.slice(2)})|${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")})`;
}

// "645312/1234" -> digits with any spacing or slash between them.
function birthNumberPattern(bn: string): string | null {
  const digits = bn.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.split("").join("[\\s/]{0,2}");
}

// A ten-digit number that is a valid Czech birth number (a real month, a real day, divisible by 11), so another
// patient's birth number without a slash is caught without taking every ten-digit lab or order number.
function looksLikeBirthNumber(digits: string): boolean {
  if (digits.length !== 10) return false;
  if (!birthDateFromNumber(digits)) return false;
  const n = Number(digits);
  const first9 = Number(digits.slice(0, 9));
  return n % 11 === 0 || (first9 % 11 === 10 && digits[9] === "0");
}

// Titles match in any case ("MUDR.", "mudr."). Short titles that are also ordinary abbreviations (Dr, Bc, Ing, doc,
// prof, Mgr, prim) count only with their dot, so "BC ER+" (breast cancer) is not a title; the long ones may also be
// followed by a space. Only spaces and tabs may follow, so a title at the end of a line does not take the next line
// ("MUDr.\nDiagnóza:"). JavaScript has no case-insensitive group, so each letter is a class.
const anyCase = (w: string) => w.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const LONG_TITLES = ["mudr", "mddr", "mvdr", "phdr", "judr", "rndr"].map(anyCase).join("|");
const SHORT_TITLES = ["doc", "prof", "mgr", "bc", "ing", "dr", "prim"].map(anyCase).join("|");
const TITLE = `(?:(?:${LONG_TITLES})(?:\\.[ \\t,]*|[ \\t,]+)|(?:${SHORT_TITLES})\\.[ \\t,]*)`;
// A title (or several), then one or two words on the same line: "MUDr. Jana Hofrová", "MUDr.Hofrová", "prim. MUDr.
// Novák", "MUDr. NOVÁK", "mudr. novák". The first word after a title is a name in any case; a second word must be in
// title case, so "MUDr. Novák CT" keeps "CT".
const TITLED = new RegExp(`(?<![\\p{L}])${TITLE}+(\\p{L}[\\p{L}-]+(?:[ \\t]+\\p{Lu}\\p{Ll}[\\p{L}-]*)?)`, "gu");
const BIRTH_NUMBER = /(?<!\d)\d{6}[ \t]?\/[ \t]?\d{3,4}(?!\d)/g;
const TEN_DIGITS = /(?<![\d/])(\d{6})[ \t]?(\d{4})(?![\d/])/g;
// "nar. 14.6.1958", "narozena 14/06/58", "dat. nar.: 14. 6. 1958"; on the folded text. Not "*14.6.1958": OCR reads a
// bullet before an event date as "*" too; the patient's own birth date is matched wherever it stands (below).
const BIRTH_LABEL = /(?<![\p{L}])(?:nar|narozena|narozen|dat\.[ \t]*nar|datum[ \t]+narozeni)\.?[ \t]*:?[ \t]*(\d{1,2}[ \t]*[./][ \t]*\d{1,2}[ \t]*[./][ \t]*\d{2,4})/gu;
// Phone numbers only with the country code or after a label: an unlabelled group of nine digits is as likely a lab
// row ("Na 138 140 137") or a cell count ("PLT 250 000 000").
const PHONE_INTL = /\+420[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}(?!\d)/g;
const PHONE_LABEL = /(?<![\p{L}])(?:tel|telefon|mobil|mob|fax)\.?[ \t]*(?:c\.)?[ \t]*:?[ \t]*(\d{3}[ -]?\d{3}[ -]?\d{3})(?!\d)/gu;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// A form label at the start of a line (or after a separator), then its value to the end of the line.
const FIELD = /(?:^|[\n|;])[ \t]*(jmeno a prijmeni|jmeno|prijmeni|trvale bydliste|bydliste|adresa|kontaktni osoba|zakonny zastupce|telefon|tel|e-mail|email)[ \t]*[.:]{1,2}[ \t]*([^\n|;]+)/g;
// "Pacientka: Nováková Jana, 63 let": the capitalized words right after the label (any patient, also a wrong one).
const PATIENT_LABEL = /(?:^|[\n|;])[ \t]*(?:pacient|pacientka|jmeno pacienta)[ \t]*:[ \t]*/g;

const PLACEHOLDER: Record<Exclude<IdentifierKind, "staff_name" | "titled_name">, string> = {
  patient_name: "[PACIENT]",
  birth_number: "[RC]",
  birth_date: "[DATUM_NAROZENI]",
  phone: "[TELEFON]",
  email: "[EMAIL]",
  address: "[ADRESA]",
  name_field: "[JMENO]",
};

// Numbers given to names after a title. One map serves all text parts of one model call, so "[LEKAR_1]" is the same
// doctor in every part.
export type TitledNumbers = Map<string, number>;

// Every identifier in `text`, non-overlapping, in order. Pure; used both to pseudonymize and to check a payload.
export function detectIdentifiers(text: string, id: CaseIdentity, titled: TitledNumbers = new Map()): Hit[] {
  const f = fold(text);
  const hits: Hit[] = [];
  const push = (start: number, end: number, kind: IdentifierKind, placeholder = PLACEHOLDER[kind as keyof typeof PLACEHOLDER]) => {
    if (end > start) hits.push({ start, end, kind, placeholder: placeholder! });
  };
  const each = (re: RegExp, on: (m: RegExpExecArray) => void, s = f) => {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      on(m);
      if (m[0].length === 0) re.lastIndex++;
    }
  };

  // Word tokens of the folded text, with the original's first letter for the capitalization rule.
  const words: { w: string; start: number; end: number; upper: boolean }[] = [];
  each(/[\p{L}]+/gu, (m) => words.push({ w: m[0], start: m.index, end: m.index + m[0].length, upper: /\p{Lu}/u.test(text[m.index]!) }));
  // Two words are one name when only spaces, a comma or a hyphen (on the same line) separate them.
  const joined = (a: { end: number }, b: { start: number }) => /^[ \t,\-]+$/.test(f.slice(a.end, b.start));

  // A person's name parts match when capitalized (also in capitals, as OCR and forms write surnames), or in any case
  // when two parts of the same person stand together ("věra lipenská"). A lone lower-case form is an ordinary word as
  // often as a name ("hlavy" for a patient Hlava), so it is left; DATA-PROTECTION.md lists the limit.
  const person = (names: string[], kind: IdentifierKind, ph?: string) => {
    // Form -> the name part it declines, so "hlavy Hlava" (one part twice) is not taken for a full name.
    const partOf = new Map<string, number>();
    nameParts(names).forEach((part, i) => nameForms(part).forEach((f) => partOf.set(f, i)));
    words.forEach((w, k) => {
      const mine = partOf.get(w.w);
      if (mine === undefined) return;
      const other = (o: typeof w | undefined) => !!o && partOf.has(o.w) && partOf.get(o.w) !== mine;
      const next = words[k + 1];
      const prev = words[k - 1];
      if (w.upper || (other(next) && joined(w, next!)) || (other(prev) && joined(prev!, w))) push(w.start, w.end, kind, ph);
    });
  };
  person(id.patientNames, "patient_name");
  // Staff placeholders are numbered by the person, so the model can tell two authors apart without their names.
  id.staffNames.forEach((name, i) => person([name], "staff_name", `[PERSONAL_${i + 1}]`));

  each(TITLED, (m) => {
    const name = m[1]!;
    const start = m.index + m[0].length - name.length;
    // A staff or patient name after a title keeps its own placeholder, and takes no number here.
    if (hits.some((h) => h.start === start)) return;
    const key = fold(name);
    if (!titled.has(key)) titled.set(key, titled.size + 1);
    push(start, start + name.length, "titled_name", `[LEKAR_${titled.get(key)}]`);
  }, text);

  each(PATIENT_LABEL, (m) => {
    // The capitalized words after the label, up to three, are the name; "63 let" or a lower-case word ends it.
    let at = m.index + m[0].length;
    for (let n = 0; n < 3; n++) {
      const w = /^(\p{Lu}[\p{L}-]*)[ \t,]*/u.exec(text.slice(at));
      if (!w) break;
      push(at, at + w[1]!.length, "name_field");
      at += w[0].length;
    }
  });

  each(BIRTH_NUMBER, (m) => push(m.index, m.index + m[0].length, "birth_number"));
  each(TEN_DIGITS, (m) => {
    if (looksLikeBirthNumber(m[1]! + m[2]!)) push(m.index, m.index + m[0].length, "birth_number");
  });
  const bn = id.birthNumber ? birthNumberPattern(id.birthNumber) : null;
  if (bn) each(new RegExp(`(?<!\\d)${bn}(?!\\d)`, "g"), (m) => push(m.index, m.index + m[0].length, "birth_number"));

  each(BIRTH_LABEL, (m) => {
    const v = m[1]!;
    push(m.index + m[0].length - v.length, m.index + m[0].length, "birth_date");
  });
  const birth = birthDateOf(id);
  const bd = birth ? datePattern(birth) : null;
  if (bd) each(new RegExp(`(?<!\\d)${bd}(?!\\d)`, "g"), (m) => push(m.index, m.index + m[0].length, "birth_date"));

  each(PHONE_INTL, (m) => push(m.index, m.index + m[0].length, "phone"));
  each(PHONE_LABEL, (m) => push(m.index + m[0].length - m[1]!.length, m.index + m[0].length, "phone"));
  each(EMAIL, (m) => push(m.index, m.index + m[0].length, "email"));
  each(FIELD, (m) => {
    const label = m[1]!;
    const value = m[2]!.replace(/\s+$/, "");
    const start = m.index + m[0].indexOf(m[2]!, m[0].indexOf(label) + label.length);
    const kind: IdentifierKind = /bydliste|adresa/.test(label) ? "address" : /mail/.test(label) ? "email" : /tel/.test(label) ? "phone" : "name_field";
    push(start, start + value.length, kind);
  });

  // Overlaps: the earliest start wins, then the longest span, so "MUDr. Novák" is one hit, not two.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      if (h.end > last.end) last.end = h.end;
      continue;
    }
    out.push({ ...h });
  }
  return out;
}

type Span = { start: number; end: number; origStart: number; origEnd: number; placeholder: string };

// The pseudonymized text with its way back. The mapping and the spans are private fields: structured clone (a
// Workflow step result, a queue message) and JSON.stringify copy only `text` and `counts`, so a caller that returns
// this object from a step does not store the patient's name in the Workflow engine.
export class Pseudonymized {
  readonly #mapping: Map<string, string[]>;
  readonly #spans: Span[];
  constructor(
    readonly text: string,
    readonly counts: Partial<Record<IdentifierKind, number>>,
    mapping: Map<string, string[]>,
    spans: Span[],
  ) {
    this.#mapping = mapping;
    this.#spans = spans;
  }

  // The original strings a placeholder replaced. Server-side only.
  originals(placeholder: string): string[] {
    return [...(this.#mapping.get(placeholder) ?? [])];
  }

  // A range in the pseudonymized text -> the same range in the original text, so a quote the model returns can be
  // anchored in the page text the source viewer shows. A range that starts or ends inside a placeholder widens to it.
  originalRange(start: number, end: number): [number, number] {
    const map = (pos: number, edge: "start" | "end") => {
      let delta = 0;
      for (const s of this.#spans) {
        if (pos < s.start) break;
        if (pos < s.end || (edge === "end" && pos === s.end)) return edge === "start" ? s.origStart : pos === s.start ? s.origStart : s.origEnd;
        delta += s.origEnd - s.origStart - (s.end - s.start);
      }
      return pos + delta;
    };
    return [map(start, "start"), map(end, "end")];
  }
}

export function pseudonymize(text: string, id: CaseIdentity, titled: TitledNumbers = new Map()): Pseudonymized {
  const hits = detectIdentifiers(text, id, titled);
  const mapping = new Map<string, string[]>();
  const spans: Span[] = [];
  const counts: Partial<Record<IdentifierKind, number>> = {};
  let out = "";
  let at = 0;
  for (const h of hits) {
    out += text.slice(at, h.start);
    const orig = text.slice(h.start, h.end);
    spans.push({ start: out.length, end: out.length + h.placeholder.length, origStart: h.start, origEnd: h.end, placeholder: h.placeholder });
    out += h.placeholder;
    const list = mapping.get(h.placeholder) ?? [];
    if (!list.includes(orig)) list.push(orig);
    mapping.set(h.placeholder, list);
    counts[h.kind] = (counts[h.kind] ?? 0) + 1;
    at = h.end;
  }
  out += text.slice(at);
  return new Pseudonymized(out, counts, mapping, spans);
}

// Counts per kind, for a refusal or a log line: never the values.
export const countKinds = (hits: Hit[]) => hits.reduce<Partial<Record<IdentifierKind, number>>>((c, h) => ((c[h.kind] = (c[h.kind] ?? 0) + 1), c), {});
