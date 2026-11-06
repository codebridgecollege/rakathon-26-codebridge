import { describe, expect, it } from "vitest";
import { drugRows, groupHistory, historyGroup } from "../src/anamnesis-view";
import { plainSmoker } from "../src/run-view";

describe("the personal history under headings", () => {
  it("places diseases, operations and injuries, and keeps every item", () => {
    expect(historyGroup("Hypertenzní nemoc")).toBe("heart");
    expect(historyGroup("Chronická obstrukční plicní nemoc")).toBe("lung");
    expect(historyGroup("Hypokalcémie")).toBe("metabolic");
    expect(historyGroup("Cysta jater v segmentu S2")).toBe("kidney_liver");
    expect(historyGroup("Gliózy supratentoriálně")).toBe("nervous");
    expect(historyGroup("Stav po cholecystektomii 2010")).toBe("surgery");
    expect(historyGroup("Zlomenina předloktí")).toBe("injury");
    expect(historyGroup("Hemoroidy")).toBe("other");
    const items = ["Hemoroidy", "Hypertenzní nemoc", "Zlomenina předloktí"].map((term_cs) => ({ term_cs }));
    const g = groupHistory(items);
    expect(g.map((x) => x.group)).toEqual(["injury", "heart", "other"]);
    expect(g.flatMap((x) => x.items)).toHaveLength(3);
  });
});

describe("one line per drug", () => {
  it("joins the dosings of one drug and strength, also from a drug written as one string, and drops none", () => {
    const rows = drugRows([
      { key: "a", drug_cs: "Everolimus Sandoz 5 mg 1-0-0" },
      { key: "b", drug_cs: "Everolimus Sandoz", strength_cs: "5 mg", dosing_cs: "2-0-0" },
      { key: "c", drug_cs: "Kapidin", strength_cs: "20 mg", dosing_cs: "1-0-0" },
      { key: "d", drug_cs: "Spiriva (inhalačně)", dosing_cs: "1-0-1" },
      { key: "e", drug_cs: "Spiriva (inhalačně)", dosing_cs: "2-0-0" },
    ]);
    expect(rows.map((r) => [r.name, r.doses.map((d) => d.dose)])).toEqual([
      ["Everolimus Sandoz 5 mg", ["1-0-0", "2-0-0"]],
      ["Kapidin 20 mg", ["1-0-0"]],
      ["Spiriva (inhalačně)", ["1-0-1", "2-0-0"]],
    ]);
  });
  it("puts related drugs together, unknown ones last, and points at the register only for an unreadable strength", () => {
    const rows = drugRows(["Smecta", "Neznámý lék", "Ventolin N", "Kapidin", "Orcal", "Everolimus Sandoz", "Neurol", "Calcichew"].map((drug_cs, i) => ({ key: String(i), drug_cs })));
    expect(rows.map((r) => r.name)).toEqual(["Everolimus Sandoz", "Kapidin", "Orcal", "Ventolin N", "Neurol", "Smecta", "Calcichew", "Neznámý lék"]);
    expect(rows.find((r) => r.name === "Calcichew")!.hint_cs).toBeNull();
    const [r] = drugRows([{ key: "a", drug_cs: "Calcichew", strength_cs: "1000/[nečitelné] IU", dosing_cs: "0-0-1" }]);
    expect(r!.name).toBe("Calcichew 1000/[nečitelné] IU");
    expect(r!.hint_cs).toContain("Pozorování asistenta");
  });
  it("keeps different strengths apart", () => {
    expect(drugRows([{ key: "a", drug_cs: "Eliquis", strength_cs: "2,5 mg" }, { key: "b", drug_cs: "Eliquis", strength_cs: "5 mg" }])).toHaveLength(2);
  });
});

describe("kuřák, never fumátor", () => {
  it("rewrites every form for the view", () => {
    expect(plainSmoker("fumátor (kuřák)")).toBe("kuřák");
    expect(plainSmoker("Fumátor, 20 cigaret denně")).toBe("kuřák, 20 cigaret denně");
    expect(plainSmoker("exfumátorka")).toBe("bývalá kuřačka");
  });
});
