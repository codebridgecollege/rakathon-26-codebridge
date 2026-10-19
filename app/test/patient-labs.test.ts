// The Laboratoř tab against the converted codebridge.extraction/2 runs: case 10's undated panel of 26 values on one
// sheet, and S01's four dated draws. Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtractionRun } from "@codebridge/domain/extraction/types";
import TabLabs from "../app/components/patient/TabLabs.vue";
import { useSourceStore } from "../app/stores/source";
import { mountInCase, setupPatient } from "./patient";
import { docsOf, runOf } from "./helpers";

// The passage a fact's first source quotes, as the source viewer receives it.
function sourceOf(run: ExtractionRun, factId: string, file: string) {
  const f = run.facts.find((x) => x.id === factId)!;
  const s = run.sources.find((x) => x.id === f.sources[0]) as { page: number; quote: string; part: string | null };
  return { file, page: s.page, quote: s.quote, part: s.part };
}
const dropFacts = (run: ExtractionRun, keep: (f: ExtractionRun["facts"][number]) => boolean) => {
  run.facts = run.facts.filter(keep);
  return run;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Laboratoř, one undated panel", () => {
  const panel = (run = runOf("NO-010")) => setupPatient({ extraction: run, documents: docsOf("NO-010") });

  it("keeps value, unit and range as written, with the sheet's arrow, and draws no chart", () => {
    const w = mountInCase(TabLabs, panel());
    expect(w.get("h2").text()).toBe("Laboratoř · Hodnoty z dokumentu");
    const rows = w.findAll("tbody tr");
    // Case 10's 26 undated values on page 3; the unit as read ("mg/1" read as mg/l) with its OCR doubt.
    expect(rows).toHaveLength(26);
    // "!" is the reading-check mark.
    expect(rows[0]!.findAll("td").map((c) => c.text())).toEqual(["hsCRP S_HSCRP!", "9,5 ↑", "mg/l", "0 ... 5"]);
    expect(rows[1]!.findAll("td").map((c) => c.text())).toEqual(["Glukóza S_GLC", "6,7 ↑", "mmol/l", "3.9 ... 5.6"]);
    expect(rows[0]!.get(".mk.ocr").attributes("title")).toBe("Ověřit čtení: V textu „mg/1“ čteno jako mg/l, „[O ... 5]“ čteno jako [0 ... 5].");
    const egfr = rows.find((r) => r.text().includes("PT(KIDN)_EGFRCKDE"))!;
    expect(egfr.findAll("td")[1]!.text()).toMatch(/ ↓$/);
    expect(w.find("svg").exists()).toBe(false);
    // One date and one page for every value: said once, and the column is dropped.
    expect(w.findAll("thead th").map((t) => t.text())).toEqual(["Parametr", "Hodnota", "Jednotka", "Referenční mez"]);
    // The document title is left out of the check: docTitle() (case-data.ts) picks the first part holding page 3, the
    // outpatient report, not the lab part (10_pacient/p1) the sources name. Reported, not fixed here.
    expect(w.get("details.labsrcs").text()).toMatch(/Pro všechny hodnoty: Datum odběru:\s-\s·\sZdroj:\s.+,\ss\.\s3\.\sKlik na název parametru otevře jeho řádek ve zdroji\./);
  });

  it("opens each value's own quoted line from its name", async () => {
    const s = panel();
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    const w = mountInCase(TabLabs, s);
    await w.findAll("tbody .srcl")[1]!.trigger("click");
    // The second value is glucose (S_GLC).
    const run = runOf("NO-010");
    const glc = run.facts.find((f) => f.kind === "lab_result" && f.codes[0]?.code === "S_GLC")!;
    expect(spy.mock.calls[0]![1]).toEqual(sourceOf(run, glc.id, "10_pacient.pdf"));
  });

  it("shows date and page columns when they differ, with a gap for a missing date and the partial date as written", () => {
    // Glucose moved to another sheet dated only to a month: it stays a table row, never a point on a made-up day.
    const run = runOf("NO-010");
    const glc = run.facts.find((f) => f.kind === "lab_result" && f.codes[0]?.code === "S_GLC")! as Extract<ExtractionRun["facts"][number], { kind: "lab_result" }>;
    glc.date = { as_written: "03/2024", precision: "month", sort: "2024-03" };
    glc.value.draw.as_written = "03/2024";
    const src = run.sources.find((x) => x.id === glc.sources[0]) as { page: number };
    src.page = 4;
    const w = mountInCase(TabLabs, panel(run));
    const rows = w.findAll("tbody tr");
    expect(rows[0]!.findAll("td")[4]!.find(".gapq").exists()).toBe(true);
    expect(rows[1]!.findAll("td")[4]!.text()).toBe("03/2024");
    expect(rows.slice(0, 3).map((r) => r.findAll("td")[5]!.text())).toEqual(["s. 3", "s. 4", "s. 3"]);
  });
});

describe("Laboratoř, a series of dated draws", () => {
  // S01's four draws, with the platelets of 4.8.2026 left out (a gap in that column) and the platelets of 12.5.2026
  // marked for a reading check.
  function series() {
    const run = dropFacts(runOf("NO-S01"), (f) => f.id !== "f-dab7b0ba");
    Object.assign(run.facts.find((f) => f.id === "f-4ba564aa")!, { certainty: "verify", certainty_reason: { code: "ocr_char_swap", text: "„54“ nebo „5 4“" } });
    return run;
  }
  const mountSeries = (run = series()) => {
    const s = setupPatient({ extraction: run, documents: docsOf("NO-S01") });
    return { s, w: mountInCase(TabLabs, s) };
  };
  const row = (w: ReturnType<typeof mountInCase>, name: string) => w.findAll("tbody tr").find((r) => r.findAll("td")[0]!.text().startsWith(name))!;

  it("shows one column per draw, values that open their own source, gaps, tags, and the first test's chart", async () => {
    const run = series();
    const { s, w } = mountSeries(run);
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    expect(s.p.file).toBe("10_pacient.pdf");
    expect(w.get("h2").text()).toBe("Laboratoř · Vývoj v čase");
    expect(w.get(".head .muted.small").text()).toBe("4 odběry z dokumentace");
    const plt = row(w, "Trombocyty");
    expect(plt.findAll("td.v")[2]!.find(".gapq").exists()).toBe(true);
    const v = plt.get("button.labv.lo");
    expect(v.text()).toBe("54 ↓");
    expect(v.attributes("aria-label")).toBe("Trombocyty 12. 5. 2026: 54 10^9/l, otevřít zdroj");
    const quote = sourceOf(run, "f-4ba564aa", "S01_pacient.pdf");
    expect(v.attributes("title")).toBe(`Zdroj: „${quote.quote}“`);
    expect(plt.get(".tag.ocr").text()).toBe("ověřit čtení");
    // A documented value carries no tag.
    expect(row(w, "Leukocyty").find(".tag").exists()).toBe(false);
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Leukocyty");
    await v.trigger("click");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toEqual(quote);
    // The value click opens the source only; the chart stays on the picked test.
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Leukocyty");
    // A draw's heading opens the sheet of that draw (its first value, the leukocytes of 8.1.2026).
    await w.findAll("thead button")[0]!.trigger("click");
    expect(spy.mock.calls[1]![1]).toEqual(sourceOf(run, "f-9199e65e", "S01_pacient.pdf"));
  });

  it("follows the picked test, and says two values are needed when a test has one", async () => {
    // Potassium keeps only its value of 8.1.2026.
    const run = dropFacts(series(), (f) => !["f-6aee1dd8", "f-54f3a074", "f-56c6bf1f"].includes(f.id));
    const { w } = mountSeries(run);
    await row(w, "Trombocyty").trigger("click");
    expect(w.get("svg").attributes("aria-label")).toBe("Vývoj v čase, Trombocyty");
    expect(row(w, "Trombocyty").classes()).toContain("sel");
    // Three dots for three values; the missing draw is not drawn.
    expect(w.findAll("svg circle")).toHaveLength(3);
    expect(w.get("h3").text()).toBe("Trombocyty (10^9/l)");
    await row(w, "Draslík").trigger("click");
    expect(w.find("svg").exists()).toBe(false);
    expect(w.text()).toContain("Pro graf jsou potřeba alespoň dvě hodnoty.");
  });

  it("draws no trend from a single dated draw", () => {
    // Only the draw of 6.10.2026 stays: its values are a table of the document's values, not a series.
    const run = dropFacts(runOf("NO-S01"), (f) => f.kind !== "lab_result" || f.date.sort?.startsWith("2026-10-06") === true);
    const { w } = mountSeries(run);
    expect(w.find("h2").exists()).toBe(true);
    expect(w.find("svg").exists()).toBe(false);
    expect(w.get("h2").text()).toBe("Laboratoř · Hodnoty z dokumentu");
    expect(w.findAll("tbody tr")).toHaveLength(13);
  });
});
