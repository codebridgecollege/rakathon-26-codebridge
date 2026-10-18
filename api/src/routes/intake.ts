// "Nový pacient" on the server (step 6, slice a-2). The referral form creates the case open for intake (POST /api/cases
// with intake: true, routes/write-work.ts); its creator uploads the documents (routes/documents.ts) and completes the
// intake here. A registered fixture's prepared extraction is attached only when every one of that fixture's files is
// uploaded (by hash), no other fixture's file is, and the referral's name and birth number match the fixture's patient;
// otherwise the case is listed with its documents "nezpracováno". Listed files (content not kept) stay as they are. Design: step-6.md "As implemented".
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { ApiError, E } from "../http/errors";
import { D } from "@codebridge/domain/errors";
import { assertCan } from "@codebridge/domain/roles";
import { fhirToForm, FORM_FIELD } from "@codebridge/domain/fhir";
import { patientRow } from "../domain/rows";
import { pragueDay } from "@codebridge/domain/time";
import { audit } from "../middleware/audit";
import { sha256Hex } from "../store/work";
import { caseDocuments } from "../store/documents";
import { deletePrefix, discardIntake, intakeState } from "../store/intake";
import { docOut } from "./documents";
import { actorOf, answer, caseFor, isoNow, label, now, statesFor, tx } from "./write-context";

type Prepared = {
  schema: string;
  fixture_id: string;
  syn: Record<string, unknown>;
  case_row: {
    diagnosis_text: string | null;
    summary_one_line: string | null;
    question_text: string | null;
    question_explicit: boolean;
    question_purpose: string | null;
    question_source_json: unknown;
    page_count: number | null;
  };
  alerts: { origin: "gap"; position: number; kind: string; text_cs: string; relevant: boolean; basis: string }[];
  pages: Record<string, { n: number; width: number; height: number; engine: string; mean_conf: number | null; low_conf_words: number | null; is_empty: boolean; verify_count: number; redacted: boolean; redaction_count: number | null; redaction_reasons: string[] | null }[]>;
};

const docsCs = (n: number) => `${n} ${n === 1 ? "nahraného dokumentu" : "nahraných dokumentů"}`;

// The intake's own routes: its creator only (others get 404 from caseFor), and only while it is open.
async function openIntake(c: import("hono").Context<AppEnv>, id: string, what: string) {
  label(c, what, id);
  const ctx = await caseFor(c, id, "case.create");
  if (ctx.core.intake_open !== 1) throw D.intakeDone();
  return ctx;
}

export const intake = new Hono<AppEnv>()
  // The referral as FHIR R4 (a Bundle with Patient, Coverage and ServiceRequest, or a Patient alone) read into the form.
  // The bundle holds identity; only its hash stays (on the case, once created), never the bundle.
  .post("/fhir/referral", async (c) => {
    label(c, "import žádosti z FHIR");
    assertCan(actorOf(c), "case.create");
    const r = fhirToForm(c.var.body);
    await tx(c).audit({ action: "fhir.import", what_cs: "importoval(a) žádost o konzultaci z FHIR" }).commit();
    const fields = Object.fromEntries(Object.entries(r.form).map(([k, v]) => [FORM_FIELD[k as keyof typeof FORM_FIELD], v]));
    return answer(c, { form: r.form, fields, found: r.found, missing_cs: r.missing_cs, referral_sha256: await sha256Hex(JSON.stringify(c.var.body)) });
  })
  .get("/cases/:id/intake", async (c) => {
    const id = c.req.param("id");
    await openIntake(c, id, "stav příjmu pacienta");
    await audit(c, { action: "intake.view", case_id: id, what_cs: "zobrazil(a) stav příjmu pacienta" });
    const { verdict } = await intakeState(c.env.DB, id);
    const docs = await caseDocuments(c.env.DB, id);
    const { docByUpload: _m, ...v } = verdict;
    return c.json({ case_id: id, ...v, documents: docs.map(docOut) });
  })
  .post("/cases/:id/intake/complete", async (c) => {
    const id = c.req.param("id");
    const { core } = await openIntake(c, id, "dokončení příjmu pacienta");
    const db = c.env.DB;
    const { docs, verdict } = await intakeState(db, id);
    const caseRow = await db.prepare("SELECT referral_sha256 FROM cases WHERE id = ?1").bind(id).first<{ referral_sha256: string | null }>();
    const from = caseRow?.referral_sha256 ? "z žádosti FHIR" : "z žádosti";
    const at = isoNow();
    const day = pragueDay(now());
    const t = tx(c).onConstraint(/cases_intake_fixture|UNIQUE constraint failed: cases\.intake_fixture/, () => D.fixtureUsed());
    t.guard("intake_open", "(SELECT intake_open FROM cases WHERE id = ?) = 1", [id], () => D.intakeDone());
    // The documents the verdict rests on are the ones still there.
    t.guard(
      "docs",
      "(SELECT group_concat(id || ':' || COALESCE(sha256, ''), ',') FROM (SELECT id, sha256 FROM documents WHERE case_id = ? AND origin = 'upload' ORDER BY id)) IS ?",
      [id, docs.length ? [...docs].sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => `${d.id}:${d.sha256 ?? ""}`).join(",") : null],
      () => D.conflict(),
    );
    const written: string[] = [];
    let runId: string | null = null;
    if (verdict.ready && verdict.fixture_id) {
      const fid = verdict.fixture_id;
      const prep = await (await c.env.DOCS.get(`fixtures/${fid}/prepared.json`))?.json<Prepared>();
      if (!prep) throw new ApiError(503, "seed_missing", "Předem připravená data ukázkového pacienta na serveru chybí; spusťte seed (api/AGENTS.md).");
      // Every reference into the fixture's combined PDF was written by the seed as "@upload:<name>"; it becomes the
      // uploaded document, so the source view opens the page of the file the user uploaded.
      const swap = (o: unknown) => {
        let s = JSON.stringify(o);
        for (const [name, docId] of Object.entries(verdict.docByUpload)) s = s.replaceAll(JSON.stringify(`@upload:${name}`), JSON.stringify(`${docId}.pdf`));
        if (s.includes('"@upload:')) throw E.internal();
        return JSON.parse(s);
      };
      const syn = { ...swap(prep.syn), file: core.source_file };
      (syn.list_entry as Record<string, unknown>).file = core.source_file;
      const row = swap(prep.case_row) as Prepared["case_row"];
      const alertRows = await Promise.all(
        prep.alerts.map(async (a) => ({ ...a, id: `al-${(await sha256Hex(`${id}|${a.origin}|${a.kind}|${a.text_cs}|${a.basis}`)).slice(0, 16)}` })),
      );
      const draft = { schema: "codebridge.extraction/1", case_id: id, processing: "partial", syn, alert_ids: { flag: [], gap: alertRows.map((a) => a.id) } };
      runId = `prep-${id}-${(await sha256Hex(JSON.stringify(draft))).slice(0, 8)}`;
      const body = JSON.stringify({ ...draft, run_id: runId });
      const key = `uploads/${id}/extract/${runId}.json`;
      // Page assets: the seed stored each upload's pages under its name; they are copied to the uploaded document.
      const pageRows: unknown[] = [];
      const partRows: unknown[] = [];
      const titles = new Map(((prep.syn.documents as { upload_name?: string; title_cs: string; type: string; date: string | null; readability: string; reason_cs: string }[]) || []).map((d) => [d.upload_name, d]));
      try {
        for (const [name, docId] of Object.entries(verdict.docByUpload)) {
          const stem = name.replace(/\.pdf$/i, "");
          for (const m of prep.pages[name] ?? []) {
            const src = `fixtures/${fid}/pages/${stem}/p${m.n}`;
            const dst = `uploads/${id}/${docId}/pages/p${m.n}`;
            for (const ext of ["json", "png", ...(m.redacted ? ["redacted.png"] : [])]) {
              const o = await c.env.DOCS.get(`${src}.${ext}`);
              if (!o) throw new ApiError(503, "seed_missing", "Stránky ukázkového pacienta na serveru chybí; spusťte seed (api/AGENTS.md).");
              await c.env.DOCS.put(`${dst}.${ext}`, await o.arrayBuffer(), { httpMetadata: o.httpMetadata });
              written.push(`${dst}.${ext}`);
            }
            pageRows.push({
              d: docId, n: m.n, j: `${dst}.json`, i: `${dst}.png`, r: m.redacted ? `${dst}.redacted.png` : null, w: m.width, h: m.height, e: m.engine,
              mc: m.mean_conf, lc: m.low_conf_words, em: m.is_empty ? 1 : 0, vc: m.verify_count, rc: m.redaction_count, rr: m.redaction_reasons ? JSON.stringify(m.redaction_reasons) : null,
            });
          }
          const d = titles.get(name);
          if (d) partRows.push({ d: docId, t: d.title_cs, ty: d.type, dt: d.date, p: JSON.stringify((prep.pages[name] ?? []).map((m) => m.n)), r: d.readability, rs: d.reason_cs, u: name });
        }
        await c.env.DOCS.put(key, body, { httpMetadata: { contentType: "application/json" } });
        written.push(key);
      } catch (e) {
        if (written.length) await c.env.DOCS.delete(written).catch(() => {});
        throw e;
      }
      t.run(
        `INSERT INTO extraction_runs (id, case_id, kind, producer, model, prompt_version, temperature, input_hashes_json, r2_key, sha256, is_current, created_at)
         VALUES (?1, ?2, 'seed_fixture', 'prepared-fixture', NULL, NULL, NULL, ?3, ?4, ?5, 1, ?6)`,
        runId, id, JSON.stringify(Object.fromEntries(docs.filter((d) => d.fixture_id === fid).map((d) => [d.id, d.sha256]))), key, await sha256Hex(body), at,
      );
      if (alertRows.length)
        t.run(
          `INSERT INTO alerts (id, case_id, run_id, origin, position, kind, text_cs, relevant)
           SELECT json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.origin'), json_extract(value, '$.position'), json_extract(value, '$.kind'),
             json_extract(value, '$.text_cs'), json_extract(value, '$.relevant') FROM json_each(?3)`,
          id, runId, JSON.stringify(alertRows.map((a) => ({ id: a.id, origin: a.origin, position: a.position, kind: a.kind, text_cs: a.text_cs, relevant: a.relevant ? 1 : 0 }))),
        );
      t.run(
        `INSERT INTO pages (document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, mean_conf, low_conf_words, is_empty, verify_count,
           redaction_count, redaction_reasons_json)
         SELECT json_extract(value, '$.d'), json_extract(value, '$.n'), json_extract(value, '$.j'), json_extract(value, '$.i'), json_extract(value, '$.r'),
           json_extract(value, '$.w'), json_extract(value, '$.h'), json_extract(value, '$.e'), json_extract(value, '$.mc'), json_extract(value, '$.lc'),
           json_extract(value, '$.em'), json_extract(value, '$.vc'), json_extract(value, '$.rc'), json_extract(value, '$.rr') FROM json_each(?1)`,
        JSON.stringify(pageRows),
      );
      t.run(
        `INSERT INTO document_parts (document_id, ordinal, title_cs, type, date, pages_json, readability, reason_cs, upload_name)
         SELECT json_extract(value, '$.d'), 0, json_extract(value, '$.t'), json_extract(value, '$.ty'), json_extract(value, '$.dt'), json_extract(value, '$.p'),
           json_extract(value, '$.r'), json_extract(value, '$.rs'), json_extract(value, '$.u') FROM json_each(?1)`,
        JSON.stringify(partRows),
      );
      // The same person (checked by the verdict), so the birth date the fixture's documents state becomes the patient's,
      // where the referral gave none; the page derives the age from it.
      t.run(
        "UPDATE patients SET birth_as_written = COALESCE(birth_as_written, (SELECT birth_as_written FROM fixture_patients WHERE fixture_id = ?1)) WHERE id = ?2",
        fid, core.patient_id,
      );
      // Only the fixture's files are prepared; a listed extra file stays "nezpracováno".
      t.run("UPDATE documents SET state = 'prepared', processing = 'processed' WHERE case_id = ?1 AND origin = 'upload' AND fixture_id = ?2", id, fid);
      // The question typed in the referral wins; without one, the documents' question with its source.
      t.run(
        `UPDATE cases SET intake_open = 0, intake_fixture = ?1, processing_level = 'partial', diagnosis_text = ?2, summary_one_line = ?3, page_count = ?4,
           question_text = COALESCE(question_text, ?5), question_explicit = CASE WHEN question_text IS NULL THEN ?6 ELSE question_explicit END,
           question_purpose = COALESCE(question_purpose, ?7), question_source_json = CASE WHEN question_text IS NULL THEN ?8 ELSE question_source_json END,
           updated_on = ?9 WHERE id = ?10`,
        fid, row.diagnosis_text, row.summary_one_line, row.page_count, row.question_text, row.question_explicit ? 1 : 0, row.question_purpose,
        row.question_source_json ? JSON.stringify(row.question_source_json) : null, day, id,
      );
      t.audit({ action: "intake.complete", what_cs: `vytvořil(a) pacienta ${from} a ${docsCs(docs.length)}`, case_id: id });
      t.audit({ action: "intake.prepared", what_cs: "připojena předem připravená data ukázkového pacienta (otisky všech dokumentů souhlasí)", case_id: id, target_type: "extraction_run", target_id: runId });
    } else {
      t.run("UPDATE cases SET intake_open = 0, updated_on = ?1 WHERE id = ?2", day, id);
      t.audit({ action: "intake.complete", what_cs: `vytvořil(a) pacienta ${from} a ${docsCs(docs.length)} (nezpracováno)`, case_id: id });
    }
    try {
      await t.commit();
    } catch (e) {
      if (written.length) await c.env.DOCS.delete(written).catch(() => {});
      throw e;
    }
    const row = await c.var.stores.cases.caseById(id);
    return answer(
      c,
      { case_id: id, attached: !!runId, run_id: runId, reason_cs: verdict.reason_cs, documents: docs.length },
      { patient: row ? patientRow(row, await c.var.stores.cases.statusHistory(id)) : null, cases: await statesFor(c, [id]) },
    );
  })
  .delete("/cases/:id/intake", async (c) => {
    const id = c.req.param("id");
    await openIntake(c, id, "zrušení příjmu pacienta");
    await discardIntake(c.env, id, c.var.viewer, c.req.header("cf-ray") ?? null, "user");
    return answer(c, { discarded: id });
  });

export { deletePrefix };
