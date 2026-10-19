// "Import z NIS", phase 1 (issue #22): find the case's patient in the org's NIS (the hospital information system, read
// over FHIR R4) and link one record to the patient row. The connector is services/fhir.ts, the match rules
// packages/domain/src/nis.ts. A person picks the record; nothing is linked or merged on its own, and a record whose
// birth number differs from the patient's is refused.
//
// Privacy: the birth number travels in request bodies only (ours and the NIS's POST _search), never in a URL or a
// log; the answers carry the candidates' names and birth dates because the person must tell them apart, but not
// their birth numbers (the person typed or already sees the one searched for). Every pull from the NIS writes an
// access-log row before it happens, without patient text.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { D } from "@codebridge/domain/errors";
import { candidateFrom, hasDuplicates, identityCheckOf, normalizeBirthNumber, rcisSearchValue } from "@codebridge/domain/nis";
import { audit } from "../middleware/audit";
import { aboutPatient, isFhirId, NATIONAL_REGISTER_STUB, NisClient, nisConfig, RECORD_TYPES, type Pull } from "../services/fhir";
import { nisRecordFields } from "@codebridge/domain/nis-record";
import { answer, caseFor, isoNow, label, orgQuery, tx } from "./write-context";
import { openCase } from "./access-check";
import { nisFragment } from "@codebridge/domain/nis-map";
import { deleteNisImport, readNisImport, writeNisImport } from "../store/nis";
import { orgStmt } from "../store/sql";
import { uploadContext } from "../store/documents";
import { storeFile, withdrawDocument, type UploadCtx } from "./documents";
import type { NisDocument } from "@codebridge/domain/nis-map";
import { limitOrThrow } from "../http/rate-limit";
import { ApiError, numVar } from "../http/errors";
import { DomainError } from "@codebridge/domain/errors";
import { MAX_DOCUMENTS_PER_CASE } from "../domain/documents";
import { pipelineListed } from "../services/page-reader";
import { startCaseMerge } from "../workflows/process-case";

type PatientRow = { id: string; full_name: string | null; birth_number: string | null };
type LinkRow = { nis_system: string; nis_patient_id: string; nis_version: string | null; identity_check: string; by_name: string; at: string };

// Written before the pull, so the row records the attempt: "hledal(a)", not "našel/našla".
const PULL_CS: Record<Pull["op"], string> = {
  search: "hledal(a) pacienta v NIS",
  read: "otevřel(a) záznam pacienta v NIS",
  record: "načítal(a) zdravotní záznam pacienta z NIS",
  view: "otevřel(a) zdroj údaje v NIS (záznam z NIS)",
  record_changes: "zjišťoval(a) změny záznamu pacienta v NIS",
  document: "načetl(a) dokument pacienta z NIS",
};
const LINK_CS = {
  matches: "propojil(a) pacienta se záznamem v NIS (rodné číslo i jméno souhlasí)",
  matches_name_differs: "propojil(a) pacienta se záznamem v NIS (rodné číslo souhlasí, jméno se liší, potvrzeno uživatelem)",
  cannot_verify: "propojil(a) pacienta se záznamem v NIS (rodné číslo nebylo možné ověřit, potvrzeno uživatelem)",
} as const;

async function context(c: Context<AppEnv>, id: string, what: string, o: { needsNis: boolean } = { needsNis: true }) {
  label(c, what, id);
  const cfg = nisConfig(c.env, c.var.viewer.org);
  if (!cfg && o.needsNis) throw D.nisOff();
  const { core, breakGlass } = await caseFor(c, id, "nis.link");
  // A doctor outside the team acting under a break-the-glass grant: every row of this request names the grant
  // (the access-log rows of the pulls through c.var.breakGlass, the link's rows through tx).
  if (breakGlass) c.set("breakGlass", breakGlass);
  const patient = await orgQuery(c, "SELECT id, full_name, birth_number FROM patients WHERE org_id = ?org AND id = ?1", core.patient_id).first<PatientRow>();
  if (!patient) throw D.caseNotFound();
  const link = await currentLink(c, patient.id);
  return { cfg, patient, link, breakGlass };
}

const currentLink = (c: Context<AppEnv>, patientId: string) =>
  orgQuery(c, "SELECT nis_system, nis_patient_id, nis_version, identity_check, by_name, at FROM patient_nis_links WHERE org_id = ?org AND patient_id = ?1", patientId).first<LinkRow>();

const linkOut = (l: LinkRow | null) =>
  l ? { nis_patient_id: l.nis_patient_id, nis_version: l.nis_version, identity_check: l.identity_check, by_name: l.by_name, at: l.at } : null;

// The birth number to search with: the patient row's own when it has one (a typed one must then be the same), else the
// one the person typed. Digits only from here on.
function searchedNumber(patient: PatientRow, typed: unknown): string {
  const ours = normalizeBirthNumber(patient.birth_number ?? undefined);
  // A number on the row that does not parse (a typo, an OCR error) is not "no number": a typed one could not be
  // compared with it, so the search stops until the row is corrected.
  if (!ours && hasRowNumber(patient)) throw D.nisRowBirthNumber();
  const t = typed === undefined || typed === null || typed === "" ? null : normalizeBirthNumber(typed);
  if (typed !== undefined && typed !== null && typed !== "" && !t) throw D.nisBirthNumber();
  if (ours && t && t !== ours) throw D.nisBirthNumberDiffers();
  const n = ours ?? t;
  if (!n) throw D.nisBirthNumber();
  return n;
}

// A record version as the refresh compares them: type, ID, version and last update, so a change shows also on a
// server that keeps no version IDs.
const versionKey = (r: Record<string, any>) =>
  `${r.resourceType}/${r.id}|${typeof r.meta?.versionId === "string" ? r.meta.versionId : ""}|${typeof r.meta?.lastUpdated === "string" ? r.meta.lastUpdated : ""}`;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
// How old the last full pull may be before a refresh pulls everything again (a deleted record drops out only then).
const FULL_PULL_MS = 24 * 3600 * 1000;

// ---------- NIS documents (phase 2b) ----------

type DocImport = { imported: number; superseded: number; skipped: number; declined: number; more: boolean };
// Binaries read per import call: a large record is taken over in several clicks, each in a request's time and memory.
const DOCS_PER_IMPORT = 10;
// What storeFile keeps as content (fileKind): a PDF, or a JPEG or PNG photo of a page.
const DOC_TYPES: Record<string, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png" };

// A reference relative to this NIS ("Type/id") or absolute within it, without its version; anything else is null.
function localRef(url: string | null | undefined, base: string, type: string): string | null {
  const s = (url ?? "").replace(/\/_history\/[^/]+$/, "");
  const local = s.startsWith(`${base}/`) ? s.slice(base.length + 1) : s;
  const m = new RegExp(`^${type}/([A-Za-z0-9\\-.]{1,64})$`).exec(local);
  return m && isFhirId(m[1]!) ? `${type}/${m[1]}` : null;
}

// A file name from the document's title and its NIS ID (so two documents with the same title stay two files),
// without characters a file system or a header would refuse, and without dots that would split it before the type.
const nisFileName = (d: NisDocument, ext: string) => {
  const title = (d.title ?? "dokument z NIS").replace(/[\\/:*?"<>|\u0000-\u001f.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "dokument z NIS";
  return `${title} (NIS ${d.resource.slice("DocumentReference/".length)})${ext}`;
};

function b64bytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Held = {
  nis_resource: string;
  nis_version: string;
  document_id: string | null;
  lifecycle: string | null;
  state: string | null;
  kept: number | null;
  auto_withdrawn: string | null;
  created_by_import?: number;
};

// Why the import withdrew a document it brought (nis_documents.auto_withdrawn), as the doctor reads it.
const NIS_WITHDRAW_CS = {
  nis_voided: "dokument byl v NIS zneplatněn",
  nis_removed: "dokument už v NIS není",
  nis_unlinked: "pacient byl odpojen od záznamu v NIS",
} as const;
type NisWithdraw = keyof typeof NIS_WITHDRAW_CS;

/**
 * Withdraws documents the NIS import brought, through the same path as a doctor's withdraw (routes/documents.ts
 * withdrawDocument: file, pages, parts, alerts, model cache and older runs' content go, the merge runs again), with an
 * access-log line giving the reason. `pick` chooses which of the case's NIS documents go and why. The row keeps the
 * reason (auto_withdrawn): the case run then carries an alert naming the document, and a later import that finds it
 * current again takes it back in (a doctor's own withdraw of another patient's document stays declined). A document
 * that cannot go now (being read, prepared, or the case locked) is counted as pending; the import route then pulls the
 * whole record at its next call to try again.
 *
 * Only a document the import itself stored is withdrawn (created_by_import), never a doctor's own upload a NIS version
 * was mapped onto, and only when every NIS record standing for it picks a reason: a document another, still current
 * DocumentReference also names stays. The caller starts one merge for the case afterwards.
 */
async function withdrawNisDocuments(c: Context<AppEnv>, caseId: string, system: string, breakGlass: string | null, pick: (h: Held) => NisWithdraw | null): Promise<{ withdrawn: number; pending: number }> {
  const rows = (
    await orgQuery(
      c,
      `SELECT n.nis_resource, n.nis_version, n.document_id, d.lifecycle, d.state, (d.original_r2_key IS NOT NULL) AS kept, n.auto_withdrawn, n.created_by_import
         FROM nis_documents n JOIN documents d ON d.org_id = n.org_id AND d.id = n.document_id
        WHERE n.org_id = ?org AND n.case_id = ?1 AND n.nis_system = ?2 AND d.lifecycle = 'current'`,
      caseId,
      system,
    ).all<Held>()
  ).results;
  const out = { withdrawn: 0, pending: 0 };
  for (const docId of new Set(rows.map((r) => r.document_id!))) {
    const mine = rows.filter((r) => r.document_id === docId);
    if (!mine.some((r) => r.created_by_import === 1)) continue;
    const reasons = mine.map(pick);
    if (reasons.some((x) => !x)) continue;
    const why = reasons[0]!;
    try {
      await withdrawDocument(c, caseId, docId, breakGlass, {
        reasonCs: NIS_WITHDRAW_CS[why],
        action: "document.nis_withdraw",
        whatCs: `dokument z NIS automaticky odebrán z případu: ${NIS_WITHDRAW_CS[why]} (obsah smazán)`,
        extra: (t) => t.run("UPDATE nis_documents SET auto_withdrawn = ?1 WHERE org_id = ?org AND case_id = ?2 AND document_id = ?3", why, caseId, docId),
        merge: false,
      });
      out.withdrawn++;
    } catch (e) {
      // A refusal of the rules (being read, prepared, the case locked) waits for the next try; anything else is a fault.
      if (!(e instanceof DomainError)) throw e;
      console.error(JSON.stringify({ route: "nis.withdraw", case_id: caseId, document_id: docId, refused: e.code }));
      out.pending++;
    }
  }
  return out;
}

/**
 * Takes the record's current documents into the case as uploads (routes/documents.ts storeFile: the same policy,
 * identity check, access-log line and automatic processing), records each version it took over (nis_documents), and
 * retires a document the NIS replaced. Runs on every import call from the documents the last full pull found, so the
 * ones a call could not take (the per-call limit, a failed read) come in on the next click.
 *
 * - A version already taken over is skipped. A DocumentReference the case declined is never taken over again: its
 *   document was withdrawn as another patient's, or deleted from the case.
 * - A superseded or entered-in-error DocumentReference is not taken over.
 * - A document that replaces another (relatesTo replaces), or a newer version of the same DocumentReference, makes the
 *   older document "superseded" by it, only when the new one's content is kept (a replacement nothing can read must not
 *   push out one the case can) and the old one is current and not prepared (a prepared fixture's data is not rebuilt).
 */
async function importNisDocuments(c: Context<AppEnv>, caseId: string, system: string, nis: NisClient, u: UploadCtx, breakGlass: string | null, list: NisDocument[]): Promise<DocImport> {
  const v = c.var.viewer;
  const max = numVar(c.env.UPLOAD_MAX_BYTES);
  const heldNow = async () =>
    (
      await orgQuery(
        c,
        `SELECT n.nis_resource, n.nis_version, n.document_id, d.lifecycle, d.state, (d.original_r2_key IS NOT NULL) AS kept, n.auto_withdrawn
           FROM nis_documents n LEFT JOIN documents d ON d.org_id = n.org_id AND d.id = n.document_id
          WHERE n.org_id = ?org AND n.case_id = ?1 AND n.nis_system = ?2`,
        caseId,
        system,
      ).all<Held>()
    ).results;
  // A version the import withdrew itself (voided, removed, unlinked) is not held: found current again, it comes back.
  let held = (await heldNow()).filter((h) => !h.auto_withdrawn);
  const declined = new Set(held.filter((h) => h.document_id === null || h.lifecycle === "withdrawn").map((h) => h.nis_resource));
  const out: DocImport = { imported: 0, superseded: 0, skipped: 0, declined: 0, more: false };
  let reads = 0;
  let count = u.doc_count;
  for (const d of list) {
    if ((d.status ?? "current") !== "current") continue;
    const version = d.version ?? "";
    if (held.some((h) => h.nis_resource === d.resource && h.nis_version === version)) continue;
    if (declined.has(d.resource)) {
      out.declined++;
      continue;
    }
    const ext = DOC_TYPES[(d.content_type ?? "").split(";")[0]!.trim().toLowerCase()];
    const bin = localRef(d.attachment_url, system, "Binary");
    if (!ext || !bin) {
      out.skipped++;
      continue;
    }
    // Every read counts against the per-call limit, also one that finds nothing; the rest comes on the next click.
    if (reads >= DOCS_PER_IMPORT || count >= MAX_DOCUMENTS_PER_CASE) {
      out.more = true;
      break;
    }
    reads++;
    // An attachment the NIS says is too large is listed like an oversized upload, never fetched.
    let bytes: Uint8Array | null = null;
    let declared = d.size ?? 0;
    try {
      if (d.size === null || d.size <= max) {
        const b = await nis.read("Binary", bin.slice("Binary/".length), { op: "document", resource: d.resource }, Math.ceil(max * 1.4) + 4096);
        // A Binary that names another patient in its security context is not this patient's document.
        const ctx = b?.securityContext?.reference;
        if (ctx && !localRef(ctx, system, "Patient")?.endsWith(`/${(await linkPatient(c, caseId)) ?? "-"}`) && !localRef(ctx, system, "DocumentReference")) {
          out.skipped++;
          continue;
        }
        if (typeof b?.data !== "string") {
          out.skipped++;
          continue;
        }
        bytes = b64bytes(b.data);
        declared = bytes.length;
        if (declared > max) bytes = null;
      }
    } catch (e) {
      // One bad Binary does not end the import: it is counted, and the next click tries it again.
      if (e instanceof ApiError && e.code === "nis_too_large") bytes = null;
      else {
        out.skipped++;
        out.more = true;
        continue;
      }
    }
    // A version taken back after the import withdrew it replaces its row, and the alert about it goes with the merge.
    // created_by_import says whether the import stored the document (1) or only mapped this version onto one already in
    // the case (0); taking a resource back clears the withdrawal on all its rows, so its alert goes whatever the version.
    const UPSERT = `INSERT INTO nis_documents (org_id, case_id, nis_system, nis_resource, nis_version, document_id, created_by_import) VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT (org_id, case_id, nis_system, nis_resource, nis_version) DO UPDATE SET document_id = excluded.document_id, auto_withdrawn = NULL,
        created_by_import = excluded.created_by_import`;
    const CLEAR = "UPDATE nis_documents SET auto_withdrawn = NULL WHERE org_id = ?org AND case_id = ?1 AND nis_system = ?2 AND nis_resource = ?3";
    const record = (t: { run: (sql: string, ...args: unknown[]) => unknown }, docId: string) => {
      t.run(UPSERT, caseId, system, d.resource, version, docId, 1);
      t.run(CLEAR, caseId, system, d.resource);
    };
    try {
      const r = await storeFile(c, caseId, u, breakGlass, null, { bytes, declared, name: nisFileName(d, ext), contentType: d.content_type }, record);
      // The same bytes already in the case (an earlier version, or uploaded by hand): that document stands for this
      // version too.
      if (r.repeat) await c.env.DB.batch([orgStmt(c.env.DB, v.org, UPSERT, caseId, system, d.resource, version, r.docId, 0), orgStmt(c.env.DB, v.org, CLEAR, caseId, system, d.resource)]);
      else {
        out.imported++;
        count++;
      }
    } catch (e) {
      // A parallel import took the same version (its provenance row), or the case filled up or was locked meanwhile:
      // counted, and the next click sees where things stand.
      console.error(JSON.stringify({ route: "nis.import", document: e instanceof DomainError || e instanceof ApiError ? e.code : "failed" }));
      out.skipped++;
      out.more = true;
    }
  }

  // Retire what the NIS replaced, over everything held (so a retirement that failed on an earlier click is done now).
  held = (await heldNow()).filter((h) => !h.auto_withdrawn);
  const byResource = (res: string) => held.filter((h) => h.nis_resource === res && h.document_id);
  const now = isoNow();
  for (const d of list) {
    if ((d.status ?? "current") !== "current") continue;
    const mine = held.find((h) => h.nis_resource === d.resource && h.nis_version === (d.version ?? "") && h.document_id && h.lifecycle === "current" && h.kept);
    if (!mine) continue;
    const replaced = d.replaces.map((x) => localRef(x, system, "DocumentReference")).filter((x): x is string => !!x);
    const old = [...replaced.flatMap(byResource), ...byResource(d.resource).filter((h) => h.nis_version !== (d.version ?? ""))].filter(
      (h) => h.document_id !== mine.document_id && h.lifecycle === "current" && h.state !== "prepared",
    );
    for (const o of new Map(old.map((x) => [x.document_id!, x])).values()) {
      const t = tx(c, breakGlass);
      // Checked again in the batch: only a still-current, unprepared document is retired, so nothing else is logged.
      t.guard("current", "(SELECT lifecycle = 'current' AND COALESCE(state, '') <> 'prepared' FROM documents WHERE org_id = ?org AND id = ?)", [o.document_id], () => D.conflict());
      t.run(
        `UPDATE documents SET lifecycle = 'superseded', superseded_by = ?1, lifecycle_reason_cs = 'nahrazeno opravenou verzí v NIS', lifecycle_changed_at = ?2, lifecycle_changed_by = ?3
         WHERE org_id = ?org AND id = ?4 AND case_id = ?5 AND lifecycle = 'current'`,
        mine.document_id, now, v.actor?.id ?? v.id, o.document_id, caseId,
      );
      t.audit({ action: "document.supersede", what_cs: "dokument nahrazen opravenou verzí z NIS", case_id: caseId, target_type: "document", target_id: o.document_id });
      try {
        await t.commit();
        out.superseded++;
      } catch {
        console.error(JSON.stringify({ route: "nis.import", supersede: "refused" }));
      }
    }
  }
  return out;
}

// The NIS patient ID the case is linked to now, for the Binary's security context check.
async function linkPatient(c: Context<AppEnv>, caseId: string): Promise<string | null> {
  const row = await orgQuery(
    c,
    "SELECT l.nis_patient_id FROM patient_nis_links l JOIN cases k ON k.patient_id = l.patient_id AND k.org_id = l.org_id WHERE k.org_id = ?org AND k.id = ?1",
    caseId,
  ).first<{ nis_patient_id: string }>();
  return row?.nis_patient_id ?? null;
}

const hasRowNumber = (p: PatientRow) => !!p.birth_number?.trim();

// The birth number in both written forms: a next link that carries either is not followed (services/fhir.ts).
const secretForms = (digits: string) => [digits, `${digits.slice(0, 6)}/${digits.slice(6)}`];

function client(c: Context<AppEnv>, cfg: NonNullable<ReturnType<typeof nisConfig>>, caseId: string) {
  return new NisClient(c.env, c.var.viewer.org, cfg, (p) =>
    audit(c, { action: `nis.${p.op}`, case_id: caseId, what_cs: PULL_CS[p.op], target_type: "nis", target_id: p.resource }),
  );
}

export const nis = new Hono<AppEnv>()
  // "Záznam z NIS": the record a fact rests on, read from the NIS when the doctor opens it in the source viewer. Only a
  // record of a type the import reads and of the patient linked to this case: a record of anyone else answers as not
  // found, so the route cannot be used to browse the NIS.
  .get("/cases/:id/nis/record", async (c) => {
    const id = c.req.param("id");
    // A clinical read, under the same rules as the case's content (role, team, break-the-glass grant and
    // CLINICAL_ACCESS), not the rules of linking: the coordinator who may link may not read records where
    // CLINICAL_ACCESS keeps clinical content to doctors.
    await openCase(c, id, "clinical");
    const cfg = nisConfig(c.env, c.var.viewer.org);
    if (!cfg) throw D.nisOff();
    const caseRow = await orgQuery(c, "SELECT patient_id FROM cases WHERE org_id = ?org AND id = ?1", id).first<{ patient_id: string }>();
    const link = caseRow ? await currentLink(c, caseRow.patient_id) : null;
    if (!link) throw D.nisNotLinked();
    const m = /^([A-Za-z]+)\/([^/]+)$/.exec(c.req.query("resource") ?? "");
    if (!m || !(RECORD_TYPES as readonly string[]).includes(m[1]!) || !isFhirId(m[2]!)) throw D.invalidInput();
    // A record cited from another NIS than the one configured now (or than the one the link was made with) is not
    // looked up in this one under the same ID.
    const cited = c.req.query("system");
    if (link.nis_system !== cfg.base_url || (cited && cited.replace(/\/+$/, "") !== cfg.base_url)) throw D.nisRecordNotFound();
    const r = await client(c, cfg, id).view(m[1]!, m[2]!);
    if (!r || !aboutPatient(r, link.nis_patient_id, cfg.base_url)) throw D.nisRecordNotFound();
    // What the panel needs and no more: contained resources (a Patient or Practitioner a NIS may embed) and the
    // narrative stay out of the answer.
    const { contained: _c, text: _t, ...shown } = r;
    return c.json({
      label_cs: cfg.label_cs,
      resource: `${m[1]}/${m[2]}`,
      version: typeof r.meta?.versionId === "string" ? r.meta.versionId : null,
      last_updated: typeof r.meta?.lastUpdated === "string" ? r.meta.lastUpdated : null,
      fields: nisRecordFields(r),
      record: shown,
    });
  })
  // The link as stored, without calling the NIS: the dialog opens with it.
  .get("/cases/:id/nis", async (c) => {
    const id = c.req.param("id");
    const { cfg, patient, link } = await context(c, id, "propojení s NIS");
    return c.json({ label_cs: cfg!.label_cs, has_birth_number: hasRowNumber(patient), link: linkOut(link), national_register: NATIONAL_REGISTER_STUB });
  })
  // Import (and refresh) of the linked patient's NIS record into the case view: the record is mapped into the case's
  // NIS fragment, and the case merge composes it with the documents (store/case-merge.ts). Facts keep their IDs through
  // the merge's matching, so a doctor's confirmations stay; a changed value shows under the same ID.
  //
  // A refresh asks what changed at or after the newest update it saw (the NIS's own clock, "ge"). It pulls the whole
  // record again when a record version it did not read comes back, when the last pull or this one was cut off at the
  // paging limit, or when the last full pull is older than FULL_PULL_MS: a record deleted in the NIS never comes back
  // from a change query, so only a full pull lets it drop out. The merge is started either way (it is idempotent), so
  // a merge whose start failed is retried by the next click.
  .post("/cases/:id/nis/import", async (c) => {
    const id = c.req.param("id");
    const { cfg, link, breakGlass } = await context(c, id, "import z NIS");
    if (!link) throw D.nisNotLinked();
    const v = c.var.viewer;
    // Only where the case merge runs: elsewhere nothing would show the import, and it is refused rather than stored
    // where no one sees it.
    if (!pipelineListed(c.env, v.org)) throw D.nisMergeOff();
    // A closed case or one with an approved conclusion takes no new content, as for uploads.
    const u = await uploadContext(c.env.DB, v.org, id);
    if (!u || u.status === "closed" || u.approved) throw D.nisLocked();
    const nis = client(c, cfg!, id);
    const before = await readNisImport(c.env.DOCS, v.org, id);
    const same = !!before && before.state.nis_system === cfg!.base_url && before.state.nis_patient_id === link.nis_patient_id && before.state.link_at === link.at;
    // A withdraw that could not run last time is tried again with a full pull, which is what notices a removal.
    let full =
      !same || !before?.state.newest_update || before.state.truncated.length > 0 || !!before.state.withdraw_pending || Date.now() - Date.parse(before.state.imported_at) > FULL_PULL_MS;
    if (!full && before?.state.newest_update) {
      const changed = await nis.patientRecord(link.nis_patient_id, before.state.newest_update, "record_changes");
      const seen = new Set(before.state.read);
      full = changed.truncated.length > 0 || changed.resources.some((r) => !seen.has(versionKey(r)));
    }
    let facts: number | null = null;
    let truncated: string[] = [];
    let docList: NisDocument[] = before?.state.documents ?? [];
    let gone = { withdrawn: 0, pending: 0 };
    if (full) {
      const rec = await nis.patientRecord(link.nis_patient_id);
      const at = isoNow();
      const importId = `nis-${id}-${at}`;
      const { fragment, mapped } = nisFragment({ system: cfg!.base_url, resources: rec.resources, importId, truncated: rec.truncated });
      // Only a well-formed instant becomes the next refresh's "since": the connector refuses anything else.
      const newest = rec.resources.map((r) => (typeof r.meta?.lastUpdated === "string" ? r.meta.lastUpdated : "")).filter((x) => INSTANT.test(x)).sort().at(-1) ?? null;
      await writeNisImport(c.env.DOCS, v.org, id, {
        fragment,
        state: {
          nis_system: cfg!.base_url,
          nis_patient_id: link.nis_patient_id,
          link_at: link.at,
          newest_update: newest,
          imported_at: at,
          import_id: importId,
          read: rec.resources.map(versionKey),
          truncated: rec.truncated,
          documents: mapped.documents,
          withdraw_pending: false,
        },
      });
      facts = fragment.facts.length;
      truncated = rec.truncated;
      docList = mapped.documents;
      // Documents the NIS voided or no longer has leave the case (Juro's decision 2026-10-19), only when this pull read
      // the record's DocumentReferences completely: a cut-off list says nothing about what is gone.
      if (!rec.truncated.includes("DocumentReference")) {
        const listed = new Set(mapped.documents.filter((d) => (d.status ?? "current") === "current").map((d) => d.resource));
        const voided = new Set(
          rec.resources.filter((r) => r.resourceType === "DocumentReference" && (r.status === "entered-in-error" || r.docStatus === "entered-in-error")).map((r) => `DocumentReference/${r.id}`),
        );
        // Superseded is not removed: a DocumentReference marked so, or named by a current one's "replaces" (a server may
        // leave superseded ones out of its answer), is retired as superseded by the import, never withdrawn.
        const superseded = new Set([
          ...mapped.documents.filter((d) => d.status === "superseded").map((d) => d.resource),
          ...mapped.documents.flatMap((d) => d.replaces.map((x) => localRef(x, cfg!.base_url, "DocumentReference")).filter((x): x is string => !!x)),
        ]);
        gone = await withdrawNisDocuments(c, id, cfg!.base_url, breakGlass, (h) =>
          voided.has(h.nis_resource) ? "nis_voided" : !listed.has(h.nis_resource) && !superseded.has(h.nis_resource) ? "nis_removed" : null,
        );
        if (gone.pending) {
          const x = await readNisImport(c.env.DOCS, v.org, id);
          if (x) await writeNisImport(c.env.DOCS, v.org, id, { ...x, state: { ...x.state, withdraw_pending: true } });
        }
      }
    }
    // The record's documents go in as uploads, on every call, so what one call could not take comes in on the next.
    // Each one counts against the upload rate limit, as a file brought by hand would.
    if (docList.length) await limitOrThrow(c, "RL_UPLOAD");
    const docs = await importNisDocuments(c, id, cfg!.base_url, nis, u, breakGlass, docList);
    const started = await startCaseMerge(c.env, { org: v.org, caseId: id, by: v.id, byActor: v.actor?.id ?? null });
    return answer(c, { changed: full, facts, truncated, documents: { ...docs, withdrawn: gone.withdrawn, withdraw_pending: gone.pending }, merge_started: started });
  })
  .post("/cases/:id/nis/search", async (c) => {
    const id = c.req.param("id");
    const { cfg, patient, link } = await context(c, id, "vyhledání pacienta v NIS");
    const searched = searchedNumber(patient, c.var.body.birth_number);
    const r = await client(c, cfg!, id).searchPatientsByIdentifier(rcisSearchValue(searched), secretForms(searched));
    const all = r.resources.map((p) => candidateFrom(p, { searched, ours: { birth_number: patient.birth_number, full_name: patient.full_name } }));
    // Only records that carry the searched birth number reach the page; anything else the NIS sent (a server that
    // matched loosely) is someone else, so the page gets a count, never their names.
    const candidates = all.filter((x) => x.birth_number_matches);
    const hidden = all.length - candidates.length;
    if (hidden) console.log(JSON.stringify({ route: "nis", op: "search", other_records_hidden: hidden }));
    return answer(c, {
      label_cs: cfg!.label_cs,
      candidates,
      other_records_hidden: hidden,
      duplicates: hasDuplicates(candidates),
      truncated: r.truncated,
      link: linkOut(link),
      national_register: NATIONAL_REGISTER_STUB,
    });
  })
  .post("/cases/:id/nis/link", async (c) => {
    const id = c.req.param("id");
    const { cfg, patient, link, breakGlass } = await context(c, id, "propojení pacienta se záznamem v NIS");
    if (link) throw D.nisAlreadyLinked();
    const b = c.var.body;
    const nisId = typeof b.nis_patient_id === "string" ? b.nis_patient_id : "";
    if (!isFhirId(nisId)) throw D.invalidInput();
    const searched = searchedNumber(patient, b.birth_number);
    // Without a birth number on our row the identity cannot be checked whatever the NIS says, so the confirmation is
    // asked before anything is pulled.
    if (!normalizeBirthNumber(patient.birth_number ?? undefined) && b.confirm_unverified !== true) throw D.nisConfirmRequired();
    // The record is read again from the NIS: the page's copy of a candidate is never trusted for identity.
    const res = await client(c, cfg!, id).read("Patient", nisId);
    if (!res) throw D.nisPatientNotFound();
    const cand = candidateFrom(res, { searched, ours: { birth_number: patient.birth_number, full_name: patient.full_name } });
    if (!cand.linkable) throw D.nisNotLinkable({ fields: { nis_patient_id: cand.reason_cs ?? "" } });
    if (cand.needs_confirmation && b.confirm_unverified !== true) throw cand.identity === "cannot_verify" ? D.nisConfirmRequired() : D.nisConfirmName();
    const check = identityCheckOf(cand);
    const at = isoNow();
    const v = c.var.viewer;
    await tx(c, breakGlass)
      .onConstraint(/UNIQUE constraint failed: patient_nis_links\.org_id, patient_nis_links\.nis_system/, () => D.nisRecordTaken())
      .onConstraint(/UNIQUE constraint failed: patient_nis_links\.org_id, patient_nis_links\.patient_id/, () => D.nisAlreadyLinked())
      .run(
        `INSERT INTO patient_nis_links (org_id, patient_id, nis_system, nis_patient_id, nis_version, identity_check, by_user_id, by_name, at)
         VALUES (?org, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        patient.id, cfg!.base_url, nisId, cand.version, check, v.id, v.name, at,
      )
      .audit({
        action: "nis.link",
        case_id: id,
        what_cs: LINK_CS[check],
        target_type: "nis_patient",
        target_id: nisId,
      })
      .commit();
    return answer(c, { link: linkOut(await currentLink(c, patient.id)) });
  })
  .delete("/cases/:id/nis/link", async (c) => {
    const id = c.req.param("id");
    // Unlinking needs no NIS: a link must be removable even after the org's NIS was switched off.
    const { patient, link, breakGlass } = await context(c, id, "zrušení propojení s NIS", { needsNis: false });
    if (!link) throw D.nisNotLinked();
    await tx(c, breakGlass)
      .guard("nis_link", "(SELECT nis_patient_id FROM patient_nis_links WHERE org_id = ?org AND patient_id = ?) = ?", [patient.id, link.nis_patient_id], () => D.nisNotLinked())
      .run("DELETE FROM patient_nis_links WHERE org_id = ?org AND patient_id = ?1", patient.id)
      .audit({ action: "nis.unlink", case_id: id, what_cs: "zrušil(a) propojení pacienta se záznamem v NIS", target_type: "nis_patient", target_id: link.nis_patient_id })
      .commit();
    // The imported NIS facts leave every case of the patient with the link (the link is the patient's, the import is
    // per case): each case's import goes, and the merge composes each case again. Until it has, the case view already
    // leaves out NIS facts of an unlinked patient (routes/cases.ts, withoutUnlinkedNis).
    const v = c.var.viewer;
    const all = (await orgQuery(c, "SELECT id FROM cases WHERE org_id = ?org AND patient_id = ?1", patient.id).all<{ id: string }>()).results;
    const withdraw = { withdrawn: 0, pending: 0, not_allowed: 0 };
    for (const k of all) {
      // Its documents from the NIS go too (Juro's decision 2026-10-19), each with an alert naming it, in each case the
      // viewer may act in: another team's case keeps them, counted, for its own team (the facts leave every case).
      let grant: { breakGlass: string | null } | null = { breakGlass };
      if (k.id !== id) {
        grant = await caseFor(c, k.id, "nis.link").catch((e) => {
          if (e instanceof DomainError) return null;
          throw e;
        });
      }
      if (grant) {
        const r = await withdrawNisDocuments(c, k.id, link.nis_system, grant.breakGlass, () => "nis_unlinked");
        withdraw.withdrawn += r.withdrawn;
        withdraw.pending += r.pending;
      } else withdraw.not_allowed++;
      await deleteNisImport(c.env.DOCS, v.org, k.id);
      if (pipelineListed(c.env, v.org)) await startCaseMerge(c.env, { org: v.org, caseId: k.id, by: v.id, byActor: v.actor?.id ?? null });
    }
    return answer(c, { link: null, documents: withdraw });
  });
