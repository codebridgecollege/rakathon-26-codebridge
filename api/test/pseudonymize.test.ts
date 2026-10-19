import { describe, expect, it } from "vitest";
import { birthDateFromNumber, detectIdentifiers, fold, nameForms, pseudonymize, type CaseIdentity } from "../src/domain/pseudonymize";

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
  it("replaces the patient's name in its declensions and in capitals, the birth number and the birth date", () => {
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
    expect(p.originals("[PERSONAL_1]")).toEqual(["Novákem"]);
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
    const [s, e] = p.originalRange(at, at + q.length);
    expect(text.slice(s, e)).toBe("Lipenská má CRP 12");
  });

  it("splits a double surname, as the text splits words at the hyphen", () => {
    const id = { ...ID, patientNames: ["Jana Nováková-Svobodová"] };
    expect(pseudonymize("Paní Nováková-Svobodová, NOVÁKOVÁ-SVOBODOVÁ Jana", id).text).toBe("Paní [PACIENT]-[PACIENT], [PACIENT]-[PACIENT] [PACIENT]");
  });

  it("keeps a lone lower-case name part that is an ordinary word, and replaces it next to another name part", () => {
    const id = { ...ID, patientNames: ["Jan Hlava"] };
    expect(pseudonymize("CT hlavy bez ložisek, bolest hlavy. Pan Hlava, kontrola jan hlava. Dle hlavy Hlava.", id).text).toBe(
      "CT hlavy bez ložisek, bolest hlavy. Pan [PACIENT], kontrola [PACIENT] [PACIENT]. Dle hlavy [PACIENT].",
    );
  });

  it("does not take lab rows for phone numbers, and finds labelled ones", () => {
    const text = "Na 138 140 137 mmol/l\nNa\n138\n140\n137\nPLT 250 000 000\nmobil 603 123 456, tel. č. 596123456";
    expect(pseudonymize(text, ID).text).toBe("Na 138 140 137 mmol/l\nNa\n138\n140\n137\nPLT 250 000 000\nmobil [TELEFON], tel. č. [TELEFON]");
  });

  it("does not take medical abbreviations or the next line for a name after a title", () => {
    const text = "BC ER+ PR+. Dr Ca mammae. Vyšetřil MUDr.\nDiagnóza: C50.4\nIng. Kovář";
    expect(pseudonymize(text, { ...ID, staffNames: [] }).text).toBe("BC ER+ PR+. Dr Ca mammae. Vyšetřil MUDr.\nDiagnóza: C50.4\nIng. [LEKAR_1]");
  });

  it("finds another patient's birth number without a slash, a slashed birth date and a name after Pacient:", () => {
    // 7103154421 is a valid birth number (divisible by 11, month 03, day 15); 6001011234 is not divisible by 11.
    expect(pseudonymize("RČ 7103154421, žádanka 6001011234", ID).text).toBe("RČ [RC], žádanka 6001011234");
    expect(pseudonymize("nar. 14/06/58", ID).text).toBe("nar. [DATUM_NAROZENI]");
    expect(pseudonymize("Pacient: Kratochvíl Petr, 63 let", ID).text).toBe("Pacient: [JMENO] [JMENO], 63 let");
  });

  it("derives the birth date from the birth number when the record has none", () => {
    expect(birthDateFromNumber("585614/1234")).toBe("14.6.1958");
    expect(birthDateFromNumber("455101/123")).toBe("1.1.1945");
    const id = { ...ID, birthDate: null };
    expect(pseudonymize("datum 14.6.1958 a 14.06.58", id).text).toBe("datum [DATUM_NAROZENI] a [DATUM_NAROZENI]");
  });

  it("numbers titled names across the parts of one call when they share the numbering", () => {
    const titled = new Map<string, number>();
    const a = pseudonymize("MUDr. Hofrová", ID, titled).text;
    const b = pseudonymize("MUDr. Walach, MUDr. Hofrová", ID, titled).text;
    expect([a, b]).toEqual(["MUDr. [LEKAR_1]", "MUDr. [LEKAR_2], MUDr. [LEKAR_1]"]);
  });

  it("keeps the mapping out of a structured clone and JSON", () => {
    const p = pseudonymize("Paní Lipenská", ID);
    const cloned = structuredClone(p) as unknown as Record<string, unknown>;
    expect(JSON.stringify(cloned)).not.toContain("Lipensk");
    expect(JSON.stringify(p)).not.toContain("Lipensk");
    expect(p.originals("[PACIENT]")).toEqual(["Lipenská"]);
  });
});
