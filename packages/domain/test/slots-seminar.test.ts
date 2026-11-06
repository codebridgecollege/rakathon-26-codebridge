import { describe, expect, it } from "vitest";
import { outOfHours, inSeminar, seminarOn } from "../src/calendar";
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
