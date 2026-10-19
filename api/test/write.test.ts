// Route tests of the step 4 write API on local D1 (workerd): role matrix, guards and rollback, idempotency,
// append-only history, the reset, and that no access-log line carries patient text.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture, resetDoc, RUN_A2, RUN_A2_ID, RUN_A2_KEY } from "./data";
import { sha256Hex } from "../src/store/work";
import { confirmedContent } from "@codebridge/domain/confirmations";
import { Tx } from "../src/store/write";
import { D } from "@codebridge/domain/errors";
import { viewLineId } from "@codebridge/domain/extraction/keys";
import { COORDINATOR_EDITS_PROTOCOL } from "@codebridge/domain/config";

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
// Org A's rows: the fixture's org B look-alikes must stay as they are, and never count here.
const count = async (table: string, where = "1", org = "demo-a") => ((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE org_id = '${org}' AND (${where})`))[0]!.n);
const log = () => q<{ actor_user_id: string; acted_as_role: string; case_id: string | null; action: string; what_cs: string; break_glass_reason: string | null }>("SELECT * FROM access_log ORDER BY id");
const decisionsBody = (o: Record<string, unknown> = {}) => ({
  protocol_version: 1,
  conclusion: "Stereotaktická radioterapie. Kontrolní MR za 3 měsíce. Radioterapie mozku není indikována.",
  picked_sections: ["summary"],
  report_html: `<p>report</p>`,
  attendance_expected: ["MUDr. Svobodová"],
  ...o,
});
// NO-A back on its old /1 run (current), as before the case is reseeded.
const useRunA = () =>
  env.DB.batch([
    env.DB.prepare(`UPDATE extraction_runs SET is_current = 0 WHERE id = '${RUN_A2_ID}'`),
    env.DB.prepare("UPDATE extraction_runs SET is_current = 1 WHERE id = 'run-A'"),
  ]);
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
    const v = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor" as const, dept: null, authMode: "demo" as const, impersonating: false, org: "demo-a", membershipId: "d2p1" };
    const t = new Tx(env.DB, v, { requestId: null, epoch: 1 });
    t.guard("ok", "(SELECT status FROM cases WHERE id = ?) = ?", ["NO-A", "ready"], () => D.conflict());
    t.guard("fails", "(SELECT status FROM cases WHERE id = ?) = ?", ["NO-B", "done"], () => D.statusChanged());
    t.run("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'");
    t.audit({ action: "x", what_cs: "y" });
    await expect(t.commit()).rejects.toMatchObject({ code: "status_changed" });
    expect((await q("SELECT status FROM cases WHERE org_id = 'demo-a' ORDER BY id")).map((r) => r.status)).toEqual(["ready", "new"]);
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

  it("follows COORDINATOR_EDITS_PROTOCOL for the coordinator's protocol edits (open question), and refuses the administrator", async () => {
    const r = await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "x" }, "coord");
    if (COORDINATOR_EDITS_PROTOCOL) expect(r.status).toBe(200);
    else expect([r.status, r.body.error?.code]).toEqual([403, "not_doctor"]);
    expect((await w("PUT", "/cases/NO-A/protocol", { version: COORDINATOR_EDITS_PROTOCOL ? 1 : 0, concl: "y" }, "admin")).status).toBe(403);
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

  it("saves, conflicts and reverts a fact edit under its fact ID; the log only grows; the source is untouched", async () => {
    const key = "f:f-5a0b11:e";
    const path = `/cases/NO-A/edits/${encodeURIComponent(key)}`;
    const s1 = await w("PUT", path, { text: "opraveno", orig: "původně", expected_edit_id: null });
    const e1 = s1.body.state!.cases["NO-A"].edits[key];
    expect(e1).toMatchObject({ text: "opraveno", orig: "původně", by: "MUDr. Svobodová", fact_id: "f-5a0b11" });
    expect(await q("SELECT key, fact_id, extraction_run_id FROM fact_edits")).toEqual([{ key, fact_id: "f-5a0b11", extraction_run_id: RUN_A2_ID }]);
    expect((await w("PUT", path, { text: "jinak", orig: "původně", expected_edit_id: null })).body.error).toMatchObject({ code: "edit_conflict", message_cs: "Údaj mezitím upravil(a) MUDr. Svobodová." });
    const rv = await w("DELETE", path, { expected_edit_id: e1.id });
    expect(rv.body.state!.cases["NO-A"].edits).toEqual({});
    expect(rv.body.state!.cases["NO-A"].editLog.map((e: { reverted: boolean }) => e.reverted)).toEqual([false, true]);
    expect((await w("PUT", path, { text: "x", orig: "y", expected_edit_id: null }, "coord")).body.error?.code).toBe("not_doctor");
    // A field that is not a fact keeps its key and no fact ID.
    const b = await w("PUT", "/cases/NO-A/edits/brief", { text: "upraveno", orig: "", expected_edit_id: null });
    expect(b.body.state!.cases["NO-A"].edits.brief).toMatchObject({ fact_id: null });
    // The access-log line names the key (fact IDs are opaque), never the text.
    expect((await log()).map((l) => l.what_cs)).toContain(`upravil(a) údaj (${key})`);
  });

  it("saves an f: key only for a fact of the current run that is not quarantined", async () => {
    const put = (fact: string) => w("PUT", `/cases/NO-A/edits/${encodeURIComponent(`f:${fact}:t`)}`, { text: "x", orig: "y", expected_edit_id: null });
    expect((await put("f-00000000")).body.error?.code).toBe("fact_not_found");
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify({ ...RUN_A2, facts: RUN_A2.facts.map((f) => (f.id === "f-5a0b11" ? { ...f, quarantined: true } : f)) }));
    expect((await put("f-5a0b11")).body.error?.code).toBe("fact_quarantined");
    // A case without a run, and a case whose current run is /1, have no fact IDs at all.
    expect((await w("PUT", `/cases/NO-B/edits/${encodeURIComponent("f:f-5a0b11")}`, { text: "x", orig: "y", expected_edit_id: null }, "d1p1")).body.error?.code).toBe("fact_not_found");
    await useRunA();
    expect((await put("f-8d41c2")).body.error?.code).toBe("fact_not_found");
    expect(await count("fact_edits")).toBe(0);
  });

  it("saves a v: key only for a composed line of the current run; the line's ID follows its facts", async () => {
    const facts = [RUN_A2.facts[0]!.id];
    const id = viewLineId("onco_lines", facts);
    const put = (line: string) => w("PUT", `/cases/NO-A/edits/${encodeURIComponent(`v:${line}`)}`, { text: "upraveno", orig: "řádek", expected_edit_id: null });
    expect((await put(id)).body.error?.code).toBe("fact_not_found");
    const line = { id, text: "řádek", title: null, detail: null, date: { as_written: null, precision: null, sort: null }, category: "clinical" as const, status: "documented" as const, facts, note: null };
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify({ ...RUN_A2, views: { onco_lines: [line], made_by: { model: null, prompt: null } } }));
    const ok = await put(id);
    expect(ok.status).toBe(200);
    // A composed line is not one fact, so the edit names no fact ID.
    expect(ok.body.state!.cases["NO-A"].edits[`v:${id}`]).toMatchObject({ text: "upraveno", fact_id: null });
    expect((await w("PUT", `/cases/NO-A/edits/${encodeURIComponent("v:vl-xyz")}`, { text: "x", orig: "y", expected_edit_id: null })).body.error?.code).toBe("invalid_input");
  });

  it("refuses a new text under an old positional key, and still reverts an edit stored under one", async () => {
    await env.DB.prepare(
      "INSERT INTO fact_edits (org_id, case_id, key, text, orig, by_user_id, by_name, log_id) VALUES ('demo-a','NO-A','od:1:e','staré','původně','d2p1','MUDr. Svobodová',NULL)",
    ).run();
    const path = "/cases/NO-A/edits/od%3A1%3Ae";
    expect((await w("PUT", path, { text: "nové", orig: "původně", expected_edit_id: null })).body.error?.code).toBe("edit_key_legacy");
    expect((await w("PUT", "/cases/NO-A/edits/OA%3A3", { text: "nové", orig: "", expected_edit_id: null })).body.error?.code).toBe("edit_key_legacy");
    const rv = await w("DELETE", path, { expected_edit_id: null });
    expect(rv.status).toBe(200);
    expect(rv.body.data).toEqual({ changed: true });
    expect(await count("fact_edits")).toBe(0);
    expect(await q("SELECT key, text, reverted FROM edit_log")).toEqual([{ key: "od:1:e", text: "původně", reverted: 1 }]);
  });

  it("acknowledges and resolves an alert by its ID; the coordinator may too; stale state refused", async () => {
    const al = RUN_A2.alerts[0]!.id;
    const a = await w("POST", `/cases/NO-A/alerts/${al}/events`, { action: "ack", expected_state: "open" }, "coord");
    expect(a.status).toBe(200);
    expect(a.body.state!.cases["NO-A"].alertHist).toMatchObject([{ alert_id: al, action: "ack", who: "Bc. Marková" }]);
    expect((await w("POST", `/cases/NO-A/alerts/${al}/events`, { action: "resolved", expected_state: "open" })).body.error?.code).toBe("alert_state_changed");
    const g = await w("POST", `/cases/NO-A/alerts/${al}/events`, { action: "resolved", expected_state: "ack" });
    expect(g.body.state!.cases["NO-A"].alertHist.map((x: { action: string }) => x.action)).toEqual(["ack", "resolved"]);
    expect(await q("SELECT case_id, alert_id, action FROM alert_events ORDER BY id")).toEqual([
      { case_id: "NO-A", alert_id: al, action: "ack" },
      { case_id: "NO-A", alert_id: al, action: "resolved" },
    ]);
    expect((await log()).map((l) => l.what_cs)).toContain("vzal(a) upozornění na vědomí: Chybí");
  });

  it("answers 404 for an alert that is not in the current run, a position key, and an old /1 alert", async () => {
    for (const k of ["al-00000000", "0", "gap%3A0", "al-1", "al-77205D20"])
      expect((await w("POST", `/cases/NO-A/alerts/${k}/events`, { action: "ack", expected_state: "open" })).body.error?.code, k).toBe("alert_not_found");
    // NO-B has no run; NO-A with its /1 run current has no alert IDs.
    expect((await w("POST", `/cases/NO-B/alerts/${RUN_A2.alerts[0]!.id}/events`, { action: "ack", expected_state: "open" }, "d1p1")).body.error?.code).toBe("alert_not_found");
    await useRunA();
    expect((await w("POST", `/cases/NO-A/alerts/${RUN_A2.alerts[0]!.id}/events`, { action: "ack", expected_state: "open" })).body.error?.code).toBe("alert_not_found");
    expect(await count("alert_events")).toBe(0);
  });

  it("keeps alert events append-only and tied to a known alert of the case", async () => {
    const al = RUN_A2.alerts[0]!.id;
    await w("POST", `/cases/NO-A/alerts/${al}/events`, { action: "ack", expected_state: "open" });
    await expect(env.DB.prepare("UPDATE alert_events SET action = 'resolved'").run()).rejects.toThrow(/append-only: alert_events/);
    await expect(env.DB.prepare("DELETE FROM alert_events").run()).rejects.toThrow(/append-only: alert_events/);
    // An event needs the alert's identity in the same case: another case, or an unknown ID, is refused by the database.
    await expect(
      env.DB.prepare(`INSERT INTO alert_events (org_id, case_id, alert_id, action, by_user_id, by_name) VALUES ('demo-a','NO-B','${al}','ack','d2p1','x')`).run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      env.DB.prepare("INSERT INTO alert_events (org_id, case_id, alert_id, action, by_user_id, by_name) VALUES ('demo-a','NO-A','al-00000000','ack','d2p1','x')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("confirms a fact of the current run with a hash of what it says, withdraws it, and refuses a stale state", async () => {
    const path = "/cases/NO-A/facts/f-5a0b11/confirmations";
    const c1 = await w("POST", path, { action: "confirm", expected_state: "unconfirmed" });
    expect(c1.status).toBe(200);
    const fact = RUN_A2.facts.find((f) => f.id === "f-5a0b11")!;
    const sha = await sha256Hex(confirmedContent(fact));
    expect(c1.body.state!.cases["NO-A"].confirmations).toMatchObject([{ fact_id: "f-5a0b11", action: "confirm", value_sha256: sha, run_id: RUN_A2_ID, who: "MUDr. Svobodová" }]);
    expect((await w("POST", path, { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("confirmation_changed");
    expect((await w("POST", path, { action: "confirm", expected_state: "confirmed" })).body.error?.code).toBe("confirm_action_not_allowed");
    expect((await w("POST", path, { action: "withdraw", expected_state: "confirmed" }, "coord")).body.error).toMatchObject({ code: "not_doctor", message_cs: "Údaje potvrzuje lékař." });
    const c2 = await w("POST", path, { action: "withdraw", expected_state: "confirmed" });
    expect(c2.body.state!.cases["NO-A"].confirmations.map((x: { action: string }) => x.action)).toEqual(["confirm", "withdraw"]);
    expect((await log()).filter((l) => l.action.startsWith("fact.confirm")).map((l) => [l.action, l.what_cs])).toEqual([
      ["fact.confirm", "potvrdil(a) údaj"],
      ["fact.confirm_withdraw", "zrušil(a) potvrzení údaje"],
    ]);
    await expect(env.DB.prepare("UPDATE fact_confirmations SET action = 'confirm'").run()).rejects.toThrow(/append-only: fact_confirmations/);
    await expect(env.DB.prepare("DELETE FROM fact_confirmations").run()).rejects.toThrow(/append-only: fact_confirmations/);
  });

  it("keeps value_sha256 stable across key order, and asks again when a new run gives the fact another value", async () => {
    const path = "/cases/NO-A/facts/f-5a0b11/confirmations";
    await w("POST", path, { action: "confirm", expected_state: "unconfirmed" });
    // The same content with its keys in another order: still confirmed.
    const reorder = (x: unknown): unknown =>
      x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, reorder(v)])) : x;
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify(reorder(RUN_A2)));
    expect((await w("POST", path, { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("confirmation_changed");
    expect((await w("POST", path, { action: "confirm", expected_state: "confirmed" })).body.error?.code).toBe("confirm_action_not_allowed");
    // The same ID with another value (ECOG 2): the earlier confirmation no longer covers it.
    await env.DOCS.put(
      RUN_A2_KEY,
      JSON.stringify({ ...RUN_A2, facts: RUN_A2.facts.map((f) => (f.id === "f-5a0b11" ? { ...f, value: { scale: "ECOG", value_as_written: "2", value_numeric: 2 } } : f)) }),
    );
    const again = await w("POST", path, { action: "confirm", expected_state: "changed" });
    expect(again.status).toBe(200);
    const hashes = (again.body.state!.cases["NO-A"].confirmations as { value_sha256: string }[]).map((x) => x.value_sha256);
    expect(new Set(hashes).size).toBe(2);
  });

  it("refuses to confirm a quarantined fact, a fact not in the current run, and any fact of a /1 run", async () => {
    await env.DOCS.put(RUN_A2_KEY, JSON.stringify({ ...RUN_A2, facts: RUN_A2.facts.map((f) => (f.id === "f-5a0b11" ? { ...f, quarantined: true } : f)) }));
    expect((await w("POST", "/cases/NO-A/facts/f-5a0b11/confirmations", { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("fact_quarantined");
    expect((await w("POST", "/cases/NO-A/facts/f-00000000/confirmations", { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("fact_not_found");
    expect((await w("POST", "/cases/NO-A/facts/x/confirmations", { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("fact_not_found");
    expect((await w("POST", "/cases/NO-B/facts/f-5a0b11/confirmations", { action: "confirm", expected_state: "unconfirmed" }, "d1p1")).body.error?.code).toBe("fact_not_found");
    await useRunA();
    expect((await w("POST", "/cases/NO-A/facts/f-8d41c2/confirmations", { action: "confirm", expected_state: "unconfirmed" })).body.error?.code).toBe("fact_not_found");
    expect(await count("fact_confirmations")).toBe(0);
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

  it("needs the override for a known birth number, logs it, and keeps an optional reason out of the log", async () => {
    const dup = await w("POST", "/cases", { ...form, birth_number: "6453121234" }, "coord", key(4));
    expect(dup.body.error).toMatchObject({ code: "duplicate_birth_number", current: { case_id: "NO-A" } });
    const plain = await w("POST", "/cases", { ...form, birth_number: "6453121234", duplicate_override: { birth_number: "645312/1234" } }, "coord", key(5));
    expect(plain.status).toBe(200);
    expect((await q("SELECT duplicate_override_reason AS r FROM cases WHERE id = ?1", plain.body.data!.case_id))[0]!.r).toBeNull();
    expect((await log()).filter((l) => l.action === "case.duplicate_override").map((l) => l.what_cs)).toEqual(["vytvořil(a) nový záznam, přestože rodné číslo už v databázi je"]);
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
    // The reason is stored once, with the grant row; every later row names the grant.
    expect(rows[0]!.break_glass_reason).toBe("konzultace na žádost onkologa");
    expect(rows.slice(1).every((l) => /^přístup mimo tým \(povolení [0-9a-f]{8}\)$/.test(l.break_glass_reason ?? ""))).toBe(true);
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
  async function putResetDoc() {
    await env.DOCS.put("seed/reset.json", JSON.stringify(resetDoc()));
  }
  // Every org's rows (org B's included: org A's reset must leave them as they were). Row ids are not compared: they
  // count on across orgs (sqlite_sequence is global), so a reseed in one org gives new ids.
  const snapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const t of ["users", "memberships", "departments", "dept_members", "patients", "cases", "case_members", "status_history", "slots", "protocols", "decisions", "tasks", "task_suggestions", "edit_log", "fact_edits", "alert_events", "alert_events_v1", "fact_confirmations", "fact_ids", "alert_identities", "extraction_runs", "attendance", "documents", "alerts", "pages"])
      // Insert-time defaults (created_at and the like) are the only columns a reseed may change.
      out[t] = (await q(`SELECT * FROM ${t}`))
        .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/^(created_at|added_at|booked_at)$/.test(k) && !(k === "id" && typeof r.id === "number"))))
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    return out;
  };

  it("restores the seeded state, archives the audit, keeps seed objects, deletes uploads and bumps the epoch", async () => {
    await putResetDoc();
    await env.DOCS.put("uploads/x.pdf", "x");
    const before = await snapshot();
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." });
    await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Kontrolní MR za 3 měsíce." }), "d2p1", { "idempotency-key": "66666666-aaaa-bbbb-cccc-000000000001" });
    await w("POST", `/cases/NO-A/alerts/${RUN_A2.alerts[0]!.id}/events`, { action: "ack", expected_state: "open" });
    await w("POST", "/cases/NO-A/facts/f-5a0b11/confirmations", { action: "confirm", expected_state: "unconfirmed" });
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
    // The archive is the org's own.
    const archive = await env.DOCS.list({ prefix: "org/demo-a/audit-archive/" });
    expect(archive.objects).toHaveLength(1);
    expect((await env.DOCS.list({ prefix: "audit-archive/" })).objects).toHaveLength(0);
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

describe("review findings (step 4)", () => {
  const k = (n: number) => ({ "idempotency-key": `77777777-aaaa-bbbb-cccc-00000000000${n}` });

  it("refuses report markup outside the app's own and a report carrying the patient's identity", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Závěr" });
    const xss = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Závěr", report_html: `<img src="x" onerror="fetch('/api/admin/reset-demo')">` }), "d2p1", k(1));
    expect(xss.body.error?.code).toBe("invalid_input");
    for (const html of ["<script>alert(1)</script>", `<p style="background:url(x)">a</p>`, `<a href="javascript:x">a</a>`, "<p>a</p><!-- x -->"])
      expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Závěr", report_html: html }), "d2p1", k(2))).status).toBe(422);
    const ident = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Závěr", report_html: "<p>Pacientka Testová · RČ: 645312/1234</p>" }), "d2p1", k(3));
    expect(ident.body.error?.fields?.report_html).toMatch(/identitu/);
    expect(await count("decisions")).toBe(0);
    const ok = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Závěr", report_html: `<article class="sheet"><p class="pt-ident"></p><img src="data:image/png;base64,iVBOR==" alt="GLIDE"><h4>Závěr</h4><p id="rep-concl">Závěr</p></article>` }), "d2p1", k(4));
    expect(ok.status).toBe(200);
  });

  it("answers an assignee without a role on the case with the task only", async () => {
    await env.DB.prepare("UPDATE tasks SET assignee_user_id = 'd1p1' WHERE id = 1").run();
    const r = await w("PATCH", "/tasks/1", { done: true, expected_done: false }, "d1p1");
    expect(r.status).toBe(200);
    expect(r.body.state).toEqual({});
    expect(r.body.data).toMatchObject({ task: { id: 1, done: true } });
  });

  it("checks access before replaying an approval", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Závěr" });
    const body = decisionsBody({ conclusion: "Závěr" });
    expect((await w("POST", "/cases/NO-A/decisions", body, "d2p1", k(5))).status).toBe(200);
    await env.DB.prepare("DELETE FROM case_members WHERE case_id = 'NO-A'").run();
    expect((await w("POST", "/cases/NO-A/decisions", body, "d2p1", k(5))).status).toBe(403);
  });

  it("supersedes the drafts of a replaced decision; they cannot be confirmed", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Kontrolní MR za 3 měsíce." });
    const a = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Kontrolní MR za 3 měsíce." }), "d2p1", k(6));
    const old = (await q<{ id: number }>("SELECT id FROM task_suggestions"))[0]!.id;
    await w("POST", "/cases/NO-A/decisions/new-version", { expected_decision_id: a.body.data!.decision_id });
    await w("PUT", "/cases/NO-A/protocol", { version: 3, concl: "Kontrolní MR není nutná." });
    expect((await w("POST", "/cases/NO-A/decisions", decisionsBody({ protocol_version: 4, conclusion: "Kontrolní MR není nutná." }), "d2p1", k(7))).status).toBe(200);
    expect((await q("SELECT state FROM task_suggestions WHERE id = ?1", old))[0]!.state).toBe("superseded");
    expect((await w("POST", `/suggestions/${old}/confirm`, {}, "d2p1")).body.error?.code).toBe("suggestion_superseded");
    expect(await count("tasks", "from_suggestion_id IS NOT NULL")).toBe(0);
  });

  it("answers protocol_conflict, not already_approved, when an autosave lands before the approval", async () => {
    await w("PUT", "/cases/NO-A/protocol", { version: 0, concl: "Závěr" });
    await w("PUT", "/cases/NO-A/protocol", { version: 1, concl: "Závěr upravený" }, "d2p1");
    const r = await w("POST", "/cases/NO-A/decisions", decisionsBody({ conclusion: "Závěr" }), "d2p1", k(8));
    expect(r.body.error?.code).toBe("protocol_conflict");
  });

  it("writes one refusal row per refusal, also on /cases and /sessions and for view events", async () => {
    await w("POST", "/cases", { first_name: "A", last_name: "B", birth_number: "700101/1234", consent: true }, "admin", k(9));
    await w("POST", "/sessions", { day: "2026-10-22" }, "admin");
    await w("POST", "/audit/events", { case_id: "NO-A", code: "source_viewed" }, "d1p1");
    expect((await log()).map((l) => l.what_cs)).toEqual(["odmítnuto: založení případu", "odmítnuto: zahájení MDT", "odmítnuto: záznam zobrazení"]);
  });

  it("keeps typed text out of the log: unknown edit keys and attendance keys are refused before logging", async () => {
    expect((await w("PUT", "/cases/NO-A/edits/Novak", { text: "x", orig: "", expected_edit_id: null })).status).toBe(422);
    expect((await w("PUT", "/attendance/case:Novak%20Jan", { version: 0, by_dept: {} }, "admin")).status).toBe(422);
    expect(JSON.stringify(await log())).not.toContain("Novak");
  });

  it("needs team membership for a case's own attendance", async () => {
    expect((await w("PUT", "/attendance/case:NO-A", { version: 0, by_dept: { d1: ["d1p1"] } }, "d1p1")).status).toBe(403);
  });

  it("confirms a drafted question once under parallel clicks", async () => {
    await env.DB.prepare("UPDATE cases SET question_draft = 'Indikace RT?' WHERE id = 'NO-B'").run();
    const sha = ((await (await call("/api/workflow", { headers: { "x-demo-user": "d1p1" } })).json()) as { cases: Record<string, { draft_sha: string }> }).cases["NO-B"]!.draft_sha;
    await Promise.all([w("POST", "/cases/NO-B/question/confirm", { draft_sha: sha }, "d1p1"), w("POST", "/cases/NO-B/question/confirm", { draft_sha: sha }, "d2p1")]);
    expect(await count("question_confirmations")).toBe(1);
  });

  it("refuses a batch whose epoch changed after the request's check", async () => {
    const v = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor" as const, dept: null, authMode: "demo" as const, impersonating: false, org: "demo-a", membershipId: "d2p1" };
    const t = new Tx(env.DB, v, { requestId: null, epoch: 1 });
    t.run("UPDATE cases SET status = 'closed' WHERE id = 'NO-A'");
    await env.DB.prepare("UPDATE demo_state SET data_epoch = 2").run();
    await expect(t.commit()).rejects.toMatchObject({ code: "data_reset" });
    expect((await q("SELECT status FROM cases WHERE id = 'NO-A'"))[0]!.status).toBe("ready");
  });

  it("gives the administrator no workflow in doctors_only mode", async () => {
    const r = await call("/api/workflow", { headers: { "x-demo-user": "admin" } }, testEnv({ CLINICAL_ACCESS: "doctors_only" }));
    expect(((await r.json()) as { cases: object }).cases).toEqual({});
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
