// The NIS import end to end without storage (issue #22, phase 2): the connector pulls a patient's record from the
// in-memory FHIR server loaded with the test Bundles, and packages/domain/src/nis-map.ts turns it into a valid
// codebridge.extraction/2 run with producer "nis". Checked against the prepared fixtures' lab values (the same
// reference stream C's evaluation uses for S01) and against the failure patients F02-F04.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { mockFetch, testEnv } from "./helpers";
import { MemoryFhir } from "../../fhir/nis/memory-server";
import { NisClient } from "../src/services/fhir";
import { nisRun } from "@codebridge/domain/nis-map";
import type { ExtractionRun, Fact } from "@codebridge/domain/extraction/types";

const BASE = "https://nis.test/fhir";
const cfg = { base_url: BASE, label_cs: "Testovací NIS", auth: { mode: "none" as const } };
let fhir: MemoryFhir;
let clock = "2026-10-19T08:00:00.000Z";
const pulls: string[] = [];
const logged: string[] = [];

beforeEach(() => {
  clock = "2026-10-19T08:00:00.000Z";
  fhir = new MemoryFhir(BASE, { now: () => clock });
  for (const b of Object.values(JSON.parse(env.TEST_NIS_BUNDLES) as Record<string, Record<string, unknown>>)) fhir.load(b);
  mockFetch((req) => fhir.handle(req));
  pulls.length = 0;
  logged.length = 0;
  for (const m of ["log", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const client = () => new NisClient(testEnv(), "demo-a", cfg, async (p) => void pulls.push(`${p.op}:${p.resource}`));

async function runFor(nisId: string, previous: ExtractionRun | null = null, since: string | null = null) {
  const rec = await client().patientRecord(nisId, since);
  return { rec, ...nisRun({ caseId: "NO-T", system: BASE, resources: rec.resources, runId: `run-${nisId}`, createdAt: clock, previous, supersedes: previous?.run.id ?? null }) };
}
const ofKind = <K extends Fact["kind"]>(run: ExtractionRun, k: K) => run.facts.filter((f): f is Extract<Fact, { kind: K }> => f.kind === k);

describe("pulling a patient's record", () => {
  it("reads every record type by NIS patient ID, with one access-log row and no identity in URLs or logs", async () => {
    const { rec } = await runFor("cb-s01");
    expect(pulls).toEqual(["record:Patient"]);
    expect(new Set(rec.resources.map((r) => r.resourceType))).toEqual(new Set(["Condition", "Observation", "Procedure", "MedicationStatement", "ServiceRequest", "DiagnosticReport", "DocumentReference"]));
    expect(rec.truncated).toEqual([]);
    for (const r of fhir.requests) expect(r.url).not.toMatch(/640312|Křemínek|Kreminek/);
    for (const l of logged) expect(l).not.toMatch(/640312|Křemínek|Kreminek|S_CREAE/);
    // Nothing of another patient.
    expect(rec.resources.every((r) => JSON.stringify(r.subject ?? {}).includes("Patient/cb-s01"))).toBe(true);
  });
});

describe("S01 and S02 from the NIS", () => {
  for (const [name, nisId] of [["S01", "cb-s01"], ["S02", "cb-s02"]] as const) {
    it(`${name}: a valid run whose lab values equal the prepared fixture's, value for value`, async () => {
      const { run, validation } = await runFor(nisId);
      expect(validation.issues).toEqual([]);
      expect(run.run.producer).toBe("nis");
      expect(run.facts.every((f) => f.origin === "nis" && f.sources.length === 1)).toBe(true);
      const ref = JSON.parse(env.TEST_NIS_LAB_REFERENCE)[name] as { draws: { date: string; time: string }[]; tests: { code: string; unit: string; reference_range: string; points: ({ value: string } | null)[] }[] };
      const labs = ofKind(run, "lab_result");
      let n = 0;
      for (const t of ref.tests)
        t.points.forEach((p, i) => {
          if (!p) return;
          n++;
          const d = ref.draws[i]!;
          const hit = labs.filter((f) => f.codes.some((c) => c.system === "fno-local-lab" && c.code === t.code) && f.date.sort === `${d.date}T${d.time}`);
          expect(hit, `${t.code} ${d.date}`).toHaveLength(1);
          expect(hit[0]!.value).toMatchObject({ value_numeric: Number(p.value.replace(",", ".")), unit_as_written: t.unit, reference_range: t.reference_range });
          expect(hit[0]!.certainty).toBe("clear");
        });
      // No lab value the reference does not account for.
      expect(labs).toHaveLength(n);
    });
  }

  it("S01: the PET/CT request stays requested without a result, and the MRI of 29.9.2026 is a done procedure", async () => {
    const { run } = await runFor("cb-s01");
    const pet = ofKind(run, "request").find((f) => f.value.what === "PET/CT s 18F-FET")!;
    expect(pet).toMatchObject({ status: "requested", value: { result_fact: null }, date: { as_written: "2026-10-01", precision: "day" } });
    expect(ofKind(run, "procedure").find((f) => f.value.name === "MR mozku")).toMatchObject({ status: "done", date: { sort: "2026-09-29" } });
    expect(ofKind(run, "diagnosis").map((f) => [f.codes[0]!.code, f.value.primary, f.value.disease_status, f.date.as_written])).toEqual([
      ["C711", true, null, "diag. 12/2025"],
      ["I802", false, null, "DUS 24.2.2026"],
    ]);
    expect(ofKind(run, "medication").every((f) => f.status === "documented")).toBe(true);
  });

  it("S02: clinical and post-neoadjuvant stages are two facts with their own dates, histology and imaging from reports", async () => {
    const { run } = await runFor("cb-s02");
    expect(ofKind(run, "stage").map((f) => [f.value.stage_kind, f.value.tnm_as_written, f.value.as_of])).toEqual([
      ["clinical", "cT3b cN1 cM0", "2026-03-17"],
      ["post_neoadjuvant", "ypT2 ypN0 (0/14), R0", "2026-08-21"],
    ]);
    expect(ofKind(run, "histology").map((f) => f.date.sort)).toEqual(["2026-03-09", "2026-08-11"]);
    const img = ofKind(run, "imaging").sort((a, b) => String(a.date.sort).localeCompare(String(b.date.sort)));
    expect(img.map((f) => [f.value.modality, f.value.region])).toEqual([
      ["MR", "pánve"],
      ["CT", "hrudníku a břicha"],
      ["MR", "pánve"],
    ]);
    expect(run.checks.find((c) => c.looks_for === "stage")?.result).toBe("found");
  });

  it("case 10: lab values without a draw date stay undated", async () => {
    const { run, validation } = await runFor("cb-c10");
    expect(validation.ok).toBe(true);
    const labs = ofKind(run, "lab_result");
    expect(labs).toHaveLength(26);
    expect(labs.every((f) => f.date.as_written === null && f.value.draw.as_written === null)).toBe(true);
    expect(ofKind(run, "stage")).toEqual([expect.objectContaining({ value: expect.objectContaining({ stage_kind: "pathological", tnm_as_written: "pT2a pN1(3+/5) M0" }) })]);
  });
});

describe("the failure patients", () => {
  it("F01 (duplicates): no clinical facts, nothing merged", async () => {
    for (const id of ["cb-f01-a", "cb-f01-b", "cb-f01-c"]) {
      const { run } = await runFor(id);
      expect(run.facts).toEqual([]);
    }
  });

  it("F02 (amended document): the replaced version is listed as superseded and named by its replacement", async () => {
    const { mapped } = await runFor("cb-f02");
    const byId = Object.fromEntries(mapped.documents.map((d) => [d.resource, d]));
    expect(byId["DocumentReference/cb-f02-doc-histo-v1"]).toMatchObject({ status: "superseded" });
    expect(byId["DocumentReference/cb-f02-doc-histo-v2"]).toMatchObject({ status: "current", replaces: ["DocumentReference/cb-f02-doc-histo-v1"], attachment_url: "Binary/cb-f02-doc-histo-v2-bin" });
  });

  it("F03 (conflicting stage): two pathological stages of one day stay two facts, the clinical one apart", async () => {
    const { run } = await runFor("cb-f03");
    const st = ofKind(run, "stage");
    expect(st.map((f) => [f.value.stage_kind, f.value.tnm_as_written, f.key])).toEqual([
      ["clinical", "cT4a cN1 cM0", "stage|clinical|2026-04-10"],
      ["pathological", "pT3 pN0 (0/18)", "stage|pathological|2026-05-04"],
      ["pathological", "pT4a pN1a (1/18)", "stage|pathological|2026-05-04#2"],
    ]);
    expect(new Set(st.map((f) => f.id)).size).toBe(3);
  });

  it("F04 (request without result): the MRI request points at its report, the PET/CT request has none", async () => {
    const { run } = await runFor("cb-f04");
    const img = ofKind(run, "imaging")[0]!;
    expect(ofKind(run, "request").map((f) => [f.value.what, f.status, f.value.result_fact])).toEqual([
      ["MR mozku", "done", img.id],
      ["PET/CT", "requested", null],
    ]);
  });
});

describe("refresh", () => {
  it("asks only for what changed since the last pull, and the changed fact keeps its ID with the new version", async () => {
    const first = await runFor("cb-s02");
    clock = "2026-10-20T08:00:00.000Z";
    const lab = (first.rec.resources.find((r) => r.id === "cb-s02-lab-2026-10-06-s-cea")!) as Record<string, any>;
    fhir.load({ resourceType: "Bundle", type: "transaction", entry: [{ resource: { ...lab, valueQuantity: { value: 9.7, unit: "µg/l" } }, request: { method: "PUT", url: `Observation/${lab.id}` } }] });
    const changed = await client().patientRecord("cb-s02", "2026-10-19T08:00:00.000Z");
    expect(changed.resources.map((r) => `${r.resourceType}/${r.id}`)).toEqual([`Observation/${lab.id}`]);
    expect(fhir.requests.at(-1)!.url).toContain("_lastUpdated=gt2026-10-19T08%3A00%3A00.000Z");
    // The refresh run is the full record again, matched against the first: every fact keeps its ID.
    const second = await runFor("cb-s02", first.run);
    expect(second.validation.ok).toBe(true);
    expect(second.run.facts.map((f) => f.id)).toEqual(first.run.facts.map((f) => f.id));
    const cea = second.run.facts.find((f) => f.sources.some((s) => second.run.sources.find((x) => x.id === s && x.type === "nis" && x.resource === `Observation/${lab.id}`)))!;
    expect(cea.value).toMatchObject({ value_numeric: 9.7 });
    expect(second.run.sources.find((s) => s.id === cea.sources[0])).toMatchObject({ version: "2" });
  });

  it("refuses a malformed since and an ID made of dots before pulling", async () => {
    await expect(client().patientRecord("cb-s02", "yesterday")).rejects.toMatchObject({ code: "bad_request" });
    await expect(client().patientRecord("..")).rejects.toMatchObject({ code: "bad_request" });
    expect(pulls).toEqual([]);
  });
});
