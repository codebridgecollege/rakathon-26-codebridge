// Whose page is this? The identity printed on a page compared with the case's patient (EXTRACTION-FORMAT.md,
// "identity"): `conflicts` when the page names someone else, `matches` when it names the case's patient, otherwise
// `cannot_verify`. Facts from a conflicting page are quarantined, never shown as the patient's and never dropped
// (decision 4 of the format), and the run carries an identity alert for the page. Only the result leaves this module;
// the identity itself never goes into a run.
import type { IdentityResult } from "@codebridge/domain/extraction/types";
import { detectIdentifiers, fold, nameForms, nameParts, type CaseIdentity } from "../pseudonymize";

const digits = (s: string) => s.replace(/\D/g, "");

// "Vrbenská Lenka, nar. 3.4.1959" or "Lenka Vrbenská,\nr.č. ...": the two capitalized words right before a birth
// label (on the same line or the next) are the name the page is about.
const NAME_BEFORE_BIRTH = /(\p{Lu}[\p{L}-]+)[ \t]+(\p{Lu}[\p{L}-]+)[ \t]*,?[ \t]*\n?[ \t]*(?:nar\.|narozen|r\.?[ \t]*č\.|RČ)/gu;
// Labels and abbreviations that a form field may hold next to the name ("Pacient: Klenovský Bořivoj, RČ ..."): never
// a name.
const NOT_A_NAME = /^(RČ|RC|Dg|MUDr|nar|Pacient|Pacientka|Jméno|Příjmení)\.?$/u;

export function pageIdentity(text: string, id: CaseIdentity): IdentityResult {
  const own = new Set(nameParts(id.patientNames).flatMap(nameForms));
  const ownBn = digits(id.birthNumber ?? "");
  let matches = false;
  let conflicts = false;
  const hits = detectIdentifiers(text, id);
  const names = hits.filter((h) => h.kind === "patient_name");
  for (const h of hits) {
    const v = text.slice(h.start, h.end);
    if (h.kind === "patient_name") matches = true;
    if (h.kind === "birth_number" && ownBn.length >= 9) {
      if (digits(v) === ownBn) matches = true;
      else conflicts = true;
    }
    // "Pacient: Vrbenská Lenka", "Jméno: ...": a name in an identity field that is not the case's patient. A label, a
    // short upper-case abbreviation or a word that is part of the patient's own name is not another person.
    if (h.kind === "name_field") {
      const isOwn = own.has(fold(v)) || names.some((n) => n.start < h.end && h.start < n.end);
      const isLabel = NOT_A_NAME.test(v) || (/^\p{Lu}+$/u.test(v) && v.length <= 3);
      if (/^\p{Lu}/u.test(v) && !isOwn && !isLabel) conflicts = true;
    }
  }
  NAME_BEFORE_BIRTH.lastIndex = 0;
  for (let m = NAME_BEFORE_BIRTH.exec(text); m; m = NAME_BEFORE_BIRTH.exec(text)) {
    if (!own.has(fold(m[1]!)) && !own.has(fold(m[2]!))) conflicts = true;
  }
  // A page that names both the patient and someone else is the dangerous kind: it is treated as conflicting.
  return conflicts ? "conflicts" : matches ? "matches" : "cannot_verify";
}
