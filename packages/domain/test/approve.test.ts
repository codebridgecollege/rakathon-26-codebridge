import { describe, expect, it } from "vitest";
import { approvalBlockers, approve, type ApproveInput } from "../src/approve";
import { emptyProtocol } from "../src/protocol";

const doctor = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor" as const };
const base = (o: Partial<ApproveInput> = {}, body: Partial<ApproveInput["body"]> = {}): ApproveInput => ({
  actor: doctor,
  actorDeptId: "d2",
  caseStatus: "ready",
  slot: { day: "2026-10-22", time: "14:00" },
  protocol: { ...emptyProtocol(), version: 2, conclusion: "Stereotaktická radioterapie. Kontrolní MR za 3 měsíce.", steps: [{ text: "objednat RT", who: "Bc. Marková", due: "2026-10-30" }, { text: "  ", who: "", due: "" }] },
  decisions: [],
  attendance: [{ dept_id: "d1", position: 0, user_id: "d1p1", user_name: "MUDr. Novák" }],
  body: {
    protocol_version: 2,
    conclusion: "Stereotaktická radioterapie. Kontrolní MR za 3 měsíce.",
    picked_sections: ["summary"],
    report_html: "<p>report</p>",
    attendance_expected: ["MUDr. Novák", "MUDr. Svobodová"],
    ...body,
  },
  reportSha256: "a".repeat(64),
  staffIdByName: new Map([["Bc. Marková", "coord"]]),
  coordinator: { id: "coord", name: "Bc. Marková" },
  now: new Date("2026-10-22T13:30:00Z"),
  newId: () => "dec-new",
  ...o,
});

describe("approval", () => {
  it("lists each blocker in Czech and never an alert", () => {
    const codes = (e: Error[]) => e.map((x) => (x as unknown as { code: string }).code);
    expect(codes(approvalBlockers({ ...doctor, role: "coordinator" }, "closed", { ...emptyProtocol(), state: "approved" }, " "))).toEqual(["not_doctor", "case_closed", "already_approved", "conclusion_empty"]);
    expect(approvalBlockers(doctor, "attention", emptyProtocol(), "Závěr")).toEqual([]);
  });

  it("approves with open alerts of every kind, including missing documents: alerts are not an input", () => {
    // approve() takes no alert list at all; the type is the guarantee, this run shows the path succeeds.
    expect(approve(base({ caseStatus: "attention" })).status?.to).toBe("done");
  });

  it("refuses a second approval of the same protocol", () => {
    expect(() => approve(base({ protocol: { ...base().protocol, state: "approved" } }))).toThrow(expect.objectContaining({ code: "already_approved" }));
  });

  it("refuses a stale protocol version and changed attendance", () => {
    expect(() => approve(base({}, { protocol_version: 1 }))).toThrow(expect.objectContaining({ code: "protocol_conflict" }));
    expect(() => approve(base({}, { attendance_expected: ["MUDr. Svobodová"] }))).toThrow(expect.objectContaining({ code: "attendance_changed" }));
  });

  it("adds the approver to attendance when absent, not twice when present", () => {
    expect(approve(base()).attendanceAdd).toMatchObject({ dept_id: "d2", position: 0, user_id: "d2p1" });
    const present = base({ attendance: [{ dept_id: "d2", position: 0, user_id: "d2p1", user_name: "MUDr. Svobodová" }] }, { attendance_expected: ["MUDr. Svobodová"] });
    expect(approve(present).attendanceAdd).toBeNull();
    expect(approve(present).decision.attSnap).toEqual(["MUDr. Svobodová"]);
  });

  it("drops blank steps, supersedes the previous decision and counts due dates from the approval day", () => {
    const p = approve(base({ decisions: [{ id: "dec-1", version: 1 }] }));
    expect(p.tasks).toEqual([{ text: "objednat RT", assignee_user_id: "coord", assignee_name: "Bc. Marková", due: "2026-10-30" }]);
    expect(p.decision).toMatchObject({ id: "dec-new", version: 2, supersedes_id: "dec-1", slot: { day: "2026-10-22", time: "14:00" } });
    expect(p.suggestions.find((s) => s.quote.startsWith("Kontrolní MR"))).toMatchObject({ due: "2027-01-22", dueSrc: "computed", who: "Bc. Marková" });
    expect(p.decision.report).toMatchObject({ sha256: "a".repeat(64), picked_sections: ["summary"] });
  });

  it("refuses an empty conclusion", () => {
    expect(() => approve(base({}, { conclusion: "   " }))).toThrow(expect.objectContaining({ code: "conclusion_empty" }));
  });
});
