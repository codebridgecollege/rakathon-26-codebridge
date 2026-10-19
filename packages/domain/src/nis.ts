// Patient match against the NIS (the hospital information system, read over FHIR R4; docs/design/INTEGRATION.md).
// Pure: the Worker's connector fetches the Patient resources, these rules turn each into a candidate the user picks
// from. Nothing here merges or links on its own: a candidate is only ever linked by a person (CLAUDE.md, "Do not merge
// patients silently").
import { SID } from "./fhir";

type R = Record<string, any>;

// A Czech birth number as digits only: 9 digits (born before 1954) or 10. Anything else is not a birth number, so
// the search refuses it instead of sending a malformed identifier to the NIS.
export function normalizeBirthNumber(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{6}\/?\d{3,4}$/.test(t)) return null;
  return t.replace("/", "");
}

// The identifier search value for both ways a NIS may store it ("585614/4019" and "5856144019"): FHIR's comma is OR.
// Which form FNO's NIS uses is an open question (docs/agent/OPEN_QUESTIONS.md).
export function rcisSearchValue(digits: string): string {
  const slash = `${digits.slice(0, 6)}/${digits.slice(6)}`;
  return `${SID.rc}|${slash},${SID.rc}|${digits}`;
}

export type Identity = "matches" | "conflicts" | "cannot_verify";
export type NameMatch = "same" | "spelling" | "different" | "cannot_verify";

export type NisCandidate = {
  nis_id: string;
  version: string | null;
  last_updated: string | null;
  name: string | null;
  birth_date: string | null;
  gender: string | null;
  active: boolean;
  // The candidate carries the birth number that was searched for (a server that matches loosely could return others).
  birth_number_matches: boolean;
  // The NIS merged this record into another one (Patient.link replaced-by): use that one.
  replaced_by: string | null;
  links: { type: string; nis_id: string }[];
  // The candidate's birth number against the one on our patient row; cannot_verify when our row has none.
  identity: Identity;
  name_match: NameMatch;
  // A person must confirm before linking: the birth number cannot be checked, or it matches but the name does not
  // (birth numbers are not guaranteed unique, and a second record may be another person's).
  needs_confirmation: boolean;
  linkable: boolean;
  reason_cs: string | null;
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) => s.split(/\s+/).filter(Boolean).sort().join(" ");

export function nameOf(p: R): string | null {
  const names: R[] = Array.isArray(p?.name) ? p.name : [];
  const n = names.find((x) => x?.use === "official") ?? names[0];
  if (!n) return null;
  const given = Array.isArray(n.given) ? n.given.filter((g: unknown) => typeof g === "string") : [];
  const s = [...given, typeof n.family === "string" ? n.family : ""].join(" ").trim();
  return s || (typeof n.text === "string" ? n.text.trim() : null) || null;
}

export function compareNames(nis: string | null, ours: string | null): NameMatch {
  if (!nis || !ours) return "cannot_verify";
  const a = words(nis.toLowerCase());
  const b = words(ours.toLowerCase());
  if (a === b) return "same";
  // Same letters once diacritics are dropped: "Jiri Zkusebni" for "Jiří Zkušební", typical of a second record typed
  // elsewhere. Shown, never treated as the same person by itself.
  return words(fold(nis)) === words(fold(ours)) ? "spelling" : "different";
}

const idOf = (ref: unknown) => (typeof ref === "string" ? ref.replace(/^.*Patient\//, "").replace(/\/_history\/.*$/, "") : "");

export function candidateFrom(p: R, o: { searched: string; ours: { birth_number: string | null; full_name: string | null } }): NisCandidate {
  const rcs = ((Array.isArray(p.identifier) ? p.identifier : []) as R[]).filter((i) => i?.system === SID.rc).map((i) => normalizeBirthNumber(i?.value));
  const links = ((Array.isArray(p.link) ? p.link : []) as R[]).map((l) => ({ type: String(l?.type ?? ""), nis_id: idOf(l?.other?.reference) })).filter((l) => l.nis_id);
  const replacedBy = links.find((l) => l.type === "replaced-by")?.nis_id ?? null;
  const ours = normalizeBirthNumber(o.ours.birth_number ?? undefined);
  const identity: Identity = !ours ? "cannot_verify" : rcs.includes(ours) ? "matches" : "conflicts";
  const name = nameOf(p);
  const active = p.active !== false;
  const matchesSearch = rcs.includes(o.searched);
  let reason: string | null = null;
  if (!matchesSearch) reason = "Záznam v NIS nemá hledané rodné číslo.";
  else if (identity === "conflicts") reason = "Rodné číslo v NIS se liší od rodného čísla pacienta.";
  else if (replacedBy) reason = `Záznam byl v NIS sloučen do záznamu ${replacedBy}.`;
  else if (!active) reason = "Záznam je v NIS neaktivní.";
  const nameMatch = compareNames(name, o.ours.full_name);
  return {
    nis_id: String(p.id ?? ""),
    version: typeof p.meta?.versionId === "string" ? p.meta.versionId : null,
    last_updated: typeof p.meta?.lastUpdated === "string" ? p.meta.lastUpdated : null,
    name,
    birth_date: typeof p.birthDate === "string" ? p.birthDate : null,
    gender: typeof p.gender === "string" ? p.gender : null,
    active,
    birth_number_matches: matchesSearch,
    replaced_by: replacedBy,
    links,
    identity,
    name_match: nameMatch,
    needs_confirmation: identity === "cannot_verify" || nameMatch === "different" || nameMatch === "spelling",
    linkable: reason === null && !!p.id,
    reason_cs: reason,
  };
}

// What a link records about identity: the birth number matched (and the name too), matched with a name that differs
// (confirmed by the person), or could not be checked (confirmed by the person).
export type IdentityCheck = "matches" | "matches_name_differs" | "cannot_verify";
export const identityCheckOf = (c: NisCandidate): IdentityCheck =>
  c.identity === "cannot_verify" ? "cannot_verify" : c.name_match === "same" || c.name_match === "cannot_verify" ? "matches" : "matches_name_differs";

// More than one record the user could link: the NIS holds duplicates for this birth number. The page says so and the
// user picks; nothing is merged.
export const hasDuplicates = (cs: NisCandidate[]) => cs.filter((c) => c.linkable).length > 1;
