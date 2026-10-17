import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { duplicateDecision, intakeFixture, validateReferral } from "../../src/domain/intake";
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

  it("creates the S02 intake fixture once", () => {
    expect(intakeFixture("S02", new Set())).toEqual({ case_id: "NO-S02", file: "S02_pacient.pdf" });
    expect(() => intakeFixture("S02", new Set(["NO-S02"]))).toThrow(expect.objectContaining({ code: "fixture_used" }));
    expect(intakeFixture(undefined, new Set())).toBeNull();
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
