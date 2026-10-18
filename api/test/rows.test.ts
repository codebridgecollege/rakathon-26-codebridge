import { describe, expect, it } from "vitest";
import { patientRow, staffName, type CaseJoinRow } from "../src/domain/rows";
import { canReadCaseHeader, canReadClinical, clinicalAccessOf, redactsListFor, type Viewer } from "@codebridge/domain/access";

const base: CaseJoinRow = {
  id: "NO-A", source_file: "A_pacient.pdf", status: "new", processing_level: "partial", question_text: null, question_explicit: 0,
  question_purpose: "Účel", question_draft: null, question_kind: null, question_basis_json: '[{"quote":"q"}]', diagnosis_text: "Dg",
  diagnosis_note: null, mkn10: "C64", summary_one_line: "S", page_count: 2, referrer_name: null, referring_dept: "X",
  referring_dept_is_example: 1, owner_name: "MUDr. Svobodová", owner_is_example: 1, submitted_on: "2026-10-14", submitted_is_example: 1,
  updated_on: "2026-10-15", full_name: "Testová Pacientka", name_as_written: null, birth_number: null, birth_as_written: null,
  age_as_written: null, identity_warning: null, name_note_cs: null, name_note_source_json: null, data_origin: "fno_challenge",
  slot_day: null, slot_time: null,
};
const v = (role: Viewer["role"]): Viewer => ({ id: "x", name: "x", role, dept: null, authMode: "demo", impersonating: false, org: "demo-a", membershipId: "x" });

describe("patientRow", () => {
  it("maps a case without a slot, not fully processed", () => {
    const r = patientRow(base);
    expect(r.slot).toBeNull();
    expect(r.full).toBe(false);
    expect(r.basis).toEqual([{ quote: "q" }]);
    expect(r.deptExample).toBe(true);
  });

  it("marks only processing_level full as full and joins the slot", () => {
    const r = patientRow({ ...base, processing_level: "full", slot_day: "2026-10-22", slot_time: "14:00" });
    expect(r.full).toBe(true);
    expect(r.slot).toEqual({ day: "2026-10-22", time: "14:00" });
  });

  it("hides clinical fields from the administrator in the strict mode and keeps identity", () => {
    const r = patientRow(base, [], true);
    expect(r).toMatchObject({ name: "Testová Pacientka", status: "new", diagnosis: null, mkn10: null, summary: null, basis: null, redacted_for_role: "admin" });
  });
});

describe("access rules", () => {
  it("lets every role read clinical content in the default demo mode, doctors only as members", () => {
    const m = clinicalAccessOf("all_roles");
    expect(canReadClinical(v("doctor"), false, m)).toBe("not_member");
    expect(canReadClinical(v("doctor"), true, m)).toBe("ok");
    expect(canReadClinical(v("coordinator"), false, m)).toBe("ok");
    expect(canReadClinical(v("admin"), false, m)).toBe("ok");
    expect(redactsListFor(v("admin"), m)).toBe(false);
  });

  it("applies INTEGRATION.md's rule in doctors_only mode, and an unknown value is strict", () => {
    for (const m of [clinicalAccessOf("doctors_only"), clinicalAccessOf("typo")]) {
      expect(canReadClinical(v("coordinator"), false, m)).toBe("role_forbidden");
      expect(canReadCaseHeader(v("coordinator"), false, m)).toBe("ok");
      expect(canReadCaseHeader(v("admin"), false, m)).toBe("role_forbidden");
      expect(redactsListFor(v("admin"), m)).toBe(true);
    }
  });

  it("formats staff names with title and degree", () => {
    expect(staffName({ pre: "MUDr.", sur: "Malá", post: "Ph.D." })).toBe("MUDr. Malá, Ph.D.");
    expect(staffName({ pre: "", sur: "Malá", post: "" })).toBe("Malá");
  });
});
