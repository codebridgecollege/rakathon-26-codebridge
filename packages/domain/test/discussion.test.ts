import { describe, expect, it } from "vitest";
import {
  allDone,
  approvalAttendance,
  approvalSignature,
  assignees,
  attKey,
  cardChip,
  cardOpen,
  emptyProto,
  inSession,
  mergeProto,
  protoEditable,
  protoFromServer,
  recordingTarget,
  runningSession,
} from "../src/discussion";
import { DEFAULT_COORDINATOR, DEFAULT_STAFF, isDefaultStaff } from "../src/staff-default";

const row = (file: string, status = "scheduled", day: string | null = "2026-10-22") => ({ file, id: `NO-${file}`, status, slot: day ? { day, time: "14:00" } : null });

describe("running session", () => {
  it("is the latest session that has not ended", () => {
    const s = runningSession([
      { day: "2026-10-15", started_at: "2026-10-15T12:00:00Z", ended_at: null },
      { day: "2026-10-22", started_at: "2026-10-22T12:00:00Z", ended_at: null },
      { day: "2026-10-29", started_at: "2026-10-29T12:00:00Z", ended_at: "2026-10-29T15:00:00Z" },
    ]);
    expect(s?.day).toBe("2026-10-22");
    expect(runningSession([{ day: "2026-10-22", started_at: "x", ended_at: "y" }])).toBeNull();
  });
  it("holds the cases booked on its day only", () => {
    expect(inSession(row("10"), { day: "2026-10-22" })).toBe(true);
    expect(inSession(row("10", "new", null), { day: "2026-10-22" })).toBe(false);
    expect(inSession(row("10"), null)).toBe(false);
  });
});

describe("attendance key", () => {
  it("is the seminar day, or the case for a case without a slot", () => {
    expect(attKey(row("10"))).toBe("2026-10-22");
    expect(attKey(row("10", "new", null))).toBe("case:NO-10");
  });
});

describe("protocol from the server and merging", () => {
  const server = protoFromServer({ notes: "theirs", conclusion: "C", steps: [{ text: "MR", who: "Bc. Marková", due: "2026-10-30" }], state: "draft", version: 4 });
  it("reads the stored conclusion name and defaults", () => {
    expect(server.concl).toBe("C");
    expect(protoFromServer(null)).toEqual(emptyProto());
  });
  it("takes the server's copy when nothing typed is pending", () => {
    const local = { ...emptyProto(), notes: "mine", version: 4 };
    const { proto, keepLocal } = mergeProto(local, server, false);
    expect(proto.notes).toBe("theirs");
    expect(keepLocal).toBe(false);
  });
  it("keeps typed text and its version while a save is pending, but always takes the state", () => {
    const local = { ...emptyProto(), notes: "mine", version: 3 };
    const { proto, keepLocal } = mergeProto(local, server, true);
    expect(proto.notes).toBe("mine");
    expect(proto.version).toBe(3);
    expect(keepLocal).toBe(true);
  });
  it("never rolls text back to an older answer", () => {
    const local = { ...emptyProto(), notes: "newer", version: 6 };
    expect(mergeProto(local, server, false).proto.notes).toBe("newer");
  });
  it("an approval replaces pending text: an approved record is the server's", () => {
    const approved = { ...server, state: "approved" as const, version: 5 };
    const { proto } = mergeProto({ ...emptyProto(), notes: "mine", version: 4 }, approved, true);
    expect(proto.state).toBe("approved");
    expect(proto.notes).toBe("theirs");
  });
});

describe("who may write and approve", () => {
  it("doctors and the coordinator write a draft of an open case", () => {
    expect(protoEditable(true, "draft", "scheduled")).toBe(true);
    expect(protoEditable(false, "draft", "scheduled")).toBe(false);
    expect(protoEditable(true, "approved", "done")).toBe(false);
    expect(protoEditable(true, "draft", "closed")).toBe(false);
  });
  it("the approver joins the frozen attendance once", () => {
    expect(approvalAttendance(["MUDr. Novák"], "MUDr. Svobodová")).toEqual(["MUDr. Novák", "MUDr. Svobodová"]);
    expect(approvalAttendance(["MUDr. Svobodová"], "MUDr. Svobodová")).toEqual(["MUDr. Svobodová"]);
  });
  it("a changed approval body changes the signature, so it gets a new idempotency key", () => {
    const b = { protocol_version: 2, conclusion: "A", attendance_expected: ["X"], picked_sections: ["summary"] };
    expect(approvalSignature(b)).toBe(approvalSignature({ ...b }));
    expect(approvalSignature(b)).not.toBe(approvalSignature({ ...b, conclusion: "B" }));
    expect(approvalSignature(b)).not.toBe(approvalSignature({ ...b, report_html: "<article>x</article>" }));
  });
});

describe("the card", () => {
  it("the doctor's choice wins; otherwise open in a session, with a draft or an approval", () => {
    expect(cardOpen(undefined, false, false, false)).toBe(false);
    expect(cardOpen(undefined, true, false, false)).toBe(true);
    expect(cardOpen(undefined, false, true, false)).toBe(true);
    expect(cardOpen(undefined, false, false, true)).toBe(true);
    expect(cardOpen(false, true, true, true)).toBe(false);
  });
  it("the chip says approved, draft, or the valid conclusion's number", () => {
    expect(cardChip("approved", "", 1)).toEqual({ kind: "approved" });
    expect(cardChip("draft", " x ", 1)).toEqual({ kind: "draft" });
    expect(cardChip("draft", "  ", 2)).toEqual({ kind: "valid", n: 2 });
    expect(cardChip("draft", "", 0)).toBeNull();
  });
  it("assignees are staff only, each once", () => {
    const staff = new Set(["Bc. Marková", "MUDr. Svobodová", "MUDr. Novák"]);
    expect(assignees("Bc. Marková", "MUDr. Svobodová", ["MUDr. Novák", "MUDr. Svobodová", "MUDr. Cizí"], staff)).toEqual(["Bc. Marková", "MUDr. Svobodová", "MUDr. Novák"]);
  });
});

describe("recording target", () => {
  it("only an open, unapproved case of the running seminar takes words", () => {
    expect(recordingTarget(row("10"), false, null)).toBe("10");
    expect(recordingTarget(row("10"), false, { day: "2026-10-22" })).toBe("10");
    expect(recordingTarget(row("10", "scheduled", "2026-10-29"), false, { day: "2026-10-22" })).toBeNull();
    expect(recordingTarget(row("10", "closed"), false, null)).toBeNull();
    expect(recordingTarget(row("10"), true, null)).toBeNull();
    expect(recordingTarget(null, false, null)).toBeNull();
  });
  it("stops by itself when every case of the agenda is approved or closed", () => {
    const ag = [row("10"), row("11", "closed")];
    expect(allDone(ag, (f) => f === "10")).toBe(true);
    expect(allDone(ag, () => false)).toBe(false);
    expect(allDone([], () => true)).toBe(false);
  });
});

describe("default staff", () => {
  const dir = {
    depts: DEFAULT_STAFF.map((d) => ({ id: d.id, name: d.name, people: d.people.map((p) => ({ id: p.id, pre: p.pre, sur: p.sur, post: "", fn: "" })) })),
    coord: { ...DEFAULT_COORDINATOR },
  };
  it("recognises the fictional default list and any edit of it", () => {
    expect(isDefaultStaff(dir)).toBe(true);
    expect(isDefaultStaff({ ...dir, coord: { ...dir.coord, sur: "Nová" } })).toBe(false);
    expect(isDefaultStaff(null)).toBe(false);
  });
});
