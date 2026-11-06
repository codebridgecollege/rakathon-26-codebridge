import { describe, expect, it } from "vitest";
import { bookedMeetings, miniMonthCells, outOfHours, inSeminar, seminarOn, seminarsOn, upcomingMeetings } from "../src/calendar";
import { seminarWarning } from "../src/slots";

// 2026-10-20 is a Tuesday, 2026-10-22 a Thursday.
const TUE = { weekday: 2, time: "14:00" };

describe("the seminar follows the org's schedule", () => {
  it("keeps Thursday 14:00-16:00 for an org that has not set one", () => {
    expect(seminarOn("2026-10-22")).toEqual({ from: "14:00", to: "16:00" });
    expect(seminarOn("2026-10-20", { weekday: null, time: null })).toBeNull();
  });
  it("moves to the org's day and time", () => {
    expect(seminarOn("2026-10-20", TUE)).toEqual({ from: "14:00", to: "16:00" });
    expect(seminarOn("2026-10-22", TUE)).toBeNull();
    expect(seminarOn("2026-10-20", { weekday: 2, time: "07:30" })).toEqual({ from: "07:30", to: "09:30" });
    expect(inSeminar("2026-10-20", "15:50", TUE)).toBe(true);
    expect(outOfHours("2026-10-20", "16:00", TUE)).toBe(true);
  });
  it("warns outside the org's seminar, not inside", () => {
    expect(seminarWarning({ day: "2026-10-20", time: "14:10" }, TUE)).toBeNull();
    expect(seminarWarning({ day: "2026-10-22", time: "14:10" }, TUE)).toBe("mimo čas semináře");
  });
});

describe("the nearest meetings", () => {
  const slot = (day: string, time: string) => ({ day, time });
  const short = (ms: { day: string; time: string; teamId: string | null; patients: unknown[] }[]) => ms.map((m) => [m.day, m.time, m.teamId, m.patients.length]);
  it("lists each team on its own line with its count, from today on", () => {
    const rows = [
      { teamId: "lung", slot: slot("2026-10-21", "14:10") },
      { teamId: "lung", slot: slot("2026-10-21", "14:00") },
      { teamId: "breast", slot: slot("2026-10-21", "14:00") },
      { teamId: "lung", slot: slot("2026-10-01", "14:00") },
      { teamId: "lung", slot: null },
    ];
    expect(short(upcomingMeetings(rows, "2026-10-16", []))).toEqual([["2026-10-21", "14:00", "lung", 2], ["2026-10-21", "14:00", "breast", 1]]);
    expect(short(bookedMeetings(rows)).map((m) => m[0])).toContain("2026-10-01");
  });
  it("shows an org with one MDT its next dates, also with nothing booked", () => {
    expect(short(upcomingMeetings([{ teamId: null, slot: slot("2026-10-20", "14:10") }], "2026-10-16", TUE))).toEqual([["2026-10-20", "14:00", null, 1], ["2026-10-27", "14:00", null, 0]]);
  });
  it("gives each team its own schedule, with their seminars side by side", () => {
    const plans = [{ id: "lung", name: "Plicní", weekday: 2, time: "14:00" }, { id: "skin", name: "Kožní", weekday: 2, time: "12:00" }];
    expect(short(upcomingMeetings([], "2026-10-16", plans, { dates: 1 }))).toEqual([["2026-10-20", "12:00", "skin", 0], ["2026-10-20", "14:00", "lung", 0]]);
    expect(seminarsOn("2026-10-20", plans).map((s) => s.name)).toEqual(["Plicní", "Kožní"]);
    expect(inSeminar("2026-10-20", "12:30", plans)).toBe(true);
    expect(inSeminar("2026-10-22", "14:00", plans)).toBe(false);
    expect(seminarsOn("2026-10-22", [])).toEqual([]);
  });
});

describe("the mini month marks the chosen team's days", () => {
  it("marks Tuesdays for a Tuesday team, and Thursdays by default", () => {
    const marked = (plans?: Parameters<typeof miniMonthCells>[3]) => miniMonthCells("2026-10", "2026-10-19", "2026-10-16", plans).filter((c) => c.seminar).map((c) => c.iso);
    expect(marked([{ id: "lung", weekday: 2, time: "14:00" }])).toContain("2026-10-20");
    expect(marked([{ id: "lung", weekday: 2, time: "14:00" }])).not.toContain("2026-10-22");
    expect(marked()).toContain("2026-10-22");
  });
});
