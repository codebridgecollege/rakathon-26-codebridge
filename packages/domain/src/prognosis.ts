// Pure rules of the Prognóza tab (mocks/src/prognosis.js): the safe link check, the numbering of the reported values
// as a paper's reference list, the explanation panels, and the similarity dimensions in one shape. The tab shows the
// study search the server recorded; nothing here computes a missing value or judges a prognosis. Labels are not here:
// the app's catalog names the fields by the keys below.

// The endpoint columns of the table, in their order (PG_ENDPOINTS in prognosis.js).
export const PG_ENDPOINTS = ["os_6", "os_12", "os_36", "os_60", "pfs", "response", "toxicity", "burden"] as const;
export type PgEndpoint = (typeof PG_ENDPOINTS)[number];
// The cells that hold one value each; response and toxicity hold two named values (ORR and DoR, grade 3 and stopping).
export const PG_SINGLE_CELLS = ["os_6", "os_12", "os_36", "os_60", "pfs"] as const;

// The similarity dimensions the catalog names (PG_DIMENSIONS); any other key is shown as the server sends it.
export const PG_DIMENSIONS = ["histology", "stage", "biomarkers", "treatment_line", "prior_treatment", "performance_status", "brain_metastases", "age"] as const;
export type PgDimension = (typeof PG_DIMENSIONS)[number];
export const isPgDimension = (k: unknown): k is PgDimension => typeof k === "string" && (PG_DIMENSIONS as readonly string[]).includes(k);

// Statuses of a dimension the catalog names; any other status is shown as sent.
export const PG_DIM_STATUSES = ["match", "mismatch", "unknown", "partial"] as const;
export type PgDimStatus = (typeof PG_DIM_STATUSES)[number];
export const isPgDimStatus = (k: unknown): k is PgDimStatus => typeof k === "string" && (PG_DIM_STATUSES as readonly string[]).includes(k);

// The names a value is listed under in the reference list. The table cell and the conflict list name some fields
// differently ("Medián trvání odpovědi" in the cell, "Trvání odpovědi" in a conflict), so they are separate names.
export const PG_NAMES = [
  "os_6",
  "os_12",
  "os_36",
  "os_60",
  "pfs",
  "response",
  "toxicity",
  "burden",
  "orr",
  "dor_median",
  "grade3",
  "discontinuation",
  "conflict_dor",
  "conflict_grade3",
] as const;
export type PgNameKey = (typeof PG_NAMES)[number];
// A field the catalog knows, or a field code the server sent that the catalog does not name, shown as sent.
export type PgName = { key: PgNameKey } | { raw: string };

// The name of a conflicting field (labels in pgConflicts()).
const CONFLICT_NAMES: Record<string, PgNameKey> = {
  os_6: "os_6",
  os_12: "os_12",
  os_36: "os_36",
  os_60: "os_60",
  pfs: "pfs",
  response: "response",
  toxicity: "toxicity",
  burden: "burden",
  orr: "orr",
  dor: "conflict_dor",
  toxicity_grade3: "conflict_grade3",
  discontinuation_toxicity: "discontinuation",
};
export const conflictName = (field: string): PgName => (CONFLICT_NAMES[field] ? { key: CONFLICT_NAMES[field] } : { raw: field });

export type PgMetric = {
  value?: string | number | null;
  unit?: string | null;
  ci?: string | null;
  quote?: string | null;
  source_url?: string | null;
  locator?: string | null;
  found_by?: string[];
  [k: string]: unknown;
};
export type PgSimilarity = {
  score?: unknown;
  coverage?: unknown;
  method?: string | null;
  dimensions?: unknown;
  critical_mismatches?: string[];
  [k: string]: unknown;
};
export type PgConflict = { field: string; values?: PgMetric[] };
export type PgRow = {
  study_title?: string | null;
  arm?: string | null;
  population?: string | null;
  sample_size?: number | string | null;
  time_origin?: string | null;
  study_type?: string | null;
  source?: { url?: string | null; pmid?: string | null; doi?: string | null; year?: number | string | null; published_date?: string | null };
  endpoints?: Record<string, PgMetric | null | undefined>;
  found_by?: string[];
  similarity?: PgSimilarity | null;
  similarity_variants?: ({ found_by?: string[]; similarity?: PgSimilarity | null } & PgSimilarity)[];
  conflicts?: PgConflict[];
  [k: string]: unknown;
};

// URL is a runtime global of the browser and the Worker; the package's type check has neither's types, so it is
// declared here to the extent used.
type UrlParts = { protocol: string; username: string; password: string; href: string };
const URL_ = (globalThis as unknown as { URL: new (v: string) => UrlParts }).URL;

// A link the page may open: https only, no user name or password in it; anything else is no link (pgUrl()).
export function pgUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL_(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

// A value the source does not report: no value is shown as missing, never as zero or a guess.
export const isMissing = (m: PgMetric | null | undefined): boolean => !m || m.value === null || m.value === undefined || m.value === "";

// One value as the reference list names it: the arm, the field, the value and its unit as reported.
export type PgWhat = { arm: string; name: PgName | null; value: string; unit: string };
export type PgRef = { study: string; what: PgWhat[]; quote: string; url: string; locator: string };
// An explanation panel of one study; the only kind is the similarity explanation.
export type PgPanel = { study: string; similarity: PgSimilarity };

// The reference number of each shown value of a row (null for a missing value), and the panel of each similarity.
export type PgRowLayout = {
  cells: Record<string, number | null>;
  conflicts: (number | null)[][];
  panel: number | null;
  variantPanels: (number | null)[];
};
export type PgLayout = { refs: PgRef[]; panels: PgPanel[]; rows: PgRowLayout[] };

// The values of a row in reading order, as the old page wrote the row: the conflicts sit in the first column, so
// their values are numbered before the endpoint cells.
const ROW_CELLS: [cell: string, endpoint: string, name: PgNameKey][] = [
  ["os_6", "os_6", "os_6"],
  ["os_12", "os_12", "os_12"],
  ["os_36", "os_36", "os_36"],
  ["os_60", "os_60", "os_60"],
  ["pfs", "pfs", "pfs"],
  ["orr", "orr", "orr"],
  ["dor", "dor", "dor_median"],
  ["toxicity_grade3", "toxicity_grade3", "grade3"],
  ["discontinuation_toxicity", "discontinuation_toxicity", "discontinuation"],
  ["burden", "burden", "burden"],
];

const nameId = (n: PgName | null) => (n ? ("key" in n ? `k:${n.key}` : `r:${n.raw}`) : "");

// Numbers every shown value in reading order; the same passage of the same study keeps one number, and the list
// entry names every value that passage supports (pgRef()). Computed from the rows, so the numbers do not depend on
// how often the tab redraws.
export function pgLayout(rows: PgRow[] | null | undefined): PgLayout {
  const refs: PgRef[] = [];
  const keys: string[] = [];
  const whatKeys: Set<string>[] = [];
  const panels: PgPanel[] = [];

  const number = (row: PgRow, m: PgMetric | null | undefined, name: PgName | null): number | null => {
    if (isMissing(m)) return null;
    const metric = m as PgMetric;
    const study = row.study_title || "";
    const key = JSON.stringify([study, metric.quote || "", metric.source_url || "", metric.locator || ""]);
    let i = keys.indexOf(key);
    if (i < 0) {
      i = keys.push(key) - 1;
      refs.push({ study, what: [], quote: metric.quote || "", url: metric.source_url || "", locator: metric.locator || "" });
      whatKeys.push(new Set());
    }
    const what: PgWhat = { arm: row.arm || "", name, value: String(metric.value), unit: metric.unit || "" };
    // A text value has no unit when shown, so it is the same entry as one without a unit (the old page compared the
    // shown text).
    const wk = JSON.stringify([what.arm, nameId(name), what.value, what.unit === "text" ? "" : what.unit]);
    if (!whatKeys[i]!.has(wk)) {
      whatKeys[i]!.add(wk);
      refs[i]!.what.push(what);
    }
    return i + 1;
  };
  const panel = (row: PgRow, s: PgSimilarity | null | undefined): number | null => (s ? panels.push({ study: row.study_title || "", similarity: s }) - 1 : null);

  const out = (rows || []).map((row): PgRowLayout => {
    const conflicts = (row.conflicts || []).map((c) => (c.values || []).map((v) => number(row, v, conflictName(c.field))));
    const ep = row.endpoints || {};
    const cells: Record<string, number | null> = {};
    // The similarity column comes before the endpoint cells; its panels take no reference numbers.
    const main = panel(row, row.similarity);
    const variantPanels = (row.similarity_variants || []).map((v) => panel(row, v.similarity || v));
    for (const [cell, endpoint, name] of ROW_CELLS) cells[cell] = number(row, ep[endpoint], { key: name });
    return { cells, conflicts, panel: main, variantPanels };
  });
  return { refs, panels, rows: out };
}

// A similarity dimension in one shape: the server sends a list, or an object keyed by dimension with a status or an
// object as value. The label the server gives wins; a known key gets the catalog's name; otherwise the name as sent.
export type PgDim = {
  label: string | null;
  key: PgDimension | null;
  name: string;
  status: string | null;
  reason: string | null;
  patient_quote: string | null;
  study_quote: string | null;
};

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export function pgDimensions(similarity: PgSimilarity | null | undefined): PgDim[] {
  const raw = similarity?.dimensions;
  const list: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : Object.entries((raw as Record<string, unknown>) || {}).map(([name, value]) => ({
        name,
        ...(typeof value === "object" ? (value as Record<string, unknown>) : { status: value }),
      }));
  return list.map((d) => ({
    label: str(d?.label),
    key: isPgDimension(d?.key) ? d.key : null,
    // As the old page did, a key the catalog does not name falls through to the name or dimension field.
    name: str(d?.name) ?? str(d?.dimension) ?? "",
    status: str(d?.status),
    reason: str(d?.reason) ?? str(d?.explanation),
    patient_quote: str(d?.patient_quote),
    study_quote: str(d?.study_quote),
  }));
}

// A score or coverage shown only when the server reports a finite number; nothing is derived from the dimensions.
export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// A full ISO day can be formatted; a partial or other date is shown as the source gives it.
export const isIsoDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The saved search of a patient for a day (SAVED_PROGNOSIS matched by patient file and scheduled day); one with no
// rows is no saved search.
export type PgSaved = { patient_id?: string; scheduled_date?: string; result?: { rows?: unknown[]; profile?: { facts?: unknown } & Record<string, unknown> } & Record<string, unknown> };
export function findSaved<S extends PgSaved>(saved: S[] | null | undefined, file: string, day: string | null | undefined): S | null {
  const hit = (saved || []).find((s) => s?.patient_id === file && s?.scheduled_date === day);
  return hit?.result?.rows?.length ? hit : null;
}

// Whether the saved search rests on other facts than the profile at hand (saved_data_changed): compared as the
// server sends them, so a changed or reordered fact counts as changed.
export const factsDiffer = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
