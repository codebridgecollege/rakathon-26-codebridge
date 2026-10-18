// The FHIR referral read into the "Nový pacient" form: the same fields as the form expects, nothing
// guessed, and the consent never imported. Synthetic bundle (the demo's built-in sample).
import { describe, expect, it } from "vitest";
import { FORM_FIELD, SID, fhirToForm } from "../src/fhir";
import { DomainError } from "../src/errors";

const bundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    { fullUrl: "urn:uuid:pat-1", resource: { resourceType: "Patient", identifier: [{ system: SID.rc, value: "715309/1236" }], name: [{ family: "Ukázková", given: ["Alena"] }] } },
    { fullUrl: "urn:uuid:vzp-1", resource: { resourceType: "Organization", identifier: [{ system: SID.kp, value: "111" }], name: "Všeobecná zdravotní pojišťovna ČR" } },
    { fullUrl: "urn:uuid:cov-1", resource: { resourceType: "Coverage", payor: [{ reference: "urn:uuid:vzp-1" }] } },
    { fullUrl: "urn:uuid:org-1", resource: { resourceType: "Organization", name: "Nemocnice Havířov, neurologie" } },
    {
      fullUrl: "urn:uuid:role-1",
      resource: {
        resourceType: "PractitionerRole",
        practitioner: { display: "MUDr. Petr Ukázkový" },
        organization: { reference: "urn:uuid:org-1" },
        telecom: [{ system: "email", value: "neurologie@example.org" }, { system: "phone", value: "+420 596 000 000" }],
      },
    },
    {
      fullUrl: "urn:uuid:sr-1",
      resource: {
        resourceType: "ServiceRequest",
        requester: { reference: "urn:uuid:role-1" },
        reasonCode: [{ text: "Indikace k resekci?" }],
        note: [{ text: "Bolesti hlavy." }, { text: "MR mozku 10/2026." }],
      },
    },
  ],
};

describe("fhirToForm", () => {
  it("fills every field the bundle holds, by reference", () => {
    const r = fhirToForm(bundle);
    expect(r.form).toEqual({
      first_name: "Alena",
      last_name: "Ukázková",
      birth_number: "715309/1236",
      insurer: "111",
      owner: "MUDr. Petr Ukázkový",
      dept: "Nemocnice Havířov, neurologie",
      email: "neurologie@example.org",
      phone: "+420 596 000 000",
      anamnesis: "Bolesti hlavy.\nMR mozku 10/2026.",
      question: "Indikace k resekci?",
    });
    expect(r.found).toEqual(["Patient", "Coverage", "ServiceRequest"]);
    expect(r.missing_cs).toEqual([]);
  });

  it("reads a Patient alone and lists what it lacks, in the form's order", () => {
    const r = fhirToForm({ resourceType: "Patient", name: [{ use: "old", family: "Stará" }, { use: "official", family: "Nová", given: ["Eva", "Marie"] }] });
    expect(r.form).toEqual({ first_name: "Eva Marie", last_name: "Nová" });
    expect(r.found).toEqual(["Patient"]);
    expect(r.missing_cs).toEqual(["rodné číslo", "pojišťovna", "lékař", "pracoviště", "e-mail", "telefon", "anamnéza", "otázka pro MDT"]);
  });

  it("takes the birth number only from the national identifier system", () => {
    const r = fhirToForm({ resourceType: "Patient", identifier: [{ system: "urn:other", value: "123" }] });
    expect(r.form.birth_number).toBeUndefined();
  });

  it("never has a consent field to import", () => {
    expect(Object.keys(FORM_FIELD)).not.toContain("consent");
    expect(Object.values(FORM_FIELD)).not.toContain("nfg");
  });

  it("refuses data without a Patient, or that is not an object", () => {
    expect(() => fhirToForm({ resourceType: "Bundle", entry: [] })).toThrow(DomainError);
    try {
      fhirToForm(null);
    } catch (e) {
      expect((e as DomainError).message_cs).toBe("Import se nezdařil: data nejsou objekt FHIR.");
    }
  });

  it("maps the form keys to the form's field names", () => {
    expect(FORM_FIELD).toMatchObject({ first_name: "nf0", last_name: "nf1", birth_number: "nf2", insurer: "nf3", anamnesis: "nfa", question: "nfq" });
  });
});
