// Alerts, fact edits, the drafted question, drafted tasks, tasks, attendance, sessions, break-the-glass.
import { describe, expect, it } from "vitest";
import { alertState, missingSignal, parseAlertKey, transition } from "../../src/domain/alerts";
import { revertEdit, saveEdit } from "@codebridge/domain/edits";
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

  it("parses the page's alert keys", () => {
    expect(parseAlertKey("3")).toEqual({ origin: "flag", position: 3 });
    expect(parseAlertKey("gap:1")).toEqual({ origin: "gap", position: 1 });
    expect(parseAlertKey("f.1")).toBeNull();
  });
});

describe("fact edits", () => {
  it("saves, treats an empty or unchanged text as a revert, and refuses a stale edit id", () => {
    expect(saveEdit("od:1:e", null, "nový text", "původní", null)).toEqual({ kind: "save", text: "nový text" });
    expect(saveEdit("od:1:e", { log_id: 5, by_name: "x" }, "", "původní", 5)).toEqual({ kind: "revert" });
    expect(saveEdit("od:1:e", { log_id: 5, by_name: "x" }, "původní", "původní", 5)).toEqual({ kind: "revert" });
    expect(saveEdit("od:1:e", null, "původní", "původní", null)).toEqual({ kind: "noop" });
    expect(() => saveEdit("od:1:e", { log_id: 6, by_name: "MUDr. Novák" }, "x", "y", 5)).toThrow(expect.objectContaining({ code: "edit_conflict", message_cs: "Údaj mezitím upravil(a) MUDr. Novák." }));
    expect(() => saveEdit("od:1:e", { log_id: 6, by_name: "x" }, "x", "y", null)).toThrow(expect.objectContaining({ code: "edit_conflict" }));
    expect(() => saveEdit("bad key!", null, "x", "y", null)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(revertEdit("brief", null, null)).toEqual({ kind: "noop" });
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
