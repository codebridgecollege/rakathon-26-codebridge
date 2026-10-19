// The case's NIS import in R2 (issue #22; docs/research/2026-10-20-case-merge-contract.md, "The NIS fragment"): what
// the last NIS import found for the case (its fragment) and which record and versions it read (its state), in ONE
// object, so two imports at once can never leave a state naming one import next to another import's fragment. Under
// the org's prefix, next to the case's uploads, so reset-demo removes it with them (routes/demo.ts R2_TRANSIENT "nis/").
import { FRAGMENT_SCHEMA, type Fragment } from "@codebridge/domain/fragments";
import type { NisDocument } from "@codebridge/domain/nis-map";
import { orgKey, orgStmt } from "./sql";

/** Which NIS record the import read, when, the newest change it saw, and every record version it read. */
export type NisImportState = {
  nis_system: string;
  nis_patient_id: string;
  /** The link's own time, so an import written after an unlink is not used again by a later link to the same record. */
  link_at: string;
  newest_update: string | null;
  imported_at: string;
  import_id: string;
  /** "Observation/8812|3|2026-10-01T08:00:00Z": type, ID, version and last update, so a change shows even without versions. */
  read: string[];
  /** Record types the import cut off at the paging limit: the next refresh pulls the whole record again. */
  truncated: string[];
  /** The record's documents as the last full pull found them; each import call takes in the ones still pending. */
  documents: NisDocument[];
  /** A withdraw of a NIS document could not run (being read, prepared, the case locked): the next import pulls in full. */
  withdraw_pending?: boolean;
};
export type NisImport = { state: NisImportState; fragment: Fragment };

export const nisImportKey = (org: string, caseId: string) => orgKey(org, `nis/${caseId}/import.json`);

export async function readNisImport(docs: R2Bucket, org: string, caseId: string): Promise<NisImport | null> {
  const x = await (await docs.get(nisImportKey(org, caseId)))?.json<NisImport>();
  return x?.state && x.fragment ? x : null;
}

export async function writeNisImport(docs: R2Bucket, org: string, caseId: string, x: NisImport): Promise<void> {
  await docs.put(nisImportKey(org, caseId), JSON.stringify(x), { httpMetadata: { contentType: "application/json" } });
}

export async function deleteNisImport(docs: R2Bucket, org: string, caseId: string): Promise<void> {
  await docs.delete(nisImportKey(org, caseId));
}

/** The patient's NIS link, by the case. */
export function linkOfCase(db: D1Database, org: string, caseId: string) {
  return orgStmt(
    db,
    org,
    "SELECT l.nis_system, l.nis_patient_id, l.at FROM patient_nis_links l JOIN cases c ON c.patient_id = l.patient_id AND c.org_id = l.org_id WHERE c.org_id = ?org AND c.id = ?1",
    caseId,
  ).first<{ nis_system: string; nis_patient_id: string; at: string }>();
}

/** Why a case's NIS import is left out of its run, or null when it counts. Codes only, for the log. */
export type NisExcluded = "no_nis_config" | "not_linked" | "other_nis" | "other_record" | "no_import" | "bad_import";

/**
 * The case's NIS fragment for the merge, or the reason it is left out. Only while the case's patient is linked to the
 * very record the import read, by the same link, in the NIS configured now: an unlinked or relinked patient leaves the
 * old NIS facts out of the next run.
 */
export async function nisFragmentFor(
  db: D1Database,
  docs: R2Bucket,
  org: string,
  caseId: string,
  configuredSystem: string | null,
): Promise<{ fragment: Fragment | null; excluded: NisExcluded | null; link: { nis_patient_id: string; at: string } | null }> {
  const imp = await readNisImport(docs, org, caseId);
  const no = (excluded: NisExcluded | null) => ({ fragment: null, excluded, link: null });
  if (!imp) return no(null);
  if (!configuredSystem) return no("no_nis_config");
  const link = await linkOfCase(db, org, caseId);
  if (!link) return no("not_linked");
  if (link.nis_system !== configuredSystem || imp.state.nis_system !== configuredSystem) return no("other_nis");
  if (imp.state.nis_patient_id !== link.nis_patient_id || imp.state.link_at !== link.at) return no("other_record");
  const f = imp.fragment;
  // Only a NIS fragment of this format from the import the state names; anything else is left out, never guessed at.
  if (f.schema !== FRAGMENT_SCHEMA || f.producer !== "nis" || f.pipeline_run !== imp.state.import_id) return no("bad_import");
  return { fragment: f, excluded: null, link: { nis_patient_id: link.nis_patient_id, at: link.at } };
}
