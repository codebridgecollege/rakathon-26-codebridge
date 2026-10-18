import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { audit } from "../middleware/audit";
import { canReadClinical, listsAllCases, redactsListFor } from "@codebridge/domain/access";
import { identitySource, patientRow } from "../domain/rows";
import { modeOf, openCase } from "./access-check";

type StoredExtraction = { schema?: string; case_id?: string; processing?: string; run_id?: string } & Record<string, unknown>;

const EMPTY_GUIDANCE = { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [], prior_assessments: {} };

const int = (s: string | undefined, dflt: number, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : dflt;
};
const isoDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export const cases = new Hono<AppEnv>()
  // The patient list. Today the page filters and pages on the client, so it calls this without parameters.
  .get("/patients", async (c) => {
    const v = c.var.viewer;
    const mode = modeOf(c);
    await audit(c, { action: "list.view", what_cs: "zobrazil(a) seznam pacientů" });
    const q = c.req.query();
    const pageSize = int(q.page_size, 50, 200) || 50;
    const page = int(q.page, 0, 10_000);
    const { rows, total } = await c.var.stores.cases.listCases(v, !listsAllCases(v), {
      q: q.q?.trim().slice(0, 100) || undefined,
      status: q.status || undefined,
      dept: q.dept || undefined,
      from: isoDay(q.from),
      to: isoDay(q.to),
      page,
      pageSize,
    });
    const redact = redactsListFor(v, mode);
    // The list carries no status history (one query per row); the page gets it from GET /api/workflow.
    return c.json({ patients: rows.map((r) => patientRow(r, [], redact)), total, page });
  })
  .get("/cases/:id", async (c) => {
    const id = c.req.param("id");
    const row = await openCase(c, id, "header");
    const viaLink = c.req.query("via") === "link";
    await audit(c, {
      action: "case.open",
      case_id: id,
      what_cs: viaLink ? "otevřel(a) případ (odkazem nebo historií prohlížeče)" : "otevřel(a) případ",
    });
    const { cases: store } = c.var.stores;
    const [hist, members, run] = await Promise.all([store.statusHistory(id), store.memberDepts(id), store.currentRun(id)]);
    const mode = modeOf(c);
    return c.json({
      ...patientRow(row, hist, redactsListFor(c.var.viewer, mode)),
      // Where the document names the patient, for the Patient's Provenance in the FHIR export. Only here, after the
      // membership check and the case.open line: a list row would hand it to every role without a per-case log. A
      // quote is document text, so a role that does not read clinical content does not get it (openCase passed, so a
      // doctor here is a member).
      identitySource: canReadClinical(c.var.viewer, true, mode) === "ok" ? identitySource(row) : null,
      members: members.map((dept) => ({ dept })),
      run: run ? { id: run.id, created_at: run.created_at, kind: run.kind } : null,
    });
  })
  .get("/cases/:id/extraction", async (c) => {
    const id = c.req.param("id");
    const row = await openCase(c, id, "clinical");
    await audit(c, { action: "case.data", case_id: id, what_cs: "načetl(a) zpracovaná data případu" });
    const run = await c.var.stores.cases.currentRun(id);
    // A case without a run is not an error: the page already says "nezpracováno".
    if (!run) return c.json({ case_id: id, processing: row.processing_level, run: null, data: null });
    const stored = await c.var.stores.blobs.getJson<StoredExtraction>(run.r2_key);
    if (!stored) throw E.dataUnavailable();
    const { schema: _s, case_id: _c, processing: _p, run_id: _r, ...data } = stored;
    return c.json({
      case_id: id,
      processing: row.processing_level,
      run: { id: run.id, kind: run.kind, created_at: run.created_at },
      data,
    });
  })
  .get("/cases/:id/alerts", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "clinical");
    await audit(c, { action: "case.alerts", case_id: id, what_cs: "zobrazil(a) upozornění" });
    const alerts = await c.var.stores.cases.alerts(id);
    return c.json({
      case_id: id,
      run_id: alerts[0]?.run_id ?? null,
      alerts: alerts.map((a) => ({
        id: a.id,
        origin: a.origin,
        position: a.position,
        // The page's key: the index for flags, "gap:<n>" for data gaps; alert events take it (step 4) and the server
        // resolves the stable id. Events come from GET /api/workflow.
        ui_key: a.origin === "flag" ? a.position : `gap:${a.position}`,
        kind: a.kind,
        text_cs: a.text_cs,
        relevant: a.relevant === 1,
        events: [],
      })),
    });
  })
  .get("/cases/:id/decisions", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "header");
    await audit(c, { action: "case.history", case_id: id, what_cs: "zobrazil(a) historii případu" });
    const rows = await c.var.stores.cases.decisions(id);
    return c.json({
      decisions: rows.map((d) => ({
        id: d.id,
        version: d.version,
        text: d.conclusion,
        by: d.approved_by_name,
        when: d.approved_at,
        slot: d.slot_day && d.slot_time ? { day: d.slot_day, time: d.slot_time } : null,
        reportSnap: JSON.parse(d.report_snapshot_json),
        attSnap: JSON.parse(d.attendance_snapshot_json),
        supersedes: d.supersedes_id,
      })),
    });
  })
  .get("/cases/:id/history", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "header");
    await audit(c, { action: "case.history", case_id: id, what_cs: "zobrazil(a) historii případu" });
    const s = c.var.stores.cases;
    const [status, edits, question_confirmations] = await Promise.all([s.statusHistory(id), s.editHistory(id), s.questionConfirmations(id)]);
    return c.json({ status, edits, question_confirmations });
  })
  .get("/cases/:id/guidance", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "clinical");
    await audit(c, { action: "guidance.load", case_id: id, what_cs: "načetl(a) doporučení" });
    // Retrospective deviation assessments are read-only (user decision 2026-10-17) and ship inside this JSON.
    const g = await c.var.stores.blobs.getJson<Record<string, unknown>>(`guidance/${id}.json`);
    return c.json(g ? { prior_assessments: {}, ...g } : EMPTY_GUIDANCE);
  })
  .get("/cases/:id/prognosis", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "clinical");
    await audit(c, { action: "prognosis.view", case_id: id, what_cs: "zobrazil(a) uloženou prognózu" });
    const blobs = c.var.stores.blobs;
    const keys = (await blobs.listKeys(`prognosis/${id}/`)).sort();
    const saved = (await Promise.all(keys.map((k) => blobs.getJson(k)))).filter((x) => x != null);
    return c.json({ saved });
  });
