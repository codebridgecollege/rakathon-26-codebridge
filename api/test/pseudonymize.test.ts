import { describe, expect, it } from "vitest";
import { detectIdentifiers, fold, nameForms, originalRange, pseudonymize, type CaseIdentity } from "../src/domain/pseudonymize";

// A synthetic patient and the seed's staff surnames (several are ordinary Czech words on purpose).
const ID: CaseIdentity = {
  patientNames: ["Věra Lipenská", "Lipenská Věra"],
  birthNumber: "585614/1234",
  birthDate: "14.6.1958",
  staffNames: ["Novák", "Malá", "Černý", "Jana Veselá"],
};

describe("nameForms", () => {
  it("declines surnames and first names the way Czech documents write them", () => {
    expect(nameForms("Lipenská")).toEqual(expect.arrayContaining(["lipenska", "lipenske", "lipenskou"]));
    expect(nameForms("Věra")).toEqual(expect.arrayContaining(["vera", "very", "vere", "veru", "verou"]));
    expect(nameForms("Poláček")).toEqual(expect.arrayContaining(["polacek", "polacka", "polackovi", "polackem"]));
    expect(nameForms("Novák")).toEqual(expect.arrayContaining(["novak", "novaka", "novakovi", "novakova"]));
    expect(nameForms("Černý")).toEqual(expect.arrayContaining(["cerny", "cerneho", "cernemu", "cernym"]));
    expect(nameForms("Jitka")).toEqual(expect.arrayContaining(["jitka", "jitce"]));
  });

  it("folds without moving offsets", () => {
    const s = "Řeřicha ŽLUŤOUČKÝ kůň";
    expect(fold(s)).toBe("rericha zlutoucky kun");
    expect(fold(s)).toHaveLength(s.length);
  });
});

describe("pseudonymize", () => {
  it("replaces the patient's name in any case and declension, the birth number and the birth date", () => {
    const text = "Pacientka Lipenská Věra, nar. 14.6.1958, r.č. 585614/1234.\nPaní Lipenské bylo doporučeno, s VĚROU LIPENSKOU probráno. Narozena 14. 06. 1958.";
    const p = pseudonymize(text, ID);
    for (const s of ["Lipensk", "Věr", "VĚR", "LIPENSK", "585614", "1958"]) expect(p.text).not.toContain(s);
    expect(p.text).toContain("[PACIENT]");
    expect(p.text).toContain("[RC]");
    expect(p.text).toContain("[DATUM_NAROZENI]");
    expect(p.counts.patient_name).toBe(5);
    expect(detectIdentifiers(p.text, ID)).toEqual([]);
  });

  it("matches OCR text without diacritics", () => {
    expect(pseudonymize("LIPENSKA VERA, rc 5856141234", ID).text).toBe("[PACIENT] [PACIENT], rc [RC]");
  });

  it("replaces staff names only when capitalized, a staff full name in any case, and any name after a title", () => {
    const text = "Konzultováno s MUDr. Novákem a s Malou. Malá pánev bez patologie, v oblasti malé pánve klid. " +
      "Kontrola u jana veselá. Černé stolice neguje. Vidi MUDr. Hofrová, mudr. kratochvílová, Doc. MUDr. Jan Rak CT hrudníku. DRENÁŽ bez sekrece.";
    const p = pseudonymize(text, ID);
    expect(p.text).toContain("MUDr. [PERSONAL_1]");
    expect(p.text).toContain("s [PERSONAL_2]");
    // Capitalized at the start of a sentence, "Malá" is taken for the staff name: the documented cost of the rule.
    expect(p.text).toContain("[PERSONAL_2] pánev");
    expect(p.text).toContain("malé pánve klid");
    expect(p.text).toContain("u [PERSONAL_4] [PERSONAL_4]");
    expect(p.text).toContain("Černé stolice neguje"); // "Černé" is not a form of "Černý"
    expect(p.text).toContain("MUDr. [LEKAR_1], mudr. [LEKAR_2]");
    expect(p.text).toContain("[LEKAR_3] CT hrudníku");
    expect(p.text).toContain("DRENÁŽ bez sekrece");
    expect(p.mapping.get("[PERSONAL_1]")).toEqual(["Novákem"]);
  });

  it("replaces phone, e-mail and address fields", () => {
    const text = "Bydliště: Ostravská 12, 700 30 Ostrava\nTel.: +420 596 123 456\nkontakt vera@example.cz\nCRP 12 mg/l";
    const p = pseudonymize(text, ID);
    expect(p.text).toBe("Bydliště: [ADRESA]\nTel.: [TELEFON]\nkontakt [EMAIL]\nCRP 12 mg/l");
  });

  it("leaves medical text without identifiers unchanged", () => {
    const text = "Adenokarcinom rekta, G2, pMMR. CT hrudníku 17.3.2026: bez známek vzdálených metastáz. Hb 108 g/l dne 10.3.2026.";
    expect(pseudonymize(text, ID).text).toBe(text);
  });

  it("maps a range in the pseudonymized text back to the original", () => {
    const text = "Paní Lipenská má CRP 12 mg/l.";
    const p = pseudonymize(text, ID);
    const q = "[PACIENT] má CRP 12";
    const at = p.text.indexOf(q);
    const [s, e] = originalRange(p, at, at + q.length);
    expect(text.slice(s, e)).toBe("Lipenská má CRP 12");
  });
});
