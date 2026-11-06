// MDT slots: a 10-minute grid on working days; one case per slot. A slot an approved decision was made on is part of
// the MDT record and stays locked (also after closing and after a new version).
import { D } from "./errors";
import { CLOSED_CASE_BOOKABLE } from "./config";
import { autoOnSchedule, autoOnUnschedule, type Status, type StatusChange } from "./status";
import { isIsoDay } from "./time";

export type Slot = { day: string; time: string };
export type DecisionSlot = { slot_day: string | null; slot_time: string | null };

// The calendar's range and grid (mock: weeks 2024-2028, 8:00-18:00, Monday to Friday).
export function validateSlot(day: unknown, time: unknown): Slot {
  if (typeof day !== "string" || typeof time !== "string" || !isIsoDay(day) || day < "2024-01-01" || day > "2028-12-31") throw D.slotInvalid();
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (wd === 0 || wd === 6) throw D.slotInvalid();
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw D.slotInvalid();
  const h = Number(m[1]), mi = Number(m[2]);
  if (h < 8 || h > 17 || mi % 10 !== 0 || mi > 50) throw D.slotInvalid();
  return { day, time };
}

// Seminars repeat weekly, on the day and at the time the org's Administrace sets (orgs.mdt_weekday, 1 = Monday, and
// mdt_time). An org that has not set them keeps the example schedule, Thursday at 14:00. Each lasts two hours; booking
// outside is allowed, with a warning.
export type SeminarSchedule = { weekday?: number | null; time?: string | null } | null | undefined;
const DEFAULT_WEEKDAY = 4;
const DEFAULT_TIME = "14:00";
const SEMINAR_HOURS = 2;
// The seminar hours of a day ([from, to), "HH:MM"), or null on a day without a seminar; the calendar grid reads it too.
export function seminarHours(day: string, plan?: SeminarSchedule): [string, string] | null {
  const js = new Date(`${day}T12:00:00Z`).getUTCDay();
  if ((js === 0 ? 7 : js) !== (plan?.weekday ?? DEFAULT_WEEKDAY)) return null;
  const from = plan?.time ?? DEFAULT_TIME;
  const h = Number(from.slice(0, 2)) + SEMINAR_HOURS;
  return [from, `${String(h).padStart(2, "0")}${from.slice(2)}`];
}
export function seminarWarning(s: Slot, plan?: SeminarSchedule): string | null {
  const sem = seminarHours(s.day, plan);
  return !sem || s.time < sem[0] || s.time >= sem[1] ? "mimo čas semináře" : null;
}

export const slotLocked = (slot: Slot | null, decisions: DecisionSlot[]) =>
  !!slot && decisions.some((d) => d.slot_day === slot.day && d.slot_time === slot.time);

// "Čt 22. 10. 2026 · 14:00", without the end time.
const WD = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
export function slotText(s: Slot): string {
  const d = new Date(`${s.day}T12:00:00Z`);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()} · ${s.time}`;
}

export type ScheduleCase = { status: Status; slot: Slot | null };

export function schedule(c: ScheduleCase, next: Slot, decisions: DecisionSlot[], plan?: SeminarSchedule): { status: StatusChange | null; warning: string | null } {
  if (c.status === "closed" && !CLOSED_CASE_BOOKABLE) throw D.caseClosedBooking();
  if (slotLocked(c.slot, decisions)) throw D.slotLocked();
  return { status: autoOnSchedule(c.status), warning: seminarWarning(next, plan) };
}

export function unschedule(c: ScheduleCase, decisions: DecisionSlot[]): { status: StatusChange | null; was: Slot } {
  if (!c.slot) throw D.noSlot();
  if (slotLocked(c.slot, decisions)) throw D.slotLocked();
  return { status: autoOnUnschedule(c.status), was: c.slot };
}

// Closing frees a slot that only reserves seminar time; a slot a decision was made on stays.
export const releasesOnClose = (c: ScheduleCase, decisions: DecisionSlot[]) => !!c.slot && !slotLocked(c.slot, decisions);
