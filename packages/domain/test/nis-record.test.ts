// "Záznam z NIS" (issue #22): the fields the source panel shows are the record's own, in reading order, and only those
// the record has.
import { describe, expect, it } from "vitest";
import { nisRecordFields } from "../src/nis-record";

describe("NIS record fields", () => {
  it("shows a lab value as the record gives it, comparator, unit, flag and range included", () => {
    const f = nisRecordFields({
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ code: "laboratory", display: "Laboratory" }] }],
      code: { coding: [{ system: "https://example.cz/lab", code: "S_CEA" }], text: "CEA" },
      valueQuantity: { value: 0.5, comparator: "<", unit: "µg/l" },
      interpretation: [{ coding: [{ code: "L" }] }],
      referenceRange: [{ text: "0 ... 5" }],
      effectiveDateTime: "2026-10-06T07:20:00+02:00",
    });
    expect(f).toEqual([
      { field: "status", value: "final" },
      { field: "category", value: "Laboratory" },
      { field: "name", value: "CEA" },
      { field: "codes", value: "S_CEA (https://example.cz/lab)" },
      { field: "value", value: "<0.5 µg/l" },
      { field: "interpretation", value: "L" },
      { field: "reference_range", value: "0 ... 5" },
      { field: "date", value: "2026-10-06T07:20:00+02:00" },
    ]);
  });

  it("shows a diagnosis, a report and a visit with what each has, and nothing it does not", () => {
    expect(nisRecordFields({ resourceType: "Condition", verificationStatus: { coding: [{ code: "confirmed" }] }, code: { text: "Zhoubný novotvar konečníku" }, onsetString: "diag. 3/2026" })).toEqual([
      { field: "verification", value: "confirmed" },
      { field: "name", value: "Zhoubný novotvar konečníku" },
      { field: "onset", value: "diag. 3/2026" },
    ]);
    expect(nisRecordFields({ resourceType: "DiagnosticReport", status: "final", code: { text: "MR mozku" }, effectiveDateTime: "2026-09-08", conclusion: "Bez ložiskových změn." }).map((x) => x.field)).toEqual([
      "status", "name", "date", "conclusion",
    ]);
    expect(nisRecordFields({ resourceType: "Encounter", status: "finished", class: { code: "AMB", display: "ambulatory" }, type: [{ text: "Ambulantní vyšetření kontrolní" }], period: { start: "2026-10-06", end: "2026-10-06" }, serviceProvider: { display: "Onkologická ambulance" } })).toEqual([
      { field: "status", value: "finished" },
      { field: "class", value: "ambulatory" },
      { field: "name", value: "Ambulantní vyšetření kontrolní" },
      { field: "date", value: "2026-10-06 - 2026-10-06" },
      { field: "department", value: "Onkologická ambulance" },
    ]);
    expect(nisRecordFields({ resourceType: "Observation" })).toEqual([]);
  });
});
