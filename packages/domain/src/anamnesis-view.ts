// How the Anamnéza tab arranges what the extraction holds (Soňa, 2026-11-06): the personal history under headings, and one
// line per drug. Pure, and it only arranges: no fact is dropped, reworded or decided on. A word match that places a
// disease under the wrong heading is harmless; anything unmatched goes under "Ostatní".
import type { Item } from "./case-data";

const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// First match wins, so an operation on the heart is an operation and an injury is an injury.
export const HISTORY_GROUPS = ["surgery", "injury", "heart", "lung", "metabolic", "kidney_liver", "nervous", "other"] as const;
export type HistoryGroup = (typeof HISTORY_GROUPS)[number];
const RULES: [HistoryGroup, RegExp][] = [
  ["surgery", /operac|ektomi|\bst\.? ?p\.|stav po (?!kortiko)|resekc|implantac|transplantac/],
  ["injury", /uraz|fraktur|zlomenin|luxac|poranen/],
  ["heart", /hypertenz|srdec|kardi|ischem|infarkt|fibrilac|tepen|arter|ateroskl|stenoz|embol|trombo|aneuryzm|chlopn/],
  ["lung", /plicni|plic\b|chopn|asthma|astma|bronch|pneumo|dusnost|emfyzem/],
  ["metabolic", /diabet|hyperglyk|hypoglyk|hyperlipo|dyslipid|hypokalc|hyperkal|hypokal|hypona|hyperna|obezit|tyreo|stitn|hyperurik|dna\b|mineral|osteopor/],
  ["kidney_liver", /ledvin|renal|nefro|jater|hepat|cirhoz|cholan|zlucn/],
  ["nervous", /glioz|mozk|neuro|demenc|epilep|parkinson|cevni mozk|deprese|uzkost/],
];

export function historyGroup(term: unknown): HistoryGroup {
  const f = fold(term);
  return RULES.find(([, re]) => re.test(f))?.[0] ?? "other";
}

// Only the groups that have something, in the fixed order, with the items in their original order.
export function groupHistory(items: Item[]): { group: HistoryGroup; items: Item[] }[] {
  return HISTORY_GROUPS.map((group) => ({ group, items: items.filter((it) => historyGroup(it.term_cs) === group) })).filter((g) => g.items.length);
}

export type DrugDose = { dose: string; item: Item };
export type DrugRow = { name: string; doses: DrugDose[]; key: string; hint_cs: string | null };

// Related drugs stand together, with no heading (Soňa, 2026-11-06): anticancer, heart and vessels, lungs, psychiatric and
// nervous system, digestive, minerals and vitamins, then anything else. Names a doctor writes in Czech records, brand or
// generic; an unknown drug only sorts last.
const DRUG_ORDER: RegExp[] = [
  /everolimus|sunitinib|nivolumab|pembrolizumab|osimertinib|alektinib|cisplatin|karboplatin|etoposid|durvalumab|tamoxifen|letrozol/,
  /kapidin|lerkanidipin|amlodipin|orcal|bisoprolol|betaloc|metoprolol|ramipril|prestarium|perindopril|entresto|eliquis|apixaban|xarelto|rivaroxaban|warfarin|clexane|atorvastatin|rosuvastatin|furosemid|verospiron/,
  /spiriva|ventolin|erdomed|berodual|symbicort|seretide|acc\b|ambrobene|salbutamol|tiotropium/,
  /neurol|alprazolam|lexaurin|diazepam|zolpidem|sertralin|citalopram|escitalopram|mirtazapin|quetiapin|gabapentin|pregabalin/,
  /degan|metoklopramid|novetron|ondansetron|imodium|loperamid|smecta|helicid|omeprazol|pantoprazol|controloc|ursosan|lactulosa/,
  /natrii|calcichew|kalcium|calcium|vitamin|kalium|kaliumchlorid|magnesium|magne|letrox|euthyrox|metformin|gliclazid/,
];
const drugRank = (name: string) => {
  const i = DRUG_ORDER.findIndex((re) => re.test(fold(name)));
  return i < 0 ? DRUG_ORDER.length : i;
};

// What a public register says about a drug whose strength could not be read. The document's "[nečitelné]" stays: this is
// the assistant's pointer for the doctor to confirm, not a value. One entry so far, checked by hand against the Czech
// SmPC; a lookup in the SÚKL database is not built.
const REGISTER_HINTS: [RegExp, string][] = [
  [/calcichew/, "Pozorování asistenta: v ČR existuje Calcichew D3 1000 mg/800 IU (SPC sukls134600/2024). Ověřte v dokumentaci nebo v databázi SÚKL."],
];
const hintFor = (name: string) => (/nečitelné/.test(name) ? (REGISTER_HINTS.find(([re]) => re.test(fold(name)))?.[1] ?? null) : null);
const DOSING_AT_END = /^(.*?)\s+(\d[\d/,]*\s*-\s*\d[\d/,]*\s*-\s*\d[\d/,]*)$/;

// One row per drug and strength, related drugs together: the documents may state several dosings of one drug, which stays
// visible on its line and is never resolved here. A drug listed as one string ("Everolimus Sandoz 5 mg 1-0-0") is split at its dosing.
export function drugRows(list: Item[]): DrugRow[] {
  const rows = new Map<string, DrugRow>();
  for (const m of list) {
    const written = [m.drug_cs, m.strength_cs].filter(Boolean).join(" ");
    const at = m.dosing_cs ? null : DOSING_AT_END.exec(written);
    const name = at ? at[1]! : written;
    const dose = String(m.dosing_cs ?? at?.[2] ?? "");
    const key = fold(name);
    const row = rows.get(key);
    if (row) row.doses.push({ dose, item: m });
    else rows.set(key, { name, doses: [{ dose, item: m }], key: String(m.key), hint_cs: hintFor(name) });
  }
  // Array.sort is stable: within a class the documents' order stays.
  return [...rows.values()].sort((a, b) => drugRank(a.name) - drugRank(b.name));
}
