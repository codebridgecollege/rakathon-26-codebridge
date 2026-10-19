// Alerts, fact edits, the drafted question, drafted tasks, tasks, attendance, sessions, break-the-glass.
import { describe, expect, it } from "vitest";
import { ALERT_ID, alertState, missingSignal, transition } from "../../src/domain/alerts";
import { factIdOfKey, revertEdit, saveEdit } from "@codebridge/domain/edits";
import { confirmTransition, confirmationState, confirmedContent, stableJson } from "@codebridge/domain/confirmations";
import { confirmDraft } from "../../src/domain/question";
import { confirmTask, editSuggestion, type SuggestionRow } from "../../src/domain/suggestions";
import { setDone } from "../../src/domain/tasks";
import { setAttendance, validSetKey } from "../../src/domain/attendance";
import { endSession, startSession } from "../../src/domain/sessions";
import { grant } from "../../src/domain/breakglass";

describe("alerts", () => {
  it("takes the state from the latest event", () => {
    expect(alertState([])).toBe("open");
    expect(alertState([{ action: "ack" }])).toBe("ack");
    expect(alertState([{ action: "resolved" }, { action: "reopen" }])).toBe("open");
  });

  it.each([
    ["open", "ack", true], ["open", "resolved", true], ["open", "reopen", false],
    ["ack", "resolved", true], ["ack", "reopen", true], ["ack", "ack", false],
    ["resolved", "reopen", true], ["resolved", "ack", false], ["resolved", "resolved", false],
  ] as const)("%s -> %s allowed %s", (from, action, ok) => {
    const f = () => transition(from, action, from);
    if (ok) expect(f()).toBe(action);
    else expect(f).toThrow(expect.objectContaining({ code: "alert_action_not_allowed" }));
  });

  it("refuses a stale expected state", () => {
    expect(() => transition("ack", "resolved", "open")).toThrow(expect.objectContaining({ code: "alert_state_changed" }));
  });

  it("keeps the missing-document signal on after acknowledging; only resolving drops an item", () => {
    expect(missingSignal([{ kind: "missing", state: "open" }, { kind: "missing", state: "ack" }, { kind: "missing", state: "resolved" }, { kind: "unclear", state: "open" }])).toBe(2);
  });

  it("takes alert IDs of codebridge.extraction/2 only, never a position", () => {
    expect(ALERT_ID.test("al-77205d20")).toBe(true);
    for (const k of ["3", "gap:1", "al-77205d2", "al-77205D20", "al-77205d20x"]) expect(ALERT_ID.test(k), k).toBe(false);
  });
});

describe("fact edits", () => {
  it("saves, treats an empty or unchanged text as a revert, and refuses a stale edit id", () => {
    expect(saveEdit("f:f-8d41c2:e", null, "nový text", "původní", null)).toEqual({ kind: "save", text: "nový text" });
    expect(saveEdit("f:f-8d41c2:e", { log_id: 5, by_name: "x" }, "", "původní", 5)).toEqual({ kind: "revert" });
    expect(saveEdit("f:f-8d41c2:e", { log_id: 5, by_name: "x" }, "původní", "původní", 5)).toEqual({ kind: "revert" });
    expect(saveEdit("f:f-8d41c2:e", null, "původní", "původní", null)).toEqual({ kind: "noop" });
    expect(() => saveEdit("f:f-8d41c2:e", { log_id: 6, by_name: "MUDr. Novák" }, "x", "y", 5)).toThrow(expect.objectContaining({ code: "edit_conflict", message_cs: "Údaj mezitím upravil(a) MUDr. Novák." }));
    expect(() => saveEdit("f:f-8d41c2:e", { log_id: 6, by_name: "x" }, "x", "y", null)).toThrow(expect.objectContaining({ code: "edit_conflict" }));
    expect(() => saveEdit("bad key!", null, "x", "y", null)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(revertEdit("brief", null, null)).toEqual({ kind: "noop" });
  });

  it("takes field keys and f:<fact id> keys with a part; names the fact of an f: key", () => {
    for (const k of ["brief", "q", "dx", "assess:3", "sev:12:note", "f:f-8d41c2", "f:f-0a1b2c3d", "f:f-0a1b2c3d:line", "f:f-0a1b2c3d:t"])
      expect(saveEdit(k, null, "x", "y", null), k).toEqual({ kind: "save", text: "x" });
    for (const k of ["f:f-8d41c", "f:f-0a1b2c3d4", "f:f-0A1B2C3D", "f:f-0a1b2c3d:x", "f:al-77205d20", "f-0a1b2c3d", "brief:x", "Novák"])
      expect(() => saveEdit(k, null, "x", "y", null), k).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(factIdOfKey("f:f-0a1b2c3d:line")).toBe("f-0a1b2c3d");
    expect(factIdOfKey("f:f-8d41c2")).toBe("f-8d41c2");
    expect(factIdOfKey("brief")).toBeNull();
    expect(factIdOfKey("f:f-0a1b2c3d:x")).toBeNull();
  });

  it("refuses a new text under an old positional key, but lets a doctor revert an edit stored under one", () => {
    expect(() => saveEdit("od:1:e", null, "nový text", "původní", null)).toThrow(expect.objectContaining({ code: "edit_key_legacy" }));
    expect(() => saveEdit("od:1:e", { log_id: 5, by_name: "x" }, "jiný text", "původní", 5)).toThrow(expect.objectContaining({ code: "edit_key_legacy" }));
    expect(saveEdit("od:1:e", { log_id: 5, by_name: "x" }, "", "původní", 5)).toEqual({ kind: "revert" });
    expect(revertEdit("od:1:e", { log_id: 5, by_name: "x" }, 5)).toEqual({ kind: "revert" });
    expect(revertEdit("OA:2", null, null)).toEqual({ kind: "noop" });
  });
});

describe("fact confirmations", () => {
  const fact = {
    kind: "performance_status" as const,
    subject: "patient" as const,
    negated: false,
    status: "documented" as const,
    date: { as_written: null, precision: null, sort: null },
    value: { scale: "ECOG", value_as_written: "1", value_numeric: 1 },
  };

  it("hashes the frame and value the same whatever the key order, and differently when the value or frame changes", () => {
    const reordered = { value: { value_numeric: 1, value_as_written: "1", scale: "ECOG" }, date: { sort: null, precision: null, as_written: null }, status: "documented" as const, negated: false, subject: "patient" as const, kind: "performance_status" as const };
    expect(confirmedContent(reordered)).toBe(confirmedContent(fact));
    expect(confirmedContent({ ...fact, value: { ...fact.value, value_as_written: "2", value_numeric: 2 } })).not.toBe(confirmedContent(fact));
    expect(confirmedContent({ ...fact, negated: true })).not.toBe(confirmedContent(fact));
    expect(stableJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe('{"a":"x","b":[2,{"c":null,"d":1}]}');
  });

  it("is confirmed only for the value confirmed; a changed value asks again", () => {
    expect(confirmationState([], "a")).toBe("unconfirmed");
    expect(confirmationState([{ action: "confirm", value_sha256: "a" }], "a")).toBe("confirmed");
    expect(confirmationState([{ action: "confirm", value_sha256: "a" }], "b")).toBe("changed");
    expect(confirmationState([{ action: "confirm", value_sha256: "a" }, { action: "withdraw", value_sha256: "a" }], "a")).toBe("unconfirmed");
    expect(confirmTransition("unconfirmed", "confirm", "unconfirmed")).toBe("confirm");
    expect(confirmTransition("changed", "confirm", "changed")).toBe("confirm");
    expect(() => confirmTransition("confirmed", "confirm", "confirmed")).toThrow(expect.objectContaining({ code: "confirm_action_not_allowed" }));
    expect(() => confirmTransition("confirmed", "withdraw", "unconfirmed")).toThrow(expect.objectContaining({ code: "confirmation_changed" }));
  });
});

describe("drafted question", () => {
  it("confirms the exact draft the doctor saw, refuses a changed one and a second confirmation", () => {
    expect(() => confirmDraft(null, null, "x", null)).toThrow(expect.objectContaining({ code: "no_draft_question" }));
    expect(() => confirmDraft("Otázka?", "aaa", "bbb", null)).toThrow(expect.objectContaining({ code: "question_changed" }));
    expect(() => confirmDraft("Otázka?", "aaa", "aaa", { text: "Otázka?", by_name: "MUDr. Novák" })).toThrow(expect.objectContaining({ code: "question_confirmed" }));
    expect(() => confirmDraft("Otázka?", "aaa", "aaa", { text: "Jiná", by_name: "x" })).not.toThrow();
  });
});

describe("drafted tasks", () => {
  const s: SuggestionRow = { id: 1, case_id: "NO-A", text: "Objednat: MR", who: "Bc. Marková", due: null, due_source: "none", due_by: null, timing: "", state: "draft", decided_by_name: null };
  it("marks a typed due date as manual with who typed it", () => {
    expect(editSuggestion(s, { due: "2026-11-01" }, "MUDr. Novák", new Set())).toMatchObject({ due: "2026-11-01", due_source: "manual", due_by: "MUDr. Novák" });
    expect(editSuggestion(s, { due: "" }, "MUDr. Novák", new Set())).toMatchObject({ due: null, due_source: "none" });
  });
  it("confirms into a task with who confirmed it; a decided draft cannot be decided again", () => {
    expect(confirmTask(s, "MUDr. Novák")).toMatchObject({ from_suggestion_id: 1, confirmed_by: "MUDr. Novák" });
    expect(() => confirmTask({ ...s, state: "dismissed", decided_by_name: "MUDr. Malá" }, "x")).toThrow(expect.objectContaining({ code: "suggestion_decided", message_cs: "O návrhu už rozhodl(a) MUDr. Malá." }));
  });
});

describe("tasks, attendance, sessions, break-the-glass", () => {
  it("sets done against the state the caller saw", () => {
    expect(setDone(false, true, false)).toBe(true);
    expect(() => setDone(true, true, false)).toThrow(expect.objectContaining({ code: "task_changed" }));
  });

  const depts = [{ id: "d1", name: "Neurochirurgie", people: [{ id: "d1p1", name: "MUDr. Novák" }, { id: "d1p2", name: "MUDr. Dvořák" }] }, { id: "d2", name: "Onko", people: [{ id: "d2p1", name: "MUDr. Svobodová" }] }];
  it("accepts staff of their own department once each", () => {
    expect(setAttendance({ d1: ["d1p1", "d1p2"], d2: [] }, depts, 0, 0)).toHaveLength(2);
    expect(() => setAttendance({ d1: ["d2p1"] }, depts, 0, 0)).toThrow(expect.objectContaining({ code: "attendee_invalid" }));
    expect(() => setAttendance({ d1: ["d1p1", "d1p1"] }, depts, 0, 0)).toThrow(expect.objectContaining({ code: "attendee_invalid" }));
    expect(() => setAttendance({ dx: [] }, depts, 0, 0)).toThrow(expect.objectContaining({ code: "attendee_invalid" }));
    expect(() => setAttendance({}, depts, 1, 2)).toThrow(expect.objectContaining({ code: "attendance_conflict" }));
    expect(validSetKey("2026-10-22")).toBe(true);
    expect(validSetKey("case:NO-012")).toBe(true);
    expect(validSetKey("bez termínu: 12_pacient.pdf")).toBe(false);
  });

  it("starts a session only on a day with a booked case, once", () => {
    expect(startSession("2026-10-22", 1, null)).toBe("2026-10-22");
    expect(startSession("2026-10-22", 1, { ended_at: "2026-10-22T16:00:00Z" })).toBe("2026-10-22");
    expect(() => startSession("2026-10-22", 0, null)).toThrow(expect.objectContaining({ code: "no_cases_that_day" }));
    expect(() => startSession("2026-10-22", 2, { ended_at: null })).toThrow(expect.objectContaining({ code: "session_running" }));
    expect(() => endSession(null)).toThrow(expect.objectContaining({ code: "session_not_found" }));
  });

  it("grants break-the-glass to a doctor outside the team with a reason, for 12 hours", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const d = { id: "x", name: "MUDr. X", role: "doctor" as const };
    expect(grant(d, false, "konzultace na žádost onkologa", now)).toEqual({ reason: "konzultace na žádost onkologa", expires_at: "2026-10-22T22:00:00.000Z" });
    expect(() => grant(d, true, "konzultace na žádost onkologa", now)).toThrow(expect.objectContaining({ code: "already_member" }));
    expect(() => grant(d, false, "krátce", now)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(() => grant({ ...d, role: "coordinator" }, false, "konzultace na žádost onkologa", now)).toThrow(expect.objectContaining({ code: "role_forbidden" }));
  });
});
