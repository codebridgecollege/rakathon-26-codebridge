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

type PatientRow = { id: string; full_name: string | null; birth_number: string | null };
type LinkRow = { nis_system: string; nis_patient_id: string; nis_version: string | null; identity_check: string; by_name: string; at: string };

// Written before the pull, so the row records the attempt: "hledal(a)", not "našel/našla".
const PULL_CS: Record<Pull["op"], string> = {
  search: "hledal(a) pacienta v NIS",
  read: "otevřel(a) záznam pacienta v NIS",
  record: "načítal(a) zdravotní záznam pacienta z NIS",
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
    const { cfg, link } = await context(c, id, "záznam z NIS");
    if (!link) throw D.nisNotLinked();
    const m = /^([A-Za-z]+)\/([^/]+)$/.exec(c.req.query("resource") ?? "");
    if (!m || !(RECORD_TYPES as readonly string[]).includes(m[1]!) || !isFhirId(m[2]!)) throw D.invalidInput();
    // A record cited from another NIS than the one configured now is not read from this one.
    if (link.nis_system !== cfg!.base_url) throw D.nisRecordNotFound();
    const r = await client(c, cfg!, id).read(m[1]!, m[2]!);
    if (!r || !aboutPatient(r, link.nis_patient_id, cfg!.base_url)) throw D.nisRecordNotFound();
    return c.json({
      label_cs: cfg!.label_cs,
      resource: `${m[1]}/${m[2]}`,
      version: typeof r.meta?.versionId === "string" ? r.meta.versionId : null,
      last_updated: typeof r.meta?.lastUpdated === "string" ? r.meta.lastUpdated : null,
      fields: nisRecordFields(r),
      record: r,
    });
  })
  // The link as stored, without calling the NIS: the dialog opens with it.
  .get("/cases/:id/nis", async (c) => {
    const id = c.req.param("id");
    const { cfg, patient, link } = await context(c, id, "propojení s NIS");
    return c.json({ label_cs: cfg!.label_cs, has_birth_number: hasRowNumber(patient), link: linkOut(link), national_register: NATIONAL_REGISTER_STUB });
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
    return answer(c, { link: null });
  });
