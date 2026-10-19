// Re-extraction keeps doctor-confirmed facts (issue #21, EXTRACTION-FORMAT.md "Doctor confirmations and edits"):
// a case run published as the case merge publishes it (matchInputs, prepareRun, the case rules and composed views,
// storeRun), confirmed through the route, then extracted again with one value read differently and one fact gone.
// The confirmation stays on the same value, asks again on the changed one, and the gone one is listed as
// "potvrzeno dříve, v novém zpracování chybí"; nothing moves silently onto another fact.
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import type { Viewer } from "@codebridge/domain/access";
import { orphansOf } from "@codebridge/domain/case-view";
import { confirmationState, confirmedContent } from "@codebridge/domain/confirmations";
import { briefFacts } from "@codebridge/domain/extraction/brief";
import { withCaseRulesAndViews } from "@codebridge/domain/extraction/compose";
import { validateRun, type ExtractionRun } from "@codebridge/domain/extraction/index";
import { fromRun } from "@codebridge/domain/run-view";
import { loadFixture, RUN_A2 } from "./data";
import { call } from "./helpers";
import { confirmedFactIds, matchInputs, prepareRun, storeRun, type DraftRun } from "../src/store/runs";
import { sha256Hex } from "../src/store/work";
import { Tx } from "../src/store/write";

const doctor: Viewer = { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null, authMode: "demo", impersonating: false, org: "demo-a", membershipId: "d2p1" };
const PS = "f-5a0b11"; // ECOG 1, clear
const STAGE = "f-0b19e4"; // pT2a pN1 M0 read from "MO": verify
const REQUEST = "f-3c90de"; // the neurosurgical seminar, requested

beforeEach(() => loadFixture());

/** A producer's draft ID for a fact of RUN_A2: never the final ID, so the test proves prepareRun rewrites references. */
const d = (fact: string) => fact.replace(/^f-/, "d-");

/** RUN_A2's content as a producer drafts it; `change` edits the drafted facts as a re-extraction would read them. */
function draft(id: string, at: string, change: (facts: DraftRun["facts"]) => DraftRun["facts"] = (f) => f): DraftRun {
  // Every reference to a fact (based_on, interval ends, alert facts, subjects and arguments, checks) uses draft IDs.
  const drafted = JSON.parse(JSON.stringify({ facts: RUN_A2.facts, alerts: RUN_A2.alerts, checks: RUN_A2.checks }).replace(/\bf-([0-9a-f]{6,8})\b/g, "d-$1")) as Pick<ExtractionRun, "facts" | "alerts" | "checks">;
  const facts = change(drafted.facts.map(({ id: fid, key: _k, ...f }) => ({ ...f, draft_id: fid })));
  const kept = new Set(facts.map((f) => f.draft_id));
  return {
    ...structuredClone(RUN_A2),
    run: { id, producer: "pipeline", created_at: at, stages: [{ name: "extract_facts", model: "test-model", prompt: "extract-facts-cs@5" }] },
    facts,
    // The producer's own alerts that rest on facts it still has; the case rules add theirs.
    alerts: drafted.alerts.filter((a) => a.facts.every((x) => kept.has(x)) && a.subject.split("|").every((x) => !x.startsWith("d-") || kept.has(x))).map(({ id: _i, ...a }) => a),
    checks: drafted.checks.filter((c) => !c.expected || kept.has(c.expected.of_fact)),
    brief: null,
    question_draft: null,
    views: undefined,
  };
}

/** Publishes a drafted run the way the case merge does; returns the stored run and how each fact got its ID. */
async function publish(dr: DraftRun): Promise<ExtractionRun & { how: Map<string, string> }> {
  const { run, match } = prepareRun(await matchInputs(env.DB, env.DOCS, "demo-a", "NO-A"), dr);
  const final = withCaseRulesAndViews(run);
  expect(validateRun(final).issues).toEqual([]);
  const t = new Tx(env.DB, doctor, { requestId: null, epoch: null });
  await storeRun(t, { db: env.DB, docs: env.DOCS }, final);
  await t.commit();
  return Object.assign(final, { how: match.how });
}

const confirm = (fact: string) =>
  call(`/api/cases/NO-A/facts/${fact}/confirmations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-user": "d2p1", "x-data-epoch": "1" },
    body: JSON.stringify({ action: "confirm", expected_state: "unconfirmed" }),
  });

async function confirmations() {
  return (
    await env.DB.prepare("SELECT fact_id, action, value_sha256, run_id, by_name, at FROM fact_confirmations WHERE org_id = 'demo-a' AND case_id = 'NO-A' ORDER BY at, id").all<{
      fact_id: string;
      action: "confirm" | "withdraw";
      value_sha256: string;
      run_id: string;
      by_name: string;
      at: string;
    }>()
  ).results;
}

describe("re-extraction keeps doctor-confirmed facts", () => {
  it("keeps a confirmation on the same value, asks again on a changed one, and lists a gone one", async () => {
    const first = await publish(draft("run-pipeline-1", "2026-10-19T09:00:00Z"));
    expect(first.alerts.map((a) => a.rule)).toContain("request_without_result");
    for (const f of [PS, STAGE, REQUEST]) expect((await confirm(f)).status, f).toBe(200);
    // A doctor-confirmed "verify" fact counts as verified for the brief.
    expect(await confirmedFactIds(env.DB, "demo-a", first)).toEqual(expect.arrayContaining([PS, STAGE, REQUEST]));

    // The second reading: ECOG read as 2, the request no longer in the documents.
    const second = await publish(
      draft("run-pipeline-2", "2026-10-20T09:00:00Z", (facts) =>
        facts
          .filter((f) => f.draft_id !== d(REQUEST))
          .map((f) => (f.draft_id === d(PS) && f.kind === "performance_status" ? { ...f, value: { ...f.value, value_as_written: "2", value_numeric: 2 } } : f)),
      ),
    );
    const ids = second.facts.map((f) => f.id);
    // The matcher carries the IDs over by key: the same fact keeps its ID, even with another value.
    expect(ids).toContain(PS);
    expect(ids).toContain(STAGE);
    expect(ids).not.toContain(REQUEST);
    expect([second.how.get(PS), second.how.get(STAGE)]).toEqual(["key", "key"]);
    // No draft ID survives into the stored run.
    expect(JSON.stringify(second)).not.toMatch(/"d-[0-9a-f]{6}/);

    const rows = await confirmations();
    const state = async (id: string) => confirmationState(rows.filter((r) => r.fact_id === id), await sha256Hex(confirmedContent(second.facts.find((f) => f.id === id)!)));
    expect(await state(STAGE)).toBe("confirmed");
    // The changed value is never shown as confirmed: the view shows both values and asks.
    expect(await state(PS)).toBe("changed");
    expect(await confirmedFactIds(env.DB, "demo-a", second)).toEqual([STAGE]);
    expect(briefFacts(second, { confirmed: [STAGE] }).map((f) => f.id)).toContain(STAGE);

    // The request's confirmation is listed as confirmed earlier and missing now, never dropped.
    const cd = fromRun("A_pacient.pdf", "NO-A", second);
    const orphans = orphansOf(cd, {}, rows.map((r) => ({ fact_id: r.fact_id, action: r.action, who: r.by_name, when: r.at, run_id: r.run_id })));
    expect(orphans).toEqual([{ kind: "confirmation", fact_id: REQUEST, run_id: "run-pipeline-1", by: "MUDr. Svobodová", when: expect.any(String) }]);
    // The alert IDs of what stays are the same as before, so acknowledgements carry over.
    const kept = first.alerts.filter((a) => a.rule !== "request_without_result" && !a.facts.includes(REQUEST)).map((a) => a.id);
    expect(second.alerts.map((a) => a.id)).toEqual(expect.arrayContaining(kept));
  });

  it("never moves a confirmation onto a fact whose date changed: a new ID, and the old one listed as missing", async () => {
    await publish(draft("run-pipeline-1", "2026-10-19T09:00:00Z"));
    expect((await confirm(STAGE)).status).toBe(200);
    const second = await publish(
      draft("run-pipeline-2", "2026-10-20T09:00:00Z", (facts) =>
        facts.map((f) => (f.draft_id === d(STAGE) ? { ...f, date: { as_written: "2.7.2022", precision: "day" as const, sort: "2022-07-02" } } : f)),
      ),
    );
    const stage = second.facts.find((f) => f.kind === "stage")!;
    expect(stage.id).not.toBe(STAGE);
    expect(await confirmedFactIds(env.DB, "demo-a", second)).toEqual([]);
    const rows = await confirmations();
    const orphans = orphansOf(fromRun("A_pacient.pdf", "NO-A", second), {}, rows.map((r) => ({ fact_id: r.fact_id, action: r.action, who: r.by_name, when: r.at, run_id: r.run_id })));
    expect(orphans.map((o) => (o.kind === "confirmation" ? o.fact_id : null))).toEqual([STAGE]);
  });

  it("keeps a confirmation through the similarity step only when the value is the same, and asks when it differs", async () => {
    const symptom = (text: string) => (facts: DraftRun["facts"]) => [
      ...facts,
      {
        kind: "symptom", subject: "patient", value: { text }, date: { as_written: "1.9.2026", precision: "day", sort: "2026-09-01" }, status: "documented",
        negated: false, not_stated: [], origin: "document", certainty: "clear", codes: [], note: null, quarantined: false, sources: ["src-0041"], draft_id: "d-symptom",
      } as DraftRun["facts"][number],
    ];
    const first = await publish(draft("run-pipeline-1", "2026-10-19T09:00:00Z", symptom("bolest hlavy v týlu")));
    const id = first.facts.find((f) => f.kind === "symptom")!.id;
    expect((await confirm(id)).status).toBe(200);
    // Re-read with a word more: the key (the text) differs, the similarity step keeps the ID, the value changed.
    const second = await publish(draft("run-pipeline-2", "2026-10-20T09:00:00Z", symptom("bolest hlavy v týlu vpravo")));
    const again = second.facts.find((f) => f.kind === "symptom")!;
    expect(again.id).toBe(id);
    expect(second.how.get(id)).toBe("similar");
    expect(await confirmedFactIds(env.DB, "demo-a", second)).not.toContain(id);
    // Read back as first: the doctor's confirmation stands again, under the same ID.
    const third = await publish(draft("run-pipeline-3", "2026-10-21T09:00:00Z", symptom("bolest hlavy v týlu")));
    expect(await confirmedFactIds(env.DB, "demo-a", third)).toContain(id);
  });

  it("does not list a withdrawn confirmation as missing", async () => {
    await publish(draft("run-pipeline-1", "2026-10-19T09:00:00Z"));
    expect((await confirm(REQUEST)).status).toBe(200);
    const withdraw = await call(`/api/cases/NO-A/facts/${REQUEST}/confirmations`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-user": "d2p1", "x-data-epoch": "1" },
      body: JSON.stringify({ action: "withdraw", expected_state: "confirmed" }),
    });
    expect(withdraw.status).toBe(200);
    const second = await publish(draft("run-pipeline-2", "2026-10-20T09:00:00Z", (facts) => facts.filter((f) => f.draft_id !== d(REQUEST))));
    const rows = await confirmations();
    expect(orphansOf(fromRun("A_pacient.pdf", "NO-A", second), {}, rows.map((r) => ({ fact_id: r.fact_id, action: r.action, who: r.by_name, when: r.at, run_id: r.run_id })))).toEqual([]);
  });
});
