// Dates and numbers through Intl (docs/design/I18N.md, "fmt.*"), with formatters cached per locale and options. The
// day functions take ISO day strings and format them at noon UTC, so no time zone can shift a day; a partial or
// broken date is returned as written, never turned into a made-up day (CLAUDE.md, "Preserve the original values").
const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string, o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(o)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, o);
    cache.set(key, f);
  }
  return f;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);

// "16. 10. 2026" in Czech.
export function fmtDay(iso: string, locale: string): string {
  if (!isDay(iso)) return iso;
  return dtf(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(noon(iso));
}

// "22. 10." in Czech: the calendar's day labels next to a weekday.
export function fmtDayMonth(iso: string, locale: string): string {
  if (!isDay(iso)) return iso;
  return dtf(locale, { day: "numeric", month: "numeric", timeZone: "UTC" }).format(noon(iso));
}

// "listopad": the mini month's heading ("YYYY-MM").
export function fmtMonthName(month: string, locale: string): string {
  return dtf(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

// A server timestamp as the old page showed it (toLocaleString): "16. 10. 2026 14:03:05" in Czech, in the browser's
// time zone. Anything that is not a timestamp is shown as written.
export function fmtDateTime(ts: string | null | undefined, locale: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return dtf(locale, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).format(d);
}

// The weekday of an ISO day, 0 = Sunday, for the catalog's short weekday names (WEEKDAY_IDS).
export const weekdayIndex = (iso: string) => noon(iso).getUTCDay();

// The interface language the i18n plugin set on <html>; formatting follows it.
export const uiLocale = () => (typeof document !== "undefined" && document.documentElement.lang) || "cs";
