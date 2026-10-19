// Patient match against the NIS (issue #22): birth-number forms, the identity comparison, merged and inactive records,
// and name spellings. Nothing here links; it only says what a person may link.
import { describe, expect, it } from "vitest";
import { candidateFrom, compareNames, hasDuplicates, identityCheckOf, normalizeBirthNumber, rcisSearchValue } from "../src/nis";

const RC = "https://ncez.mzcr.cz/fhir/sid/rcis";
const pt = (id: string, rc: string, extra: Record<string, unknown> = {}) => ({
  resourceType: "Patient",
  id,
  meta: { versionId: "2", lastUpdated: "2026-10-01T10:00:00Z" },
  identifier: [{ system: RC, value: rc }],
  name: [{ use: "official", family: "Zkušební", given: ["Jiří"] }],
  birthDate: "1972-09-05",
  ...extra,
});

describe("birth numbers", () => {
  it("accepts the two written forms and nothing else", () => {
    expect(normalizeBirthNumber("720905/3005")).toBe("7209053005");
    expect(normalizeBirthNumber(" 7209053005 ")).toBe("7209053005");
    expect(normalizeBirthNumber("530101/123")).toBe("530101123");
    for (const bad of ["", "72-09-05", "720905/30051", "abc", null, 7209053005]) expect(normalizeBirthNumber(bad)).toBeNull();
  });

  it("searches both stored forms with FHIR's OR", () => {
    expect(rcisSearchValue("7209053005")).toBe(`${RC}|720905/3005,${RC}|7209053005`);
  });
});

describe("candidates", () => {
  const ours = { birth_number: "720905/3005", full_name: "Jiří Zkušební" };

  it("lets a person link a matching active record", () => {
    const c = candidateFrom(pt("a", "720905/3005"), { searched: "7209053005", ours });
    expect(c).toMatchObject({ nis_id: "a", version: "2", identity: "matches", name_match: "same", needs_confirmation: false, linkable: true, reason_cs: null });
    expect(identityCheckOf(c)).toBe("matches");
  });

  it("refuses a record merged into another one and points at the survivor", () => {
    const c = candidateFrom(pt("b", "7209053005", { active: false, link: [{ type: "replaced-by", other: { reference: "Patient/a" } }] }), { searched: "7209053005", ours });
    expect(c).toMatchObject({ replaced_by: "a", linkable: false });
    expect(c.reason_cs).toContain("a");
  });

  it("refuses an inactive record, a conflict and a record without the searched number", () => {
    expect(candidateFrom(pt("x", "720905/3005", { active: false }), { searched: "7209053005", ours }).linkable).toBe(false);
    const conflict = candidateFrom(pt("y", "720905/3005"), { searched: "7209053005", ours: { ...ours, birth_number: "640312/3001" } });
    expect(conflict).toMatchObject({ identity: "conflicts", linkable: false });
    expect(candidateFrom(pt("z", "640312/3001"), { searched: "7209053005", ours }).birth_number_matches).toBe(false);
  });

  it("cannot verify identity when our row has no birth number, but still lets a person decide", () => {
    const c = candidateFrom(pt("a", "720905/3005"), { searched: "7209053005", ours: { birth_number: null, full_name: null } });
    expect(c).toMatchObject({ identity: "cannot_verify", name_match: "cannot_verify", needs_confirmation: true, linkable: true });
    expect(identityCheckOf(c)).toBe("cannot_verify");
  });

  it("asks for confirmation when the birth number matches but the name does not", () => {
    for (const ours2 of [{ ...ours, full_name: "Petr Novák" }, { ...ours, full_name: "Jiri Zkusebni" }]) {
      const c = candidateFrom(pt("a", "720905/3005"), { searched: "7209053005", ours: ours2 });
      expect(c).toMatchObject({ identity: "matches", needs_confirmation: true, linkable: true });
      expect(identityCheckOf(c)).toBe("matches_name_differs");
    }
  });

  it("tells a spelling difference from a different name, and reports duplicates", () => {
    expect(compareNames("Jiri Zkusebni", "Jiří Zkušební")).toBe("spelling");
    expect(compareNames("Zkušební Jiří", "Jiří Zkušební")).toBe("same");
    expect(compareNames("Petr Novák", "Jiří Zkušební")).toBe("different");
    const a = candidateFrom(pt("a", "720905/3005"), { searched: "7209053005", ours });
    const c = candidateFrom(pt("c", "720905/3005"), { searched: "7209053005", ours });
    expect(hasDuplicates([a])).toBe(false);
    expect(hasDuplicates([a, c])).toBe(true);
  });
});
