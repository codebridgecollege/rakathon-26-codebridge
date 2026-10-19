import { describe, expect, it } from "vitest";
import { allowed, assertCan, type Action, type Actor } from "../src/roles";
import { COORDINATOR_ACTS_ON_ALERTS, COORDINATOR_EDITS_PROTOCOL } from "../src/config";

const doctor: Actor = { id: "d1p1", name: "MUDr. Novák", role: "doctor" };
const coord: Actor = { id: "coord", name: "Bc. Marková", role: "coordinator" };
const admin: Actor = { id: "admin", name: "Ing. Kovář", role: "admin" };
const member = { member: true, grant: false };
const outsider = { member: false, grant: false };
const granted = { member: false, grant: true };

// The permission matrix of step-4.md section 2, one row per action: doctor (member), coordinator, administrator.
const MATRIX: [Action, boolean, boolean, boolean][] = [
  ["status.move", true, true, false],
  ["slot.write", true, true, false],
  ["protocol.edit", true, COORDINATOR_EDITS_PROTOCOL, false],
  ["decision.approve", true, false, false],
  ["decision.new_version", true, false, false],
  ["question.confirm", true, false, false],
  ["fact.edit", true, false, false],
  ["fact.confirm", true, false, false],
  ["suggestion.decide", true, false, false],
  ["task.done", true, true, false],
  ["alert.act", true, COORDINATOR_ACTS_ON_ALERTS, false],
  ["session.write", true, true, false],
  ["case.create", true, true, false],
  ["digest.send", true, true, false],
  ["staff.write", false, true, true],
  ["break_glass", true, false, false],
  ["demo.reset", false, false, true],
];

describe("permission matrix", () => {
  it.each(MATRIX)("%s: doctor %s, coordinator %s, admin %s", (action, d, c, a) => {
    expect(allowed(doctor, action, member)).toBe(d);
    expect(allowed(coord, action, outsider)).toBe(c);
    expect(allowed(admin, action, outsider)).toBe(a);
  });

  it("refuses a doctor outside the team on case actions, unless a grant exists", () => {
    for (const [action, d] of MATRIX) {
      if (!d || ["session.write", "case.create", "digest.send", "break_glass"].includes(action)) continue;
      expect(() => assertCan(doctor, action, outsider)).toThrow(expect.objectContaining({ code: "not_member" }));
      expect(allowed(doctor, action, granted)).toBe(true);
    }
  });

  it("says who approves when someone else tries", () => {
    expect(() => assertCan(coord, "decision.approve", outsider)).toThrow(expect.objectContaining({ code: "not_doctor", message_cs: "Závěr schvaluje lékař." }));
    expect(() => assertCan(coord, "suggestion.decide", outsider)).toThrow(expect.objectContaining({ message_cs: "Návrh úlohy potvrzuje lékař." }));
    expect(() => assertCan(admin, "status.move")).toThrow(expect.objectContaining({ code: "role_forbidden" }));
  });

  it("lets the assignee close their own task without a role on the case", () => {
    expect(allowed(admin, "task.done", { ...outsider, assignee: true })).toBe(true);
    expect(allowed(admin, "task.done", outsider)).toBe(false);
  });
});
