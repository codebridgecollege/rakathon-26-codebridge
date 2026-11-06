// The Prognóza tab's study search on the Worker (routes/prognosis.ts, workflows/prognosis.ts): who may start it, what
// leaves (a profile with no name), one job at a time, a daily cap, and the whole way from the click to the saved result
// with a stubbed OpenRouter (never the network).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { introspectWorkflow } from "cloudflare:test";
import { call, mockFetch, testEnv } from "./helpers";
import { FAKE_NAME, loadFixture } from "./data";
import { resetCatalogCache } from "../src/services/prognosis-search";
import { prognosisSavedKey, runPrognosisJob } from "../src/workflows/prognosis";

type Body = { job?: { id: string; state: string }; error?: { code: string; message_cs: string }; profile?: Record<string, any>; saved?: any[]; run?: Record<string, any> | null; [k: string]: any };
const ON = { PROGNOSIS_ORGS: "demo-a", OPENROUTER_API_KEY: "test-secret", PROGNOSIS_MODEL: "m", PROGNOSIS_MODEL_LABEL: "Test model", PROGNOSIS_ROUTE_ONLY: "test/eu" };

async function api(method: string, path: string, user = "d2p1", body: unknown = {}, e: Env = testEnv(ON)) {
  const init: RequestInit =
    method === "GET" ? { headers: { "x-demo-user": user } } : { method, headers: { "content-type": "application/json", "x-demo-user": user, "x-data-epoch": "1" }, body: JSON.stringify(body) };
  const r = await call(`/api${path}`, init, e);
  return { status: r.status, body: (await r.json()) as Body };
}
const q = async <T = Record<string, any>>(sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results;

const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/12345678/";
const answer = () => ({
  usage: { server_tool_use_details: { web_search_requests: 1 } },
  choices: [
    {
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          rows: [
            {
              study_title: "Controlled synthetic fixture, not medical evidence",
              arm: "Arm A",
              population: "Cohort X",
              source: { url: PUBMED, pmid: "12345678", year: 2020 },
              time_origin: "Randomization",
              endpoints: { os_12: { value: 80, unit: "%", quote: "Twelve month overall survival was 80% in Arm A.", source_url: PUBMED } },
              matching: {},
            },
          ],
          limitations: [],
        }),
        annotations: [{ type: "url_citation", url_citation: { url: PUBMED, content: "Twelve month overall survival was 80% in Arm A." } }],
      },
    },
  ],
});
// OpenRouter as a stub: the catalog, then the answer. Records every outgoing request body.
function openrouter(chat: () => Response = () => Response.json(answer())) {
  const sent: string[] = [];
  mockFetch(async (req) => {
    if (req.url === "https://openrouter.ai/api/v1/models") return Response.json({ data: [{ id: "m", name: "Astra", supported_parameters: [] }] });
    if (req.url === "https://openrouter.ai/api/v1/chat/completions") {
      sent.push(await req.text());
      return chat();
    }
    return new Response("unexpected host", { status: 599 });
  });
  return sent;
}

beforeEach(async () => {
  await loadFixture();
  resetCatalogCache();
});
afterEach(() => vi.restoreAllMocks());

describe("config and profile", () => {
  it("is off until the org is switched on and the key and model are set, and says why", async () => {
    const off = (await api("GET", "/prognosis/config", "d2p1", {}, testEnv({ ...ON, PROGNOSIS_ORGS: "" }))).body;
    expect(off).toMatchObject({ configured: false, error: "Vyhledávání studií není pro tuto organizaci zapnuté." });
    expect((await api("GET", "/prognosis/config", "d2p1", {}, testEnv({ ...ON, OPENROUTER_API_KEY: "" }))).body).toMatchObject({ configured: false, error: "Na serveru chybí klíč OpenRouter." });
    expect((await api("GET", "/prognosis/config")).body).toMatchObject({ configured: true, error: null, models: [{ id: "m" }] });
    // Another org that is not switched on.
    expect((await api("GET", "/prognosis/config", "b-doc")).body.configured).toBe(false);
  });

  it("builds a profile from what the doctor sees, with no name in it, and treats another org's file as unknown", async () => {
    const r = await api("GET", "/prognosis/profile?patient_id=A_pacient.pdf&scheduled_date=2026-10-22");
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ available: true, synthetic: true, scheduled_date: "2026-10-22" });
    expect((r.body.profile!.facts as unknown[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toContain(FAKE_NAME);
    // Org B has its own case of the same file name, so the same address reads that org's case, never org A's.
    const b = await api("GET", "/prognosis/profile?patient_id=A_pacient.pdf", "b-doc", {}, testEnv({ ...ON, PROGNOSIS_ORGS: "demo-b" }));
    expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).not.toContain(FAKE_NAME);
    expect((await api("GET", "/prognosis/profile?patient_id=nope.pdf")).status).toBe(404);
  });
});

describe("starting a search", () => {
  it("runs from the click to a saved result, sending a profile with no name, and logs the start", async () => {
    const sent = openrouter();
    await using wf = await introspectWorkflow(env.PROGNOSIS);
    await wf.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    const r = await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf", scheduled_date: "2026-10-22" });
    expect(r.status).toBe(202);
    expect(r.body.job).toMatchObject({ state: "queued" });
    for (const i of await wf.get()) await i.waitForStatus("complete");

    // One model call, and nothing in it names the patient.
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toContain(FAKE_NAME);
    expect(sent[0]).toContain("scheduled_date");

    const got = await api("GET", "/cases/NO-A/prognosis");
    expect(got.body.run).toMatchObject({ state: "done", error_code: null, message_cs: null });
    const mine = got.body.saved!.find((s) => s.scheduled_date === "2026-10-22");
    expect(mine).toMatchObject({ patient_id: "A_pacient.pdf" });
    expect(mine.result.rows).toHaveLength(1);
    expect(mine.result.models[0]).toMatchObject({ status: "success" });
    // The draft profile is gone, and the log names who started it.
    expect((await env.DOCS.list({ prefix: "org/demo-a/jobs/NO-A/prognosis-" })).objects).toHaveLength(0);
    const log = await q<{ actor_user_id: string; what_cs: string }>("SELECT actor_user_id, what_cs FROM access_log WHERE action = 'prognosis.search'");
    expect(log).toHaveLength(1);
    expect(log[0]!.actor_user_id).toBe("d2p1");
  });

  it("refuses an org that is off, a role that may not, a doctor outside the team and a grant", async () => {
    const body = { patient_id: "A_pacient.pdf" };
    expect((await api("POST", "/prognosis", "d2p1", body, testEnv({ ...ON, PROGNOSIS_ORGS: "" }))).body.error?.code).toBe("prognosis_off");
    expect((await api("POST", "/prognosis", "admin", body)).body.error?.code).toBe("role_forbidden");
    // A doctor of another department is not on the team of this case.
    expect((await api("POST", "/prognosis", "d1p1", body)).body.error?.code).toBe("not_member");
    expect((await q("SELECT id FROM jobs WHERE kind = 'prognosis'")).length).toBe(0);
    expect((await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf", scheduled_date: "22.10.2026" })).body.error?.code).toBe("invalid_input");
  });

  it("allows one search at a time for a case", async () => {
    await env.DB.prepare(
      "INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, phase, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at) VALUES ('demo-a', 'pg-busy', 'prognosis', 'NO-A', 'PROGNOSIS', 'pg-busy', 1, 'running', NULL, NULL, 'd2p1', 'x', 'doctor', ?1, ?1)",
    ).bind(new Date().toISOString()).run();
    expect((await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf" })).body.error?.code).toBe("prognosis_busy");
  });

  it("stops at the daily limit, which erasing a case does not reset", async () => {
    openrouter();
    const one = testEnv({ ...ON, PROGNOSIS_DAILY_MAX: "1" });
    await using wf = await introspectWorkflow(env.PROGNOSIS);
    await wf.modifyAll(async (m) => {
      await m.disableRetryDelays();
    });
    expect((await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf" }, one)).status).toBe(202);
    for (const i of await wf.get()) await i.waitForStatus("complete");
    expect((await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf" }, one)).body.error?.code).toBe("prognosis_cap");
    // The jobs go with an erased case; the access log does not, so the count stays.
    await env.DB.prepare("DELETE FROM jobs WHERE kind = 'prognosis'").run();
    expect((await api("POST", "/prognosis", "d2p1", { patient_id: "A_pacient.pdf" }, one)).body.error?.code).toBe("prognosis_cap");
  });

  it("refuses the coordinator under the strict mode, where clinical content is not hers to read", async () => {
    const strict = testEnv({ ...ON, CLINICAL_ACCESS: "doctors_only" });
    expect((await api("POST", "/prognosis", "coord", { patient_id: "A_pacient.pdf" }, strict)).body.error?.code).toBe("role_forbidden");
    expect((await q("SELECT id FROM jobs WHERE kind = 'prognosis'")).length).toBe(0);
  });

  it("closes a job nobody touched for minutes, with a reason the tab can show, and removes its draft", async () => {
    await env.DOCS.put("org/demo-a/jobs/NO-A/prognosis-pg-old.json", "{}");
    await env.DB.prepare(
      "INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, phase, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at) VALUES ('demo-a', 'pg-old', 'prognosis', 'NO-A', 'PROGNOSIS', 'pg-old', 1, 'running', 'search', NULL, 'd2p1', 'x', 'doctor', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z')",
    ).run();
    const got = await api("GET", "/cases/NO-A/prognosis");
    expect(got.body.run).toMatchObject({ id: "pg-old", state: "error", error_code: "stalled", message_cs: "Hledání se nedokončilo. Spusťte ho znovu." });
    expect(await env.DOCS.head("org/demo-a/jobs/NO-A/prognosis-pg-old.json")).toBeNull();
  });
});

describe("the job", () => {
  const params = { org: "demo-a", caseId: "NO-A", jobId: "pg-x", file: "A_pacient.pdf", scheduledDate: "2026-10-22" };
  const job = () =>
    env.DB.prepare(
      "INSERT INTO jobs (org_id, id, kind, case_id, workflow, instance_id, attempt, state, phase, result_ref, created_by, created_by_name, created_by_role, created_at, updated_at) VALUES ('demo-a', 'pg-x', 'prognosis', 'NO-A', 'PROGNOSIS', 'pg-x', 1, 'queued', NULL, NULL, 'd2p1', 'x', 'doctor', '2026-10-22T10:00:00.000Z', '2026-10-22T10:00:00.000Z')",
    ).run();
  const draft = () => env.DOCS.put("org/demo-a/jobs/NO-A/prognosis-pg-x.json", JSON.stringify({ available: true, included_count: 1, synthetic: true, scheduled_date: "2026-10-22", facts: [{ text: "Histologie: adenokarcinom", date: "2023-01-05", source: { page: 1, quote: "Histologie: adenokarcinom" }, kind: "clinical", status: "documented", certainty: "documented" }], excluded_undated: 0, excluded_after_cutoff: 0, warnings: [] }));

  it("ends as an error with a fixed code when the key is missing, and removes the draft", async () => {
    await job();
    await draft();
    const out = await runPrognosisJob({ ...env, OPENROUTER_API_KEY: "", PROGNOSIS_MODEL: "m", PROGNOSIS_MODEL_LABEL: "Test model", PROGNOSIS_ROUTE_ONLY: "test/eu" } as Env, params);
    expect(out).toEqual({ state: "error", code: "missing_key" });
    expect((await q("SELECT state, error_code FROM jobs WHERE id = 'pg-x'"))[0]).toEqual({ state: "error", error_code: "missing_key" });
    expect(await env.DOCS.head("org/demo-a/jobs/NO-A/prognosis-pg-x.json")).toBeNull();
  });

  it("ends as an error when the draft is gone", async () => {
    await job();
    expect((await runPrognosisJob({ ...env, ...ON } as Env, params)).code).toBe("draft_missing");
  });

  it("keeps a good saved search when a later one fails, and says so through the job", async () => {
    const key = prognosisSavedKey("demo-a", "NO-A", "2026-10-22");
    const good = JSON.stringify({ patient_id: "A_pacient.pdf", scheduled_date: "2026-10-22", result: { rows: [{ study_title: "Dobrá studie" }] } });
    await env.DOCS.put(key, good);
    openrouter(() => new Response("provider failed", { status: 500 }));
    await job();
    await draft();
    expect(await runPrognosisJob({ ...env, ...ON } as Env, params)).toEqual({ state: "error", code: "search_failed" });
    expect(await (await env.DOCS.get(key))!.text()).toBe(good);
    expect((await q("SELECT state, error_code FROM jobs WHERE id = 'pg-x'"))[0]).toEqual({ state: "error", error_code: "search_failed" });
    expect(await env.DOCS.head("org/demo-a/jobs/NO-A/prognosis-pg-x.json")).toBeNull();
  });

  it("keeps a good saved search when a later one finds nothing, and says another try will not help", async () => {
    await env.DOCS.put(prognosisSavedKey("demo-a", "NO-A", "2026-10-22"), JSON.stringify({ result: { rows: [{ study_title: "Dobrá" }] } }));
    openrouter(() => Response.json({ usage: { server_tool_use_details: { web_search_requests: 1 } }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ rows: [] }), annotations: [] } }] }));
    await job();
    await draft();
    expect((await runPrognosisJob({ ...env, ...ON } as Env, params)).code).toBe("search_empty");
  });

  it("does not let a failed search hide demo org A's seeded replay", async () => {
    await env.DOCS.put("prognosis/NO-A/saved.json", JSON.stringify({ result: { rows: [{ study_title: "Uložená" }] } }));
    openrouter(() => new Response("provider failed", { status: 500 }));
    await job();
    await draft();
    expect((await runPrognosisJob({ ...env, ...ON } as Env, params)).code).toBe("search_failed");
    expect(await env.DOCS.head(prognosisSavedKey("demo-a", "NO-A", "2026-10-22"))).toBeNull();
  });

  it("stores a provider failure as a result the tab can show, never the provider's text", async () => {
    openrouter(() => new Response("secret provider text with the patient", { status: 500 }));
    await job();
    await draft();
    const out = await runPrognosisJob({ ...env, ...ON } as Env, params);
    expect(out).toEqual({ state: "done", code: null });
    const saved = (await (await env.DOCS.get(prognosisSavedKey("demo-a", "NO-A", "2026-10-22")))!.json()) as { result: { rows: unknown[]; models: { status: string; error: string }[] } };
    expect(saved.result.rows).toEqual([]);
    expect(saved.result.models[0]).toMatchObject({ status: "error" });
    expect(JSON.stringify(saved)).not.toContain("secret provider text");
  });
});
