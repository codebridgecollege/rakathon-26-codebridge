// The Prognóza tab's search on the Worker (PRODUCT.md, "Prognosis evidence search"). The routes keep the shapes of the
// local prognosis server (prognosis/serve.py) so the tab is the same; the search itself runs as a Workflow (a model call
// with web search outlives a browser request) and the tab polls GET /cases/:id/prognosis for it.
//
// What leaves the Worker: a clinical profile with no name, birth number, author or contact (packages/domain/src/
// prognosis-profile.ts), to OpenRouter, only on a click and only where the team switched the org on. Every start is an
// access-log row. Reading is for whoever may read the case; starting needs a doctor or the coordinator on the case team.
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { E } from "../http/errors";
import { D, DomainError } from "@codebridge/domain/errors";
import { fromExtraction } from "@codebridge/domain/case-data";
import { buildProfile } from "@codebridge/domain/prognosis-profile";
import { audit } from "../middleware/audit";
import { openCase } from "./access-check";
import { extractionOf } from "./cases";
import { actorOf, caseFor, isoNow, label, newId, orgQuery, tx } from "./write-context";
import { todayPrague } from "./write-cases";
import { prognosisDailyMax, prognosisOrgOn } from "../domain/prognosis";
import { prognosisConfig } from "../services/prognosis-search";
import { prognosisDraftKey, type PrognosisParams } from "../workflows/prognosis";
import { orgById } from "../store/people";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The tab names a case by its file (the local server's patient_id).
async function caseOfFile(c: import("hono").Context<AppEnv>, file: unknown) {
  if (typeof file !== "string" || !file || file.length > 200) throw E.caseNotFound();
  const row = await orgQuery(c, "SELECT id FROM cases WHERE org_id = ?org AND source_file = ?1 AND intake_open = 0", file).first<{ id: string }>();
  if (!row) throw E.caseNotFound();
  return row.id;
}

// The profile of a case as of a day, or the reason there is none. Reads exactly what the doctor sees of the case.
async function profileOf(c: import("hono").Context<AppEnv>, id: string, file: string, day: string) {
  const row = await c.var.stores.cases.caseById(id);
  if (!row) throw E.caseNotFound();
  const ext = await extractionOf(c, id, row);
  const cd = fromExtraction(file, id, ext.data, ext.documents);
  const org = await orgById(c.env.DB, c.var.viewer.org);
  const forbidden = [row.full_name, row.name_as_written ?? "", row.owner_name, row.referrer_name ?? ""];
  return buildProfile(cd, day, { forbidden, synthetic: org?.is_demo === 1 });
}
const isProblem = (x: object): x is { code: string; message_cs: string } => "code" in x && "message_cs" in x;

export const prognosis = new Hono<AppEnv>()
  // Key, model and the org's switch: what the tab needs to offer the search.
  .get("/prognosis/config", async (c) => {
    const cfg = prognosisConfig(c.env);
    const on = prognosisOrgOn(c.env, c.var.viewer.org);
    const error = !on
      ? "Vyhledávání studií není pro tuto organizaci zapnuté."
      : !cfg.available
        ? "Na serveru chybí klíč OpenRouter."
        : !cfg.configured
          ? "Na serveru chybí ID modelu pro hledání studií."
          : null;
    return c.json({ configured: on && cfg.configured, available: on && cfg.available, error, models: cfg.models });
  })
  // The profile that would be sent, without any model call.
  .get("/prognosis/profile", async (c) => {
    const id = await caseOfFile(c, c.req.query("patient_id"));
    await openCase(c, id, "clinical");
    const q = c.req.query("scheduled_date");
    const day = q && ISO_DAY.test(q) ? q : todayPrague();
    await audit(c, { action: "prognosis.profile", case_id: id, what_cs: "zobrazil(a) klinický profil pro prognózu" });
    const profile = await profileOf(c, id, c.req.query("patient_id")!, day);
    return c.json({ profile: isProblem(profile) ? { available: false, reason: profile.message_cs } : profile });
  })
  // One search, started by a click. It answers at once with the job; the result arrives through the saved searches.
  .post("/prognosis", async (c) => {
    const b = c.var.body;
    const id = await caseOfFile(c, b.patient_id);
    label(c, "vyhledání studií pro prognózu", id);
    const { breakGlass } = await caseFor(c, id, "prognosis.run");
    // A temporary grant reads a case; it does not send the case's facts to an outside service.
    if (breakGlass) throw D.notMember();
    // What may not be read may not be sent: also the role's clinical access, which the strict mode narrows.
    await openCase(c, id, "clinical");
    const v = c.var.viewer;
    const cfg = prognosisConfig(c.env);
    if (!prognosisOrgOn(c.env, v.org) || !cfg.configured) throw D.prognosisOff();
    const day = typeof b.scheduled_date === "string" && ISO_DAY.test(b.scheduled_date) ? b.scheduled_date : todayPrague();
    if (b.scheduled_date !== undefined && day !== b.scheduled_date) throw D.invalidInput();
    const profile = await profileOf(c, id, b.patient_id as string, day);
    if (isProblem(profile)) throw new DomainError(422, profile.code, profile.message_cs);
    const jobId = `pg-${newId()}`;
    const at = isoNow();
    const t = tx(c);
    t.guard("one_at_a_time", "NOT EXISTS (SELECT 1 FROM jobs WHERE org_id = ?org AND case_id = ? AND kind = 'prognosis' AND state IN ('queued','running') AND updated_at > ?)", [id, new Date(Date.now() - 12 * 60_000).toISOString()], () => D.prognosisBusy());
    // Counted in the access log, which an erased case does not take with it: creating, searching and erasing again must
    // not reset the cap.
    t.guard("daily_cap", "(SELECT COUNT(*) FROM access_log WHERE org_id = ?org AND action = 'prognosis.search' AND at >= ?) < ?", [new Date(Date.now() - 24 * 3600_000).toISOString(), prognosisDailyMax(c.env)], () => D.prognosisCap());
    t.run(
      `INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, phase, result_ref, created_by, created_by_name, created_by_role, created_by_actor, created_at, updated_at)
       VALUES (?org, ?1, 'prognosis', ?2, 'PROGNOSIS', ?1, 1, 'queued', NULL, NULL, ?3, ?4, ?5, ?6, ?7, ?7)`,
      jobId, id, v.id, v.name, actorOf(c).role, v.actor?.id ?? null, at,
    );
    t.audit({ action: "prognosis.search", what_cs: "spustil(a) vyhledávání studií pro prognózu (klinický profil bez jména a rodného čísla se posílá externí službě)", case_id: id, target_type: "job", target_id: jobId });
    await t.commit();
    const params: PrognosisParams = { org: v.org, caseId: id, jobId, file: b.patient_id as string, scheduledDate: day };
    try {
      await c.env.DOCS.put(prognosisDraftKey(v.org, id, jobId), JSON.stringify(profile), { httpMetadata: { contentType: "application/json" } });
      await c.env.PROGNOSIS.create({ id: jobId, params, retention: { successRetention: "1 day", errorRetention: "3 days" }, locationHint: "weur" });
    } catch (e) {
      console.error(JSON.stringify({ job: "prognosis_start_failed", error: e instanceof Error ? e.name : "Error" }));
      await orgQuery(c, "UPDATE jobs SET state = 'error', error_code = 'start_failed', updated_at = ?2 WHERE org_id = ?org AND id = ?1", jobId, isoNow()).run();
      await c.env.DOCS.delete(prognosisDraftKey(v.org, id, jobId));
      throw E.notConfigured();
    }
    return c.json({ job: { id: jobId, state: "queued" }, scheduled_date: day }, 202);
  });
