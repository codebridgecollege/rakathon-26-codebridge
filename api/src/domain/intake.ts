// A new referral (Nový pacient): the form's checks with the page's messages, the duplicate birth-number rule and the
// one-time demo intake fixture. Czech hospitals hold duplicate records for one birth number, so a second record is
// allowed only as a deliberate choice with a reason, which the access log keeps (CLAUDE.md: do not merge silently).
import { D } from "./errors";

export const RC_RE = /^\d{6}\/?\d{3,4}$/;
export const normalizeRc = (rc: string) => rc.replace("/", "");

export type Referral = {
  first_name: string;
  last_name: string;
  birth_number: string;
  question: string | null;
  owner: string | null;
  dept: string | null;
};

const str = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

export function validateReferral(body: Record<string, unknown>): Referral {
  const r: Referral = {
    first_name: str(body.first_name, 100),
    last_name: str(body.last_name, 100),
    birth_number: str(body.birth_number, 20),
    question: str(body.question, 2000) || null,
    owner: str(body.owner, 200) || null,
    dept: str(body.dept, 200) || null,
  };
  const fields: Record<string, string> = {};
  if (!r.first_name) fields.first_name = "Vyplňte jméno.";
  if (!r.last_name) fields.last_name = "Vyplňte příjmení.";
  // Format only; the national register check is a labelled stub (CLAUDE.md).
  if (!r.birth_number) fields.birth_number = "Vyplňte rodné číslo.";
  else if (!RC_RE.test(r.birth_number)) fields.birth_number = "Rodné číslo zadejte ve tvaru 123456/7890.";
  if (body.consent !== true) fields.consent = "Bez souhlasu se zpracováním údajů nelze žádost odeslat.";
  if (Object.keys(fields).length) throw D.invalidInput({ fields });
  return r;
}

export type Existing = { case_id: string; file: string };

// Returns the override reason when a duplicate is knowingly created, null when there is no duplicate.
export function duplicateDecision(rc: string, existing: Existing[], override: unknown): string | null {
  if (!existing.length) return null;
  const o = (override ?? null) as { birth_number?: unknown; reason?: unknown } | null;
  const first = existing[0]!;
  // The confirmation holds only for the number it was given; a changed number is checked again (mock rule).
  if (!o || typeof o.birth_number !== "string" || normalizeRc(o.birth_number) !== normalizeRc(rc)) throw D.duplicateBirthNumber({ case_id: first.case_id, file: first.file });
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (reason.length < 10 || reason.length > 300) throw D.overrideReasonRequired();
  return reason;
}

// The intake demo patient (samples/S02_pacient) can be created once; a second copy would share its file.
export const INTAKE_FIXTURES: Record<string, { case_id: string; file: string }> = { S02: { case_id: "NO-S02", file: "S02_pacient.pdf" } };

export function intakeFixture(id: unknown, existingIds: ReadonlySet<string>): { case_id: string; file: string } | null {
  if (id === undefined || id === null || id === "") return null;
  const f = typeof id === "string" ? INTAKE_FIXTURES[id] : undefined;
  if (!f) throw D.invalidInput({ fields: { intake_fixture: "Neznámá ukázková žádost." } });
  if (existingIds.has(f.case_id)) throw D.fixtureUsed();
  return f;
}
