// The side panel's "Léčebné modality" check: for each common treatment modality, the facts in the documentation that
// are known to bear on it (an autoimmune disease for immunotherapy, a low ejection fraction for some chemotherapy, a
// poor spirometry for lung surgery). Pure, so the rules are tested without a screen.
//
// What it is and is not (CLAUDE.md, "The assistant prepares, the doctor decides"): it looks through the facts the
// extraction already holds and names the ones that match a rule, each with its source. It never ranks or recommends a
// treatment and never says a modality is safe: a modality with no hit shows nothing, and the data a rule needs but the
// documentation lacks (EF, spirometry, kidney function) is listed as missing, in the fixed gap wording, because
// silence is a gap, not an all-clear. A negated fact ("bez autoimunitního onemocnění") never matches. The numeric
// limits are rough, common cut-offs shown beside the value so the doctor sees what was applied; they are for a doctor
// to confirm or change before this goes beyond the demo.
import { refAt, type CaseData, type Item, type SourceRef } from "./case-data";

export const MODALITIES = ["immuno", "chemo", "radio", "surgery"] as const;
export type Modality = (typeof MODALITIES)[number];

export type ModalityFinding = {
  rule: string;
  // The documented fact as written, shortened.
  text: string;
  // Why it bears on the modality, in the content language (the assistant's observation, not the document's).
  why_cs: string;
  source: SourceRef | undefined;
  // The fact's own date when it has one, so an old value is not read as a current one.
  date: string | null;
  // The extraction's item, for its certainty marks (Marks.vue).
  item: Item;
};
export type ModalityCheck = { modality: Modality; findings: ModalityFinding[] };
export type ModalityChecks = {
  // Only modalities with at least one finding, in the fixed order of MODALITIES.
  checks: ModalityCheck[];
  // Data the rules use that the documentation does not give at all.
  missing: ("ef" | "spirometry" | "kidney")[];
};

type Ev = { text: string; shown: string; source: SourceRef | undefined; item: Item; lab: Item | null; date: string | null; negated: boolean; suspected: boolean };
type Hit = { shown?: string };
type Rule = { id: string; modalities: Modality[]; why_cs: string; test: (e: Ev, folded: string) => Hit | null };

export const EF_BELOW = 50;
export const LUNG_FUNCTION_BELOW = 60;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const re = (r: RegExp) => (_e: Ev, f: string): Hit | null => (r.test(f) ? {} : null);
const num = (f: string, r: RegExp) => {
  const m = r.exec(f);
  return m ? Number(m[1]) : null;
};
// The gap before the number stops at a digit, a clause end or a percent sign, so "EF nezměřena, hematokrit 30 %" is not an EF.
// A range ("55-60 %") gives its lower value; "FEV1/FVC" is not FEV1.
const GAP = "[^%;.,\\n\\d]{0,25}";
const EF_RE = new RegExp(`(?:\\bef\\b|\\blvef\\b|ejekcni frakce)${GAP}(\\d{1,3})(?:\\s*[-–]\\s*\\d{1,3})?\\s*(?:%|procent)`);
const EF_FRACTION_RE = new RegExp(`(?:\\bef\\b|\\blvef\\b)${GAP}0[,.](\\d{1,2})\\b`);
const FEV1_RE = new RegExp(`fev\\s?1(?!\\s*/)${GAP}(\\d{1,3})(?:\\s*[-–]\\s*\\d{1,3})?\\s*%`);
const DLCO_RE = new RegExp(`(?:dlco|tlco)${GAP}(\\d{1,3})(?:\\s*[-–]\\s*\\d{1,3})?\\s*%`);
const efOf = (f: string) => num(f, EF_RE) ?? (num(f, EF_FRACTION_RE) !== null ? Number(`${/0[,.](\d{1,2})/.exec(f.slice(f.search(EF_FRACTION_RE)))![1]!.padEnd(2, "0")}`) : null);
const below = (r: RegExp, limit: number) => (_e: Ev, f: string): Hit | null => {
  const v = num(f, r);
  return v !== null && v < limit ? {} : null;
};
// A lab the document itself marks out of its reference range, so no limit of ours is applied.
const labOut = (name: RegExp, dir: "high" | "low") => (e: Ev): Hit | null =>
  e.lab && name.test(fold(String(e.lab.name_cs ?? ""))) && e.lab.out_of_range === dir ? {} : null;

const RULES: Rule[] = [
  { id: "autoimmune", modalities: ["immuno"], why_cs: "Autoimunitní onemocnění je u imunoterapie uváděno jako riziko (zhoršení nemoci).",
    test: re(/autoimun|cholangoitid|ulcerozni kolitid|crohn|revmatoid|lupus(?! (?:pernio|antikoag))|sklerodermi|myasteni|thyreoiditid|hashimoto|sarkoidoz|vaskulitid/) },
  { id: "ild", modalities: ["immuno", "radio"], why_cs: "Plicní intersticiální postižení nebo pneumonitida zvyšuje riziko plicní toxicity.",
    test: re(/intersticial|pneumonitid|plicni fibroz/) },
  { id: "immunosuppression", modalities: ["immuno"], why_cs: "Transplantace nebo imunosuprese (včetně kortikoterapie) může účinek imunoterapie oslabit.",
    test: (e, f) => (/inhalac|mast\b|krem/.test(f) ? null : re(/transplantac|imunosupres|kortikoter|prednis|methylprednis/)(e, f)) },
  { id: "hepatitis", modalities: ["immuno"], why_cs: "Zánět jater nebo jeho nález se u imunoterapie sleduje.", test: (e, f) => (/steatohepatitid|ockov|vakcinac/.test(f) ? null : re(/hepatitid/)(e, f)) },
  { id: "ef-low", modalities: ["chemo", "surgery"], why_cs: `Snížená ejekční frakce (pod ${EF_BELOW} %) je u kardiotoxické léčby a před operací důvodem k posouzení kardiologem.`,
    test: (_e, f) => {
      const v = efOf(f);
      return v !== null && v < EF_BELOW ? {} : null;
    } },
  { id: "heart-failure", modalities: ["chemo", "surgery"], why_cs: "Srdeční selhání nebo kardiomyopatie bývá důvodem upravit léčbu nebo ji konzultovat s kardiologem.",
    test: re(/srdecni selhani|kardiomyopati/) },
  { id: "heart-disease", modalities: ["surgery"], why_cs: "Ischemická choroba srdeční, infarkt nebo poruchy rytmu zvyšují riziko operace.",
    test: re(/infarkt(?! (?:sleziny|ledviny|mozku|plic))|ischemick\w* choroba srdecni|\bfibrilac|av blok/) },
  { id: "fev1-low", modalities: ["surgery", "radio"], why_cs: `FEV1 pod ${LUNG_FUNCTION_BELOW} % predikované hodnoty omezuje plicní resekci a zvyšuje riziko plicní toxicity ozáření.`,
    test: below(FEV1_RE, LUNG_FUNCTION_BELOW) },
  { id: "dlco-low", modalities: ["surgery", "radio"], why_cs: `DLCO pod ${LUNG_FUNCTION_BELOW} % predikované hodnoty omezuje plicní resekci a zvyšuje riziko plicní toxicity ozáření.`,
    test: below(DLCO_RE, LUNG_FUNCTION_BELOW) },
  { id: "copd", modalities: ["surgery"], why_cs: "Chronická obstrukční plicní nemoc zvyšuje pooperační plicní komplikace.",
    test: re(/chronicka obstrukcni plicni|\bchopn\b|(?<!podkozni )emfyzem/) },
  { id: "kidney", modalities: ["chemo"], why_cs: "Porucha funkce ledvin bývá důvodem upravit dávku nebo volbu léku (například platiny).",
    test: (e, f) => re(/renalni insuficien|ledvinn\w* selhani|selhani ledvin|\bckd\b|dialyz|chronicke onemocneni ledvin|snizena funkce ledvin/)(e, f) ?? labOut(/egfr|clearance|glomerul/, "low")(e) },
  { id: "liver", modalities: ["chemo"], why_cs: "Porucha funkce jater bývá důvodem upravit dávku léků odbourávaných v játrech.",
    test: (e, f) => re(/jaterni (?:selhani|insuficien)|selhani jater|cirhoz|cholestat?z|cholestatick/)(e, f) ?? labOut(/bilirubin/, "high")(e) },
  { id: "blood-count", modalities: ["chemo"], why_cs: "Krevní obraz pod referenčním rozmezím (neutrofily, trombocyty) omezuje myelosupresivní léčbu.",
    test: (e) => labOut(/neutrofil|trombocyt|leukocyt/, "low")(e) },
  { id: "neuropathy", modalities: ["chemo"], why_cs: "Neuropatie se u taxanů a platiny může zhoršit.", test: re(/neuropati/) },
  { id: "connective", modalities: ["radio"], why_cs: "Onemocnění pojiva (sklerodermie, lupus, revmatoidní artritida) zvyšuje riziko toxicity ozáření.",
    test: re(/sklerodermi|lupus(?! (?:pernio|antikoag))|revmatoid/) },
  { id: "device", modalities: ["radio"], why_cs: "Kardiostimulátor nebo defibrilátor v poli ozáření vyžaduje zvláštní postup.", test: re(/kardiostimul|defibrilator/) },
  { id: "anticoagulant", modalities: ["surgery"], why_cs: "Antikoagulace vyžaduje před výkonem plán jejího přerušení.",
    test: re(/(?<!lupus )antikoagul|warfarin|apixaban|rivaroxaban|dabigatran|edoxaban/) },
  { id: "ps", modalities: ["immuno", "chemo", "surgery"], why_cs: "Výkonnostní stav 2 nebo horší omezuje intenzivní léčbu.", test: (e) => {
    if (e.item.what !== "ecog") return null;
    // Anchored after the label, so a date in the text is not read as the score; a range counts by its worse end.
    const m = /(?:ecog|ps)\D{0,6}([0-4])(?:\s*[-–/]\s*([0-4]))?/i.exec(String(e.item.text_cs ?? ""));
    return m && Math.max(Number(m[1]), Number(m[2] ?? 0)) >= 2 ? {} : null;
  } },
];

function evidence(cd: CaseData): Ev[] {
  const rec = cd.record;
  const out: Ev[] = [];
  const add = (item: Item, text: string, shown: string, lab: Item | null = null) => {
    // A negated fact ("bez metastáz") is the doctor's recorded negative, never a finding. The extraction's label is not
    // always set, so a negation cue in the text counts too: dropping a real finding is safer than showing a negative as a risk.
    const f = fold(text);
    const negated = !!item.negation_label || /(?:^|\W)(?:bez|neguje|negat\w*|nema|nebyl\w*|nepotvrz\w*|vylouc\w*)(?:\W|$)/.test(f);
    out.push({
      text,
      shown: shown.length > 160 ? `${shown.slice(0, 157)}...` : shown,
      source: refAt(cd, (item.refs ?? [])[0]) ?? (item.source as SourceRef | undefined),
      item,
      lab,
      date: (item.date as string | undefined) ?? (item.date_sort as string | undefined) ?? null,
      negated,
      suspected: /\bsusp|podezreni/.test(f),
    });
  };
  // RA (family history) and AA (allergies) are not the patient's own conditions.
  for (const [key, items] of Object.entries(rec?.anamnesis ?? {}))
    if (key !== "RA" && key !== "AA")
      for (const it of items ?? []) add(it, `${it.term_cs ?? ""} ${it.comment_cs ?? ""}`, [it.term_cs, it.comment_cs].filter(Boolean).join(" · "));
  // The report's findings (echo, spirometry, onco summary) usually sit here, not in the anamnesis.
  const flat = (it: Item) => Object.values(it).filter((v): v is string => typeof v === "string").join(" ");
  const label = (it: Item) => String(it.text_cs ?? it.term_cs ?? it.title_cs ?? flat(it));
  for (const it of rec?.onco_detailed ?? []) add(it, flat(it), label(it));
  for (const items of Object.values(rec?.sections ?? {})) for (const it of items ?? []) add(it, flat(it), label(it));
  for (const e of rec?.timeline ?? []) add(e, `${e.title_cs ?? ""} ${e.text_cs ?? ""}`, String(e.title_cs ?? ""));
  for (const it of ((rec?.status_praesens as Item | null)?.items ?? []) as Item[]) add(it, String(it.text_cs ?? ""), String(it.text_cs ?? ""));
  for (const l of cd.labs?.values ?? []) add(l, `${l.name_cs} ${l.value} ${l.unit ?? ""}`, `${l.name_cs} ${l.value}${l.unit ? ` ${l.unit}` : ""}`, l);
  return out;
}

export function modalityChecksOf(cd: CaseData | null | undefined): ModalityChecks {
  if (!cd?.record) return { checks: [], missing: [] };
  const evs = evidence(cd);
  const byModality = new Map<Modality, ModalityFinding[]>();
  const seen = new Set<string>();
  for (const e of evs) {
    const f = fold(e.text);
    for (const r of RULES) {
      // A rule that reads a number or a flagged lab does not depend on negation wording; word rules do.
      if (e.negated && !e.lab && r.id !== "ps" && !/^(?:ef-low|fev1-low|dlco-low)$/.test(r.id)) continue;
      const hit = r.test(e, f);
      if (!hit) continue;
      for (const m of r.modalities) {
        // The same fact under the same rule is listed once, however many places repeat it.
        const key = `${m}|${r.id}|${fold(e.shown)}|${e.date ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byModality.set(m, [...(byModality.get(m) ?? []), { rule: r.id, text: hit.shown ?? e.shown, why_cs: e.suspected ? `${r.why_cs} Jde o podezření, ne potvrzenou diagnózu.` : r.why_cs, source: e.source, date: e.date, item: e.item }]);
      }
    }
  }
  const has = (t: (e: Ev, f: string) => boolean) => evs.some((e) => t(e, fold(e.text)));
  const missing: ModalityChecks["missing"] = [];
  if (!has((_e, f) => efOf(f) !== null)) missing.push("ef");
  if (!has((_e, f) => num(f, FEV1_RE) !== null || num(f, DLCO_RE) !== null)) missing.push("spirometry");
  if (!has((e, f) => /egfr|clearance|renalni funkce/.test(f) || !!(e.lab && /egfr|clearance/.test(fold(String(e.lab.name_cs ?? "")))))) missing.push("kidney");
  return { checks: MODALITIES.filter((m) => byModality.has(m)).map((m) => ({ modality: m, findings: byModality.get(m)! })), missing };
}
