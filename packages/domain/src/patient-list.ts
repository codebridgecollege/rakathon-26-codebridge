// The patient database (screen S-1), as viewPatients() and the column filters in mocks/src/v3-template.html: search,
// Excel-style column filters, the submitted-date range, newest referral first, and pages of 20.
//
// Column filters hold codes, not display text (docs/design/I18N.md, "Display strings used as keys"): the owner's name,
// the department as written (or "" when the row has none), the slot's day (or "" when unscheduled) and the status
// code. The screen turns each code into its label.

export const FILTER_COLUMNS = ["owner", "dept", "slot", "status"] as const;
export type FilterColumn = (typeof FILTER_COLUMNS)[number];
// A missing key means "every value"; a list means "only these values" (possibly none).
export type ColumnFilters = Partial<Record<FilterColumn, string[]>>;

export const PAGE_SIZE = 20;

export type ListRow = {
  id: string;
  name: string;
  diagnosis: string | null;
  mkn10: string | null;
  owner: string;
  dept: string | null;
  slot: { day: string; time: string } | null;
  status: string;
  submitted: string | null;
};

export function columnValue(key: FilterColumn, p: ListRow): string {
  if (key === "owner") return p.owner;
  if (key === "dept") return p.dept || "";
  if (key === "slot") return p.slot ? p.slot.day : "";
  return p.status;
}

export const passesFilters = (f: ColumnFilters, p: ListRow) => FILTER_COLUMNS.every((k) => !f[k] || f[k]!.includes(columnValue(k, p)));

// Search reads the case ID, the name, the diagnosis and the MKN-10 code, ignoring case.
export function matchesSearch(q: string, p: ListRow): boolean {
  if (!q) return true;
  return `${p.id} ${p.name} ${p.diagnosis} ${p.mkn10 || ""}`.toLowerCase().includes(q.toLowerCase());
}

export type ListQuery = { q: string; filters: ColumnFilters; from: string; to: string };

// The rows that pass, newest referral first (ISO days compare as text; a row without a date sorts last).
export function filterPatients<T extends ListRow>(rows: T[], query: ListQuery): T[] {
  return rows
    .filter(
      (p) =>
        passesFilters(query.filters, p) &&
        (!query.from || (p.submitted ?? "") >= query.from) &&
        (!query.to || (p.submitted ?? "") <= query.to) &&
        matchesSearch(query.q, p),
    )
    .sort((a, b) => (b.submitted ?? "").localeCompare(a.submitted ?? ""));
}

// The distinct codes of a column over all rows (the filter's choices).
export const columnValues = (key: FilterColumn, rows: ListRow[]) => [...new Set(rows.map((p) => columnValue(key, p)))];

// One checkbox of a filter changed. Ticking every value again drops the filter, as "(Vše)" does.
export function toggleFilterValue(f: ColumnFilters, key: FilterColumn, all: string[], value: string, checked: boolean): ColumnFilters {
  const cur = f[key] ? [...f[key]!] : [...all];
  const next = checked ? [...new Set([...cur, value])] : cur.filter((v) => v !== value);
  const out = { ...f };
  if (next.length === all.length) delete out[key];
  else out[key] = next;
  return out;
}

// "(Vše)": ticked shows every value, unticked shows none.
export function toggleFilterAll(f: ColumnFilters, key: FilterColumn, checked: boolean): ColumnFilters {
  const out = { ...f };
  if (checked) delete out[key];
  else out[key] = [];
  return out;
}

export const activeFilterCount = (f: ColumnFilters) => FILTER_COLUMNS.filter((k) => f[k]).length;

// The page to show and its row range. A page past the end (after a filter narrowed the list) falls back to the last.
export function pageRange(total: number, page: number, showAll: boolean) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  if (showAll) return { page: p, pages, start: 0, end: total };
  return { page: p, pages, start: p * PAGE_SIZE, end: Math.min(total, p * PAGE_SIZE + PAGE_SIZE) };
}

export const surnameOf = (p: { name: string }) => p.name.split(" ").slice(-1)[0]!;

// Age as a bare number: a stated age ("57 let"), or computed from a stated birth date ("d.m.yyyy") on the given day.
// computed tells the screen to say so in a tooltip.
export function ageOf(p: { age: string | null; birth: string | null }, today: string): { n: string; computed: boolean } | null {
  if (p.age) return { n: p.age.replace(/\s*let$/, ""), computed: false };
  if (!p.birth) return null;
  const [d, m, y] = p.birth.split(".").map(Number);
  if (!d || !m || !y) return null;
  const t = new Date(`${today}T12:00:00Z`);
  let a = t.getUTCFullYear() - y;
  if (t.getUTCMonth() + 1 < m || (t.getUTCMonth() + 1 === m && t.getUTCDate() < d)) a--;
  return { n: String(a), computed: true };
}
