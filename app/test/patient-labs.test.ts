// The Laboratoř tab against synthetic data shaped like the real extraction: case 10's undated panel (case.labs) and a
// synthetic patient's series (syn.labs_series). Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import TabLabs from "../app/components/patient/TabLabs.vue";
import { useSourceStore } from "../app/stores/source";
import { mountInCase, setupPatient } from "./patient";

const src = (page: number, quote: string) => ({ file: "10_pacient.pdf", page, quote });
const PANEL = [
  { code: "S_CREA", name_cs: "Kreatinin", value: "107", unit: "µmol/l", reference_range: "59 ... 104", out_of_range: "high", date: null, source: src(3, "S_CREA: 107 µmol/l [59 ... 104]"), certainty: "documented" },
  { code: "S_HSCRP", name_cs: "hsCRP", value: "9,5", unit: "mg/l", reference_range: "0 ... 5", out_of_range: "high", date: null, source: src(3, "S_HSCRP: 9,5 mg/1 [O ... 5]"), certainty: "unclear_ocr", note: "OCR 'mg/1' = mg/l" },
  { code: "S_NA", name_cs: "Sodík", value: "131", unit: "mmol/l", reference_range: "136 ... 145", out_of_range: "low", date: null, source: src(3, "S_NA: 131") },
];
const panelCase = (labs = PANEL) => ({
  case: { file: "10_pacient.pdf", page_count: 5, labs, labs_note_cs: "Jediná sada hodnot na str. 3.", flags: [] },
  extra: { refs: [], documents: [{ title_cs: "Laboratorní výsledky", type: "jiné", pages: [3], readability: "fair" }] },
});

const ssrc = (page: number, quote: string) => ({ file: "S99_pacient.pdf", page, quote });
const DRAWS = [
  { date: "2026-01-08", time: "07:40", source: ssrc(7, "Odběr: 8.1.2026 07:40") },
  { date: "2026-05-12", time: "07:35", source: ssrc(5, "Odběr: 12.5.2026 07:35") },
  { date: "2026-08-04", time: "07:45", source: ssrc(4, "Odběr: 4.8.2026 07:45") },
];
const pt = (i: number, value: string, out: string | null, extra: Record<string, unknown> = {}) => ({ value, out_of_range: out, date: DRAWS[i]!.date, time: DRAWS[i]!.time, certainty: "documented", source: ssrc(7 - i, `X: ${value}`), ...extra });
const TESTS = [
  { code: "B_LKC", name_cs: "Leukocyty", unit: "10^9/l", reference_range: "4 ... 10", points: [pt(0, "11,42", "high"), pt(1, "2,86", "low"), pt(2, "7,95", null)] },
  // The middle draw has no value for this test: a gap, never a borrowed value.
  { code: "B_PLT", name_cs: "Trombocyty", unit: "10^9/l", reference_range: "150 ... 400", points: [pt(0, "210", null), pt(2, "54", "low", { certainty: "unclear_ocr" })] },
  { code: "S_ONE", name_cs: "Jediný", unit: "g/l", reference_range: "1 ... 2", points: [pt(0, "1,5", null)] },
];
const seriesCase = (ser: Record<string, unknown> = {}) => ({
  syn: { documents: [], data_gaps: [], labs_series: { synthetic: false, note_cs: "Hodnoty ze 3 listů.", draws: DRAWS, tests: TESTS, ...ser } },
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Laboratoř, one undated panel", () => {
  it("keeps value, unit and range as written, with the sheet's arrow, and draws no chart", () => {
    const w = mountInCase(TabLabs, setupPatient({ extraction: panelCase() }));
    expect(w.get("h2").text()).toBe("Laboratoř · Hodnoty z dokumentu");
    const cells = w.findAll("tbody tr")[0]!.findAll("td").map((c) => c.text());
    expect(cells).toEqual(["Kreatinin S_CREA", "107 ↑", "µmol/l", "59 ... 104"]);
    expect(w.findAll("tbody tr")[2]!.findAll("td")[1]!.text()).toBe("131 ↓");
    expect(w.findAll("tbody tr")[1]!.get(".mk.ocr").attributes("title")).toBe("Ověřit čtení: OCR 'mg/1' = mg/l");
    expect(w.find("svg").exists()).toBe(false);
    // One date and one page for every value: said once, and the column is dropped.
    expect(w.findAll("thead th").map((t) => t.text())).toEqual(["Parametr", "Hodnota", "Jednotka", "Referenční mez"]);
    expect(w.get("details.labsrcs").text()).toContain("Pro všechny hodnoty: Datum odběru: - · Zdroj: Laboratorní výsledky, s. 3. Klik na název parametru otevře jeho řádek ve zdroji.");
  });

  it("opens each value's own quoted line from its name", async () => {
    const s = setupPatient({ extraction: panelCase() });
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    const w = mountInCase(TabLabs, s);
    await w.findAll("tbody .srcl")[1]!.trigger("click");
    expect(spy.mock.calls[0]![1]).toEqual(PANEL[1]!.source);
  });

  it("shows date and page columns when they differ, with a gap for a missing date and the partial date as written", () => {
    const labs = [PANEL[0]!, { ...PANEL[1]!, date: "03/2024", source: src(4, "q") }];
    const w = mountInCase(TabLabs, setupPatient({ extraction: panelCase(labs as never) }));
    const rows = w.findAll("tbody tr");
    expect(rows[0]!.findAll("td")[4]!.find(".gapq").exists()).toBe(true);
    expect(rows[1]!.findAll("td")[4]!.text()).toBe("03/2024");
    expect(rows.map((r) => r.findAll("td")[5]!.text())).toEqual(["s. 3", "s. 4"]);
  });
});

describe("Laboratoř, a series of dated draws", () => {
  it("shows one column per draw, values that open their own source, gaps, tags, and the first test's chart", async () => {
    const s = setupPatient({ extraction: seriesCase() });
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    const w = mountInCase(TabLabs, s);
    expect(w.get("h2").text()).toBe("Laboratoř · Vývoj v čase");
    expect(w.get(".head .muted.small").text()).toBe("3 odběry z dokumentace");
    const plt = w.findAll("tbody tr")[1]!;
    expect(plt.findAll("td.v")[1]!.find(".gapq").exists()).toBe(true);
    const v = plt.get("button.labv.lo");
    expect(v.text()).toBe("54 ↓");
    expect(v.attributes("aria-label")).toBe("Trombocyty 4. 8. 2026: 54 10^9/l, otevřít zdroj");
    expect(v.attributes("title")).toBe("Zdroj: „X: 54“");
    expect(plt.get(".tag.ocr").text()).toBe("ověřit čtení");
    // A documented value carries no tag.
    expect(w.findAll("tbody tr")[0]!.find(".tag").exists()).toBe(false);
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Leukocyty");
    await v.trigger("click");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toEqual(TESTS[1]!.points[1]!.source);
    // The value click opens the source only; the chart stays on the picked test.
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Leukocyty");
    await w.findAll("thead button")[0]!.trigger("click");
    expect(spy.mock.calls[1]![1]).toEqual(DRAWS[0]!.source);
  });

  it("follows the picked test, and says two values are needed when a test has one", async () => {
    const w = mountInCase(TabLabs, setupPatient({ extraction: seriesCase() }));
    await w.findAll("tbody tr")[1]!.trigger("click");
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Trombocyty");
    expect(w.findAll("tbody tr")[1]!.classes()).toContain("sel");
    // Two dots for two values; the missing draw is not drawn.
    expect(w.findAll("svg circle")).toHaveLength(2);
    expect(w.get("h3").text()).toBe("Trombocyty (10^9/l)");
    await w.findAll("tbody tr")[2]!.trigger("click");
    expect(w.find("svg").exists()).toBe(false);
    expect(w.text()).toContain("Pro graf jsou potřeba alespoň dvě hodnoty.");
  });

  it("draws no trend for a series the case data refuses (synthetic values or one draw)", () => {
    const syn = mountInCase(TabLabs, setupPatient({ extraction: seriesCase({ synthetic: true }) }));
    expect(syn.find("h2").exists()).toBe(true);
    expect(syn.find("svg").exists()).toBe(false);
    expect(syn.get("h2").text()).not.toBe("Laboratoř · Vývoj v čase");
    const one = mountInCase(TabLabs, setupPatient({ extraction: seriesCase({ draws: DRAWS.slice(0, 1) }) }));
    expect(one.find("svg").exists()).toBe(false);
  });
});
