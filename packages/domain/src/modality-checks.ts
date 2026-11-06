// The red chips beside PS in the MDT side panel: the documented values and conditions a doctor must count with when the
// meeting talks about a treatment (Soňa, 2026-11-05: doctors sometimes discuss the guideline option without factoring in
// that the patient has, say, autoimmune cholangitis or EF 30 %). Pure, so the rules are tested without a screen.
//
// A chip names the value, never a verdict: "EF 30 %", not "surgery contraindicated". Which modality a rule usually bears
// on and why is only in the tooltip, as the assistant's observation (CLAUDE.md, "The assistant prepares, the doctor
// decides"). The rules read the run's facts, so each chip has its source and date, a relative's disease or a negated
// fact never matches, and for a measurement only the newest value counts. No chip is no all-clear: a value the rules need
// and the documents lack is listed as missing. The numeric limits are rough common cut-offs, not a named guideline; a
// doctor should confirm them before this goes beyond the demo.
import { refAt, type CaseData, type Item, type SourceRef } from "./case-data";
import { vitalsOf } from "./case-view";
import type { Fact } from "./extraction/types";
import { factText, marksFrom } from "./run-view";

export const MODALITIES = ["immuno", "chemo", "radio", "surgery"] as const;
export type Modality = (typeof MODALITIES)[number];

export type PanelFlag = {
  rule: string;
  // The short chip text: the value as written, or the first clause of the fact.
  label: string;
  // The fact as the documents state it, for the tooltip.
  text: string;
  // As the document writes it; null when undated.
  date: string | null;
  // A measured value: the chip shows its date, so an old value is not read as a current one.
  dated: boolean;
  modalities: Modality[];
  // Why the value matters, in the content language; the assistant's observation.
  why_cs: string;
  // Further facts under the same rule, listed behind the newest.
  more: number;
  source: SourceRef | undefined;
  item: Item;
};
export type PanelPerformance = { label: string; low: boolean; source: SourceRef | undefined; item: Item };
export type MissingValue = "ef" | "lung" | "kidney";
export type PanelFlags = { performance: PanelPerformance | null; flags: PanelFlag[]; missing: MissingValue[] };

export const EF_BELOW = 50;
export const LUNG_FUNCTION_BELOW = 60;
const LABEL_MAX = 38;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// The gap before a number stops at a digit, a clause end or a percent sign, so "EF nezměřena, hematokrit 30 %" is not an
// EF. A range ("55-60 %") gives its lower value; "FEV1/FVC" is not FEV1.
const GAP = "[^%;.,\\n\\d]{0,25}";
const RANGE = "(?:\\s*[-–]\\s*\\d{1,3})?";
const EF_RE = new RegExp(`(?:\\bef\\b|\\blvef\\b|ejekcni frakce)${GAP}(\\d{1,3})${RANGE}\\s*(?:%|procent)`);
const EF_FRACTION_RE = new RegExp(`(?:\\bef\\b|\\blvef\\b)${GAP}0[,.](\\d{1,2})\\b`);
// Reports often give litres first: "FEV1 1,41 l (52 % n. h.)".
const LITRES = "(?:\\d+[,.]\\d+\\s*l?\\s*\\(?)?";
const FEV1_RE = new RegExp(`fev\\s?1(?!\\s*/)${GAP}${LITRES}(\\d{1,3})${RANGE}\\s*%`);
const DLCO_RE = new RegExp(`(?:dlco|tlco)(?!\\s*/)${GAP}${LITRES}(\\d{1,3})${RANGE}\\s*%`);

// The last value a text gives counts: "dříve EF 60 %, nyní EF 35 %".
const lastOf = (r: RegExp, f: string) => [...f.matchAll(new RegExp(r.source, "g"))].at(-1)?.[1] ?? null;
const efOf = (f: string): number | null => {
  const m = lastOf(EF_RE, f);
  if (m) return Number(m);
  const d = lastOf(EF_FRACTION_RE, f);
  return d ? Number(d.padEnd(2, "0")) : null;
};
const percentOf = (r: RegExp) => (f: string): number | null => {
  const m = lastOf(r, f);
  return m ? Number(m) : null;
};

type Measure = { id: string; name: string; read: (f: string) => number | null; limit: number; modalities: Modality[]; why_cs: string };
const MEASURES: Measure[] = [
  { id: "ef-low", name: "EF", read: efOf, limit: EF_BELOW, modalities: ["chemo", "surgery"], why_cs: `Ejekční frakce pod ${EF_BELOW} % je důvodem k pozornosti u kardiotoxické léčby a před operací.` },
  { id: "fev1-low", name: "FEV1", read: percentOf(FEV1_RE), limit: LUNG_FUNCTION_BELOW, modalities: ["surgery", "radio"], why_cs: `FEV1 pod ${LUNG_FUNCTION_BELOW} % predikce je důvodem k pozornosti před plicní resekcí a u ozáření plic.` },
  { id: "dlco-low", name: "DLCO", read: percentOf(DLCO_RE), limit: LUNG_FUNCTION_BELOW, modalities: ["surgery", "radio"], why_cs: `DLCO pod ${LUNG_FUNCTION_BELOW} % predikce je důvodem k pozornosti před plicní resekcí a u ozáření plic.` },
];

// A lab the document itself marks out of its reference range, so no limit of ours is applied.
type LabRule = { id: string; name: RegExp; dir: "high" | "low"; modalities: Modality[]; why_cs: string };
const LABS: LabRule[] = [
  { id: "kidney-lab", name: /egfr|clearance|glomerul/, dir: "low", modalities: ["chemo"], why_cs: "Snížená funkce ledvin bývá důvodem upravit dávku nebo volbu léku." },
  { id: "liver-lab", name: /bilirubin/, dir: "high", modalities: ["chemo"], why_cs: "Zvýšený bilirubin bývá důvodem upravit dávku léků odbourávaných v játrech." },
  { id: "neutrophils", name: /neutrofil/, dir: "low", modalities: ["chemo"], why_cs: "Nízké neutrofily omezují myelosupresivní léčbu." },
  { id: "platelets", name: /trombocyt|\bplt\b/, dir: "low", modalities: ["chemo"], why_cs: "Nízké trombocyty omezují myelosupresivní léčbu." },
];

// Word rules read what the documents state about the patient's conditions, not free findings, where chance words abound.
const CONDITION_KINDS = new Set(["diagnosis", "comorbidity", "adverse_event", "risk_factor"]);
type TextRule = { id: string; re: RegExp; kinds?: Set<string>; modalities: Modality[]; why_cs: string };
const CURRENT_DRUG = new Set(["medication"]);
const CONDITION_OR_PROCEDURE = new Set([...CONDITION_KINDS, "procedure"]);
const TEXTS: TextRule[] = [
  { id: "autoimmune", modalities: ["immuno"], why_cs: "Autoimunitní onemocnění je u imunoterapie uváděno jako riziko zhoršení nemoci.",
    re: /autoimun|primarni (?:biliarni|sklerozujici) cholan|\bpbc\b|\bpsc\b|ulcerozni kolitid|crohn|revmatoid|lupus(?! (?:pernio|antikoag))|sklerodermi|myasteni|thyreoiditid|hashimoto|sarkoidoz|vaskulitid|roztrousen\w* skleroz|psoriaz/ },
  { id: "ild", modalities: ["immuno", "radio"], why_cs: "Intersticiální plicní postižení nebo pneumonitida zvyšuje riziko plicní toxicity.", re: /intersticialni plicni|plicni intersticial|intersticialni pneumon|\bipp\b|pneumonitid|plicni fibroz/ },
  { id: "viral-hepatitis", modalities: ["immuno", "chemo"], why_cs: "Virová hepatitida nebo pozitivní HBsAg se před systémovou léčbou posuzuje (riziko reaktivace).",
    re: /hbsag\s*:?\s*(?:pozit|\+)|\bhbv\b|\bhcv\b|hepatitid\w* [bc]\b/ },
  { id: "transplant", modalities: ["immuno"], kinds: CONDITION_OR_PROCEDURE, why_cs: "Po transplantaci nebo při imunosupresi může imunoterapie vyvolat rejekci nebo mít menší účinek.", re: /transplantac|imunosupres/ },
  { id: "steroids", kinds: CURRENT_DRUG, modalities: ["immuno"], why_cs: "Trvalá systémová kortikoterapie může oslabit účinek imunoterapie.", re: /prednis|dexamet|dexamed/ },
  { id: "anticoagulant", kinds: CURRENT_DRUG, modalities: ["surgery"], why_cs: "Antikoagulace vyžaduje před výkonem plán jejího přerušení.", re: /warfarin|apixaban|eliquis|rivaroxaban|xarelto|dabigatran|pradaxa|edoxaban|lixiana|enoxaparin|clexane|fraxiparin/ },
  { id: "heart-failure", modalities: ["chemo", "surgery"], why_cs: "Srdeční selhání nebo kardiomyopatie je důvodem k pozornosti u kardiotoxické léčby a před operací.", re: /srdecni selhani|kardiomyopati/ },
  { id: "heart-disease", modalities: ["surgery"], why_cs: "Ischemická choroba srdeční, infarkt nebo poruchy rytmu zvyšují riziko operace.", re: /infarkt\w*\b(?!\s+(?:sleziny|ledviny|mozku|plic))|ischemick\w* chorob\w* srdecni|\bichs\b|(?<!de)fibrilac|av blok/ },
  { id: "copd", modalities: ["surgery", "radio"], why_cs: "Chronická plicní nemoc zvyšuje riziko plicních komplikací po operaci i po ozáření.", re: /chronicka obstrukcni plicni|\bchopn\b|(?<!podkozni )emfyzem/ },
  { id: "spirometry-poor", modalities: ["surgery", "radio"], why_cs: "Spirometrie popisuje významnou poruchu plicní funkce.", re: /(?:stredne tezk|tezk)\w* (?:obstrukc|restrikc)/ },
  { id: "kidney", modalities: ["chemo"], why_cs: "Porucha funkce ledvin bývá důvodem upravit dávku nebo volbu léku.", re: /renalni insuficien|ledvinn\w* selhani|selhani ledvin|\bckd\b|dialyz|chronicke onemocneni ledvin/ },
  { id: "liver", modalities: ["chemo"], why_cs: "Porucha funkce jater bývá důvodem upravit dávku léků odbourávaných v játrech.", re: /jaterni (?:selhani|insuficien)|selhani jater|cirhoz|hepatopati/ },
  { id: "neuropathy", modalities: ["chemo"], why_cs: "Neuropatie se u taxanů a platiny může zhoršit.", re: /neuropati/ },
  { id: "connective", modalities: ["radio"], why_cs: "Onemocnění pojiva zvyšuje riziko toxicity ozáření.", re: /sklerodermi|lupus(?! (?:pernio|antikoag))|revmatoid/ },
  { id: "device", modalities: ["radio"], why_cs: "Kardiostimulátor nebo defibrilátor v poli ozáření vyžaduje zvláštní postup.", re: /kardiostimul|defibrilator/ },
];
const CHECKPOINT_DRUG = /nivolumab|ipilimumab|pembrolizumab|atezolizumab|durvalumab|avelumab|cemiplimab|dostarlimab|tremelimumab/;

// A denial covers its own clause and any clause after it ("Neguje DM, CHOPN"; "Revmatoidní artritida, vyloučena" covers
// the clause before). "bez" reaches only forward in its clause: "CHOPN bez exacerbací" is still COPD.
const DENIAL = /(?:^|\W)(?:neguje|negat\w*|neg|nema|nebyl\w*|nepotvrz\w*|vylouc\w*|neprokaz\w*)(?:\W|$)/;
const BEZ = /(?:^|\W)bez\s/;
function denied(folded: string, at: number): boolean {
  if (DENIAL.test(folded)) return true;
  const start = Math.max(folded.lastIndexOf(",", at), folded.lastIndexOf(";", at), folded.lastIndexOf(".", at)) + 1;
  return BEZ.test(folded.slice(start, at));
}

// A comma inside a number ("Eliquis 2,5 mg") does not end a clause.
const firstClause = (s: string) => {
  const c = s.split(/[;(]|,(?!\d)/)[0]!.trim() || s.trim();
  return c.length > LABEL_MAX ? `${c.slice(0, LABEL_MAX - 1).trimEnd()}…` : c;
};
// A suspicion is labelled as one: the chip must not state it as a diagnosis, wherever the fact says so.
function conditionLabel(f: Fact): string {
  const text = factText(f);
  const label = firstClause(text);
  const suspected = /\bsusp|podezren/.test(fold(text)) || (f.value as Item)?.disease_status === "suspected";
  return suspected && !/\bsusp|podezren/.test(fold(label)) ? `susp. ${label}` : label;
}
// Newest first; undated facts count as oldest, since nothing says they are current.
const sortKey = (f: Fact) => f.date?.sort ?? "";
const newestFirst = (a: Fact, b: Fact) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0);
// "ml/s/1,73 m2" is the reference surface, not part of the value a chip needs.
const shortUnit = (u: unknown) => String(u ?? "").replace(/\/\s*1[,.]73.*$/, "").trim();

// PS of the current exam, as the "Aktuální stav" card shows it; without one, the newest, undated first since the current
// exam is rarely dated. Shown as written and never converted between scales.
function performanceOf(cd: CaseData, facts: Fact[], sourceOf: (f: Fact) => SourceRef | undefined): PanelPerformance | null {
  const all = facts.filter((f): f is Extract<Fact, { kind: "performance_status" }> => f.kind === "performance_status");
  const current = vitalsOf(((cd.record?.status_praesens as Item | null)?.items ?? []) as Item[]).ecog as Item | null;
  const ps = all.find((f) => (current?.fact_ids as string[] | undefined)?.includes(f.id)) ?? all.find((f) => !f.date?.sort) ?? all.sort(newestFirst)[0];
  if (!ps) return null;
  const written = String(ps.value.value_as_written ?? "");
  const w = fold(written);
  const namedEcog = /(?:ecog|\bps\b|who)\D{0,4}([0-4])/.exec(w);
  const namedKps = /(?:karnofsk\w*|kps)\D{0,4}(\d{2,3})/.exec(w);
  const karnofsky = !namedEcog && (!!namedKps || /karnofsk|kps/.test(fold(String(ps.value.scale ?? ""))));
  // A range counts by its worse end; a date after the value is not a value.
  const lead = /^\D*(\d{1,3})(?:\s*[-–/]\s*(\d{1,3}))?(?![.\d])/.exec(w);
  const nums = ps.value.value_numeric != null && !lead?.[2] ? [ps.value.value_numeric] : lead ? [Number(lead[1]), ...(lead[2] ? [Number(lead[2])] : [])] : [];
  const low = !!(namedEcog && Number(namedEcog[1]) >= 2) || !!(namedKps && Number(namedKps[1]) <= 60) ||
    (!namedEcog && !namedKps && nums.length > 0 && (karnofsky ? Math.min(...nums) <= 60 : Math.max(...nums) >= 2));
  const label = namedEcog || namedKps ? written : `${karnofsky ? "KPS" : "PS"} ${written}`;
  return { label, low, source: sourceOf(ps), item: marksFrom([ps]) };
}

export function panelFlagsOf(cd: CaseData | null | undefined): PanelFlags {
  const run = cd?.run;
  if (!cd || !run) return { performance: null, flags: [], missing: [] };
  const sourceOf = (f: Fact): SourceRef | undefined => refAt(cd, run.source_index[f.sources[0] ?? ""]);
  const flagOf = (f: Fact, rule: string, label: string, modalities: Modality[], why_cs: string, more = 0, dated = false): PanelFlag => ({
    rule,
    label,
    dated,
    text: factText(f),
    date: f.date?.as_written ?? null,
    modalities,
    why_cs,
    more,
    source: sourceOf(f),
    item: marksFrom([f]),
  });
  // Only what the documents state about the patient and happened: a relative's disease, a denied fact, a plan or the
  // assistant's own inference is none of these.
  const facts = Object.values(run.facts).filter((f) => f.subject === "patient" && !f.negated && f.origin !== "assistant" && f.status !== "planned" && f.status !== "requested");
  const flags: PanelFlag[] = [];

  // Measurements: the newest dated value decides, so a recovered EF does not stay red. An undated value may be the current
  // one (run-view.ts, currentState: reports rarely date the current exam), so it counts too, and the worse value shows.
  const seenValue = { ef: false, lung: false };
  for (const m of MEASURES) {
    const found = facts
      .filter((f) => ["imaging", "exam_finding", "comorbidity", "procedure", "diagnosis", "lab_result"].includes(f.kind))
      .map((f) => ({ f, v: m.read(fold(factText(f))) }))
      .filter((x): x is { f: Fact; v: number } => x.v !== null)
      .sort((a, b) => newestFirst(a.f, b.f));
    if (found.length) seenValue[m.id === "ef-low" ? "ef" : "lung"] = true;
    const newest = found.find((x) => x.f.date?.sort);
    const worst = found.filter((x) => x === newest || !x.f.date?.sort).sort((a, b) => a.v - b.v)[0];
    if (worst && worst.v < m.limit) flags.push(flagOf(worst.f, m.id, `${m.name} ${worst.v} %`, m.modalities, m.why_cs, 0, true));
  }

  // Labs: the newest value of each test, by the document's own flag.
  const labs = facts.filter((f): f is Extract<Fact, { kind: "lab_result" }> => f.kind === "lab_result").sort(newestFirst);
  const kidneySeen = labs.some((f) => /egfr|clearance|glomerul/.test(fold(String(f.value.name_as_written ?? ""))));
  for (const r of LABS) {
    const latest = labs.find((f) => r.name.test(fold(String(f.value.name_as_written ?? ""))));
    if (latest && latest.value.out_of_range === r.dir) {
      const v = latest.value;
      flags.push(flagOf(latest, r.id, `${firstClause(String(v.name_as_written)).replace(/\s+CKD-EPI.*$/i, "")} ${v.value_as_written} ${shortUnit(v.unit ?? v.unit_as_written)}`.trim(), r.modalities, r.why_cs, 0, true));
    }
  }

  // Toxicity of an earlier immunotherapy: the documents' own link to the drug, not a word match.
  const immuneTox = facts
    .filter((f): f is Extract<Fact, { kind: "adverse_event" }> => f.kind === "adverse_event" && CHECKPOINT_DRUG.test(fold(String(f.value.related_therapy ?? ""))))
    .filter((f) => !/gastrointest/.test(fold(factText(f))) || /[3-5]/.test(String(f.value.grade ?? "")))
    .sort(newestFirst);
  if (immuneTox[0]) flags.push(flagOf(immuneTox[0], "immune-tox", conditionLabel(immuneTox[0]), ["immuno"], "Toxicita při předchozí imunoterapii.", immuneTox.length - 1));

  // Conditions: one chip per rule, the newest fact leading.
  for (const r of TEXTS) {
    const hits = facts.filter((f) => {
      if (immuneTox.includes(f as never)) return false;
      // A stopped drug is history; a drug rule never reads conditions, nor a condition rule drugs.
      if (r.kinds ? !r.kinds.has(f.kind) || f.status === "stopped" || f.status === "interrupted" : !CONDITION_KINDS.has(f.kind)) return false;
      const folded = fold(factText(f));
      const m = r.re.exec(folded);
      return !!m && !denied(folded, m.index);
    }).sort(newestFirst);
    if (hits[0]) flags.push(flagOf(hits[0], r.id, conditionLabel(hits[0]), r.modalities, r.why_cs, hits.length - 1));
  }

  // A low eGFR and a stated kidney disease are one thing to count with: the value stays, the words go in its tooltip's
  // count. Not so for the liver: a raised bilirubin does not say what a cirrhosis says.
  const kidneyValue = flags.find((f) => f.rule === "kidney-lab");
  const kidneyWords = flags.findIndex((f) => f.rule === "kidney");
  if (kidneyValue && kidneyWords >= 0) {
    kidneyValue.more += 1 + flags[kidneyWords]!.more;
    flags.splice(kidneyWords, 1);
  }

  // Stated contraindications and allergies are the documents' own warnings.
  for (const f of facts.filter((x) => x.kind === "contraindication")) flags.push(flagOf(f, `contraindication-${f.id}`, firstClause(factText(f)), [], "Dokumentace to uvádí jako kontraindikaci."));
  for (const f of facts.filter((x) => x.kind === "allergy")) flags.push(flagOf(f, `allergy-${f.id}`, `Alergie: ${firstClause(factText(f))}`, [], "Dokumentace uvádí alergii."));

  const performance = performanceOf(cd, facts, sourceOf);

  const missing: MissingValue[] = [];
  if (!seenValue.ef) missing.push("ef");
  if (!seenValue.lung) missing.push("lung");
  if (!kidneySeen) missing.push("kidney");
  return { performance, flags, missing };
}
