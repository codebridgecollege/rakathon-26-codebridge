// The referral form's checks (the browser's copy of validateReferral) and the duplicate birth number lookup.
import { describe, expect, it } from "vitest";
import { RC_RE, duplicateOf, normalizeRc, referralProblems } from "../src/referral";
import { surnameFirst } from "../src/names";

describe("referralProblems", () => {
  it("names every missing required field in the form's order", () => {
    expect(referralProblems({ first_name: " ", last_name: "", birth_number: "", consent: false })).toEqual([
      ["first_name", "missing"],
      ["last_name", "missing"],
      ["birth_number", "missing"],
      ["consent", "missing"],
    ]);
  });

  it("checks the birth number's format only, with or without the slash", () => {
    const ok = { first_name: "A", last_name: "B", consent: true };
    expect(referralProblems({ ...ok, birth_number: "12345" })).toEqual([["birth_number", "format"]]);
    expect(referralProblems({ ...ok, birth_number: " 585614/4019 " })).toEqual([]);
    expect(referralProblems({ ...ok, birth_number: "5856144019" })).toEqual([]);
    expect(referralProblems({ ...ok, birth_number: "585614/401" })).toEqual([]);
    expect(RC_RE.test("585614//4019")).toBe(false);
  });
});

describe("duplicateOf", () => {
  const rows = [{ rc: null, id: "a" }, { rc: "585614/4019", id: "b" }];
  it("finds the same number with or without the slash", () => {
    expect(duplicateOf("5856144019", rows)?.id).toBe("b");
    expect(duplicateOf("585614/4019", rows)?.id).toBe("b");
    expect(normalizeRc("585614/4019")).toBe("5856144019");
  });
  it("finds nothing for an empty or unknown number", () => {
    expect(duplicateOf("", rows)).toBeUndefined();
    expect(duplicateOf("111111/1111", rows)).toBeUndefined();
  });
});

describe("surnameFirst", () => {
  it("puts the surname first unless the documents' spelling is known", () => {
    expect(surnameFirst({ name: "Věra Lipenská" })).toBe("Lipenská Věra");
    expect(surnameFirst({ name: "Jan Karel Novák" })).toBe("Novák Jan Karel");
    expect(surnameFirst({ name: "Novák" })).toBe("Novák");
    expect(surnameFirst({ name: "Věra Lipenská", nameAsWritten: "LIPENSKÁ Věra" })).toBe("LIPENSKÁ Věra");
  });
});
