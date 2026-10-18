// The FHIR R4 referral ("žádost o konzultaci") read into the "Nový pacient" form (step 6). Both
// the browser and the server fill the same fields from the same bundle. Pure.
import { DomainError } from "./errors";

// Czech national identifier systems (NCEZ): the birth number and the insurer code.
export const SID = { rc: "https://ncez.mzcr.cz/fhir/sid/rcis", kp: "https://ncez.mzcr.cz/fhir/sid/kp" };

export type ReferralForm = {
  first_name?: string;
  last_name?: string;
  birth_number?: string;
  insurer?: string;
  owner?: string;
  dept?: string;
  email?: string;
  phone?: string;
  anamnesis?: string;
  question?: string;
};

// The page's field names for each form key, so the page can apply the answer without a mapping of its own.
export const FORM_FIELD: Record<keyof ReferralForm, string> = {
  first_name: "nf0", last_name: "nf1", birth_number: "nf2", insurer: "nf3", owner: "nf4", dept: "nf5", email: "nf6", phone: "nf7",
  anamnesis: "nfa", question: "nfq",
};
const LABEL_CS: Record<keyof ReferralForm, string> = {
  first_name: "jméno", last_name: "příjmení", birth_number: "rodné číslo", insurer: "pojišťovna", owner: "lékař", dept: "pracoviště",
  email: "e-mail", phone: "telefon", anamnesis: "anamnéza", question: "otázka pro MDT",
};

type R = Record<string, any>;
const fail = (msg: string) => new DomainError(422, "fhir_invalid", `Import se nezdařil: ${msg}`);
const str = (x: unknown, max = 2000) => (typeof x === "string" ? x.trim().slice(0, max) : "");

export function fhirToForm(json: unknown): { form: ReferralForm; found: string[]; missing_cs: string[] } {
  if (!json || typeof json !== "object") throw fail("data nejsou objekt FHIR.");
  const j = json as R;
  const res: { url: string; r: R }[] =
    j.resourceType === "Bundle" ? (Array.isArray(j.entry) ? j.entry : []).map((e: R) => ({ url: e?.fullUrl, r: e?.resource })).filter((x: { r: unknown }) => x.r && typeof x.r === "object") : [{ url: "", r: j }];
  const byRef = (ref: unknown) => (typeof ref === "string" && ref ? res.find((x) => x.url === ref || `${x.r.resourceType}/${x.r.id}` === ref)?.r : undefined);
  const one = (t: string) => res.find((x) => x.r.resourceType === t)?.r;
  const pat = one("Patient");
  if (!pat) throw fail("V datech chybí Patient.");
  const out: ReferralForm = {};
  const names: R[] = Array.isArray(pat.name) ? pat.name : [];
  const nm = names.find((n) => n?.use === "official") || names[0];
  if (Array.isArray(nm?.given) && nm.given.length) out.first_name = str(nm.given.filter((g: unknown) => typeof g === "string").join(" "), 100);
  if (nm?.family) out.last_name = str(nm.family, 100);
  const ids: R[] = Array.isArray(pat.identifier) ? pat.identifier : [];
  const rc = ids.find((i) => i?.system === SID.rc)?.value;
  if (rc) out.birth_number = str(rc, 20);
  const cov = one("Coverage");
  const payor = cov && byRef(cov.payor?.[0]?.reference);
  const kp = (Array.isArray(payor?.identifier) ? payor!.identifier : []).find((i: R) => i?.system === SID.kp)?.value || cov?.payor?.[0]?.identifier?.value;
  if (kp) out.insurer = str(kp, 20);
  const sr = one("ServiceRequest");
  const req = sr && byRef(sr.requester?.reference);
  const doc = req?.resourceType === "PractitionerRole" ? byRef(req.practitioner?.reference) || req.practitioner : req?.resourceType === "Practitioner" ? req : sr?.requester;
  const docName = doc?.name ? [doc.name[0]?.prefix, doc.name[0]?.given, doc.name[0]?.family].flat().filter(Boolean).join(" ") : doc?.display;
  if (docName) out.owner = str(docName, 200);
  const org = req?.resourceType === "PractitionerRole" ? byRef(req.organization?.reference) || req.organization : req?.resourceType === "Organization" ? req : null;
  const orgName = org?.name || org?.display;
  if (orgName) out.dept = str(orgName, 200);
  const tel: R[] = [...(Array.isArray(req?.telecom) ? req.telecom : []), ...(Array.isArray(doc?.telecom) ? doc.telecom : [])];
  const mail = tel.find((t) => t?.system === "email")?.value;
  const phone = tel.find((t) => t?.system === "phone")?.value;
  if (mail) out.email = str(mail, 200);
  if (phone) out.phone = str(phone, 50);
  const note = (Array.isArray(sr?.note) ? sr.note : []).map((n: R) => n?.text).filter(Boolean).join("\n");
  if (note) out.anamnesis = str(note, 4000);
  const why = (Array.isArray(sr?.reasonCode) ? sr.reasonCode : []).map((c: R) => c?.text || c?.coding?.[0]?.display).filter(Boolean).join("; ");
  if (why) out.question = str(why, 2000);
  const found = ["Patient", cov && "Coverage", sr && "ServiceRequest"].filter(Boolean) as string[];
  const missing_cs = (Object.keys(LABEL_CS) as (keyof ReferralForm)[]).filter((k) => !out[k]).map((k) => LABEL_CS[k]);
  return { form: out, found, missing_cs };
}
