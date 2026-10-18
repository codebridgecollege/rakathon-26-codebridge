import { describe, expect, it } from "vitest";
import { dueFrom, suggestTasks } from "../src/suggest";

// CLAUDE.md "a negated finding read as positive", "wrong or outdated date", partial dates stay partial.
describe("task drafts from an approved conclusion", () => {
  it("drafts nothing from a negated clause", () => {
    expect(suggestTasks("Radioterapie není indikována.", "2026-10-22")).toEqual([]);
    expect(suggestTasks("Bez nutnosti doplnit vyšetření.", "2026-10-22")).toEqual([]);
    expect(suggestTasks("Stereotaktická radioterapie se nedoporučuje.", "2026-10-22")).toEqual([]);
  });

  it("does not read nefrektomie or neurochirurg as a negation", () => {
    expect(suggestTasks("Po nefrektomii kontrolní CT za 3 měsíce", "2026-10-22")).toHaveLength(1);
    expect(suggestTasks("Odeslat k neurochirurgovi", "2026-10-22")[0]?.text).toBe("Zajistit odeslání: Odeslat k neurochirurgovi");
  });

  it("counts a single interval from the approval day, months by calendar month", () => {
    expect(dueFrom("kontrolní MR za 3 měsíce", "2026-10-22")).toMatchObject({ due: "2027-01-22", dueSrc: "computed" });
    expect(dueFrom("kontrola za 1 měsíc", "2027-01-31")).toMatchObject({ due: "2027-02-28", dueSrc: "computed" });
    expect(dueFrom("kontrola za 2 týdny", "2026-10-22")).toMatchObject({ due: "2026-11-05" });
    expect(dueFrom("kontrola za 10 dní", "2026-10-22")).toMatchObject({ due: "2026-11-01" });
  });

  it("gives no date for a range, a month, a year or a date, and keeps the wording", () => {
    expect(dueFrom("kontrolní MR za 2-3 měsíce", "2026-10-22")).toEqual({ due: "", dueSrc: "none", timing: "za 2-3 měsíce" });
    expect(dueFrom("kontrolní MR 1/2027", "2026-10-22")).toMatchObject({ due: "", dueSrc: "none", timing: "1/2027" });
    expect(dueFrom("kontrolní MR v lednu 2027", "2026-10-22")).toMatchObject({ due: "", dueSrc: "none" });
    expect(dueFrom("kontrolní MR 03/2024", "2026-10-22")).toMatchObject({ due: "", timing: "03/2024" });
  });

  it("gives no clause a default date and drafts nothing for an unrelated sentence", () => {
    expect(dueFrom("kontrolní CT", "2026-10-22")).toEqual({ due: "", dueSrc: "none", timing: "" });
    expect(suggestTasks("Pacient informován.", "2026-10-22")).toEqual([]);
  });

  it("keeps a full date inside one clause", () => {
    const s = suggestTasks("Kontrola v 9.10.2026 na onkologii", "2026-10-22");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ quote: "Kontrola v 9.10.2026 na onkologii", due: "", dueSrc: "none" });
  });

  it("drafts nothing from contraindication, refusal, past negation or 'not needed' (review of step 4)", () => {
    for (const c of ["Radioterapie kontraindikována", "Radioterapii neindikujeme", "Pacient radioterapii odmítá", "Radioterapie nebyla indikována", "Kontrolní MR netřeba", "Kontrolní MR nevyžaduje"])
      expect(suggestTasks(c, "2026-10-22"), c).toEqual([]);
  });

  it("gives no date for an interval counted from another event or for two intervals", () => {
    expect(dueFrom("Kontrolní MR za 3 měsíce po ukončení radioterapie", "2026-10-22")).toMatchObject({ due: "", dueSrc: "none" });
    expect(dueFrom("kontrolní MR za 3 měsíce a za 6 měsíců", "2026-10-22")).toMatchObject({ due: "", dueSrc: "none" });
  });
});
