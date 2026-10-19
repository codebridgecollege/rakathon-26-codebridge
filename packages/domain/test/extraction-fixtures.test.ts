// The converted reference runs (fixtures/data/runs, written by fixtures/convert/convert_v2.py) pass the TypeScript
// validator, and the facts a doctor would act on read as the documents say: the stage with its kind and date, the
// request that has no result, the negated brain metastasis next to the ECOG value, a lab value with its original unit.
// JSON imports, as the other tests here: the package has no Node types (it runs in the browser and the Worker).
import { describe, expect, it } from "vitest";
import { validateRun, type ExtractionRun, type Fact } from "../src/extraction/index";
import run10 from "../../../fixtures/data/runs/NO-010.json";
import runS01 from "../../../fixtures/data/runs/NO-S01.json";
import runS02 from "../../../fixtures/data/runs/NO-S02.json";

const runs = { "NO-010": run10, "NO-S01": runS01, "NO-S02": runS02 } as unknown as Record<"NO-010" | "NO-S01" | "NO-S02", ExtractionRun>;
const ofKind = <K extends Fact["kind"]>(run: ExtractionRun, kind: K) => run.facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === kind);

describe("converted reference runs", () => {
  it.each(Object.keys(runs))("%s passes the validator", (caseId) => {
    const run = runs[caseId as keyof typeof runs];
    expect(validateRun(run).issues).toEqual([]);
    expect(run.case_id).toBe(caseId);
    expect(run.run).toMatchObject({ id: `fixture-${caseId}-v2`, producer: "fixture", supersedes: null });
  });

  it.each(Object.keys(runs))("%s: every fact rests on a source, every source has a quote", (caseId) => {
    const run = runs[caseId as keyof typeof runs];
    for (const f of run.facts) expect(f.sources.length > 0 || (f.origin === "assistant" && (f.based_on || []).length > 0), f.id).toBe(true);
    for (const s of run.sources) if (s.type === "document") expect(s.quote.trim().length, s.id).toBeGreaterThan(0);
  });
});

describe("case 10", () => {
  const run = runs["NO-010"];
  const byId = new Map(run.facts.map((f) => [f.id, f]));

  it("keeps the stage as a pathological stage at diagnosis, dated, with the OCR reading to verify", () => {
    const [stage] = ofKind(run, "stage");
    expect(ofKind(run, "stage")).toHaveLength(1);
    expect(stage!.value).toEqual({
      tnm_as_written: "pT2a pN1(3+/5) MO",
      tnm: "pT2a pN1 M0",
      stage_kind: "pathological",
      edition: null,
      as_of: "2.6.2022",
      at_diagnosis: true,
    });
    expect(stage!.date).toEqual({ as_written: "2.6.2022", precision: "day", sort: "2022-06-02" });
    expect(stage!.certainty).toBe("verify");
  });

  it("holds the NCH seminar as a request without a result, and the alert that says so", () => {
    const [request] = ofKind(run, "request");
    expect(request!.status).toBe("requested");
    expect(request!.value.result_fact).toBeNull();
    expect(request!.value.what).toContain("neurochirurgickém semináři");
    const alert = run.alerts.find((a) => a.rule === "request_without_result");
    expect(alert).toMatchObject({ subject: request!.id, kind: "missing", facts: [request!.id], message: { id: "alert-request-without-result", args: { fact: request!.id } } });
  });

  it("keeps 'bez klin. známek mozkových mts' as a negated clinical finding beside ECOG PS 1, on the same passage", () => {
    const neg = ofKind(run, "metastasis").find((f) => f.value.site === "mozek")!;
    expect(neg).toMatchObject({ negated: true, value: { status: "excluded", basis: "clinical" } });
    const [ecog] = ofKind(run, "performance_status");
    expect(ecog!.value).toMatchObject({ scale: "ECOG", value_as_written: "1", value_numeric: 1 });
    expect(neg.sources).toEqual(ecog!.sources);
    // The suspected cerebellar lesion stays a suspicion: no histology confirms it.
    const cereb = ofKind(run, "metastasis").find((f) => f.value.site === "pravá mozečková hemisféra")!;
    expect(cereb).toMatchObject({ negated: false, value: { status: "suspected", basis: "imaging" } });
  });

  it("keeps creatinine with its value, original unit, range and the assistant's high flag", () => {
    const crea = ofKind(run, "lab_result").find((f) => f.codes.some((c) => c.code === "S_CREAE"))!;
    expect(crea.value).toMatchObject({
      value_as_written: "107",
      value_numeric: 107,
      unit_as_written: "µmol/1",
      unit: "µmol/l",
      reference_range: "59 ... 104",
      reference_low: 59,
      reference_high: 104,
      out_of_range: "high",
      out_of_range_origin: "assistant",
    });
    expect(crea.codes).toEqual([{ system: "fno-local-lab", code: "S_CREAE", assigned_by: "source" }]);
    expect(crea.date.as_written).toBeNull();
    expect(crea.not_stated).toContain("draw");
  });

  it("splits disagreeing Spiriva dosing into two facts with a contradiction alert", () => {
    const spiriva = ofKind(run, "medication").filter((f) => f.value.drug.startsWith("Spiriva"));
    expect(spiriva.map((f) => f.value.dosing).sort()).toEqual(["1-0-1", "2-0-0"]);
    const alert = run.alerts.find((a) => a.rule === "dosing_contradiction")!;
    expect(alert.kind).toBe("contradiction");
    expect([...alert.facts].sort()).toEqual(spiriva.map((f) => f.id).sort());
  });

  it("points the brief and the drafted question at existing facts", () => {
    expect(run.brief!.sentences).toHaveLength(7);
    for (const s of run.brief!.sentences) for (const id of s.facts) expect(byId.has(id), id).toBe(true);
    expect(run.question_draft!.basis.find((b) => b.role === "purpose")!.facts.map((id) => byId.get(id)!.kind)).toEqual(["request"]);
  });
});

describe("S01 and S02", () => {
  it("hold the dated lab series with draw time and requisition", () => {
    const labs = ofKind(runs["NO-S01"], "lab_result");
    expect(labs).toHaveLength(52);
    const plt = labs.find((f) => f.codes[0]!.code === "B_PLT" && f.value.draw.as_written === "12.5.2026 07:35")!;
    expect(plt.date).toEqual({ as_written: "12.5.2026 07:35", precision: "minute", sort: "2026-05-12T07:35" });
    expect(plt.value.draw.requisition).toBe("S01-260512-01");
  });

  it("raise one alert per missing item, and the requested CT without a result", () => {
    const run = runs["NO-S02"];
    expect(run.alerts.filter((a) => a.rule === "original_report_missing")).toHaveLength(7);
    const [ct] = ofKind(run, "request");
    expect(ct).toMatchObject({ status: "requested", value: { result_fact: null }, date: { as_written: "7.10.2026" } });
    expect(run.alerts.find((a) => a.rule === "request_without_result")!.subject).toBe(ct!.id);
    // Sections the fixture never extracted say so instead of looking empty.
    expect(run.checks.find((c) => c.looks_for === "allergy")!.result).toBe("not_run");
  });
});
