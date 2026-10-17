import { describe, expect, it } from "vitest";
import { autoOnApprove, autoOnNewVersion, autoOnSchedule, autoOnUnschedule, manualMoves, moveStatus, statusLine } from "../../src/domain/status";

describe("manual status moves", () => {
  it.each([
    ["new", false, ["ready", "attention", "closed"]],
    ["scheduled", true, ["ready", "attention", "closed"]],
    ["attention", true, ["scheduled", "ready", "closed"]],
    ["attention", false, ["new", "ready", "closed"]],
    ["ready", true, ["scheduled", "attention", "closed"]],
    ["ready", false, ["new", "attention", "closed"]],
    ["done", true, ["closed"]],
  ] as const)("%s (slot %s) offers %j", (status, hasSlot, moves) => {
    expect(manualMoves({ status, hasSlot }, [])).toEqual(moves);
  });

  it("never offers scheduled or done as a manual target from a status that is not already backed by a slot", () => {
    for (const s of ["new", "ready", "attention", "done"] as const) {
      expect(manualMoves({ status: s, hasSlot: false }, [])).not.toContain("scheduled");
      expect(manualMoves({ status: s, hasSlot: false }, [])).not.toContain("done");
    }
  });

  it("reopens to the status the case was closed from", () => {
    expect(manualMoves({ status: "closed", hasSlot: true }, [{ from: "ready", to: "closed" }])).toEqual(["ready"]);
    expect(manualMoves({ status: "closed", hasSlot: true }, [{ from: "done", to: "closed" }])).toEqual(["done"]);
  });

  it("reopens a case closed from scheduled whose slot was freed as new", () => {
    expect(manualMoves({ status: "closed", hasSlot: false }, [{ from: "scheduled", to: "closed" }])).toEqual(["new"]);
  });

  it("refuses a move that is not offered and a stale view", () => {
    expect(() => moveStatus({ status: "new", hasSlot: false }, [], "done", "new")).toThrow(expect.objectContaining({ code: "status_move_not_allowed" }));
    expect(() => moveStatus({ status: "new", hasSlot: false }, [], "ready", "scheduled")).toThrow(expect.objectContaining({ code: "status_changed" }));
    expect(moveStatus({ status: "closed", hasSlot: false }, [{ from: "ready", to: "closed" }], "ready", "closed").how).toBe("ručně, znovu otevřeno");
  });

  it("moves automatically on booking, freeing, approval and a new version", () => {
    expect(autoOnSchedule("new")?.to).toBe("scheduled");
    expect(autoOnSchedule("ready")).toBeNull();
    expect(autoOnUnschedule("scheduled")?.to).toBe("new");
    expect(autoOnUnschedule("ready")).toBeNull();
    expect(autoOnApprove("ready")?.to).toBe("done");
    expect(autoOnNewVersion("done", true)?.to).toBe("scheduled");
    expect(autoOnNewVersion("done", false)?.to).toBe("new");
    expect(statusLine({ from: "new", to: "ready", how: "ručně" })).toBe("změnil(a) stav případu: Nový -> Připraven (ručně)");
  });
});
