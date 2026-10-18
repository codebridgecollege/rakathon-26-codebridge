// The MDT calendar's grid (screen S-2): a week of
// five working days, 10-minute slots from 8:00 to 18:00, the weekly seminar, and the month grid used to jump to a week.
// Dates are ISO day strings handled at noon UTC, so no time zone can shift a day.
import { addDays } from "./time";
import { seminarHours } from "./slots";

// The demo's fixed "today": the calendar and report specs depend on it while the app runs on
// the demo seed (e2e/README.md, "How the suite gates the port").
export const DEMO_TODAY = "2026-10-16";
// The seeded seminar week, the calendar's first week in a fresh tab.
export const DEFAULT_WEEK = "2026-10-19";
// The range the week arrows and the month arrows may reach (the server accepts slots in 2024-2028).
export const FIRST_WEEK = "2024-01-01";
export const LAST_WEEK = "2028-12-25";
export const YEARS = [2024, 2025, 2026, 2027, 2028];

export const SLOT_MIN = 10;

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
const ofMin = (x: number) => `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;

// 08:00, 08:10, ... 17:50: a session can be booked well before or after the seminar hours.
export const GRID_TIMES: readonly string[] = Array.from({ length: 60 }, (_, i) => ofMin(8 * 60 + i * SLOT_MIN));

export const shiftTime = (t: string, n: number) => ofMin(toMin(t) + n);
export const slotEnd = (t: string) => shiftTime(t, SLOT_MIN);

export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export const mondayOf = (iso: string) => addDays(iso, -((weekdayOf(iso) + 6) % 7));
export const isIsoDayShape = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s);

// The seminar of a day; kind names the seminar for its label (one neuro-oncology MDT a week in the example schedule).
export type Seminar = { from: string; to: string; kind: "neuro" };
export function seminarOn(day: string): Seminar | null {
  const h = seminarHours(day);
  return h ? { from: h[0], to: h[1], kind: "neuro" } : null;
}
export const inSeminar = (day: string, t: string) => {
  const s = seminarOn(day);
  return !!s && t >= s.from && t < s.to;
};
// On a seminar day every slot outside the seminar hours can be booked too (sessions may run longer).
export const outOfHours = (day: string, t: string) => !!seminarOn(day) && !inSeminar(day, t);

export const weekDays = (week: string) => [0, 1, 2, 3, 4].map((i) => addDays(week, i));

// The next week n steps away, or null outside the calendar's range.
export function stepWeek(week: string, n: number): string | null {
  const w = addDays(week, 7 * n);
  return w < FIRST_WEEK || w > LAST_WEEK ? null : w;
}

// The month n steps away ("YYYY-MM"), or null outside the range.
export function stepMonth(month: string, n: number): string | null {
  const [y, m] = month.split("-").map(Number);
  const iso = new Date(Date.UTC(y!, m! - 1 + n, 15)).toISOString().slice(0, 10);
  return iso < "2024-01" || iso > "2028-12-31" ? null : iso.slice(0, 7);
}

// The month the mini month shows for a week: the month of the week's Thursday, as the week arrows set it.
export const monthOfWeek = (week: string) => addDays(week, 3).slice(0, 7);

// Which rows the grid shows. By default, the seminar hours from 30 minutes before to an hour after, so the first
// seminar row is in view and an overrun has room; the whole day when asked, when the week has no seminar, or when a
// booking lies outside that range, so no booked slot is ever hidden.
export function visibleTimes(days: string[], booked: (day: string, t: string) => boolean, fullDay: boolean) {
  const sems = days.map(seminarOn).filter((s): s is Seminar => !!s);
  const from = sems.length ? shiftTime(sems.map((s) => s.from).sort()[0]!, -30) : null;
  const to = sems.length ? shiftTime(sems.map((s) => s.to).sort().at(-1)!, 60) : null;
  const outside = !!from && days.some((d) => GRID_TIMES.some((t) => booked(d, t) && (t < from || t >= to!)));
  const canTrim = !!from && !outside;
  const times = canTrim && !fullDay ? GRID_TIMES.filter((t) => t >= from! && t < to!) : [...GRID_TIMES];
  return { times, canTrim, from, to };
}

export type MiniCell = { iso: string; day: number; out: boolean; inWeek: boolean; seminar: boolean; today: boolean };

// The month grid: weeks from the Monday on or before the 1st; a sixth row only when it still holds days of the month.
export function miniMonthCells(month: string, week: string, today = DEMO_TODAY): MiniCell[] {
  const m = Number(month.slice(5, 7));
  const start = mondayOf(`${month}-01`);
  const weekEnd = addDays(week, 6);
  const out: MiniCell[] = [];
  for (let i = 0; i < 42; i++) {
    const iso = addDays(start, i);
    const d = new Date(`${iso}T12:00:00Z`);
    if (i >= 35 && d.getUTCMonth() + 1 !== m) break;
    out.push({ iso, day: d.getUTCDate(), out: d.getUTCMonth() + 1 !== m, inWeek: iso >= week && iso <= weekEnd, seminar: !!seminarOn(iso), today: iso === today });
  }
  return out;
}

type Slotted = { file: string; status: string; slot: { day: string; time: string } | null };

// The patients waiting for a slot. A closed case needs no slot, so it does not wait there; the patient being moved
// (picked from a booked slot) is listed too, so the pick shows where it is.
export const unscheduledOf = <T extends Slotted>(rows: T[], picked: string | null) => rows.filter((p) => (!p.slot && p.status !== "closed") || p.file === picked);

// The cases booked on one day, in slot order (the MDT's agenda).
export const dayAgenda = <T extends Slotted>(rows: T[], day: string) =>
  rows.filter((p) => p.slot && p.slot.day === day).sort((a, b) => a.slot!.time.localeCompare(b.slot!.time));
