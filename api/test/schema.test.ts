import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { loadFixture } from "./data";

const run = (sql: string) => env.DB.prepare(sql).run();
const APPEND_ONLY = ["decisions", "status_history", "edit_log", "alert_events", "question_confirmations", "access_log"];

beforeEach(() => loadFixture());

describe("D1 schema", () => {
  it("has every append-only trigger after the migrations", async () => {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all<{ name: string }>();
    // 13 append-only triggers, and the reset triggers that remove uploads (migration 0005) and upload sessions (0010).
    const RESET = ["demo_reset_uploads", "demo_reset_upload_sessions"];
    expect(r.results.filter((t) => !RESET.includes(t.name))).toHaveLength(13);
    for (const t of RESET) expect(r.results.map((x) => x.name)).toContain(t);
  });

  it("refuses UPDATE and DELETE on every append-only table", async () => {
    await run("INSERT INTO status_history (org_id, case_id, from_status, to_status, by_name, how) VALUES ('demo-a','NO-A','new','ready','x','ručně')");
    await run("INSERT INTO edit_log (org_id, case_id, key, text, by_user_id, by_name) VALUES ('demo-a','NO-A','k','t','d2p1','x')");
    await run("INSERT INTO alert_events (org_id, alert_id, action, by_user_id, by_name) VALUES ('demo-a','al-1','ack','d2p1','x')");
    await run("INSERT INTO question_confirmations (org_id, case_id, text, by_user_id, by_name) VALUES ('demo-a','NO-A','t','d2p1','x')");
    await run(
      "INSERT INTO access_log (org_id, actor_user_id, actor_name, acted_as_role, auth_mode, action, what_cs) VALUES ('demo-a','d2p1','x','doctor','demo','a','b')",
    );
    await run(
      `INSERT INTO decisions (org_id, id, case_id, version, conclusion, approved_by_user_id, approved_by_name, report_snapshot_json, attendance_snapshot_json)
       VALUES ('demo-a','dec-1','NO-A',1,'Závěr','d2p1','x','{}','{}')`,
    );
    for (const t of APPEND_ONLY) {
      await expect(run(`DELETE FROM ${t}`)).rejects.toThrow(`append-only: ${t}`);
      await expect(run(`UPDATE ${t} SET rowid = rowid`)).rejects.toThrow(`append-only: ${t}`);
    }
  });

  it("refuses values outside the CHECK constraints", async () => {
    await expect(run("UPDATE cases SET status = 'lost' WHERE id = 'NO-A'")).rejects.toThrow(/CHECK/);
    await expect(run("UPDATE slots SET time = '14:05'")).rejects.toThrow(/CHECK/);
    await expect(run("UPDATE users SET created_at = '2026-10-17T10:00:00' WHERE id = 'admin'")).rejects.toThrow(/CHECK/);
    await expect(run("INSERT INTO case_members (org_id, case_id, user_id, dept_id, reason) VALUES ('demo-a','NO-A','d1p1','d1','x')")).rejects.toThrow(/CHECK/);
    await expect(run("INSERT INTO case_members (org_id, case_id, reason) VALUES ('demo-a','NO-A','x')")).rejects.toThrow(/CHECK/);
  });

  it("books one slot per time and one slot per case", async () => {
    await expect(run("INSERT INTO slots (org_id, day, time, case_id) VALUES ('demo-a','2026-10-22','14:00','NO-B')")).rejects.toThrow(/UNIQUE/);
    await expect(run("INSERT INTO slots (org_id, day, time, case_id) VALUES ('demo-a','2026-10-22','14:10','NO-A')")).rejects.toThrow(/UNIQUE/);
  });

  it("lets a decision supersede only the previous version of the same case", async () => {
    const dec = (id: string, caseId: string, v: number, sup: string | null) =>
      run(`INSERT INTO decisions (org_id, id, case_id, version, conclusion, approved_by_user_id, approved_by_name, report_snapshot_json,
           attendance_snapshot_json, supersedes_id) VALUES ('demo-a','${id}','${caseId}',${v},'Závěr','d2p1','x','{}','{}',${sup ? `'${sup}'` : "NULL"})`);
    await dec("a1", "NO-A", 1, null);
    await dec("b1", "NO-B", 1, null);
    await expect(dec("a2x", "NO-A", 2, "b1")).rejects.toThrow(/supersede/);
    await expect(dec("a3", "NO-A", 3, "a1")).rejects.toThrow(/supersede/);
    await expect(dec("a1b", "NO-A", 1, "a1")).rejects.toThrow(/supersede|CHECK/);
    await dec("a2", "NO-A", 2, "a1");
  });
});
