// The NIS fragment in the case merge (issue #22): nisFragment builds the case's fragment from NIS records, and
// composeFragments takes it next to the documents' fragments. The NIS adds facts and "found", never a document and never
// "nothing found"; a run of the NIS alone has producer "nis".
import { describe, expect, it } from "vitest";
import { composeFragments, pipelineFragment, type ParsedLabs } from "../src/fragments";
import { nisFragment } from "../src/nis-map";

const SYS = "https://nis.test/fhir";
const meta = { versionId: "1", lastUpdated: "2026-10-01T08:00:00Z" };
const resources = [
  { resourceType: "ServiceRequest", id: "mr", meta, status: "completed", intent: "order", code: { text: "MR mozku" }, authoredOn: "2026-09-01", subject: { reference: "Patient/p" } },
  { resourceType: "DiagnosticReport", id: "r1", meta, status: "final", category: [{ coding: [{ code: "RAD" }] }], code: { text: "MR mozku" }, basedOn: [{ reference: "ServiceRequest/mr" }], effectiveDateTime: "2026-09-08", conclusion: "Bez ložiskových změn." },
  { resourceType: "ServiceRequest", id: "pet", meta, status: "active", intent: "order", code: { text: "PET/CT" }, authoredOn: "2026-09-15" },
];

const LABS: ParsedLabs = { draws: [{ date: "2026-03-10", time: "07:25", source: { page: 1, quote: "Odběr: 10.3.2026 07:25" } }], tests: [] };
const doc = pipelineFragment({
  documentId: "up-1",
  sha256: "a".repeat(64),
  pipelineRun: "pl-1",
  engine: "tesseract 5.3.0 ces",
  parts: [{ part_id: "up-1/p0", pages: [1] }],
  pages: [{ n: 1, level: "good" }],
  identity: [{ n: 1, result: "matches" }],
  documentIdentity: null,
  labs: LABS,
});

describe("nisFragment", () => {
  it("gives each fact a stable draft ID from its record and links the request to its report", () => {
    const { fragment } = nisFragment({ system: SYS, resources, importId: "nis-1" });
    expect(fragment).toMatchObject({ producer: "nis", document_id: "nis", pipeline_run: "nis-1", parts: [], alerts: [] });
    expect(fragment.facts.map((f) => f.draft_id).sort()).toEqual(["nis:DiagnosticReport/r1", "nis:ServiceRequest/mr", "nis:ServiceRequest/pet"]);
    const mr = fragment.facts.find((f) => f.draft_id === "nis:ServiceRequest/mr")!;
    expect(mr.kind === "request" && mr.value.result_fact).toBe("nis:DiagnosticReport/r1");
    // Only "found" checks: the merge reads the absence of a check as "not run".
    expect(fragment.checks.every((c) => c.result === "found")).toBe(true);
  });
});

describe("composeFragments with the NIS", () => {
  it("makes a NIS run from the NIS alone: no documents, found or not run, never nothing found", () => {
    const { fragment } = nisFragment({ system: SYS, resources, importId: "nis-1" });
    const d = composeFragments("X", "r", "2026-10-19T10:00:00Z", [fragment]);
    expect(d.run.producer).toBe("nis");
    expect(d.documents).toEqual([]);
    expect(d.checks.find((c) => c.looks_for === "request")?.result).toBe("found");
    expect(d.checks.find((c) => c.looks_for === "allergy")?.result).toBe("not_run");
    expect(d.checks.some((c) => c.result === "nothing_found")).toBe(false);
  });

  it("never says nothing found for a kind the NIS holds facts of, even when its pull of that kind was cut off", () => {
    const { fragment } = nisFragment({ system: SYS, resources, importId: "nis-1", truncated: ["ServiceRequest"] });
    // The NIS's own request check is then "not run" and left out of the fragment; a document says nothing found.
    expect(fragment.checks.some((c) => c.looks_for === "request")).toBe(false);
    const ai = { ...doc, producer: "ai" as const, facts: [], sources: [], alerts: [], checks: [{ id: "c", looks_for: "request", expected: null, covered: [{ document_id: "up-1", part: "up-1/p0" }], unreadable: [], result: "nothing_found" as const }] };
    const d = composeFragments("X", "r", "2026-10-19T10:00:00Z", [doc, ai, fragment]);
    expect(d.facts.some((f) => f.kind === "request")).toBe(true);
    expect(d.checks.find((c) => c.looks_for === "request")?.result).toBe("found");
  });

  it("joins the documents: a pipeline run with both producers' facts, the NIS adding found and no document", () => {
    const { fragment } = nisFragment({ system: SYS, resources, importId: "nis-1" });
    const d = composeFragments("X", "r", "2026-10-19T10:00:00Z", [doc, fragment]);
    expect(d.run.producer).toBe("pipeline");
    expect(d.documents.map((x) => x.document_id)).toEqual(["up-1"]);
    expect(d.facts.filter((f) => f.origin === "nis")).toHaveLength(3);
    expect(d.checks.find((c) => c.looks_for === "request")?.result).toBe("found");
    // The document's own lab check is not changed by the NIS.
    expect(d.checks.find((c) => c.looks_for === "lab_result")?.result).toBe(composeFragments("X", "r", "t", [doc]).checks.find((c) => c.looks_for === "lab_result")?.result);
  });
});
