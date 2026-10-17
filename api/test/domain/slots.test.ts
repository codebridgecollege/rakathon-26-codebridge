import { describe, expect, it } from "vitest";
import { releasesOnClose, schedule, seminarWarning, slotLocked, unschedule, validateSlot } from "../../src/domain/slots";
import { CLOSED_CASE_BOOKABLE } from "../../src/domain/config";

const dec = (day: string, time: string) => ({ slot_day: day, slot_time: time });

describe("slots", () => {
  it("accepts the calendar's grid and range only", () => {
    expect(validateSlot("2026-10-22", "14:00")).toEqual({ day: "2026-10-22", time: "14:00" });
    for (const [d, t] of [["2026-10-22", "14:05"], ["2026-10-22", "07:50"], ["2026-10-22", "18:00"], ["2023-12-29", "14:00"], ["2029-01-02", "14:00"], ["2026-10-24", "14:00"], ["2026-02-30", "14:00"], ["x", "14:00"]])
      expect(() => validateSlot(d, t), `${d} ${t}`).toThrow(expect.objectContaining({ code: "slot_invalid" }));
  });

  it("warns outside the seminar time without refusing", () => {
    expect(seminarWarning({ day: "2026-10-22", time: "14:00" })).toBeNull();
    expect(seminarWarning({ day: "2026-10-22", time: "16:00" })).toBe("mimo čas semináře");
    expect(seminarWarning({ day: "2026-10-21", time: "14:00" })).toBe("mimo čas semináře");
    expect(schedule({ status: "new", slot: null }, { day: "2026-10-21", time: "09:00" }, []).warning).toBe("mimo čas semináře");
  });

  it("locks a slot an approved decision was made on, also after close and after a new version", () => {
    const s = { day: "2026-10-22", time: "14:00" };
    expect(slotLocked(s, [dec("2026-10-22", "14:00")])).toBe(true);
    expect(slotLocked(s, [dec("2026-10-22", "14:10")])).toBe(false);
    expect(() => schedule({ status: "scheduled", slot: s }, { day: "2026-10-29", time: "14:00" }, [dec("2026-10-22", "14:00")])).toThrow(expect.objectContaining({ code: "slot_locked" }));
    expect(() => unschedule({ status: "closed", slot: s }, [dec("2026-10-22", "14:00")])).toThrow(expect.objectContaining({ code: "slot_locked" }));
    expect(releasesOnClose({ status: "done", slot: s }, [dec("2026-10-22", "14:00")])).toBe(false);
    expect(releasesOnClose({ status: "ready", slot: s }, [])).toBe(true);
  });

  it("refuses to book a closed case (open question, assumed no)", () => {
    const f = () => schedule({ status: "closed", slot: null }, { day: "2026-10-22", time: "14:00" }, []);
    if (CLOSED_CASE_BOOKABLE) expect(f).not.toThrow();
    else expect(f).toThrow(expect.objectContaining({ code: "case_closed" }));
  });

  it("moves new to scheduled on booking and back on freeing", () => {
    expect(schedule({ status: "new", slot: null }, { day: "2026-10-22", time: "14:00" }, []).status?.to).toBe("scheduled");
    expect(unschedule({ status: "scheduled", slot: { day: "2026-10-22", time: "14:00" } }, []).status?.to).toBe("new");
    expect(() => unschedule({ status: "new", slot: null }, [])).toThrow(expect.objectContaining({ code: "no_slot" }));
  });
});
