// Whose page is this? The identity printed on a page compared with the case's patient (EXTRACTION-FORMAT.md,
// "identity"): `conflicts` when the page names someone else, `matches` when it names the case's patient, otherwise
// `cannot_verify`. Facts from a conflicting page are quarantined, never shown as the patient's and never dropped
// (decision 4 of the format), and the run carries an identity alert for the page. Only the result leaves this module;
// the identity itself never goes into a run.
import type { IdentityResult } from "@codebridge/domain/extraction/types";
import { detectIdentifiers, fold, nameForms, nameParts, type CaseIdentity } from "../pseudonymize";

const digits = (s: string) => s.replace(/\D/g, "");

// "Vrbenská Lenka, nar. 3.4.1959" or "Lenka Vrbenská, r.č. ...": the two capitalized words right before a birth
// label are the name the page is about.
const NAME_BEFORE_BIRTH = /(\p{Lu}[\p{L}-]+)[ \t]+(\p{Lu}[\p{L}-]+)[ \t]*,?[ \t]*(?:nar\.|narozen|r\.?[ \t]*č\.|RČ)/gu;

export function pageIdentity(text: string, id: CaseIdentity): IdentityResult {
  const own = new Set(nameParts(id.patientNames).flatMap(nameForms));
  const ownBn = digits(id.birthNumber ?? "");
  let matches = false;
  let conflicts = false;
  for (const h of detectIdentifiers(text, id)) {
    const v = text.slice(h.start, h.end);
    if (h.kind === "patient_name") matches = true;
    if (h.kind === "birth_number" && ownBn.length >= 9) {
      if (digits(v) === ownBn) matches = true;
      else conflicts = true;
    }
    // "Pacient: Vrbenská Lenka", "Jméno: ...": a name in an identity field that is not the case's patient.
    if (h.kind === "name_field" && /^\p{Lu}/u.test(v) && !own.has(fold(v))) conflicts = true;
  }
  NAME_BEFORE_BIRTH.lastIndex = 0;
  for (let m = NAME_BEFORE_BIRTH.exec(text); m; m = NAME_BEFORE_BIRTH.exec(text)) {
    if (!own.has(fold(m[1]!)) && !own.has(fold(m[2]!))) conflicts = true;
  }
  // A page that names both the patient and someone else is the dangerous kind: it is treated as conflicting.
  return conflicts ? "conflicts" : matches ? "matches" : "cannot_verify";
}
