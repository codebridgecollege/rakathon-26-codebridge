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

// ---------- intake on the server (step 6) ----------
// "Nový pacient" creates the case at once, open for intake; its creator uploads the documents, and completing the
// intake attaches a fixture's prepared extraction only when it is the same person and the same documents.

export type IntakeDoc = { id: string; sha256: string | null; fixture_id: string | null; file_name: string };
export type FixtureFile = { sha256: string; file_name: string; title_cs: string | null; page_count: number | null };
export type IntakeInput = {
  docs: IntakeDoc[];
  // The fixture the uploads belong to (the one most uploads came from) and its expected upload files.
  fixture: { id: string; files: FixtureFile[]; patient: { full_name: string; birth_number: string | null } } | null;
  patient: { full_name: string; birth_number: string | null };
  // Another completed case already holds this fixture's prepared extraction (a second copy would share its pages).
  attachedElsewhere: boolean;
};
export type IntakeVerdict = {
  ready: boolean;
  fixture_id: string | null;
  expected: number;
  present: number;
  missing_cs: string[];
  reason_cs: string;
  // upload name of the fixture -> uploaded document id, for the reference rewrite
  docByUpload: Record<string, string>;
};

const nameKey = (n: string | null | undefined) => String(n ?? "").toLocaleLowerCase("cs").split(/\s+/).filter(Boolean).sort().join(" ");

// The same person: name in either order and the birth number without the slash, both present and equal. The birth
// number alone must never join a differently named person to the documents (CLAUDE.md: never merge patients silently).
export const samePerson = (a: { full_name: string; birth_number: string | null }, b: { full_name: string; birth_number: string | null }) =>
  !!a.birth_number && !!b.birth_number && normalizeRc(a.birth_number) === normalizeRc(b.birth_number) && nameKey(a.full_name) === nameKey(b.full_name);

const docsCs = (n: number) => `${n} ${n === 1 ? "dokument" : n >= 2 && n <= 4 ? "dokumenty" : "dokumentů"}`;

// Which fixture an intake's uploads belong to: the one most of them came from (ties: the first by id).
export function intakeFixtureOf(docs: IntakeDoc[]): string | null {
  const n = new Map<string, number>();
  for (const d of docs) if (d.fixture_id) n.set(d.fixture_id, (n.get(d.fixture_id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export function evaluateIntake(x: IntakeInput): IntakeVerdict {
  const base = { fixture_id: x.fixture?.id ?? null, expected: x.fixture?.files.length ?? 0, present: 0, missing_cs: [] as string[], docByUpload: {} as Record<string, string> };
  const none = (reason_cs: string, extra: Partial<IntakeVerdict> = {}): IntakeVerdict => ({ ...base, ready: false, reason_cs, ...extra });
  if (!x.docs.length) return none("Žádný dokument není nahraný; záznam zůstane bez zpracovaných dokumentů.");
  if (!x.fixture || !x.fixture.files.length)
    return none("Dokumenty jsou nahrané. Server zpracovává jen připravené dokumenty ukázkového pacienta, tento záznam zůstane bez extrakce.");
  const bySha = new Map(x.docs.map((d) => [d.sha256, d]));
  const present = x.fixture.files.filter((f) => bySha.has(f.sha256));
  const missing = x.fixture.files.filter((f) => !bySha.has(f.sha256));
  const extra = { present: present.length, missing_cs: missing.map((f) => f.title_cs || f.file_name) };
  // The fixture's patient is never named in the answer: the person filling in the form may not be entitled to it.
  // Counts and titles of the fixture's other documents only after the identity matches: they describe its patient.
  if (!samePerson(x.patient, x.fixture.patient))
    return none("Jméno nebo rodné číslo v žádosti se neshoduje s dokumenty ukázkového pacienta. Dokumenty se k tomuto záznamu nepřipojí.", { expected: 0 });
  if (x.attachedElsewhere) return none("Ukázkový pacient už v databázi je; nový záznam zůstane bez zpracovaných dokumentů.", extra);
  const fixtureShas = new Set(x.fixture.files.map((f) => f.sha256));
  if (x.docs.some((d) => !d.sha256 || !fixtureShas.has(d.sha256)))
    return none("Mezi nahranými dokumenty je soubor, který k ukázkovému pacientovi nepatří; předem připravená data se nepřipojí.", extra);
  if (missing.length)
    return none(`Chybí ještě ${missing.length} z ${x.fixture.files.length} dokumentů ukázkového pacienta; záznam zůstane bez zpracovaných dokumentů.`, extra);
  const docByUpload = Object.fromEntries(x.fixture.files.map((f) => [f.file_name, bySha.get(f.sha256)!.id]));
  const pages = x.fixture.files.reduce((s, f) => s + (f.page_count ?? 0), 0);
  return { ...base, ...extra, ready: true, docByUpload, reason_cs: `Připojí se předem připravená data ukázkového pacienta: ${docsCs(present.length)} (${pages} s.), hledané podle otisku souborů.` };
}

// The case ID the intake gets: the fixture's own ID (NO-S02, as the embedded demo shows it) when the referral names a
// fixture patient and that ID is free, else the next number. Cosmetic: the attach decides by documents and identity.
export function intakeCaseId(fixtureId: string | null, taken: boolean, next: number) {
  if (fixtureId && !taken) return { id: `NO-${fixtureId}`, file: `${fixtureId}_pacient.pdf` };
  return { id: `NO-${String(next).padStart(3, "0")}`, file: `${next}_novy.pdf` };
}
