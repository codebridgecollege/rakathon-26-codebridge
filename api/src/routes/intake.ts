// "Nový pacient" on the server (step 6, slice a-2). The referral form creates the case open for intake (POST /api/cases
// with intake: true, routes/write-work.ts); its creator uploads the documents (routes/documents.ts) and completes the
// intake here. A registered fixture's prepared extraction is attached only when every one of that fixture's files is
// uploaded (by hash), no other fixture's file is, and the referral's name and birth number match the fixture's patient;
// otherwise the case is listed with its documents "nezpracováno". Listed files (content not kept) stay as they are. Design: step-6.md "As implemented".
// The attached extraction is a codebridge.extraction/2 run (docs/design/EXTRACTION-FORMAT.md), stored through
// store/runs.ts like any other producer's run: not seeded, so the demo reset removes it.
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
import { actorOf, answer, caseFor, isoNow, label, now, orgQuery, statesFor, tx } from "./write-context";
import { orgKey } from "../store/sql";
import { autoStart } from "./pipeline-start";
import { matchInputs, prepareRun, RunInvalid, storeRun, type DraftRun } from "../store/runs";
import { sourceIdFor, type Source } from "@codebridge/domain/extraction/index";

// fixtures/<id>/prepared.json as api/seed/seed.py prepared_fixture() writes it.
type Prepared = {
  schema: string;
  fixture_id: string;
  /**
   * The fixture's run over the files the intake uploads, as a draft (no fact or alert IDs; facts carry draft_id). The
   * seed has already mapped each reference from the combined PDF to one uploaded file per document, with the page
   * numbered inside that file; what it cannot know is the uploaded documents' IDs, written as placeholders.
   */
  run: DraftRun;
  /** The part each uploaded file becomes (document_parts), by upload name. */
  documents: { upload_name: string; title_cs: string; type: string | null; date: string | null; readability: string | null; reason_cs: string | null }[];
  case_row: {
    diagnosis_text: string | null;
    summary_one_line: string | null;
    question_text: string | null;
    question_explicit: boolean;
    question_purpose: string | null;
    question_source_json: unknown;
    page_count: number | null;
  };
  pages: Record<string, { n: number; width: number; height: number; engine: string; mean_conf: number | null; low_conf_words: number | null; is_empty: boolean; verify_count: number; redacted: boolean; redaction_count: number | null; redaction_reasons: string[] | null }[]>;
};
const PREPARED_SCHEMA = "codebridge.prepared/2";
// The placeholders of the prepared run (seed.py UPLOAD_DOC, UPLOAD_PART): an uploaded file's document ID, and its one
// part, "<document id>/p0" (the part row this route inserts).
const UPLOAD_DOC = "@upload:";
const UPLOAD_PART = "@upload-part:";

/**
 * The prepared run pointed at this intake's uploaded documents: placeholders become document and part IDs, each
 * document carries the uploaded file's hash, and every source ID is derived again from where its passage now is
 * (keys.ts sourceIdFor), so the run's sources are named as a run read from these documents would name them. A
 * placeholder for a file that was not uploaded is an internal error: the verdict requires every fixture file.
 */
export function uploadRun(draft: DraftRun, docByUpload: Record<string, string>, shaById: Map<string, string | null>): DraftRun {
  const docId = (name: string) => {
    const id = docByUpload[name];
    if (!id) throw E.internal();
    return id;
  };
  const swap = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(swap);
    if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, swap(v)]));
    if (typeof o === "string" && o.startsWith(UPLOAD_PART)) return `${docId(o.slice(UPLOAD_PART.length))}/p0`;
    if (typeof o === "string" && o.startsWith(UPLOAD_DOC)) return docId(o.slice(UPLOAD_DOC.length));
    return o;
  };
  const d = swap(draft) as DraftRun;
  const taken = new Set<string>();
  const renamed = new Map<string, string>();
  const sources = d.sources.map((src) => {
    const { id: old, ...rest } = src;
    const id = sourceIdFor(rest as Parameters<typeof sourceIdFor>[0], taken);
    taken.add(id);
    renamed.set(old, id);
    return { ...src, id } as Source;
  });
  return {
    ...d,
    documents: d.documents.map((x) => ({ ...x, sha256: shaById.get(x.document_id) ?? x.sha256 })),
    sources,
    facts: d.facts.map((f) => ({ ...f, sources: f.sources.map((x) => renamed.get(x) ?? x) })),
  };
}

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
    const { verdict } = await intakeState(c.env.DB, c.var.viewer.org, id);
    const docs = await caseDocuments(c.env.DB, c.var.viewer.org, id);
    const { docByUpload: _m, ...v } = verdict;
    return c.json({ case_id: id, ...v, documents: docs.map(docOut) });
  })
  .post("/cases/:id/intake/complete", async (c) => {
    const id = c.req.param("id");
    const { core } = await openIntake(c, id, "dokončení příjmu pacienta");
    const db = c.env.DB;
    const { docs, verdict } = await intakeState(db, c.var.viewer.org, id);
    const caseRow = await orgQuery(c, "SELECT referral_sha256 FROM cases WHERE org_id = ?org AND id = ?1", id).first<{ referral_sha256: string | null }>();
    const from = caseRow?.referral_sha256 ? "z žádosti FHIR" : "z žádosti";
    const at = isoNow();
    const day = pragueDay(now());
    const t = tx(c).onConstraint(/cases_intake_fixture|UNIQUE constraint failed: cases\.org_id, cases\.intake_fixture/, () => D.fixtureUsed());
    t.guard("intake_open", "(SELECT intake_open FROM cases WHERE org_id = ?org AND id = ?) = 1", [id], () => D.intakeDone());
    // The documents the verdict rests on are the ones still there.
    t.guard(
      "docs",
      "(SELECT group_concat(id || ':' || COALESCE(sha256, ''), ',') FROM (SELECT id, sha256 FROM documents WHERE org_id = ?org AND case_id = ? AND origin = 'upload' ORDER BY id)) IS ?",
      [id, docs.length ? [...docs].sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => `${d.id}:${d.sha256 ?? ""}`).join(",") : null],
      () => D.conflict(),
    );
    const written: string[] = [];
    let runId: string | null = null;
    if (verdict.ready && verdict.fixture_id) {
      const fid = verdict.fixture_id;
      const prep = await (await c.env.DOCS.get(`fixtures/${fid}/prepared.json`))?.json<Prepared>();
      // A prepared file from before the codebridge.extraction/2 seed counts as missing: the seed writes the new one.
      if (!prep || prep.schema !== PREPARED_SCHEMA) throw new ApiError(503, "seed_missing", "Předem připravená data ukázkového pacienta na serveru chybí; spusťte seed (api/AGENTS.md).");
      // The case row's question source names the combined PDF's pages as "@upload:<name>"; it becomes the uploaded file.
      const swap = (o: unknown) => {
        let s = JSON.stringify(o);
        for (const [name, docId] of Object.entries(verdict.docByUpload)) s = s.replaceAll(JSON.stringify(`@upload:${name}`), JSON.stringify(`${docId}.pdf`));
        if (s.includes('"@upload:')) throw E.internal();
        return JSON.parse(s);
      };
      const row = swap(prep.case_row) as Prepared["case_row"];
      const fixtureDocs = docs.filter((d) => d.fixture_id === fid);
      // The run: placeholders become this case's documents, then the matcher assigns the case's fact IDs against what
      // the case already has (matchInputs: an intake case has no run yet, but the call is the same for every producer).
      const draft = uploadRun(prep.run, verdict.docByUpload, new Map(fixtureDocs.map((d) => [d.id, d.sha256])));
      const inputs = await matchInputs(db, c.env.DOCS, c.var.viewer.org, id);
      // The case ID and the time make the run ID unique across orgs and repeated demos (extraction_runs.id is the key).
      const newRunId = `fixture-${id}-${(await sha256Hex(`${c.var.viewer.org}|${id}|${at}`)).slice(0, 8)}`;
      const { run } = prepareRun(inputs, { ...draft, case_id: id, run: { ...draft.run, id: newRunId, created_at: at } });
      // Page assets: the seed stored each upload's pages under its name; they are copied to the uploaded document.
      const pageRows: unknown[] = [];
      const partRows: unknown[] = [];
      const titles = new Map(prep.documents.map((d) => [d.upload_name, d]));
      try {
        for (const [name, docId] of Object.entries(verdict.docByUpload)) {
          const stem = name.replace(/\.pdf$/i, "");
          for (const m of prep.pages[name] ?? []) {
            const src = `fixtures/${fid}/pages/${stem}/p${m.n}`;
            const dst = orgKey(c.var.viewer.org, `uploads/${id}/${docId}/pages/p${m.n}`);
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
          // Every uploaded file is one part of the run ("<document id>/p0"), so each must have its part row.
          const d = titles.get(name);
          if (!d) throw E.internal();
          partRows.push({ d: docId, t: d.title_cs, ty: d.type, dt: d.date, p: JSON.stringify((prep.pages[name] ?? []).map((m) => m.n)), r: d.readability, rs: d.reason_cs, u: name });
        }
        // Validates the run (an invalid one is refused before anything of it is written), writes it to R2 under runs/
        // (not seeded) and queues its row, fact IDs and alert identities into this batch.
        const stored = await storeRun(t, { db, docs: c.env.DOCS }, run, {
          seeded: false,
          inputHashes: Object.fromEntries(fixtureDocs.flatMap((d) => (d.sha256 ? [[d.id, d.sha256]] : []))),
        });
        written.push(stored.r2_key);
        runId = run.run.id;
      } catch (e) {
        if (written.length) await c.env.DOCS.delete(written).catch(() => {});
        // A prepared run the validator refuses was written by another version of the seed; reseeding fixes it.
        if (e instanceof RunInvalid) throw new ApiError(503, "seed_missing", "Předem připravená data ukázkového pacienta neodpovídají serveru; spusťte seed znovu (api/AGENTS.md).");
        throw e;
      }
      t.run(
        `INSERT INTO pages (org_id, document_id, n, json_r2_key, image_r2_key, redacted_r2_key, width, height, engine, mean_conf, low_conf_words, is_empty, verify_count,
           redaction_count, redaction_reasons_json)
         SELECT ?org, json_extract(value, '$.d'), json_extract(value, '$.n'), json_extract(value, '$.j'), json_extract(value, '$.i'), json_extract(value, '$.r'),
           json_extract(value, '$.w'), json_extract(value, '$.h'), json_extract(value, '$.e'), json_extract(value, '$.mc'), json_extract(value, '$.lc'),
           json_extract(value, '$.em'), json_extract(value, '$.vc'), json_extract(value, '$.rc'), json_extract(value, '$.rr') FROM json_each(?1)`,
        JSON.stringify(pageRows),
      );
      t.run(
        `INSERT INTO document_parts (org_id, document_id, ordinal, part_id, title_cs, type, date, pages_json, readability, reason_cs, upload_name)
         SELECT ?org, json_extract(value, '$.d'), 0, json_extract(value, '$.d') || '/p0', json_extract(value, '$.t'), json_extract(value, '$.ty'), json_extract(value, '$.dt'), json_extract(value, '$.p'),
           json_extract(value, '$.r'), json_extract(value, '$.rs'), json_extract(value, '$.u') FROM json_each(?1)`,
        JSON.stringify(partRows),
      );
      // The same person (checked by the verdict), so the birth date the fixture's documents state becomes the patient's,
      // where the referral gave none; the page derives the age from it.
      t.run(
        "UPDATE patients SET birth_as_written = COALESCE(birth_as_written, (SELECT birth_as_written FROM fixture_patients WHERE fixture_id = ?1)) WHERE org_id = ?org AND id = ?2",
        fid, core.patient_id,
      );
      // Only the fixture's files are prepared; a listed extra file stays "nezpracováno".
      t.run("UPDATE documents SET state = 'prepared', processing = 'processed' WHERE org_id = ?org AND case_id = ?1 AND origin = 'upload' AND fixture_id = ?2", id, fid);
      // The question typed in the referral wins; without one, the documents' question with its source.
      t.run(
        `UPDATE cases SET intake_open = 0, intake_fixture = ?1, processing_level = 'partial', diagnosis_text = ?2, summary_one_line = ?3, page_count = ?4,
           question_text = COALESCE(question_text, ?5), question_explicit = CASE WHEN question_text IS NULL THEN ?6 ELSE question_explicit END,
           question_purpose = COALESCE(question_purpose, ?7), question_source_json = CASE WHEN question_text IS NULL THEN ?8 ELSE question_source_json END,
           updated_on = ?9 WHERE org_id = ?org AND id = ?10`,
        fid, row.diagnosis_text, row.summary_one_line, row.page_count, row.question_text, row.question_explicit ? 1 : 0, row.question_purpose,
        row.question_source_json ? JSON.stringify(row.question_source_json) : null, day, id,
      );
      t.audit({ action: "intake.complete", what_cs: `vytvořil(a) pacienta ${from} a ${docsCs(docs.length)}`, case_id: id });
      t.audit({ action: "intake.prepared", what_cs: "připojena předem připravená data ukázkového pacienta (otisky všech dokumentů souhlasí)", case_id: id, target_type: "extraction_run", target_id: run.run.id });
    } else {
      t.run("UPDATE cases SET intake_open = 0, updated_on = ?1 WHERE org_id = ?org AND id = ?2", day, id);
      t.audit({ action: "intake.complete", what_cs: `vytvořil(a) pacienta ${from} a ${docsCs(docs.length)} (nezpracováno)`, case_id: id });
    }
    try {
      await t.commit();
    } catch (e) {
      if (written.length) await c.env.DOCS.delete(written).catch(() => {});
      throw e;
    }
    // The intake's uploads waited for this point; those the prepared data did not cover are read now where the pipeline
    // runs for the org (never in demo org A).
    await autoStart(c, docs.map((d) => d.id), null);
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
    await discardIntake(c.env, c.var.viewer.org, id, c.var.viewer, c.req.header("cf-ray") ?? null, "user");
    return answer(c, { discarded: id });
  });

export { deletePrefix };
