// The checks of the "Nový pacient" referral form that the browser runs before it asks the server, and the server runs
// again (api/src/domain/intake.ts validateReferral). Only identity and the GDPR consent are required (round 20): the
// history comes from the documents and the MDT question can be added later. The birth number is checked for its
// format only; the national register check is a labelled stub (CLAUDE.md).

// 9 or 10 digits with an optional slash, the only formatting the format check allows.
export const RC_RE = /^\d{6}\/?\d{3,4}$/;
// Birth numbers are compared without the slash.
export const normalizeRc = (rc: string) => rc.replace("/", "");

export type ReferralInput = { first_name: string; last_name: string; birth_number: string; consent: boolean };
// Why a field is refused, as codes; the page and the server word them (the server's Czech messages are the same).
export type ReferralProblem = "missing" | "format";

// The refused fields in the form's order, so the page can focus the first one. Values are trimmed first.
export function referralProblems(r: ReferralInput): [keyof ReferralInput, ReferralProblem][] {
  const out: [keyof ReferralInput, ReferralProblem][] = [];
  if (!r.first_name.trim()) out.push(["first_name", "missing"]);
  if (!r.last_name.trim()) out.push(["last_name", "missing"]);
  const rc = r.birth_number.trim();
  if (!rc) out.push(["birth_number", "missing"]);
  else if (!RC_RE.test(rc)) out.push(["birth_number", "format"]);
  if (r.consent !== true) out.push(["consent", "missing"]);
  return out;
}

// The patient in the list with the same birth number (ignoring the slash), if any. Czech hospitals hold duplicate
// records for one birth number, so a match is a warning with a link and a deliberate choice, never a silent merge.
export function duplicateOf<T extends { rc: string | null }>(rc: string, rows: readonly T[]): T | undefined {
  const n = normalizeRc(rc.trim());
  return n ? rows.find((x) => !!x.rc && normalizeRc(x.rc) === n) : undefined;
}
