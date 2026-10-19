// The composed views (src/extraction/compose.ts): one line per event, grouping the facts that belong together, in
// words the facts back. Every composed run must pass the validator, whose backing check rejects a line that adds a
// date, number, negation or side its facts do not hold.
import { describe, expect, it } from "vitest";
import { composeViews, validateRun, writtenSort, type DocumentSource, type ExtractionRun, type Fact, type FactDate } from "../src/extraction/index";
import run10 from "../../../fixtures/data/runs/NO-010.json";
import runS01 from "../../../fixtures/data/runs/NO-S01.json";
import runS02 from "../../../fixtures/data/runs/NO-S02.json";

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function date(as_written: string | null): FactDate {
  if (!as_written) return { as_written: null, precision: null, sort: null };
  const sort = writtenSort(as_written)!;
  return { as_written, precision: sort.length === 10 ? "day" : sort.length === 7 ? "month" : "year", sort };
}

let n = 0;
function fact<K extends Fact["kind"]>(kind: K, value: Extract<Fact, { kind: K }>["value"], over: Partial<Fact> = {}): Fact {
  n++;
  return {
    id: `f-${String(n).padStart(8, "0")}`,
    key: `k${n}`,
    kind,
    subject: "patient",
    value,
    date: date(null),
    status: "documented",
    negated: false,
    not_stated: [],
    origin: "document",
    certainty: "clear",
    codes: [],
    note: null,
    quarantined: false,
    sources: ["s1"],
    ...over,
  } as Fact;
}

const therapy = (regimen: string, start: string | null, over: Partial<Fact> = {}, stop: string | null = null, line: number | null = null) =>
  fact("systemic_therapy", { regimen, line, start, stop, reason_stopped: null, text: null }, { date: date(start), status: "done", ...over });

const source: DocumentSource = { id: "s1", type: "document", document_id: "D1", part: null, page: 1, quote: "", quote_text: "pdf_text", anchor: null, reported_as: "original", identity: "matches", reading_check: null };

/** A whole run around the facts, so the validator can judge the composed lines. */
function runOf(facts: Fact[]): ExtractionRun {
  // Keys must follow from the facts for the validator; these tests judge the lines, so the run uses the real keys.
  return {
    schema: "codebridge.extraction/2",
    case_id: "T",
    content_language: "cs",
    run: { id: "run-t", producer: "pipeline", created_at: "2026-10-19T00:00:00Z", stages: [], supersedes: null },
    documents: [{ document_id: "D1", sha256: null, parts: [] }],
    sources: [source],
    facts,
    checks: [],
    alerts: [],
    brief: null,
    question_draft: null,
  };
}

const lineTexts = (facts: Fact[]) => composeViews({ facts }).onco_lines!.map((l) => l.text);

describe("composeViews", () => {
  it("passes the validator on every reference case composed from its facts alone", () => {
    for (const [id, r] of Object.entries({ "NO-010": run10, "NO-S01": runS01, "NO-S02": runS02 })) {
      const run = copy(r) as unknown as ExtractionRun;
      run.views = composeViews(run);
      expect(validateRun(run).issues, id).toEqual([]);
      expect(run.views.onco_lines!.length, id).toBeGreaterThan(0);
    }
  });

  it("joins a treatment line with its later dose change, its stop and its toxicity, and notes a missing stop date", () => {
    const start = therapy("sunitinib 50 mg denně", "27.1.2026", {}, null, 2);
    const reduced = therapy("sunitinib 37,5 mg", "25.2.2026");
    const stopped = therapy("léčba sunitinibem ukončena", null, { status: "stopped" });
    const tox = fact("adverse_event", { text: "trombocytopenie", grade: "G2-3", related_therapy: "sunitinib" });
    const views = composeViews({ facts: [stopped, tox, reduced, start] });
    const line = views.onco_lines!.find((l) => l.category === "systemic")!;
    expect(line.facts.sort()).toEqual([start.id, reduced.id, stopped.id, tox.id].sort());
    expect(line.status).toBe("stopped");
    expect(line.text).toBe("2. linie sunitinib 50 mg denně, od 27.1.2026; dále sunitinib 37,5 mg od 25.2.2026, léčba sunitinibem ukončena; toxicita: trombocytopenie");
    expect(line.note).toBe("Datum ukončení neuvedeno v dostupné dokumentaci.");
    expect(line.date.as_written).toBe("27.1.2026");
  });

  it("keeps a combination apart from its single drug and lines of different number apart", () => {
    const combo = therapy("nivolumab + ipilimumab", "27.3.2023");
    const maintenance = therapy("nivolumab 240 mg q2w", "27.6.2023", { status: "stopped" }, "29.12.2025");
    expect(lineTexts([combo, maintenance])).toEqual(["nivolumab + ipilimumab, od 27.3.2023", "nivolumab 240 mg q2w, od 27.6.2023, do 29.12.2025"]);
    expect(lineTexts([therapy("everolimus", "3.9.2026", {}, null, 3), therapy("everolimus", "1.10.2026", {}, null, 4)])).toHaveLength(2);
  });

  it("puts a surgery's histology and a same-day metastasis finding on the surgery's line", () => {
    const op = fact("procedure", { name: "exstirpace paraaortální uzliny vlevo", region: null, text: null }, { date: date("25.10.2022"), status: "done" });
    const h = fact("histology", { specimen: "uzlina", result_text: "metastáza světlobuněčného karcinomu", tumour_type: null, grade: "G2" }, { date: date("25.10.2022") });
    const brain = fact("metastasis", { site: "mozeček vpravo", status: "suspected", basis: "imaging", text: null }, { date: date("25.10.2022") });
    const views = composeViews({ facts: [op, h, brain] });
    expect(views.onco_lines!.map((l) => [l.category, l.text])).toEqual([
      ["surgery", "exstirpace paraaortální uzliny vlevo; histologie: metastáza světlobuněčného karcinomu, G2"],
      ["imaging", "suspektní metastáza: mozeček vpravo"],
    ]);
  });

  it("never puts a histology of another specimen on a surgery's line", () => {
    const liver = fact("procedure", { name: "biopsie jater", region: null, text: null }, { date: date("1.3.2026"), status: "done" });
    const colo = fact("procedure", { name: "koloskopie s polypektomií", region: null, text: null }, { date: date("1.3.2026"), status: "done" });
    const polyp = fact("histology", { specimen: "polyp colon", result_text: "tubulární adenom", tumour_type: null, grade: null }, { date: date("1.3.2026") });
    const noSpecimen = fact("histology", { specimen: null, result_text: "adenokarcinom", tumour_type: null, grade: null }, { date: date("1.3.2026") });
    const lines = composeViews({ facts: [liver, colo, polyp, noSpecimen] }).timeline!;
    expect(lines.find((l) => l.facts.includes(liver.id))!.facts).toEqual([liver.id]);
    // Two procedures that day and no specimen: the histology cannot be placed, so it stands on its own.
    expect(lines.find((l) => l.facts.includes(noSpecimen.id))!.facts).toEqual([noSpecimen.id]);
  });

  it("never lets a planned or requested item share a line with what was done", () => {
    const op = fact("procedure", { name: "nefrektomie vlevo", region: null, text: null }, { date: date("1.3.2026"), status: "planned" });
    const biopsy = fact("histology", { specimen: "nefrektomie vlevo", result_text: "světlobuněčný karcinom", tumour_type: null, grade: null }, { date: date("1.3.2026") });
    const start = therapy("sunitinib 50 mg denně", "1.2.2026");
    const planned = therapy("sunitinib 37,5 mg", "1.3.2026", { status: "planned" });
    const lines = composeViews({ facts: [op, biopsy, start, planned] }).onco_lines!;
    expect(lines.map((l) => [l.facts.length, l.status])).toEqual([
      [1, "done"],
      [1, "planned"],
      [1, "planned"],
    ]);
  });

  it("keeps two drugs apart even when their statements start with the same verb", () => {
    const a = therapy("snížení dávky sunitinibu", "1.3.2026");
    const b = therapy("snížení dávky pazopanibu", "1.6.2026");
    expect(lineTexts([a, b])).toHaveLength(2);
    // Prose with "a" is not a combination: the adjuvant phase continues the temozolomide line.
    expect(lineTexts([therapy("temozolomid", "12.1.2026", {}, null, 1), therapy("adjuvantní temozolomid, 4., 5. a 6. cyklus", "23.3.2026", {}, null, 1)])).toHaveLength(1);
  });

  it("keeps a rechallenge after a documented stop on its own line, and takes the stop only as a date", () => {
    const first = therapy("sunitinib", "1.1.2020", { status: "stopped" }, "3.3.2021");
    const again = therapy("sunitinib", "5.5.2024");
    expect(composeViews({ facts: [first, again] }).onco_lines!.map((l) => l.status)).toEqual(["stopped", "done"]);
    const phase = therapy("temozolomid", "12.1.2026", { status: "stopped" }, "po ukončení");
    const line = composeViews({ facts: [phase] }).onco_lines![0]!;
    expect(line.text).toBe("temozolomid, od 12.1.2026");
    expect(line.note).toBe("Datum ukončení neuvedeno v dostupné dokumentaci.");
    const paused = therapy("everolimus", "3.9.2026", { status: "interrupted" });
    expect(composeViews({ facts: [paused] }).onco_lines![0]!.note).toBeNull();
  });

  it("puts a toxicity on the line of exactly its therapy and within its dates, else on no line", () => {
    const combo = therapy("nivolumab + ipilimumab", "27.3.2023", { status: "stopped" }, "17.4.2023");
    const maint = therapy("nivolumab 240 mg q2w", "27.6.2023");
    const hepatitis = fact("adverse_event", { text: "hepatitida", grade: "G3", related_therapy: "nivolumab" }, { date: date("1.3.2025") });
    const early = fact("adverse_event", { text: "kolitida", grade: null, related_therapy: "pembrolizumab" }, { date: date("1.1.2025") });
    const pembro = therapy("pembrolizumab", "1.6.2026");
    const lines = composeViews({ facts: [combo, maint, hepatitis, early, pembro] }).onco_lines!;
    expect(lines.find((l) => l.facts.includes(hepatitis.id))!.facts[0]).toBe(maint.id);
    expect(lines.some((l) => l.facts.includes(early.id))).toBe(false);
  });

  it("keeps the facts' own notes and labels a suspected diagnosis", () => {
    const ct = fact("imaging", { modality: "CT", region: "hrudník", finding_text: "ložisko", response: null }, { date: date("1.3.2026"), status: "done", note: "Datum dle souhrnu zprávy." });
    expect(composeViews({ facts: [ct] }).onco_lines![0]!.note).toBe("Datum dle souhrnu zprávy.");
    const dx = fact("diagnosis", { text: "karcinom plic", disease_status: "suspected", primary: true }, { date: date("1.3.2026") });
    expect(composeViews({ facts: [dx] }).timeline![0]!.text).toBe("karcinom plic (podezření)");
  });

  it("labels a recorded negative whose words hold no negation, and keeps planned lines planned", () => {
    const pe = fact("imaging", { modality: "CT angiografie", region: "plicnice", finding_text: "plicní embolie", response: null }, { date: date("10.2.2026"), status: "done", negated: true });
    const plan = fact("plan", { what: "kontrolní CT", when_as_written: null }, { status: "planned" });
    const views = composeViews({ facts: [pe, plan] });
    expect(views.onco_lines!.map((l) => [l.text, l.status])).toEqual([
      ["CT angiografie plicnice: plicní embolie (negativní nález)", "done"],
      ["kontrolní CT", "planned"],
    ]);
    const run = runOf([pe, plan]);
    run.facts = run.facts.map((f) => ({ ...f, key: "" }));
    run.views = views;
    expect(validateRun(run).issues.filter((i) => i.path.startsWith("/views"))).toEqual([]);
  });

  it("leaves out quarantined facts and a relative's history, and is deterministic", () => {
    const own = therapy("everolimus", "3.9.2026");
    const other = fact("imaging", { modality: "CT", region: "játra", finding_text: "metastázy", response: null }, { date: date("24.9.2026"), status: "done", quarantined: true });
    const mother = fact("family_history", { relation: "matka", condition: "karcinom prsu" }, { subject: "relative" });
    const a = composeViews({ facts: [own, other, mother] });
    expect(a.timeline!.flatMap((l) => l.facts)).toEqual([own.id]);
    expect(composeViews({ facts: [mother, other, own] })).toEqual(a);
  });

  it("notes an older value a newer fact of the same slot replaces, without judging the change", () => {
    const older = fact("metastasis", { site: "mozeček", status: "suspected", basis: "imaging", text: null }, { date: date("14.9.2026") });
    const newer = fact("metastasis", { site: "mozeček", status: "confirmed", basis: "histology", text: null }, { date: date("1.10.2026") });
    const lines = composeViews({ facts: [older, newer] }).onco_lines!;
    expect(lines.map((l) => l.note)).toEqual(["Novější údaj téhož druhu z 1.10.2026.", null]);
    // A newer value of a metastasis on an exam's line does not mark the exam itself as outdated.
    const ct = fact("imaging", { modality: "MR", region: "mozeček", finding_text: "ložisko", response: null }, { date: date("14.9.2026"), status: "done" });
    const onExam = composeViews({ facts: [ct, older, newer] }).onco_lines!;
    expect(onExam.find((l) => l.facts.includes(ct.id))!.note).toBeNull();
  });
});
