// Dates, times and MDT slots of the patient screen, as the old page prints them. Server times are ISO UTC and are
// formatted when shown, never stored as formatted text (I18N.md, "Formatted dates stored as data"). The weekday and the
// date layout come from the catalog.
import { slotEnd } from "./slot";

// The Intl locale for the interface language: Czech prints "16. 10. 2026 14:03:22" as today's page does.
const INTL: Record<string, string> = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB" };
export const intlLocale = () => INTL[document.documentElement.lang] ?? "cs-CZ";

// A server timestamp in local format; a value that is not a date is shown as given.
export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(intlLocale());
}

// A number in the interface language (decimal comma in Czech).
export const fmtNumber = (n: number) => n.toLocaleString(intlLocale());

export type T = (id: string, args?: Record<string, string | number>) => string;

// An ISO day ("2026-10-22") as "22. 10. 2026"; a missing day is the fixed gap wording. A partial date never reaches
// here: partial dates are shown as the document writes them.
export function fmtDate(t: T, iso: string | null | undefined): string {
  if (!iso) return t("patient-gap-not-stated");
  const [y, m, d] = iso.split("-");
  // A month without a day stays a month ("3/2024"), never a made-up day (CLAUDE.md).
  if (!d) return m ? `${Number(m)}/${y}` : String(y);
  return t("patient-date-dmy", { d: Number(d), m: Number(m), y: String(y) });
}

// "Čt 22. 10. 2026 · 14:00-14:10", or "nenaplánováno" without a slot. Dates are read at noon UTC, so no time zone
// shifts the day.
export function slotText(t: T, slot: { day: string; time: string } | null | undefined): string {
  if (!slot) return t("patient-slot-none");
  const d = new Date(`${slot.day}T12:00:00Z`);
  return t("patient-slot", { weekday: d.getUTCDay(), d: d.getUTCDate(), m: d.getUTCMonth() + 1, y: String(d.getUTCFullYear()), from: slot.time, to: slotEnd(slot.time) });
}
