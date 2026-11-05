// The de-identified, dated clinical profile the prognosis study search sends to the model, built from a case's
// processed view data (CaseData). A port of prognosis/service.py (profile_for, date_end, clean_text) for any case,
// not only the two mock fixtures. Pure: no I/O, no clock. The caller passes the cutoff day and the names to scrub.
//
// Rules that keep the profile safe to send out: a fact enters only with a date; a fact dated after the cutoff (the MDT
// day, or today) is left out, so the search never sees what the MDT could not know; partial dates keep their original
// precision and count by their latest possible day; no identity header, author, source file name or document is sent.

import type { CaseData, Item, SourceRef } from "./case-data";

export type ProfileFact = { text: string; date: string; source: { page: number | string | null; quote: string }; kind: string; status: string; certainty: string };
export type Profile = { available: true; included_count: number; synthetic: boolean; scheduled_date: string; facts: ProfileFact[]; excluded_undated: number; excluded_after_cutoff: number; warnings: string[] };
export type ProfileProblem = { code: "invalid_date" | "empty_profile" | "not_processed"; message_cs: string };

const MAX_TEXT = 4000;
const RANGE_SPLIT = /\s(?:až|do|–)\s/;
// Dates inside a fact's own text or quote: a later one means the fact describes something after the cutoff.
const EMBEDDED_DATE = /(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\/(?:\d{4}|\d{2}))(?!\d)/g;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number): string | null => {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lastDay(year, month)) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
};

// The upper bound of a date at its original precision, as YYYY-MM-DD, so a partly future month is excluded.
// A range takes its latest end and needs every boundary readable; anything unreadable gives null.
export function dateEnd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (RANGE_SPLIT.test(v)) {
    const ends = v.split(RANGE_SPLIT).map(dateEnd);
    return ends.length && ends.every((e) => e) ? (ends as string[]).reduce((a, b) => (a >= b ? a : b)) : null;
  }
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return iso(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{4})-(\d{2})$/.exec(v))) return iso(+m[1]!, +m[2]!, lastDay(+m[1]!, +m[2]!));
  if ((m = /^(\d{4})$/.exec(v))) return iso(+m[1]!, 12, 31);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v))) return iso(+m[3]!, +m[2]!, +m[1]!);
  if ((m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(v))) {
    const month = +m[1]!;
    const year = m[2]!.length === 2 ? 2000 + +m[2]! : +m[2]!;
    return month >= 1 && month <= 12 ? iso(year, month, lastDay(year, month)) : null;
  }
  return null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A letter with the accented forms Czech and Slovak text writes it with, so a name matches also when OCR or a typist left
// the diacritics out ("Polacek" for "Poláček").
const FOLD: Record<string, string> = { a: "aáä", c: "cč", d: "dď", e: "eéěë", i: "ií", l: "lĺľ", n: "nň", o: "oóô", r: "rř", s: "sš", t: "tť", u: "uúůü", y: "yý", z: "zž" };
const letterClass = (ch: string) => {
  const lower = ch.toLowerCase();
  const base = Object.keys(FOLD).find((k) => FOLD[k]!.includes(lower)) ?? lower;
  return FOLD[base] ? `[${FOLD[base]}]` : escapeRe(lower);
};

// A pattern for one word of a name. Czech names change their ending ("Poláček", "Poláčka", "Poláčkovi", "Poláčkem"), so a
// name of 6+ letters is matched by its stem (without the last two letters) plus up to four more letters; a name of 5
// letters by itself plus up to four; a shorter one (Jan, Eva, Ota) only as a whole word. Matching is case-blind and
// ignores diacritics. Words of fewer than 3 letters are not scrubbed: they would eat ordinary words.
function namePattern(word: string): string | null {
  const letters = [...word.normalize("NFC")].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3) return null;
  const stem = letters.length >= 6 ? letters.slice(0, letters.length - 2) : letters;
  const tail = letters.length >= 5 ? "[\\p{L}]{0,4}" : "";
  return `(?<![\\p{L}\\p{N}])${stem.map(letterClass).join("")}${tail}(?![\\p{L}\\p{N}])`;
}

// Scrubs names (every word of a forbidden name, in any case ending, with or without diacritics), birth numbers with or
// without the slash, "nar. D.M.YYYY", author titles with names, phone numbers and e-mail addresses; caps the length. A
// surname alone is as identifying as the full name. A birth date is only scrubbed where the text says it is one: clinical
// dates stay. Addresses are not recognised.
export function cleanText(text: unknown, forbidden: readonly string[] = []): string {
  if (typeof text !== "string") return "";
  const patterns = new Set<string>();
  for (const f of forbidden) {
    const full = (f || "").trim();
    if (!full) continue;
    for (const word of full.split(/[\s,.\-]+/)) {
      const p = namePattern(word);
      if (p) patterns.add(p);
    }
  }
  let out = text;
  for (const p of patterns) out = out.replace(new RegExp(p, "giu"), "[odstraněný identifikátor]");
  out = out.replace(/\b\d{6}\s*\/\s*\d{3,4}\b/g, "[odstraněné RČ]");
  out = out.replace(/(?<!\d)\d{9,10}(?!\d)/g, "[odstraněné RČ]");
  out = out.replace(/\bnar(?:\.|ozen[aáoy]?)\s*:?\s*\d{1,2}\.\s?\d{1,2}\.\s?\d{4}/giu, "[odstraněné datum narození]");
  out = out.replace(/\b(?:MUDr|MVDr|RNDr|JUDr|PhDr|Mgr|Ing|Bc|Dr|doc|prof)\.\s+[^,;()\n]+/g, "[odstraněný autor]");
  out = out.replace(/(?<!\d)(?:\+?42[01]\s?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g, "[odstraněný kontakt]");
  out = out.replace(/[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_.-]+\.[A-Za-z]{2,}/gu, "[odstraněný kontakt]");
  return out.slice(0, MAX_TEXT);
}

const srcOf = (cd: CaseData, item: Item | undefined): Partial<SourceRef> => {
  const direct = item?.source as SourceRef | undefined;
  if (direct) return direct;
  const i = Array.isArray(item?.refs) ? item!.refs[0] : undefined;
  return (typeof i === "number" ? cd.refs[i] : undefined) ?? {};
};
const pageOf = (s: Partial<SourceRef>): number | string | null => (typeof s.page === "number" || typeof s.page === "string" ? s.page : null);
const plannedOf = (item: Item) => item.status === "planned" || /^planned/.test(String(item.change_status ?? ""));
const joinText = (...parts: unknown[]) => {
  const seen: string[] = [];
  for (const p of parts) if (typeof p === "string" && p.trim() && !seen.includes(p.trim())) seen.push(p.trim());
  return seen;
};

export function buildProfile(cd: CaseData | null | undefined, scheduledDate: string, opts: { forbidden?: string[]; synthetic: boolean }): Profile | ProfileProblem {
  // An unprocessed case has nothing to profile; say so before judging the date.
  if (!cd || (!cd.record && !cd.labs)) return { code: "not_processed", message_cs: "Nedostatek údajů: případ zatím není zpracovaný, klinický profil nelze sestavit." };
  if (typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { code: "invalid_date", message_cs: "Vyberte datum naplánovaného MDT." };
  const cutoff = dateEnd(scheduledDate);
  if (!cutoff) return { code: "invalid_date", message_cs: "Datum MDT není platné." };

  const forbidden = opts.forbidden ?? [];
  const facts: ProfileFact[] = [];
  let undated = 0;
  let future = 0;

  const add = (text: string, date: string | null | undefined, source: Partial<SourceRef>, kind: string, status = "documented", certainty = "documented") => {
    const end = dateEnd(date);
    if (end === null) { undated++; return; }
    if (end > cutoff) { future++; return; }
    // A fact dated at treatment start can describe its later end or follow-up.
    const embedded = `${text} ${source.quote ?? ""}`.match(EMBEDDED_DATE) ?? [];
    if (embedded.some((d) => { const e = dateEnd(d); return e !== null && e > cutoff; })) { future++; return; }
    const clean = cleanText(text, forbidden);
    if (clean) facts.push({ text: clean, date: String(date).trim(), source: { page: pageOf(source), quote: cleanText(source.quote ?? "", forbidden) }, kind, status, certainty });
  };

  const rec = cd.record;
  if (rec) {
    for (const e of rec.timeline ?? []) {
      // The full original date (ranges included), not date_sort's start.
      const text = joinText(e.title_cs, e.text_cs).join(": ");
      add(text, e.date, srcOf(cd, e), e.category || e.type || e.kind || "clinical", e.status === "planned" ? "planned" : "documented", e.certainty ?? "documented");
    }
    for (const [section, items] of Object.entries(rec.sections ?? {})) {
      for (const it of items ?? []) add(it.text_cs, it.date, srcOf(cd, it), it.fact_kind || section, plannedOf(it) ? "planned" : "documented", it.certainty ?? "documented");
    }
    // OA comorbidities, FA current medication, AA allergies. An item with no date of its own is undated, never given the
    // visit's date.
    for (const key of ["OA", "FA", "AA"]) {
      for (const it of rec.anamnesis?.[key] ?? []) {
        const text = joinText(it.term_cs ?? it.drug_cs, it.comment_cs ?? it.comment_line_cs).join(": ");
        add(text, it.date, srcOf(cd, it), "anamnesis", plannedOf(it) ? "planned" : "documented", it.certainty ?? "documented");
      }
    }
    // Only the status group (ECOG and the like); vital signs and exam details stay out of the profile.
    const sp = rec.status_praesens;
    for (const it of sp?.items ?? []) {
      if (it.group !== "status") continue;
      const text = joinText(it.label_cs, it.text_cs).join(": ");
      add(text, sp?.exam_date_cs, srcOf(cd, it), "status_praesens", "documented", it.certainty ?? "documented");
    }
  }

  // The latest dated result per test, with its original unit, reference range and quote.
  const labs = cd.labs;
  if (labs) {
    const line = (code: string, value: unknown, unit: unknown, range: unknown) => `${code}: ${value ?? ""} ${unit ?? ""}; referenční rozmezí ${range ?? ""}`.replace(/\s+;/, ";");
    for (const t of labs.series?.tests ?? []) {
      const ok = (t.points ?? []).filter((p) => { const e = dateEnd(p.date); return e !== null && e <= cutoff; });
      if (!ok.length) { if ((t.points ?? []).length) future++; continue; }
      const p = ok.reduce((a, b) => (dateEnd(b.date)! >= dateEnd(a.date)! ? b : a));
      add(line(t.code || t.name_cs, p.value, t.unit, t.reference_range), p.date, srcOf(cd, p), "laboratory", "documented", p.certainty ?? "documented");
    }
    // Values outside the series keep the date as written (maybe partial or none); one result per test.
    const latest = new Map<string, Item>();
    for (const v of labs.values ?? []) {
      const k = `${v.code || v.name_cs}|${v.unit ?? ""}`;
      const e = dateEnd(v.date);
      const prev = latest.get(k);
      const pe = prev ? dateEnd(prev.date) : null;
      // An undated value never displaces a dated one; among dated values that fit the cutoff the latest wins.
      if (!prev || (e !== null && e <= cutoff && (pe === null || pe > cutoff || e >= pe)) || (pe === null && e === null)) latest.set(k, v);
      else if (e === null) undated++;
      else if (e > cutoff && (pe === null || pe <= cutoff)) future++;
    }
    for (const v of latest.values()) add(line(v.code || v.name_cs, v.value, v.unit, v.reference_range), v.date, srcOf(cd, v), "laboratory", "documented", v.certainty ?? "documented");
  }

  // The brief covers the whole record, so it is as old as the newest document it can rest on; unknown if any
  // document has no date.
  const b = cd.brief;
  if (b?.text_cs) {
    const docs = cd.documents?.documents ?? [];
    const ends = docs.map((d) => dateEnd(d.date));
    const date = docs.length && ends.every((e) => e) ? docs[ends.indexOf((ends as string[]).reduce((a, c) => (a >= c ? a : c)))]!.date : null;
    const text = b.text_cs.replace(/\s*\[\d+\]/g, "");
    add(text, date, { ...(b.refs[0] ?? {}), quote: text }, "summary");
  }

  const seen = new Set<string>();
  const unique = facts.filter((f) => { const k = `${f.text}\u0000${f.date}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!unique.length) return { code: "empty_profile", message_cs: "K datu MDT nejsou dostupné bezpečně datované údaje." };
  return {
    available: true,
    included_count: unique.length,
    synthetic: opts.synthetic,
    scheduled_date: scheduledDate,
    facts: unique,
    excluded_undated: undated,
    excluded_after_cutoff: future,
    warnings: [
      `Vynecháno ${undated} nedatovaných a ${future} údajů přesahujících datum MDT.`,
      "Nedatované údaje jsou vynechány. Profil nemusí obsahovat aktuální ECOG, věk ani všechny komorbidity.",
      "Historický stav neprokazuje aktuální stav. Plánovaná léčba není podaná léčba.",
    ],
  };
}
