// Route tests of the step 4 write API on local D1 (workerd): role matrix, guards and rollback, idempotency,
// append-only history, the reset, and that no access-log line carries patient text.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, testEnv } from "./helpers";
import { FAKE_NAME, SQL, loadFixture } from "./data";
import { Tx } from "../src/store/write";
import { D } from "../src/domain/errors";

type Body = { data?: Record<string, unknown>; data_epoch?: number; state?: Record<string, any>; error?: { code: string; message_cs: string; current?: any; fields?: any } };

let epoch = 1;
async function w(method: string, path: string, body: unknown = {}, user = "d2p1", headers: Record<string, string> = {}) {
  const r = await call(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": String(epoch), ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Body };
}
const q = async <T = Record<string, unknown>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;
const count = async (table: string, where = "1") => ((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!.n);
const log = () => q<{ actor_user_id: string; acted_as_role: string; case_id: string | null; action: string; what_cs: string; break_glass_reason: string | null }>("SELECT * FROM access_log ORDER BY id");
const decisionsBody = (o: Record<string, unknown> = {}) => ({
  protocol_version: 1,
  conclusion: "Stereotaktická radioterapie. Kontrolní MR za 3 měsíce. Radioterapie mozku není indikována.",
  picked_sections: ["summary"],
  report_html: `<p>report</p>`,
  attendance_expected: ["MUDr. Svobodová"],
  ...o,
});
// Every access-log line written in this file, checked for patient text at the end.
const seenLog: string[] = [];

beforeEach(async () => {
  if ((await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'access_log'").first())) {
    try {
      for (const r of await log()) seenLog.push(r.what_cs, r.break_glass_reason ?? "");
    } catch {
      /* an empty database */
    }
  }
  await loadFixture();
  epoch = 1;
});

describe("guards roll back the whole batch", () => {
  it("leaves no change and no audit row when a later guard fails", async () => {
    const v = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor" as const, dept: null, authMode: "demo" as const, impersonating: false };
    const t = new Tx(env.DB, v, { requestId: null, epoch: 1 });
    t.guard("ok", "(SELECT status FROM cases WHERE id = ?) = ?", ["NO-A", "ready"], () => D.conflict());
    t.guard("fails", "(SELECT status FROM cases WHERE id = ?) = ?", ["NO-B", "done"], () => D.statusChanged());
    t.run("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'");
    t.audit({ action: "x", what_cs: "y" });
    await expect(t.commit()).rejects.toMatchObject({ code: "status_changed" });
    expect((await q("SELECT status FROM cases ORDER BY id")).map((r) => r.status)).toEqual(["ready", "new"]);
    expect(await count("access_log")).toBe(0);
    expect(await count("write_guards")).toBe(0);
  });
});

describe("common write checks", () => {
  it("refuses another origin, non-JSON and a stale data epoch", async () => {
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, "d2p1", { origin: "https://evil.test" })).status).toBe(403);
    const r = await call("/api/cases/NO-A/status", { method: "POST", headers: { "content-type": "text/plain", "x-data-epoch": "1" }, body: "x" });
    expect(r.status).toBe(415);
    epoch = 7;
    const s = await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" });
    expect(s.status).toBe(409);
    expect(s.body.error?.code).toBe("data_reset");
    expect(await count("status_history")).toBe(0);
  });
});

describe("status and closing", () => {
  it("moves the status, writes history and one audit row with the actor", async () => {
    const r = await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" });
    expect(r.status).toBe(200);
    expect(r.body.state!.cases["NO-A"].status).toBe("attention");
    expect(r.body.state!.cases["NO-A"].statusHist).toMatchObject([{ from: "ready", to: "attention", by: "MUDr. Svobodová", how: "ručně" }]);
    expect(await log()).toMatchObject([{ actor_user_id: "d2p1", acted_as_role: "doctor", case_id: "NO-A", action: "case.status", what_cs: "změnil(a) stav případu: Připraven -> Vyžaduje pozornost (ručně)" }]);
  });

  it("refuses the administrator and a doctor outside the team, with one refusal row and no data change", async () => {
    for (const user of ["admin", "d1p1"]) {
      const r = await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, user);
      expect(r.status).toBe(403);
    }
    expect(await count("status_history")).toBe(0);
    expect((await log()).map((l) => [l.actor_user_id, l.what_cs, l.case_id])).toEqual([
      ["admin", "odmítnuto: změna stavu případu", "NO-A"],
      ["d1p1", "odmítnuto: změna stavu případu", "NO-A"],
    ]);
  });

  it("refuses a stale view of the status and a move that is not offered", async () => {
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "new" })).body.error?.code).toBe("status_changed");
    expect((await w("POST", "/cases/NO-A/status", { to: "done", expected_status: "ready" })).body.error?.code).toBe("status_move_not_allowed");
    expect(await count("status_history")).toBe(0);
  });

  it("frees an unlocked slot on close and reopens to the status it was closed from", async () => {
    const r = await w("POST", "/cases/NO-A/status", { to: "closed", expected_status: "ready" }, "coord");
    expect(r.body.data).toEqual({ slot_released: true });
    expect(await count("slots", "case_id = 'NO-A'")).toBe(0);
    expect((await log()).map((l) => l.what_cs)).toContain("uvolnil(a) termín MDT při uzavření případu (Čt 22. 10. 2026 · 14:00)");
    const back = await w("POST", "/cases/NO-A/status", { to: "ready", expected_status: "closed" }, "coord");
    expect(back.body.state!.cases["NO-A"].status).toBe("ready");
  });
});

describe("slots", () => {
  it("maps the slot's UNIQUE to slot_taken and rolls back the status change", async () => {
    const r = await w("PUT", "/cases/NO-B/slot", { day: "2026-10-22", time: "14:00" }, "d1p1");
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "slot_taken", message_cs: "Termín mezitím obsadil jiný případ. Vyberte jiný." });
    expect((await q("SELECT status FROM cases WHERE id = 'NO-B'"))[0]!.status).toBe("new");
    expect(await count("status_history")).toBe(0);
    expect(await count("access_log")).toBe(0);
  });

  it("books, moves new to scheduled, and warns outside seminar time", async () => {
    const r = await w("PUT", "/cases/NO-B/slot", { day: "2026-10-21", time: "09:00" }, "coord");
    expect(r.body.data).toEqual({ warning_cs: "mimo čas semináře" });
    expect(r.body.state!.cases["NO-B"]).toMatchObject({ status: "scheduled", slot: { day: "2026-10-21", time: "09:00" } });
    const back = await w("DELETE", "/cases/NO-B/slot", {}, "coord");
    expect(back.body.state!.cases["NO-B"]).toMatchObject({ status: "new", slot: null });
  });

  it("lets exactly one of two parallel bookings of one slot win", async () => {
    const [a, b] = await Promise.all([
      w("PUT", "/cases/NO-B/slot", { day: "2026-10-29", time: "14:00" }, "coord"),
      w("PUT", "/cases/NO-A/slot", { day: "2026-10-29", time: "14:00" }, "coord"),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count("slots", "day = '2026-10-29'")).toBe(1);
  });

  it("refuses booking a closed case and an invalid slot", async () => {
    await w("POST", "/cases/NO-B/status", { to: "closed", expected_status: "new" }, "coord");
    expect((await w("PUT", "/cases/NO-B/slot", { day: "2026-10-22", time: "14:10" }, "coord")).body.error?.code).toBe("case_closed");
    expect((await w("PUT", "/cases/NO-A/slot", { day: "2026-10-24", time: "14:10" }, "coord")).body.error?.code).toBe("slot_invalid");
  });
});

describe("protocol, approval, new version", () => {
  it("autosaves with versions and refuses a stale one with the stored draft", async () => {
    const a = await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Návrh" });
    expect(a.body.data).toMatchObject({ version: 1, updated_by: "MUDr. Svobodová" });
    const stale = await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Jiný" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "protocol_conflict", message_cs: "Koncept mezitím upravil(a) MUDr. Svobodová.", current: { conclusion: "Návrh", version: 1 } });
    await w("PUT", "/cases/NO-A/protocol", { version: 1, notes: "pozn." });
    // Autosave writes one audit row per user, case and window.
    expect(await count("access_log", "action = 'protocol.edit'")).toBe(1);
  });

  it("refuses protocol edits by the coordinator (doctors only, open question)", async () => {
    const r = await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "x" }, "coord");
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe("not_doctor");
  });

  it("approves with an open missing-document alert, once per key, and freezes what was approved", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "rozepsáno", steps: [{ text: "objednat RT", who: "Bc. Marková", due: "2026-10-30" }] });
    const key = { "idempotency-key": "11111111-aaaa-bbbb-cccc-000000000001" };
    const body = decisionsBody();
    const [r1, r2] = await Promise.all([w("POST", "/cases/NO-A/decisions", body, "d2p1", key), w("POST", "/cases/NO-A/decisions", body, "d2p1", key)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.data).toEqual(r2.body.data);
    expect(await count("decisions")).toBe(1);
    const d = (await q("SELECT * FROM decisions"))[0]!;
    expect(d).toMatchObject({ case_id: "NO-A", version: 1, conclusion: body.conclusion, approved_by_user_id: "d2p1", slot_day: "2026-10-22", slot_time: "14:00", supersedes_id: null });
    expect(JSON.parse(d.attendance_snapshot_json as string)).toEqual(["MUDr. Svobodová"]);
    const cs = r1.body.state!.cases["NO-A"];
    expect(cs.status).toBe("done");
    expect(cs.protocol).toMatchObject({ state: "approved", approver: "MUDr. Svobodová" });
    expect(cs.tasks.map((t: { text: string }) => t.text)).toContain("objednat RT");
    // Drafted tasks stay drafts; the negated radiotherapy clause drafts nothing.
    expect(cs.sugg.map((s: { state: string; quote: string }) => [s.state, s.quote])).toEqual([
      ["draft", "Stereotaktická radioterapie"],
      ["draft", "Kontrolní MR za 3 měsíce"],
    ]);
    const n = (await q("SELECT * FROM notifications"))[0]!;
    expect(n).toMatchObject({ kind: "approval", case_id: "NO-A", count: 1, to_user_id: "coord" });
    expect(JSON.stringify(n)).not.toContain("radioterapie");
    expect(r1.body.state!.att["2026-10-22"].byName).toEqual({ "Klinická onkologie": ["MUDr. Svobodová"] });
    expect((await log()).map((l) => l.what_cs)).toEqual(expect.arrayContaining(["schválil(a) závěr MDT", "doplněn(a) mezi přítomné při schválení závěru"]));

    // A second click with another key is refused; the same key with another body too.
    const again = await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 2 }), "d2p1", { "idempotency-key": "11111111-aaaa-bbbb-cccc-000000000002" });
    expect(again.body.error?.code).toBe("already_approved");
    const mismatch = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "jiný" }), "d2p1", key);
    expect(mismatch.body.error?.code).toBe("idempotency_mismatch");
    expect(await count("decisions")).toBe(1);
  });

  it("refuses approval by the coordinator, a stale attendance and an empty conclusion", async () => {
    const k = (n: number) => ({ "idempotency-key": `22222222-aaaa-bbbb-cccc-00000000000${n}` });
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 0 }), "coord", k(1))).body.error?.code).toBe("not_doctor");
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 0, attendance_expected: [] }), "d2p1", k(2))).body.error?.code).toBe("attendance_changed");
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 0, conclusion: " " }), "d2p1", k(3))).body.error?.code).toBe("conclusion_empty");
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 0 }), "d2p1")).body.error?.code).toBe("invalid_input");
    expect(await count("decisions")).toBe(0);
  });

  it("starts a new version only after approval and never wipes an unapproved draft", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "koncept" });
    const early = await w("POST", "/cases/NO-A/decisions/new-version", { expected_decision_id: null });
    expect(early.body.error?.code).toBe("not_approved_yet");
    expect((await q("SELECT conclusion FROM protocols WHERE case_id = 'NO-A'"))[0]!.conclusion).toBe("koncept");
    const ok = await w("POST", "/cases/NO-A/decisions", decisionsBody(), "d2p1", { "idempotency-key": "33333333-aaaa-bbbb-cccc-000000000001" });
    const id = ok.body.data!.decision_id;
    const nv = await w("POST", "/cases/NO-A/decisions/new-version", { expected_decision_id: id });
    expect(nv.body.state!.cases["NO-A"]).toMatchObject({ status: "scheduled", protocol: { state: "draft", concl: "" } });
    // The approved decision is untouched, and the slot it was made on stays locked.
    expect((await q("SELECT conclusion FROM decisions"))[0]!.conclusion).toBe(decisionsBody().conclusion);
    expect((await w("DELETE", "/cases/NO-A/slot", {}, "coord")).body.error?.code).toBe("slot_locked");
    // The next approval supersedes the first.
    await w("PUT", "/cases/NO-A/protocol", { version: 3, concl: "druhý závěr" });
    const second = await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 4, conclusion: "druhý závěr" }), "d2p1", { "idempotency-key": "33333333-aaaa-bbbb-cccc-000000000002" });
    expect(second.status).toBe(200);
    expect((await q("SELECT version, supersedes_id FROM decisions ORDER BY version")).map((r) => [r.version, r.supersedes_id])).toEqual([[1, null], [2, id]]);
  });
});

describe("question, edits, alerts", () => {
  it("confirms the drafted question only against the draft the doctor saw", async () => {
    await env.DB.prepare("UPDATE cases SET question_draft = 'Indikace RT?' WHERE id = 'NO-B'").run();
    const wf = await call("/api/workflow", { headers: { "x-demo-user": "d1p1" } });
    const sha = ((await wf.json()) as { cases: Record<string, { draft_sha: string }> }).cases["NO-B"]!.draft_sha;
    expect((await w("POST", "/cases/NO-B/question/confirm", { draft_sha: "0".repeat(64) }, "d1p1")).body.error?.code).toBe("question_changed");
    expect((await w("POST", "/cases/NO-B/question/confirm", { draft_sha: sha }, "coord")).status).toBe(403);
    const ok = await w("POST", "/cases/NO-B/question/confirm", { draft_sha: sha }, "d1p1");
    expect(ok.body.state!.cases["NO-B"].qConfirm).toMatchObject({ text: "Indikace RT?", by: "MUDr. Novák" });
    expect((await w("POST", "/cases/NO-B/question/confirm", { draft_sha: sha }, "d1p1")).body.error?.code).toBe("question_confirmed");
  });

  it("saves, conflicts and reverts a fact edit; the log only grows; the source is untouched", async () => {
    const s1 = await w("PUT", "/cases/NO-A/edits/od%3A1%3Ae", { text: "opraveno", orig: "původně", expected_edit_id: null });
    const e1 = s1.body.state!.cases["NO-A"].edits["od:1:e"];
    expect(e1).toMatchObject({ text: "opraveno", orig: "původně", by: "MUDr. Svobodová" });
    expect((await w("PUT", "/cases/NO-A/edits/od%3A1%3Ae", { text: "jinak", orig: "původně", expected_edit_id: null })).body.error).toMatchObject({ code: "edit_conflict", message_cs: "Údaj mezitím upravil(a) MUDr. Svobodová." });
    const rv = await w("DELETE", "/cases/NO-A/edits/od%3A1%3Ae", { expected_edit_id: e1.id });
    expect(rv.body.state!.cases["NO-A"].edits).toEqual({});
    expect(rv.body.state!.cases["NO-A"].editLog.map((e: { reverted: boolean }) => e.reverted)).toEqual([false, true]);
    expect((await w("PUT", "/cases/NO-A/edits/od%3A1%3Ae", { text: "x", orig: "y", expected_edit_id: null }, "coord")).body.error?.code).toBe("not_doctor");
  });

  it("acknowledges and resolves an alert by its page key; the coordinator may too; stale state refused", async () => {
    const a = await w("POST", "/cases/NO-A/alerts/0/events", { action: "ack", expected_state: "open" }, "coord");
    expect(a.body.state!.cases["NO-A"].alertHist).toMatchObject([{ i: 0, action: "ack", who: "Bc. Marková" }]);
    expect((await w("POST", "/cases/NO-A/alerts/0/events", { action: "resolved", expected_state: "open" })).body.error?.code).toBe("alert_state_changed");
    const g = await w("POST", "/cases/NO-A/alerts/gap%3A0/events", { action: "resolved", expected_state: "open" });
    expect(g.body.state!.cases["NO-A"].alertHist.map((x: { i: unknown }) => x.i)).toEqual([0, "gap:0"]);
    expect((await q("SELECT alert_id FROM alert_events ORDER BY id")).map((r) => r.alert_id)).toEqual(["al-1", "al-2"]);
    expect((await w("POST", "/cases/NO-A/alerts/9/events", { action: "ack", expected_state: "open" })).status).toBe(404);
    expect((await log()).map((l) => l.what_cs)).toContain("vzal(a) upozornění na vědomí: Chybí");
  });
});

describe("tasks, drafted tasks, digest", () => {
  it("marks a task done against the state seen, and logs it", async () => {
    const r = await w("PATCH", "/tasks/1", { done: true, expected_done: false }, "coord");
    expect(r.body.state!.cases["NO-A"].tasks.find((t: { id: number }) => t.id === 1).done).toBe(true);
    expect((await w("PATCH", "/tasks/1", { done: true, expected_done: false }, "coord")).body.error?.code).toBe("task_changed");
    expect((await log()).at(-1)?.what_cs).toBe("označil(a) úlohu jako hotovou");
  });

  it("confirms a drafted task into a task with who confirmed it; the coordinator cannot", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." });
    await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Kontrolní MR za 3 měsíce." }), "d2p1", { "idempotency-key": "44444444-aaaa-bbbb-cccc-000000000001" });
    const sid = (await q<{ id: number }>("SELECT id FROM task_suggestions"))[0]!.id;
    expect((await w("POST", `/suggestions/${sid}/confirm`, {}, "coord")).body.error?.code).toBe("not_doctor");
    const ok = await w("POST", `/suggestions/${sid}/confirm`, {}, "d2p1");
    const t = ok.body.state!.cases["NO-A"].tasks.find((x: { fromSugg: number }) => x.fromSugg === sid);
    expect(t).toMatchObject({ confirmedBy: "MUDr. Svobodová", dueSrc: "computed" });
    expect((await w("POST", `/suggestions/${sid}/dismiss`, {}, "d2p1")).body.error).toMatchObject({ code: "suggestion_decided", message_cs: "O návrhu už rozhodl(a) MUDr. Svobodová." });
  });

  it("writes a digest outbox row with a count only, once a minute", async () => {
    const r = await w("POST", "/notifications/digest", {}, "coord");
    expect(r.body.state!.mails[0]).toMatchObject({ kind: "digest", n: 1, by: "Bc. Marková" });
    expect((await w("POST", "/notifications/digest", {}, "coord")).body.error?.code).toBe("digest_too_soon");
  });
});

describe("sessions and attendance", () => {
  it("starts and ends an MDT on a day with a booked case", async () => {
    expect((await w("POST", "/sessions", { day: "2026-10-23" }, "coord")).body.error?.code).toBe("no_cases_that_day");
    const s = await w("POST", "/sessions", { day: "2026-10-22" }, "coord");
    expect(s.body.state!.sessions).toMatchObject([{ day: "2026-10-22", ended_at: null }]);
    expect((await w("POST", "/sessions", { day: "2026-10-22" }, "coord")).body.error?.code).toBe("session_running");
    expect((await w("DELETE", "/sessions/2026-10-22", {}, "coord")).body.state!.sessions[0].ended_at).toBeTruthy();
    expect((await w("POST", "/sessions", { day: "2026-10-22" }, "admin")).status).toBe(403);
  });

  it("sets attendance with a version, staff of their department only", async () => {
    const a = await w("PUT", "/attendance/2026-10-22", { version: 0, by_dept: { d1: ["d1p1"], d2: ["d2p1"] } }, "coord");
    expect(a.body.state!.att["2026-10-22"]).toMatchObject({ version: 1, byName: { Neurochirurgie: ["MUDr. Novák"], "Klinická onkologie": ["MUDr. Svobodová"] } });
    const stale = await w("PUT", "/attendance/2026-10-22", { version: 0, by_dept: {} }, "coord");
    expect(stale.body.error).toMatchObject({ code: "attendance_conflict", current: { version: 1 } });
    expect((await w("PUT", "/attendance/2026-10-22", { version: 1, by_dept: { d1: ["d2p1"] } }, "coord")).body.error?.code).toBe("attendee_invalid");
    expect((await w("PUT", "/attendance/case:NO-B", { version: 0, by_dept: { d1: ["d1p1"] } }, "d1p1")).status).toBe(200);
  });
});

describe("new case and break-the-glass", () => {
  const form = { first_name: "Nová", last_name: "Pacientka", birth_number: "655312/1234", consent: true };
  const key = (n: number) => ({ "idempotency-key": `55555555-aaaa-bbbb-cccc-00000000000${n}` });

  it("returns field messages, and creates a case once per key with all MDT departments as members", async () => {
    expect((await w("POST", "/cases", { consent: false }, "coord", key(1))).body.error?.fields).toMatchObject({ first_name: "Vyplňte jméno.", consent: expect.any(String) });
    const [a, b] = await Promise.all([w("POST", "/cases", form, "coord", key(2)), w("POST", "/cases", form, "coord", key(2))]);
    expect(a.body.data).toEqual(b.body.data);
    expect(await count("cases")).toBe(3);
    const id = a.body.data!.case_id as string;
    expect(a.body.state!.patient).toMatchObject({ id, status: "new", name: "Nová Pacientka" });
    expect(await count("case_members", `case_id = '${id}' AND dept_id IS NOT NULL`)).toBe(2);
    expect((await w("POST", "/cases", form, "admin", key(3))).status).toBe(403);
  });

  it("needs an override with a reason for a known birth number; the reason stays out of the log", async () => {
    const dup = await w("POST", "/cases", { ...form, birth_number: "6453121234" }, "coord", key(4));
    expect(dup.body.error).toMatchObject({ code: "duplicate_birth_number", current: { case_id: "NO-A" } });
    const short = await w("POST", "/cases", { ...form, birth_number: "6453121234", duplicate_override: { birth_number: "645312/1234", reason: "x" } }, "coord", key(5));
    expect(short.body.error?.code).toBe("override_reason_required");
    const reason = "jiná osoba, ověřeno u odesílajícího lékaře";
    const ok = await w("POST", "/cases", { ...form, birth_number: "6453121234", duplicate_override: { birth_number: "645312/1234", reason } }, "coord", key(6));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await log())).not.toContain(reason);
    expect((await q("SELECT duplicate_override_reason AS r FROM cases WHERE id = ?1", ok.body.data!.case_id))[0]!.r).toBe(reason);
  });

  it("lets a doctor outside the team in with a reason, and logs every read under the grant", async () => {
    expect((await call("/api/cases/NO-A", { headers: { "x-demo-user": "d1p1" } })).status).toBe(403);
    expect((await w("POST", "/cases/NO-A/break-glass", { reason: "krátce" }, "d1p1")).status).toBe(422);
    const g = await w("POST", "/cases/NO-A/break-glass", { reason: "konzultace na žádost onkologa" }, "d1p1");
    expect(g.status).toBe(200);
    expect((await call("/api/cases/NO-A", { headers: { "x-demo-user": "d1p1" } })).status).toBe(200);
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" }, "d1p1")).status).toBe(200);
    const rows = (await log()).filter((l) => l.actor_user_id === "d1p1" && l.case_id === "NO-A" && !l.what_cs.startsWith("odmítnuto"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((l) => l.break_glass_reason === "konzultace na žádost onkologa")).toBe(true);
    expect((await w("POST", "/cases/NO-A/break-glass", { reason: "konzultace na žádost onkologa" }, "d2p1")).body.error?.code).toBe("already_member");
  });
});

describe("view events", () => {
  it("writes the server's fixed line for an allowed code and refuses others", async () => {
    expect((await w("POST", "/audit/events", { case_id: "NO-A", code: "source_viewed", target: 2 })).status).toBe(200);
    expect((await w("POST", "/audit/events", { case_id: "NO-A", code: "anything", what: FAKE_NAME })).status).toBe(422);
    expect((await w("POST", "/audit/events", { case_id: "NO-A", code: "source_viewed" }, "d1p1")).status).toBe(403);
    expect((await log()).filter((l) => l.action.startsWith("view.")).map((l) => l.what_cs)).toEqual(["zobrazil(a) zdroj s. 2"]);
  });
});

describe("reset-demo", () => {
  const MUTABLE = /^\s*INSERT INTO (users|departments|dept_members|cases|case_members|slots|tasks) /;
  async function putResetDoc() {
    await env.DOCS.put("seed/reset.json", JSON.stringify({ seed_version: "test", statements: SQL.filter((s) => MUTABLE.test(s)), patient_ids: ["pt-A", "pt-B"] }));
  }
  const snapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const t of ["users", "departments", "dept_members", "patients", "cases", "case_members", "status_history", "slots", "protocols", "decisions", "tasks", "task_suggestions", "edit_log", "fact_edits", "alert_events", "attendance", "documents", "alerts", "pages"])
      // Insert-time defaults (created_at and the like) are the only columns a reseed may change.
      out[t] = (await q(`SELECT * FROM ${t} ORDER BY rowid`)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/^(created_at|added_at|booked_at)$/.test(k))));
    return out;
  };

  it("restores the seeded state, archives the audit, keeps seed objects, deletes uploads and bumps the epoch", async () => {
    await putResetDoc();
    await env.DOCS.put("uploads/x.pdf", "x");
    const before = await snapshot();
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." });
    await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Kontrolní MR za 3 měsíce." }), "d2p1", { "idempotency-key": "66666666-aaaa-bbbb-cccc-000000000001" });
    await w("POST", "/cases/NO-A/alerts/0/events", { action: "ack", expected_state: "open" });
    await w("POST", "/cases", { first_name: "A", last_name: "B", birth_number: "700101/1234", consent: true }, "coord", { "idempotency-key": "66666666-aaaa-bbbb-cccc-000000000002" });
    await w("PUT", "/cases/NO-A/edits/brief", { text: "upraveno", orig: "", expected_edit_id: null });
    expect(await count("decisions")).toBe(1);

    expect((await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "d2p1")).status).toBe(403);
    expect((await w("POST", "/admin/reset-demo", { confirm: "ano" }, "admin")).status).toBe(422);
    const r = await w("POST", "/admin/reset-demo", { confirm: "OBNOVIT" }, "admin");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ data_epoch: 2, seed_version: "test", r2_left: 0 });
    expect(r.body.data!.statements as number).toBeLessThan(50);
    expect(await snapshot()).toEqual(before);
    expect((await log()).map((l) => l.what_cs)).toEqual(["obnovil(a) ukázková data (seed test)"]);
    const archive = await env.DOCS.list({ prefix: "audit-archive/" });
    expect(archive.objects).toHaveLength(1);
    expect(await env.DOCS.get("uploads/x.pdf")).toBeNull();
    expect(await env.DOCS.get("extract/NO-A/run-A.json")).not.toBeNull();
    // A tab from before the reset cannot write; the append-only triggers are back on.
    expect((await w("POST", "/cases/NO-A/status", { to: "attention", expected_status: "ready" })).body.error?.code).toBe("data_reset");
    await expect(env.DB.prepare("DELETE FROM access_log").run()).rejects.toThrow(/append-only/);
    const h = await (await call("/api/health")).json<{ demo: { data_epoch: number; reset_enabled: boolean } }>();
    expect(h.demo).toMatchObject({ data_epoch: 2, reset_enabled: true, seed_version: "test" });
  });

  it("is refused when the deployment does not enable it", async () => {
    await putResetDoc();
    const r = await call("/api/admin/reset-demo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "admin", "x-data-epoch": "1" },
      body: JSON.stringify({ confirm: "OBNOVIT" }),
    }, testEnv({ DEMO_RESET_ENABLED: "false" }));
    expect(r.status).toBe(403);
  });
});

describe("append-only history", () => {
  it("refuses UPDATE and DELETE outside the reset, also through the new columns", async () => {
    await w("PUT", "/cases/NO-A/edits/brief", { text: "upraveno", orig: "", expected_edit_id: null });
    await expect(env.DB.prepare("UPDATE edit_log SET confirmed = 1").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM edit_log").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("UPDATE access_log SET target_id = 'x'").run()).rejects.toThrow(/append-only/);
  });
});

afterAll(async () => {
  for (const r of await log()) seenLog.push(r.what_cs, r.break_glass_reason ?? "");
});

describe("privacy of the access log", () => {
  it("never holds a patient name, birth number or conclusion text (checked over every line this file wrote)", async () => {
    for (const r of await log()) seenLog.push(r.what_cs);
    const text = seenLog.join("\n");
    expect(seenLog.length).toBeGreaterThan(20);
    for (const bad of [FAKE_NAME, "Testová", "Pacientka", "645312", "655312", "Stereotaktická", "Kontrolní MR", "rozepsáno", "Indikace RT", "opraveno", "jiná osoba"]) expect(text).not.toContain(bad);
  });
});
