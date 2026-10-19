// A date as a Czech document writes it -> its precision and a sort form, never more precise than written
// (CLAUDE.md: "03/2024" stays a month). The text as written is kept by the caller; this only adds the sort form.
import type { FactDate } from "@codebridge/domain/extraction/types";

const pad = (n: number) => String(n).padStart(2, "0");
// A real calendar date: "31.2.2026" is a misread, not the 3rd of March.
const valid = (y: number, m: number, d?: number) =>
  y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && (d === undefined || (d >= 1 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d));

// Two-digit years ("12.3.26") are read as 20yy up to the current year + 1, else 19yy; such a date is still kept as
// written, and the sort form only orders it.
function year(y: string, now = new Date()): number {
  if (y.length === 4) return Number(y);
  const n = Number(y);
  return 2000 + n <= now.getUTCFullYear() + 1 ? 2000 + n : 1900 + n;
}

export function parseDate(asWritten: string | null | undefined): FactDate {
  const w = (asWritten ?? "").trim();
  const none: FactDate = { as_written: w || null, precision: null, sort: null };
  if (!w) return { as_written: null, precision: null, sort: null };
  // 12.3.2026 14:05 / 12. 3. 2026
  let m = /(?<!\d)(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4}|\d{2})(?!\d)(?:\s+(\d{1,2}):(\d{2}))?/.exec(w);
  if (m) {
    const y = year(m[3]!);
    const mo = Number(m[2]);
    const d = Number(m[1]);
    if (!valid(y, mo, d)) return none;
    const day = `${y}-${pad(mo)}-${pad(d)}`;
    if (m[4]) return { as_written: w, precision: "minute", sort: `${day}T${pad(Number(m[4]))}:${m[5]}` };
    return { as_written: w, precision: "day", sort: day };
  }
  // 2026-03-12
  m = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(w);
  if (m && valid(Number(m[1]), Number(m[2]), Number(m[3]))) return { as_written: w, precision: "day", sort: `${m[1]}-${m[2]}-${m[3]}` };
  // 3/2024, 03/2024, 3.2024, 3/24
  m = /(?<![\d.])(\d{1,2})\s*[/.]\s*(\d{4}|\d{2})(?![\d./])/.exec(w);
  if (m) {
    const y = year(m[2]!);
    const mo = Number(m[1]);
    if (valid(y, mo)) return { as_written: w, precision: "month", sort: `${y}-${pad(mo)}` };
  }
  // 2024 alone
  m = /(?<!\d)(19\d{2}|20\d{2})(?!\d)/.exec(w);
  if (m) return { as_written: w, precision: "year", sort: m[1]! };
  return none;
}
