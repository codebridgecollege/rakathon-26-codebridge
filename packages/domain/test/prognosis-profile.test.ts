// The prognosis profile builder (prognosis-profile.ts): date precision, scrubbing, the cutoff rules and a real case.
import { describe, expect, it } from "vitest";
import { fromExtraction, unprocessedCase, type CaseData } from "../src/case-data";
import { buildProfile, cleanText, dateEnd, type Profile, type ProfileProblem } from "../src/prognosis-profile";
import type { ExtractionRun } from "../src/extraction/types";

import run10 from "../../../fixtures/data/runs/NO-010.json";

// A minimal processed case: only the parts the profile reads.
const caseWith = (timeline: object[], extra: Partial<NonNullable<CaseData["record"]>> = {}): CaseData => ({
  ...unprocessedCase("x.pdf", "X"),
  level: "partial",
  record: { onco_compact: null, onco_detailed: [], status_praesens: null, timeline, timeline_source: [], anamnesis: null, sections: null, patient: {}, diagnosis: null, mdt_question: {}, ocr_quality_note: null, ...extra } as unknown as NonNullable<CaseData["record"]>,
});
const ev = (date: string | null, text: string, quote = text) => ({ title_cs: "Událost", text_cs: text, date, category: "clinical", status: "done", source: { page: 2, quote } });
const build = (cd: CaseData, day = "2026-10-22", forbidden: string[] = []) => buildProfile(cd, day, { forbidden, synthetic: true });
const ok = (r: Profile | ProfileProblem): Profile => {
  if (!("available" in r)) throw new Error(`expected a profile, got ${r.code}`);
  return r;
};

describe("dateEnd", () => {
  it("keeps the upper bound of the original precision", () => {
    expect(dateEnd("9/23")).toBe("2023-09-30");
    expect(dateEnd("2026-02")).toBe("2026-02-28");
    expect(dateEnd("2026-02-10")).toBe("2026-02-10");
    expect(dateEnd("2026")).toBe("2026-12-31");
    expect(dateEnd("2.6.2022")).toBe("2022-06-02");
    expect(dateEnd("11/2023")).toBe("2023-11-30");
  });
  it("takes the latest end of a range and needs every boundary", () => {
    expect(dateEnd("11/2023 až 6/2025")).toBe("2025-06-30");
    expect(dateEnd("1.1.2023 do 29.12.2025")).toBe("2025-12-29");
    expect(dateEnd("1.1.2023 – 5.5.2024")).toBe("2024-05-05");
    expect(dateEnd("11/2023 až nejasné")).toBeNull();
  });
  it("rejects impossible and unreadable dates", () => {
    expect(dateEnd("31.2.2026")).toBeNull();
    expect(dateEnd("13/2026")).toBeNull();
    expect(dateEnd("")).toBeNull();
    expect(dateEnd(null)).toBeNull();
  });
});

describe("cleanText", () => {
  it("scrubs names, birth numbers, authors and e-mail addresses", () => {
    const t = cleanText("Daniel Poláček, RČ 800101/1234, vyšetřil MUDr. Jan Novák, kontakt jan.novak@fno.cz", ["Daniel Poláček"]);
    expect(t).not.toMatch(/Poláček|Daniel|800101|Novák|@/);
    expect(t).toContain("[odstraněné RČ]");
  });
  it("scrubs a surname alone, case-insensitively", () => {
    expect(cleanText("pacient POLÁČEK přišel", ["Daniel Poláček"])).not.toMatch(/poláček/i);
  });
  it("caps the length", () => expect(cleanText("a".repeat(5000)).length).toBe(4000));
});

describe("buildProfile", () => {
  it("returns not_processed for a case with no record and no labs", () => {
    expect(buildProfile(unprocessedCase("x.pdf", "X"), "2026-10-22", { synthetic: true })).toMatchObject({ code: "not_processed" });
    expect(buildProfile(null, "2026-10-22", { synthetic: true })).toMatchObject({ code: "not_processed" });
  });
  it("rejects a bad scheduled date", () => {
    expect(build(caseWith([ev("1.1.2022", "a")]), "22.10.2026")).toMatchObject({ code: "invalid_date" });
    expect(build(caseWith([ev("1.1.2022", "a")]), "2026-02-31")).toMatchObject({ code: "invalid_date" });
  });
  it("excludes undated and future facts and counts them", () => {
    const p = ok(build(caseWith([ev("1.1.2022", "stará"), ev(null, "bez data"), ev("11/2026", "budoucí měsíc"), ev("10/2026", "tento měsíc, ještě neskončil")])));
    expect(p.facts.map((f) => f.text)).toEqual(["Událost: stará"]);
    expect(p.excluded_undated).toBe(1);
    expect(p.excluded_after_cutoff).toBe(2);
    expect(p.warnings[0]).toBe("Vynecháno 1 nedatovaných a 2 údajů přesahujících datum MDT.");
  });
  it("excludes a fact whose text or quote holds a later explicit date", () => {
    const p = ok(build(caseWith([ev("1.1.2023", "léčba", "Zahájeno 1.1.2023; progrese 3.9.2027"), ev("1.1.2023", "do 12/2027"), ev("1.1.2023", "ok")])));
    expect(p.facts.map((f) => f.text)).toEqual(["Událost: ok"]);
    expect(p.excluded_after_cutoff).toBe(2);
  });
  it("keeps partial dates as written and marks planned events", () => {
    const p = ok(build(caseWith([{ ...ev("3/2024", "plán"), status: "planned" }])));
    expect(p.facts[0]).toMatchObject({ date: "3/2024", status: "planned", kind: "clinical", source: { page: 2 } });
  });
  it("de-duplicates by text and date", () => {
    const p = ok(build(caseWith([ev("1.1.2022", "a"), ev("1.1.2022", "a"), ev("2.1.2022", "a")])));
    expect(p.included_count).toBe(2);
  });
  it("scrubs the forbidden names in facts and quotes", () => {
    const p = ok(build(caseWith([ev("1.1.2022", "Pan Poláček má bolest", "Pan Poláček: bolest")]), "2026-10-22", ["Poláček"]));
    expect(JSON.stringify(p)).not.toContain("Poláček");
  });
  it("dates an anamnesis item only by its own date", () => {
    const p = ok(build(caseWith([ev("1.1.2022", "a")], { anamnesis: { OA: [{ term_cs: "Hypertenze", comment_cs: "" }, { term_cs: "Diabetes", comment_cs: "typ 2", date: "2019" }], FA: [], AA: [] } })));
    expect(p.facts.map((f) => f.text)).toContain("Diabetes: typ 2");
    expect(p.facts.map((f) => f.text)).not.toContain("Hypertenze");
    expect(p.excluded_undated).toBe(1);
  });
  it("returns empty_profile when nothing survives", () => {
    expect(build(caseWith([ev(null, "a"), ev("1.1.2030", "b")]))).toMatchObject({ code: "empty_profile" });
  });
});

describe("a real case: NO-010", () => {
  const cd = fromExtraction("10_pacient.pdf", "NO-010", JSON.parse(JSON.stringify(run10)) as ExtractionRun, null);
  it("gives dated facts with no identity and nothing after the cutoff", () => {
    const p = ok(buildProfile(cd, "2026-10-22", { forbidden: ["Daniel Poláček", "Poláček Daniel"], synthetic: true }));
    expect(p.facts.length).toBeGreaterThan(5);
    const all = JSON.stringify(p);
    expect(all).not.toMatch(/Poláček|Daniel/);
    for (const f of p.facts) expect(dateEnd(f.date)! <= "2026-10-22").toBe(true);
    expect(p.excluded_undated).toBeGreaterThan(0);
  });
  it("leaves out events after an earlier MDT day", () => {
    const p = ok(buildProfile(cd, "2023-04-01", { synthetic: true }));
    for (const f of p.facts) expect(dateEnd(f.date)! <= "2023-04-01").toBe(true);
    expect(p.excluded_after_cutoff).toBeGreaterThan(0);
  });
});

describe("the scrub", () => {
  const scrub = (t: string, names = ["Poláček Daniel"]) => cleanText(t, names);
  it("catches the case endings of a surname, with or without diacritics", () => {
    for (const form of ["Poláček", "Poláčka", "Poláčkovi", "Poláčkem", "POLÁČEK", "Polacek", "Polacka"]) expect(scrub(`Pacient ${form} přišel.`)).not.toMatch(/pol[aá][cč]/i);
  });
  it("catches a short first name as a whole word, but not inside another word", () => {
    expect(scrub("Daniel a Jan přišli.", ["Novák Jan"])).not.toContain("Jan");
    expect(scrub("Januvia 100 mg.", ["Novák Jan"])).toContain("Januvia");
    expect(scrub("Eva přišla.", ["Eva Kos"])).not.toContain("Eva");
  });
  it("does not eat ordinary words that share a few letters with a short surname", () => {
    expect(scrub("Nová léze v játrech.", ["Novák Petr"])).toContain("Nová léze");
  });
  it("catches each part of a hyphenated surname", () => {
    const t = scrub("Novák a Svobodová přišli.", ["Novák-Svobodová Jana"]);
    expect(t).not.toContain("Novák");
    expect(t).not.toContain("Svobodová");
  });
  it("scrubs a birth number written without the slash, a stated birth date, more titles and a phone number", () => {
    expect(scrub("RČ 7360285163.")).toContain("[odstraněné RČ]");
    expect(scrub("Narozen 28.2.1973, nyní 63 let.")).toContain("[odstraněné datum narození]");
    expect(scrub("Narozen 28.2.1973, nyní 63 let.")).toContain("63 let");
    expect(scrub("CT provedeno 12.3.2023.")).toContain("12.3.2023");
    expect(scrub("Vyšetřil prof. Karel Dvořák, tel. 777 123 456.")).not.toMatch(/Karel|Dvořák|777/);
    expect(scrub("Vyšetřil doc. Karel Dvořák.")).not.toContain("Dvořák");
  });
});
