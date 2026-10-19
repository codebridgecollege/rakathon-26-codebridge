import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { loadFixture } from "./data";

const run = (sql: string) => env.DB.prepare(sql).run();
const APPEND_ONLY = ["decisions", "status_history", "edit_log", "alert_events", "question_confirmations", "access_log"];

beforeEach(() => loadFixture());

describe("D1 schema", () => {
  it("has every append-only trigger after the migrations", async () => {
    const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all<{ name: string }>();
    // 13 append-only triggers, the 5 document lifecycle triggers (migration 0013), and the reset triggers that remove
    // uploads (0005), upload sessions (0010) and model calls (0014), and make seeded documents current again (0013).
    const RESET = ["demo_reset_uploads", "demo_reset_upload_sessions", "demo_reset_document_lifecycle", "demo_reset_model_calls"];
    const lifecycle = r.results.filter((t) => t.name.startsWith("documents_lifecycle_"));
    expect(lifecycle).toHaveLength(5);
    expect(r.results.filter((t) => !RESET.includes(t.name) && !lifecycle.includes(t))).toHaveLength(13);
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

  describe("document lifecycle (migration 0013)", () => {
    const NOW = "2026-10-19T08:00:00.000Z";
    const addScan = (id: string, caseId = "NO-A") =>
      run(`INSERT INTO documents (id, org_id, case_id, file_name, page_count, origin, processing) VALUES ('${id}','demo-a','${caseId}','${id}.pdf',1,'upload','processed')`);
    const lifecycleOf = (id: string) => env.DB.prepare("SELECT lifecycle, superseded_by FROM documents WHERE id = ?1").bind(id).first();
    const supersede = (id: string, by: string, who = "d2p1") =>
      run(`UPDATE documents SET lifecycle = 'superseded', superseded_by = '${by}', lifecycle_reason_cs = 'lepší sken', lifecycle_changed_at = '${NOW}', lifecycle_changed_by = '${who}' WHERE id = '${id}'`);
    const withdraw = (id: string) =>
      run(`UPDATE documents SET lifecycle = 'withdrawn', superseded_by = NULL, lifecycle_reason_cs = 'dokument jiného pacienta', lifecycle_changed_at = '${NOW}', lifecycle_changed_by = 'd2p1' WHERE id = '${id}'`);

    it("starts every document current, including the ones inserted before the migration", async () => {
      expect(await lifecycleOf("A_pacient")).toEqual({ lifecycle: "current", superseded_by: null });
      await expect(
        run("INSERT INTO documents (id, org_id, case_id, file_name, page_count, origin, processing, lifecycle) VALUES ('x','demo-a','NO-A','x.pdf',1,'upload','processed','withdrawn')"),
      ).rejects.toThrow(/starts current/);
      await expect(run(`UPDATE documents SET lifecycle = 'lost', lifecycle_changed_at = '${NOW}', lifecycle_changed_by = 'd2p1' WHERE id = 'A_pacient'`)).rejects.toThrow(/CHECK/);
    });

    it("lets a document be superseded only by another current document of the same case", async () => {
      await addScan("A_rescan");
      await addScan("B_scan", "NO-B");
      await expect(supersede("A_pacient", "A_pacient")).rejects.toThrow(/same case/);
      await expect(supersede("A_pacient", "B_scan")).rejects.toThrow(/same case/);
      await expect(supersede("A_pacient", "b-A_pacient")).rejects.toThrow(/same case/);
      await expect(supersede("A_pacient", "nope")).rejects.toThrow(/same case/);
      await expect(
        run(`UPDATE documents SET lifecycle = 'superseded', lifecycle_changed_at = '${NOW}', lifecycle_changed_by = 'd2p1' WHERE id = 'A_pacient'`),
      ).rejects.toThrow(/exactly when/);
      await expect(run("UPDATE documents SET superseded_by = 'A_rescan' WHERE id = 'A_pacient'")).rejects.toThrow(/exactly when/);
      // Who and when are required, and the person must belong to the document's org.
      await expect(run("UPDATE documents SET lifecycle = 'superseded', superseded_by = 'A_rescan' WHERE id = 'A_pacient'")).rejects.toThrow(/by which member/);
      await expect(supersede("A_pacient", "A_rescan", "b-doc")).rejects.toThrow(/by which member/);
      await supersede("A_pacient", "A_rescan");
      expect(await lifecycleOf("A_pacient")).toEqual({ lifecycle: "superseded", superseded_by: "A_rescan" });
      // A superseded document cannot replace another one.
      await addScan("A_third");
      await expect(supersede("A_third", "A_pacient")).rejects.toThrow(/same case/);
    });

    it("withdraws a document without a replacement", async () => {
      await withdraw("B_pacient");
      expect(await lifecycleOf("B_pacient")).toEqual({ lifecycle: "withdrawn", superseded_by: null });
    });

    it("never brings a superseded or withdrawn document back, nor switches between the two", async () => {
      await addScan("A_rescan");
      await supersede("A_pacient", "A_rescan");
      await withdraw("B_pacient");
      await expect(run("UPDATE documents SET lifecycle = 'current', superseded_by = NULL WHERE id = 'A_pacient'")).rejects.toThrow(/stays so/);
      await expect(run("UPDATE documents SET lifecycle = 'current' WHERE id = 'B_pacient'")).rejects.toThrow(/stays so/);
      await expect(withdraw("A_pacient")).rejects.toThrow(/stays so/);
      await expect(run("UPDATE documents SET lifecycle_reason_cs = 'jinak' WHERE id = 'B_pacient'")).rejects.toThrow(/stays so/);
      // The processing columns stay writable.
      await run("UPDATE documents SET readability = 'good' WHERE id = 'B_pacient'");
    });

    it("the demo reset makes the seeded documents of its org current again", async () => {
      await addScan("A_rescan");
      await supersede("A_pacient", "A_rescan");
      await withdraw("B_pacient");
      await run("UPDATE demo_state SET reset_in_progress = 1 WHERE org_id = 'demo-a'");
      expect(await lifecycleOf("A_pacient")).toEqual({ lifecycle: "current", superseded_by: null });
      expect(await lifecycleOf("B_pacient")).toEqual({ lifecycle: "current", superseded_by: null });
      expect(await lifecycleOf("A_rescan")).toBeNull();
    });
  });
});
