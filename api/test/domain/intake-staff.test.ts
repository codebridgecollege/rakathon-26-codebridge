import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { duplicateDecision, evaluateIntake, intakeCaseId, intakeFixtureOf, samePerson, validateReferral, type IntakeInput } from "../../src/domain/intake";
import { fhirToForm } from "../../src/domain/fhir";
import { compareIdentity } from "../../src/domain/documents";
import { DEFAULT_STAFF, nameTaken, removePerson, renamePerson, validateDeptName, validatePerson, type StaffUser } from "../../src/domain/staff";

const form = { first_name: "Jana", last_name: "Testová", birth_number: "645312/1234", consent: true };

describe("new referral", () => {
  it("returns the form's messages per field", () => {
    expect(() => validateReferral({})).toThrow(
      expect.objectContaining({
        code: "invalid_input",
        extra: { fields: { first_name: "Vyplňte jméno.", last_name: "Vyplňte příjmení.", birth_number: "Vyplňte rodné číslo.", consent: "Bez souhlasu se zpracováním údajů nelze žádost odeslat." } },
      }),
    );
    expect(() => validateReferral({ ...form, birth_number: "12345" })).toThrow(expect.objectContaining({ extra: { fields: { birth_number: "Rodné číslo zadejte ve tvaru 123456/7890." } } }));
    expect(validateReferral(form).birth_number).toBe("645312/1234");
  });

  it("finds a duplicate with or without the slash and needs an override with a reason for this number", () => {
    const existing = [{ case_id: "NO-A", file: "A_pacient.pdf" }];
    expect(duplicateDecision("6453121234", [], undefined)).toBeNull();
    expect(() => duplicateDecision("6453121234", existing, undefined)).toThrow(expect.objectContaining({ code: "duplicate_birth_number", extra: { current: { case_id: "NO-A", file: "A_pacient.pdf" } } }));
    expect(() => duplicateDecision("645312/1234", existing, { birth_number: "6453121234", reason: "krátce" })).toThrow(expect.objectContaining({ code: "override_reason_required" }));
    expect(() => duplicateDecision("645312/1234", existing, { birth_number: "6453121235", reason: "jiný pacient, ověřeno v registru" })).toThrow(expect.objectContaining({ code: "duplicate_birth_number" }));
    expect(duplicateDecision("645312/1234", existing, { birth_number: "6453121234", reason: "jiný pacient, ověřeno v registru" })).toBe("jiný pacient, ověřeno v registru");
  });

});
describe("staff", () => {
  const u = (id: string, pre: string, sur: string, role = "doctor", active = 1): StaffUser => ({ id, pre, sur, post: "", fn: "", role, active });
  const users = [u("d1p1", "MUDr.", "Novák"), u("admin", "Ing.", "Kovář", "admin"), u("old", "MUDr.", "Bývalý", "doctor", 0)];

  it("keeps names unique, the administrator included, inactive people not", () => {
    expect(nameTaken("Ing. Kovář", users)).toBe(true);
    expect(nameTaken("mudr. novák", users)).toBe(true);
    expect(nameTaken("MUDr. Bývalý", users)).toBe(false);
    expect(() => validatePerson({ pre: "Ing.", sur: "Kovář", role: "staff" }, users)).toThrow(expect.objectContaining({ code: "staff_name_taken" }));
  });

  it("needs an explicit role and a surname", () => {
    expect(() => validatePerson({ pre: "MUDr.", sur: "Nový" }, users)).toThrow(expect.objectContaining({ code: "invalid_input" }));
    expect(validatePerson({ pre: "MUDr.", sur: "Nový", role: "doctor" }, users).role).toBe("doctor");
    expect(() => renamePerson(users[0]!, "sur", "", "Novák", users)).toThrow(expect.objectContaining({ code: "surname_required" }));
    expect(() => renamePerson(users[0]!, "sur", "Nováček", "Jiný", users)).toThrow(expect.objectContaining({ code: "staff_changed" }));
  });

  it("refuses removing oneself or a role holder, and a duplicate department", () => {
    expect(() => removePerson(users[0]!, "d1p1")).toThrow(expect.objectContaining({ code: "cannot_remove_self" }));
    expect(() => removePerson(users[1]!, "coord")).toThrow(expect.objectContaining({ code: "role_forbidden" }));
    expect(() => validateDeptName("neurochirurgie", [{ name: "Neurochirurgie" }])).toThrow(expect.objectContaining({ code: "dept_name_taken" }));
  });

  it("has the same default staff as the page's defaultStaff()", () => {
    const html = env.TEST_PAGE_DEFAULT_STAFF;
    expect(html).toContain("function defaultStaff()");
    for (const d of DEFAULT_STAFF) {
      expect(html).toContain(`["${d.name}", [${d.people.map((p) => `"${p.sur}"`).join(", ")}]]`);
    }
  });
});

describe("intake on the server (step 6)", () => {
  const files = [1, 2, 3].map((i) => ({ sha256: `s${i}`, file_name: `0${i}-x.pdf`, title_cs: `Dokument ${i}`, page_count: i }));
  const fx = { id: "S02", files, patient: { full_name: "Věra Lipenská", birth_number: "585614/4019" } };
  const docs = files.map((f, i) => ({ id: `up-${i}`, sha256: f.sha256, fixture_id: "S02", file_name: `kopie-${i}.pdf` }));
  const input = (o: Partial<IntakeInput> = {}): IntakeInput => ({ docs, fixture: fx, patient: { full_name: "Lipenská Věra", birth_number: "5856144019" }, attachedElsewhere: false, ...o });

  it("attaches when every document matches by hash and name and birth number match, in either order and renamed", () => {
    const v = evaluateIntake(input());
    expect(v).toMatchObject({ ready: true, fixture_id: "S02", expected: 3, present: 3, missing_cs: [] });
    expect(v.docByUpload).toEqual({ "01-x.pdf": "up-0", "02-x.pdf": "up-1", "03-x.pdf": "up-2" });
    expect(v.reason_cs).toBe("Připojí se předem připravená data ukázkového pacienta: 3 dokumenty (6 s.), hledané podle otisku souborů.");
  });

  it("refuses a different name or birth number without naming the fixture's patient", () => {
    for (const patient of [{ full_name: "Věra Lipenská-Nová", birth_number: "585614/4019" }, { full_name: "Věra Lipenská", birth_number: "585614/4018" }, { full_name: "Vera Lipenska", birth_number: "585614/4019" }]) {
      const v = evaluateIntake(input({ patient }));
      expect(v.ready).toBe(false);
      expect(v.reason_cs).toMatch(/^Jméno nebo rodné číslo v žádosti se neshoduje/);
      expect(v.reason_cs).not.toMatch(/Lipensk|585614/);
    }
  });

  it("does not attach a partial upload, a foreign file, a second intake or no documents", () => {
    expect(evaluateIntake(input({ docs: docs.slice(0, 2) }))).toMatchObject({ ready: false, present: 2, missing_cs: ["Dokument 3"], reason_cs: "Chybí ještě 1 z 3 dokumentů ukázkového pacienta; záznam zůstane bez zpracovaných dokumentů." });
    expect(evaluateIntake(input({ docs: [...docs, { id: "up-9", sha256: "other", fixture_id: null, file_name: "x.pdf" }] })).reason_cs).toMatch(/nepatří/);
    expect(evaluateIntake(input({ attachedElsewhere: true })).reason_cs).toMatch(/už v databázi je/);
    expect(evaluateIntake(input({ docs: [] })).ready).toBe(false);
    expect(evaluateIntake(input({ fixture: null })).reason_cs).toMatch(/zůstane bez extrakce/);
  });

  it("picks the fixture most uploads came from and the case ID", () => {
    expect(intakeFixtureOf([...docs, { id: "x", sha256: "y", fixture_id: "S01", file_name: "y" }])).toBe("S02");
    expect(intakeFixtureOf([])).toBeNull();
    expect(intakeCaseId("S02", false, 101)).toEqual({ id: "NO-S02", file: "S02_pacient.pdf" });
    expect(intakeCaseId("S02", true, 101)).toEqual({ id: "NO-101", file: "101_novy.pdf" });
    expect(samePerson({ full_name: "A B", birth_number: null }, { full_name: "A B", birth_number: null })).toBe(false);
  });

  it("compares a fixture's patient with the case's patient for the wrong-patient alert", () => {
    const p = { full_name: "Věra Lipenská", name_as_written: "Lipenská Věra", birth_number: "585614/4019" };
    expect(compareIdentity({ full_name: "Lipenská Věra", birth_number: "5856144019" }, p)).toBe("matches");
    expect(compareIdentity({ full_name: "Věra Lipenská", birth_number: "585614/4018" }, p)).toBe("conflicts");
    expect(compareIdentity({ full_name: "Radovan Křemínek", birth_number: null }, p)).toBe("conflicts");
    expect(compareIdentity({ full_name: "Věra Lipenská", birth_number: null }, { full_name: "Věra Lipenská", birth_number: null })).toBe("matches");
    expect(compareIdentity({ full_name: "", birth_number: null }, p)).toBe("cannot_verify");
  });

  it("reads the FHIR referral as the page does", () => {
    const b = { resourceType: "Bundle", entry: [
      { fullUrl: "urn:p", resource: { resourceType: "Patient", identifier: [{ system: "https://ncez.mzcr.cz/fhir/sid/rcis", value: "585614/4019" }], name: [{ use: "official", family: "Lipenská", given: ["Věra"] }] } },
      { fullUrl: "urn:o", resource: { resourceType: "Organization", identifier: [{ system: "https://ncez.mzcr.cz/fhir/sid/kp", value: "111" }] } },
      { fullUrl: "urn:c", resource: { resourceType: "Coverage", payor: [{ reference: "urn:o" }] } },
      { fullUrl: "urn:r", resource: { resourceType: "PractitionerRole", practitioner: { display: "MUDr. X" }, organization: { display: "Chirurgie" }, telecom: [{ system: "email", value: "a@b.cz" }] } },
      { fullUrl: "urn:s", resource: { resourceType: "ServiceRequest", requester: { reference: "urn:r" }, reasonCode: [{ text: "Adjuvance?" }], note: [{ text: "Anamnéza." }] } },
    ] };
    const r = fhirToForm(b);
    expect(r.form).toEqual({ first_name: "Věra", last_name: "Lipenská", birth_number: "585614/4019", insurer: "111", owner: "MUDr. X", dept: "Chirurgie", email: "a@b.cz", anamnesis: "Anamnéza.", question: "Adjuvance?" });
    expect(r.found).toEqual(["Patient", "Coverage", "ServiceRequest"]);
    expect(r.missing_cs).toEqual(["telefon"]);
    expect(() => fhirToForm({ resourceType: "Bundle", entry: [] })).toThrow(expect.objectContaining({ code: "fhir_invalid", message_cs: "Import se nezdařil: V datech chybí Patient." }));
  });
});
