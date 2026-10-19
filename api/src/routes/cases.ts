import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { audit } from "../middleware/audit";
import { canReadClinical, listsAllCases, redactsListFor } from "@codebridge/domain/access";
import { identitySource, patientRow } from "../domain/rows";
import { modeOf, openCase } from "./access-check";
import { EXTRACTION_SCHEMA, type ExtractionRun, type Producer } from "@codebridge/domain/extraction/index";
import type { EarlierFact, Extraction, ExtractionDocument } from "@codebridge/domain/wire";
import { FACT_ID_RE } from "@codebridge/domain/edits";
import { D } from "@codebridge/domain/errors";
import { orgQuery } from "./write-context";
import { withoutDocuments, withoutQuarantined } from "../store/runs";

const EMPTY_GUIDANCE = { guidelines: [], statements: [], pages: [], literature: [], queries: [], not_retrieved: [], prior_assessments: {} };

const int = (s: string | undefined, dflt: number, max: number) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : dflt;
};
const isoDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

// The case's documents that left its current set (documents.lifecycle, migration 0013).
async function retiredOf(c: Context<AppEnv>, caseId: string): Promise<Set<string>> {
  const r = await orgQuery(c, "SELECT id FROM documents WHERE org_id = ?org AND case_id = ?1 AND lifecycle <> 'current'", caseId).all<{ id: string }>();
  return new Set(r.results.map((x) => x.id));
}

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
      run: run ? { id: run.id, created_at: run.created_at, producer: run.producer } : null,
    });
  })
  .get("/cases/:id/extraction", async (c) => {
    const id = c.req.param("id");
    const row = await openCase(c, id, "clinical");
    await audit(c, { action: "case.data", case_id: id, what_cs: "načetl(a) zpracovaná data případu" });
    const run = await c.var.stores.cases.currentRun(id);
    // The stored documents with their parts (titles, types, pages, readability) come with the run: the run names parts
    // by ID only, and one request per case load keeps one "case.data" row in the access log.
    const documents: ExtractionDocument[] = (await c.var.stores.cases.documents(id)).map((d) => ({ id: d.id, file: d.file_name, page_count: d.page_count, note_cs: d.note_cs, parts: d.parts }));
    // A case without a run is not an error: the page already says "nezpracováno".
    if (!run) return c.json<Extraction>({ case_id: id, processing: row.processing_level, run: null, data: null, documents });
    const info = { id: run.id, producer: run.producer as Producer, created_at: run.created_at };
    // A run in the old format /1 has no fact or alert IDs to attach confirmations to; the case shows as not processed
    // until it is reseeded or processed again.
    if (run.schema !== EXTRACTION_SCHEMA) return c.json<Extraction>({ case_id: id, processing: row.processing_level, run: info, data: null, documents });
    // The run holds no patient identity (EXTRACTION-FORMAT.md). It goes out minus its quarantined content: a fact from a
    // page that shows another patient, and a source only such facts cite, never reach the browser; the identity alert
    // stays and names document and page. So the payload is not a whole run for validateRun. Its alerts are part of it.
    const stored = await c.var.stores.blobs.getJson<ExtractionRun>(run.r2_key);
    if (!stored) throw E.dataUnavailable();
    // A document that left the case (withdrawn as another patient's) is gone from the view at once, before any newer
    // run exists.
    return c.json<Extraction>({ case_id: id, processing: row.processing_level, run: info, data: withoutQuarantined(withoutDocuments(stored, await retiredOf(c, id))), documents });
  })
  // One fact as an earlier run of the case stated it: the value a doctor confirmed, shown next to the current one when
  // a later run gives the same fact ID another value (EXTRACTION-FORMAT.md, "Doctor confirmations and edits"). Only a
  // run of this case, only a fact that run did not quarantine.
  .get("/cases/:id/runs/:runId/facts/:factId", async (c) => {
    const id = c.req.param("id");
    await openCase(c, id, "clinical");
    const runId = c.req.param("runId");
    const factId = c.req.param("factId");
    if (!FACT_ID_RE.test(factId) || runId.length > 200) throw D.factNotFound();
    await audit(c, { action: "case.data", case_id: id, what_cs: "načetl(a) dříve potvrzený údaj" });
    const run = await orgQuery(c, "SELECT r2_key, schema FROM extraction_runs WHERE org_id = ?org AND case_id = ?1 AND id = ?2", id, runId).first<{ r2_key: string; schema: string }>();
    if (!run || run.schema !== EXTRACTION_SCHEMA) throw D.factNotFound();
    const stored = await c.var.stores.blobs.getJson<ExtractionRun>(run.r2_key);
    const fact = stored ? withoutQuarantined(withoutDocuments(stored, await retiredOf(c, id))).facts.find((f) => f.id === factId) : undefined;
    if (!fact) throw D.factNotFound();
    // A fact the current run quarantines (its page shows another patient) is not served from an older run either.
    const cur = await c.var.stores.cases.currentRun(id);
    if (cur && cur.id !== runId && cur.schema === EXTRACTION_SCHEMA) {
      const now = await c.var.stores.blobs.getJson<ExtractionRun>(cur.r2_key);
      if (now?.facts.some((f) => f.id === factId && f.quarantined)) throw D.factNotFound();
    }
    return c.json<EarlierFact>({ run_id: runId, fact });
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
