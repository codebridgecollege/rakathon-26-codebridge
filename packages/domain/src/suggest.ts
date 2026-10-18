// Task drafts from an approved conclusion (mock v3 round 19), ported from suggestTasks() in mocks/src/v3-template.html.
// Simple phrase rules: a draft quotes the clause it came from, never adds a step the conclusion does not state, and
// becomes a task only when a doctor confirms it. Due dates count from the approval day passed in (the mock used a
// fixed TODAY); only "za N dní/týdnů/měsíců" with a single N gives a date, anything else keeps its wording and no date.
import { addDays, addMonths } from "./time";

const SUGG_RULES: [RegExp, string][] = [
  [/kontrolní\s+(MR|CT|PET|UZ|RTG|vyšetření)/i, "Objednat"],
  [/odesl(at|án|ána|ání)\s+(k|na|do)\b/i, "Zajistit odeslání"],
  [/radioterapi|stereotakti|\bSRS\b|\bRT\b|ozáření/i, "Domluvit radioterapii"],
  [/kontrol(a|u)\s+(za|v|po|na)\b/i, "Objednat kontrolu"],
  [/doplnit|dovyšetř/i, "Zajistit doplnění"],
  [/znovu\s+na\s+MDT|opět\s+na\s+MDT|představit\s+na\s+MDT|předložit/i, "Naplánovat MDT"],
];

// JavaScript's \b only knows ASCII letters, so word edges are lookarounds over \p{L}; "ledna" is listed in full
// because a "led" prefix would also match "ledvina".
const MONTHS_CS =
  "leden|ledna|lednu|únor|února|únoru|březen|března|březnu|duben|dubna|dubnu|květen|května|květnu|červen|června|červnu|červenec|července|červenci|srpen|srpna|srpnu|září|říjen|října|říjnu|listopad|listopadu|prosinec|prosince|prosinci";
const TIMING_RE = [
  /(?<![\p{L}\d])za\s+\d+\s*(?:[-–]|až)\s*\d+\s*\p{L}+/giu, // range: "za 2-3 měsíce"
  /(?<![\d.])\d{1,2}\.\s?\d{1,2}\.(?:\s?\d{4})?/gu, // date: "9.10.2026"
  /(?<![\d./])\d{1,2}\/\d{2,4}(?!\d)/gu, // month/year: "1/2027"
  /(?<![\p{L}\d./])(?:v\s+roce\s+|r\.\s?)?(?:19|20)\d{2}(?!\d)/giu, // year: "v roce 2028"
  new RegExp(`(?<![\\p{L}])(?:v\\s+)?(?:${MONTHS_CS})(?![\\p{L}])(?:\\s+\\d{4})?`, "giu"), // "v lednu 2027"
  /(?<![\p{L}\d])za\s+\d+\s*(?:dn|den|týd|měs)\p{L}*/giu, // single interval: "za 3 měsíce"
];

export type DueSource = "computed" | "none";
export type Due = { due: string; dueSrc: DueSource; timing: string };

export function dueFrom(clause: string, approvalDay: string): Due {
  const said = [...new Set(TIMING_RE.flatMap((re) => [...clause.matchAll(re)].map((m) => m[0].trim())))];
  const single = clause.match(/(?<![\p{L}\d])za\s+(\d+)\s*(dn|den|týd|měs)/iu);
  // Any other timing in the clause (a date, a month, a range) wins over the interval, so nothing is guessed.
  const other = said.filter((t) => !/^za\s+\d+\s*(dn|den|týd|měs)/iu.test(t));
  // An interval counted from another event ("za 3 měsíce po ukončení radioterapie") or a second interval would make
  // the date a guess, so the wording stays and a person fills the date in.
  const anchored = /(?<![\p{L}\d])za\s+\d+\s*\p{L}+\s+(?:po|od)(?![\p{L}])/iu.test(clause);
  const intervals = [...clause.matchAll(/(?<![\p{L}\d])za\s+\d+\s*(?:dn|den|týd|měs)/giu)].length;
  if (!single || other.length || anchored || intervals > 1) return { due: "", dueSrc: "none", timing: said.join(", ") };
  const n = Number(single[1]);
  const u = single[2]!.toLowerCase();
  return {
    due: u.startsWith("měs") ? addMonths(approvalDay, n) : addDays(approvalDay, u.startsWith("týd") ? n * 7 : n),
    dueSrc: "computed",
    timing: said.join(", "),
  };
}

// A negated clause ("radioterapie není indikována", "bez nutnosti doplnit") must not become a task. Negation is read
// from whole words, not from a "ne" prefix, because "nefrektomie" or "neurochirurg" are not negations.
// Server additions to the mock's list (review of step 4): contraindication, refusal, past negation, "not needed".
const NEG_RE =
  /(?:^|[^\p{L}])(?:ne|není|nejsou|nebude|nebudou|nelze|bez|nedoporuč\p{L}*|neindik\p{L}*|neprovád\p{L}*|neplánuj\p{L}*|kontraindik\p{L}*|odmít\p{L}*|nebyl\p{L}*|netřeba|nevyžad\p{L}*|nepotřeb\p{L}*|nezbytn\p{L}*\s+není|zbytečn\p{L}*|upouští\p{L}*|upustit)(?![\p{L}])/iu;

export type Suggestion = { text: string; quote: string } & Due;

export function suggestTasks(conclusion: string, approvalDay: string): Suggestion[] {
  // Clauses split at ";", line breaks, and "." or "," not followed by a digit, so "9.10.2026" stays whole.
  const clauses = String(conclusion).split(/[;\n]|[.,](?!\d)/).map((x) => x.trim()).filter(Boolean);
  const out: Suggestion[] = [];
  for (const c of clauses) {
    if (NEG_RE.test(c)) continue;
    const r = SUGG_RULES.find(([re]) => re.test(c));
    if (r) out.push({ text: `${r[1]}: ${c}`, quote: c, ...dueFrom(c, approvalDay) });
  }
  return out;
}
