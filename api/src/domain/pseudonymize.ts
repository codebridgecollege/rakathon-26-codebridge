// Text pseudonymization before any external model call (DATA-PROTECTION.md, "Text sent to a model").
//
// The case patient's name, birth number, birth date, address and phone, and the names of the org's staff, are
// replaced by placeholders such as [PACIENT] or [PERSONAL_2]. The mapping back to the original text stays in the
// Worker's memory (`Pseudonymized.spans`, `.mapping`): it is never part of a prompt, a log line, a Workflow step result
// or an R2 object. `detectIdentifiers` runs the same rules over the final payload, and the model call refuses to send
// it when anything is found (services/model.ts).
//
// Pseudonymized text is still personal data (GDPR recital 26): diagnoses, dates and places stay, on purpose, because
// they are the medical content.
//
// Matching is done on a folded copy of the text (lowercase, no diacritics) that keeps every character at the same
// offset, so OCR output without diacritics ("Polacek") is matched too, and spans map 1:1 to the original.
//
// Known limits (documented in DATA-PROTECTION.md):
// - An OCR misread inside a name ("Lipcnská") is not matched.
// - Staff names are matched only when capitalized, because several are ordinary Czech words ("Malá", "Černý",
//   "Veselá": "malé pánve" must stay readable). A staff name written in lower case is missed.
// - The patient's name is matched in any case: their identity outweighs an over-replaced ordinary word.
// - Other people's names without a title (relatives, external doctors) are found only after a title (MUDr., ...)
//   or a form label (Jméno:, Příjmení:); there is no Czech name recognizer yet.

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

// Name parts long enough to be a name; initials and particles are not matched on their own.
const nameParts = (names: string[]) =>
  [...new Set(names.flatMap((n) => (n ?? "").split(/[\s,]+/)).map((p) => p.replace(/[.()]/g, "").trim()).filter((p) => p.length > 2))];

// "12.3.1964" -> a pattern that also matches "12. 03. 1964" and "1964-03-12".
function datePattern(asWritten: string): string | null {
  const m = /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})/.exec(asWritten);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3]!;
  const dd = `0?${d}`;
  const mm = `0?${mo}`;
  return `(?:${dd}\\s*\\.\\s*${mm}\\s*\\.\\s*${y}|${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")})`;
}

// "645312/1234" -> digits with any spacing or slash between them.
function birthNumberPattern(bn: string): string | null {
  const digits = bn.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.split("").join("[\\s/]{0,2}");
}

// Titles match in any case ("MUDR.", "mudr."), the name after them only when capitalized, so "MUDr. Novák
// doporučuje" takes "Novák" and not the verb. JavaScript has no case-insensitive group, so each letter is a class.
const anyCase = (w: string) => w.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const TITLES = ["mudr", "mddr", "mvdr", "doc", "prof", "phdr", "mgr", "bc", "ing", "judr", "rndr", "dr", "prim"].map(anyCase).join("|");
// A title, then one or two words on the same line: "MUDr. Jana Hofrová", "MUDr.Hofrová", "prim. MUDr. Novák",
// "MUDr. NOVÁK", "mudr. novák". The first word after a title is a name in any case; a second word must be in title
// case, so "MUDr. Novák CT" keeps "CT". A title must end in a dot or a space, so the start of an upper-case word
// ("DRENÁŽ", "INGUINÁLNÍ") is not a title.
const TITLED = new RegExp(`(?<![\\p{L}])(?:${TITLES})(?:\\.[\\s,]*|[\\s,]+)(?:(?:${TITLES})(?:\\.\\s*|\\s+))*(\\p{L}[\\p{L}-]+(?:[ \\t]+\\p{Lu}\\p{Ll}[\\p{L}-]*)?)`, "gu");
const BIRTH_NUMBER = /(?<!\d)\d{6}\s?\/\s?\d{3,4}(?!\d)/g;
const BIRTH_LABEL = /(?<![\p{L}])(?:nar|narozena|narozen|dat\.\s*nar|datum\s+narozeni)\.?\s*:?\s*(\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*\d{2,4})/giu;
const PHONE = /(?<![\d])(?:\+420[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\d])/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// A form label at the start of a line (or after a separator), then its value to the end of the line.
const FIELD = /(?:^|[\n|;])[ \t]*(jmeno a prijmeni|jmeno|prijmeni|trvale bydliste|bydliste|adresa|kontaktni osoba|zakonny zastupce|telefon|tel|e-mail|email)[ \t]*[.:]{1,2}[ \t]*([^\n|;]+)/g;

const PLACEHOLDER: Record<Exclude<IdentifierKind, "staff_name" | "titled_name">, string> = {
  patient_name: "[PACIENT]",
  birth_number: "[RC]",
  birth_date: "[DATUM_NAROZENI]",
  phone: "[TELEFON]",
  email: "[EMAIL]",
  address: "[ADRESA]",
  name_field: "[JMENO]",
};

// Every identifier in `text`, non-overlapping, in order. Pure; used both to pseudonymize and to check a payload.
export function detectIdentifiers(text: string, id: CaseIdentity): Hit[] {
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

  const patientForms = new Set(nameParts(id.patientNames).flatMap(nameForms));
  for (const w of words) if (patientForms.has(w.w)) push(w.start, w.end, "patient_name");

  // Staff placeholders are numbered by the person, so the model can tell two authors apart without their names.
  // A staff name alone counts only when capitalized; a full name (two parts of the same person next to each other,
  // "jana nováková") counts in any case, because two parts together are not an ordinary phrase.
  id.staffNames.forEach((person, i) => {
    const parts = nameParts([person]);
    const forms = new Set(parts.flatMap(nameForms));
    const ph = `[PERSONAL_${i + 1}]`;
    words.forEach((w, k) => {
      if (!forms.has(w.w)) return;
      const next = words[k + 1];
      const pair = parts.length > 1 && next && forms.has(next.w) && next.w !== w.w && /^[\s,]+$/.test(f.slice(w.end, next.start));
      if (pair) {
        push(w.start, w.end, "staff_name", ph);
        push(next.start, next.end, "staff_name", ph);
      } else if (w.upper) push(w.start, w.end, "staff_name", ph);
    });
  });

  // Names after a title are numbered by their first appearance in this text.
  const titled = new Map<string, number>();
  each(TITLED, (m) => {
    const name = m[1]!;
    const start = m.index + m[0].length - name.length;
    // A staff or patient name after a title keeps its own placeholder, and takes no number here.
    if (hits.some((h) => h.start === start)) return;
    const key = name.toLowerCase();
    if (!titled.has(key)) titled.set(key, titled.size + 1);
    push(start, start + name.length, "titled_name", `[LEKAR_${titled.get(key)}]`);
  }, text);

  each(BIRTH_NUMBER, (m) => push(m.index, m.index + m[0].length, "birth_number"));
  const bn = id.birthNumber ? birthNumberPattern(id.birthNumber) : null;
  if (bn) each(new RegExp(`(?<!\\d)${bn}(?!\\d)`, "g"), (m) => push(m.index, m.index + m[0].length, "birth_number"));

  each(BIRTH_LABEL, (m) => {
    const v = m[1]!;
    push(m.index + m[0].length - v.length, m.index + m[0].length, "birth_date");
  });
  const bd = id.birthDate ? datePattern(id.birthDate) : null;
  if (bd) each(new RegExp(`(?<!\\d)${bd}(?!\\d)`, "g"), (m) => push(m.index, m.index + m[0].length, "birth_date"));

  each(PHONE, (m) => push(m.index, m.index + m[0].length, "phone"));
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

export type Pseudonymized = {
  text: string;
  // Placeholder -> the original strings it replaced. Server-side only.
  mapping: Map<string, string[]>;
  // Where each placeholder sits in `text` and what it replaced in the original, for mapping a quote back.
  spans: { start: number; end: number; origStart: number; origEnd: number; placeholder: string }[];
  counts: Partial<Record<IdentifierKind, number>>;
};

export function pseudonymize(text: string, id: CaseIdentity): Pseudonymized {
  const hits = detectIdentifiers(text, id);
  const mapping = new Map<string, string[]>();
  const spans: Pseudonymized["spans"] = [];
  const counts: Pseudonymized["counts"] = {};
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
  return { text: out, mapping, spans, counts };
}

// A range in the pseudonymized text -> the same range in the original text, so a quote the model returns can be
// anchored in the page text the source viewer shows. A range that starts or ends inside a placeholder widens to it.
export function originalRange(p: Pseudonymized, start: number, end: number): [number, number] {
  const map = (pos: number, edge: "start" | "end") => {
    let delta = 0;
    for (const s of p.spans) {
      if (pos < s.start) break;
      if (pos < s.end || (edge === "end" && pos === s.end)) return edge === "start" ? s.origStart : pos === s.start ? s.origStart : s.origEnd;
      delta += s.origEnd - s.origStart - (s.end - s.start);
    }
    return pos + delta;
  };
  return [map(start, "start"), map(end, "end")];
}

// Counts per kind, for a refusal or a log line: never the values.
export const countKinds = (hits: Hit[]) => hits.reduce<Partial<Record<IdentifierKind, number>>>((c, h) => ((c[h.kind] = (c[h.kind] ?? 0) + 1), c), {});
