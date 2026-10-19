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
import { numVar } from "../http/errors";
import { nisFragment } from "@codebridge/domain/nis-map";
import { deleteNisImport, readNisImport, writeNisImport } from "../store/nis";
import { uploadContext } from "../store/documents";
import { storeFile, type UploadCtx } from "./documents";
import type { NisDocument } from "@codebridge/domain/nis-map";
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

type DocImport = { imported: number; superseded: number; skipped: number; more: boolean };
// Documents fetched per import: a large record is taken over in several clicks, each one in a request's time.
const DOCS_PER_IMPORT = 10;
const DOC_TYPES = /^(application\/pdf|image\/(jpeg|png|tiff|webp|heic|heif))\b/i;

// The Binary a DocumentReference's attachment names, relative ("Binary/<id>") or within the same NIS; anything else is
// not fetched (it would send our token to another server).
function binaryId(url: string | null, base: string): string | null {
  if (!url) return null;
  const local = url.startsWith(`${base}/`) ? url.slice(base.length + 1) : url;
  const m = /^Binary\/([A-Za-z0-9\-.]{1,64})$/.exec(local);
  return m && isFhirId(m[1]!) ? m[1]! : null;
}

// A file name from the document's title, without characters a file system or a header would refuse.
const nisFileName = (d: NisDocument, ext: string) =>
  `${(d.title ?? "dokument z NIS").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "dokument z NIS"} (NIS)${ext}`;

function b64bytes(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Takes the record's current documents into the case as uploads (routes/documents.ts storeFile: the same policy,
 * identity check, access-log line and automatic processing), records where each came from (nis_documents), and retires
 * a document the NIS replaced: a DocumentReference that `replaces` another, or a newer version of the same one, makes
 * the older one "superseded" by the new one (the document lifecycle), so the case run reads only the current version.
 * A version already taken over is skipped. A superseded or entered-in-error DocumentReference is not taken over.
 */
async function importNisDocuments(c: Context<AppEnv>, caseId: string, system: string, nis: NisClient, u: UploadCtx, breakGlass: string | null, list: NisDocument[]): Promise<DocImport> {
  const v = c.var.viewer;
  const max = numVar(c.env.UPLOAD_MAX_BYTES);
  const held = (
    await orgQuery(c, "SELECT document_id, nis_resource, nis_version FROM nis_documents WHERE org_id = ?org AND case_id = ?1 AND nis_system = ?2", caseId, system).all<{
      document_id: string;
      nis_resource: string;
      nis_version: string;
    }>()
  ).results;
  const has = (res: string, ver: string) => held.find((h) => h.nis_resource === res && h.nis_version === ver);
  const out: DocImport = { imported: 0, superseded: 0, skipped: 0, more: false };
  const current = list.filter((d) => (d.status ?? "current") === "current");
  out.skipped += list.length - current.length;
  const fresh = current.filter((d) => !has(d.resource, d.version ?? ""));
  const taken: { d: NisDocument; docId: string }[] = [];
  for (const d of fresh) {
    if (taken.length >= DOCS_PER_IMPORT) {
      out.more = true;
      break;
    }
    const bin = binaryId(d.attachment_url, system);
    if (!bin || !DOC_TYPES.test(d.content_type ?? "")) {
      out.skipped++;
      continue;
    }
    const b = await nis.read("Binary", bin, { op: "document", resource: d.resource });
    const data = typeof b?.data === "string" ? b.data : null;
    if (!data) {
      out.skipped++;
      continue;
    }
    let bytes: Uint8Array | null;
    try {
      bytes = b64bytes(data);
    } catch {
      out.skipped++;
      continue;
    }
    const declared = bytes.length;
    // Too large to keep: listed like an oversized upload, never read.
    if (declared > max) bytes = null;
    const ext = /pdf/i.test(d.content_type ?? "") ? ".pdf" : "";
    const record = (t: { run: (sql: string, ...args: unknown[]) => unknown }, docId: string) =>
      t.run(
        "INSERT INTO nis_documents (org_id, document_id, case_id, nis_system, nis_resource, nis_version) VALUES (?org, ?1, ?2, ?3, ?4, ?5)",
        docId, caseId, system, d.resource, d.version ?? "",
      );
    const r = await storeFile(c, caseId, u, breakGlass, null, { bytes, declared, name: nisFileName(d, ext), contentType: d.content_type }, record);
    // The same bytes already in the case (uploaded by hand before): that document is the NIS one too.
    if (r.repeat)
      await orgQuery(
        c,
        "INSERT OR IGNORE INTO nis_documents (org_id, document_id, case_id, nis_system, nis_resource, nis_version) VALUES (?org, ?1, ?2, ?3, ?4, ?5)",
        r.docId, caseId, system, d.resource, d.version ?? "",
      ).run();
    else out.imported++;
    taken.push({ d, docId: r.docId });
  }
  // What the NIS replaced: the documents taken over from the replaced DocumentReferences, and older versions of the
  // same one, while they are still current.
  const now = isoNow();
  for (const { d, docId } of taken) {
    const old = held.filter((h) => h.document_id !== docId && (d.replaces.some((x) => x.replace(/^.*?(DocumentReference\/)/, "$1") === h.nis_resource) || (h.nis_resource === d.resource && h.nis_version !== (d.version ?? ""))));
    for (const o of old) {
      const t = tx(c, breakGlass).onConstraint(/a superseded or withdrawn document stays so/, () => D.conflict());
      t.run(
        `UPDATE documents SET lifecycle = 'superseded', superseded_by = ?1, lifecycle_reason_cs = 'nahrazeno opravenou verzí v NIS', lifecycle_changed_at = ?2, lifecycle_changed_by = ?3
         WHERE org_id = ?org AND id = ?4 AND case_id = ?5 AND lifecycle = 'current'`,
        docId, now, v.actor?.id ?? v.id, o.document_id, caseId,
      );
      t.audit({ action: "document.supersede", what_cs: "dokument nahrazen opravenou verzí z NIS", case_id: caseId, target_type: "document", target_id: o.document_id });
      try {
        await t.commit();
        out.superseded++;
      } catch {
        console.error(JSON.stringify({ route: "nis.import", supersede: "failed" }));
      }
    }
  }
  return out;
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
    let full = !same || !before?.state.newest_update || before.state.truncated.length > 0 || Date.now() - Date.parse(before.state.imported_at) > FULL_PULL_MS;
    if (!full && before?.state.newest_update) {
      const changed = await nis.patientRecord(link.nis_patient_id, before.state.newest_update, "record_changes");
      const seen = new Set(before.state.read);
      full = changed.truncated.length > 0 || changed.resources.some((r) => !seen.has(versionKey(r)));
    }
    let facts: number | null = null;
    let truncated: string[] = [];
    let docs: DocImport = { imported: 0, superseded: 0, skipped: 0, more: false };
    if (full) {
      const rec = await nis.patientRecord(link.nis_patient_id);
      const at = isoNow();
      const importId = `nis-${id}-${at}`;
      const { fragment, mapped } = nisFragment({ system: cfg!.base_url, resources: rec.resources, importId, truncated: rec.truncated });
      // Only a well-formed instant becomes the next refresh's "since": the connector refuses anything else.
      const newest = rec.resources.map((r) => (typeof r.meta?.lastUpdated === "string" ? r.meta.lastUpdated : "")).filter((x) => INSTANT.test(x)).sort().at(-1) ?? null;
      await writeNisImport(c.env.DOCS, v.org, id, {
        fragment,
        state: { nis_system: cfg!.base_url, nis_patient_id: link.nis_patient_id, link_at: link.at, newest_update: newest, imported_at: at, import_id: importId, read: rec.resources.map(versionKey), truncated: rec.truncated },
      });
      facts = fragment.facts.length;
      truncated = rec.truncated;
      // The record's documents go in as uploads: each is read, identity-checked page by page and composed into the
      // case like a file the doctor brought.
      docs = await importNisDocuments(c, id, cfg!.base_url, nis, u, breakGlass, mapped.documents);
    }
    const started = await startCaseMerge(c.env, { org: v.org, caseId: id, by: v.id, byActor: v.actor?.id ?? null });
    return answer(c, { changed: full, facts, truncated, documents: docs, merge_started: started });
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
    for (const k of all) {
      await deleteNisImport(c.env.DOCS, v.org, k.id);
      if (pipelineListed(c.env, v.org)) await startCaseMerge(c.env, { org: v.org, caseId: k.id, by: v.id, byActor: v.actor?.id ?? null });
    }
    return answer(c, { link: null });
  });
