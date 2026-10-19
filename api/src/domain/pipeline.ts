// The document pipeline without an LLM (step 6, slice b-1): Czech labels of its results and the comparison of a run's
// lab values with a document's prepared data. Pure.
import type { Labs } from "../services/page-reader";

// Pages per page reader call: one call for a 40-page document would run for minutes with no partial retry; one call per
// page would send the whole PDF each time. The page reader takes at most 10.
export const PIPELINE_BATCH = 5;

export const READABILITY_CS: Record<string, string> = { good: "dobrá", fair: "částečná", poor: "špatná", empty: "prázdná stránka" };

// A poor or empty document gets an immediate request for a better copy (CLAUDE.md, readability); it never blocks.
export const POOR_COPY_CS = "Dokument je špatně čitelný, vyžádejte lepší kopii.";

const ERROR_CS: Record<string, string> = {
  not_pdf: "soubor není čitelné PDF",
  unreadable_pdf: "soubor není čitelné PDF",
  encrypted: "PDF je zašifrované",
  too_many_pages: "PDF má příliš mnoho stran (nejvýše 60)",
  too_large: "PDF je příliš velké",
  document_changed: "dokument se během zpracování změnil",
  document_missing: "soubor dokumentu chybí",
  pipeline_off: "zpracování není na tomto serveru zapnuté",
  page_reader_unreachable: "služba pro čtení stránek neodpovídá",
};
export const pipelineErrorCs = (code: string) => `zpracování selhalo: ${ERROR_CS[code] ?? "služba pro čtení stránek odpověděla chybou"}`;

export type PreparedPoint = { code: string; value: string; unit: string; reference_range: string; date: string | null; time: string | null; out_of_range?: string | null };

// "mmol/l" read as "mmol/1": a unit without digits that differs only by look-alike characters is the same unit
// (same_unit in pipeline/page_reader/page_index.py); a unit with a digit ("10^9/l" as "10"9/|") is not.
const LOOK = { l: "1", I: "1", i: "1", O: "0", o: "0", "µ": "u" } as Record<string, string>;
const fold = (s: string) => [...s].map((ch) => LOOK[ch] ?? ch).join("");
export const sameUnit = (a: string, b: string) => a === b || (!/\d/.test(a) && fold(a) === fold(b));
const sameRange = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export type DiffResult = "same" | "verify" | "silent" | "missing";

// Every prepared value is found in the run (same code, draw date and time) and is either equal or marked "ověřit".
// "silent" is a value the run reads differently without a mark: a pipeline failure the demo must show, never hide.
export function diffLabs(prepared: PreparedPoint[], labs: Labs) {
  const byKey = new Map<string, { test: Labs["tests"][number]; point: Labs["tests"][number]["points"][number] }[]>();
  for (const t of labs.tests) for (const x of t.points) {
    const k = `${t.code}|${x.date}|${x.time}`;
    byKey.set(k, [...(byKey.get(k) ?? []), { test: t, point: x }]);
  }
  const points = prepared.map((p) => {
    const got = byKey.get(`${p.code}|${p.date}|${p.time}`) ?? [];
    const base = { code: p.code, date: p.date, time: p.time, prepared: p.value };
    if (got.length !== 1) return { ...base, run: null, result: "missing" as DiffResult };
    const { test, point } = got[0]!;
    if (point.certainty !== "documented") return { ...base, run: point.value, result: "verify" as DiffResult };
    const same = point.value === p.value && sameUnit(String(point.unit ?? test.unit), p.unit) && sameRange(String(point.reference_range ?? test.reference_range), p.reference_range);
    return { ...base, run: point.value, result: (same ? "same" : "silent") as DiffResult };
  });
  const n = (r: DiffResult) => points.filter((x) => x.result === r).length;
  const preparedKeys = new Set(prepared.map((p) => `${p.code}|${p.date}|${p.time}`));
  const extra = [...byKey.keys()].filter((k) => !preparedKeys.has(k)).length;
  return { counts: { same: n("same"), verify: n("verify"), silent: n("silent"), missing: n("missing"), extra }, points };
}
