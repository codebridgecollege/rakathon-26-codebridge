// The model interface (src/services/model.ts) against local D1 and R2, with the model and the page reader mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { accessLog, FAKE_NAME, loadFixture } from "./data";
import { mockFetch, sequence, testEnv } from "./helpers";
import { cacheKey, callModel, forStep, ModelError, type ModelRequest } from "../src/services/model";
import { PROMPTS, loadPrompt } from "../src/prompts";
import { redactPages, RedactedPage } from "../src/services/redaction";
import { loadCaseIdentity } from "../src/store/identity";
import { actorFor } from "../src/store/audio";
import { orgKey } from "../src/store/sql";

const BN = "645312/1234"; // pt-A's birth number in test/data.ts
const PAGE_TEXT = `Paní ${FAKE_NAME}, r.č. ${BN}\nKontrola u MUDr. Nováka. CRP 12 mg/l.`;
const answer = (content = "Přepis.", finish = "stop") => () => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });
const busy = (headers: Record<string, string> = {}) => () => new Response("busy secret-detail", { status: 429, headers });

beforeEach(() => loadFixture());
afterEach(() => vi.restoreAllMocks());

async function request(over: Partial<ModelRequest> = {}, org = "demo-a", caseId = "NO-A", user = "d2p1"): Promise<ModelRequest> {
  return {
    org,
    caseId,
    actor: await actorFor(env.DB, org, user, "demo"),
    purpose: "read_page",
    prompt: "read-page-cs",
    identity: await loadCaseIdentity(env.DB, org, caseId),
    text: [{ ref: { docId: "A_pacient", page: 1 }, text: PAGE_TEXT }],
    ...over,
  };
}

const modelCalls = async (org = "demo-a") =>
  (await env.DB.prepare("SELECT * FROM model_calls WHERE org_id = ?1 ORDER BY created_at").bind(org).all<Record<string, unknown>>()).results;
const modelLog = async (org = "demo-a") => (await accessLog(org)).filter((r) => r.action === "model.call");

describe("callModel", () => {
  it("sends pseudonymized text to the configured endpoint, with the key from configuration", async () => {
    const { calls } = mockFetch(answer());
    const r = await callModel(testEnv(), await request());
    expect(r.output).toBe("Přepis.");
    expect(calls).toHaveLength(1);
    const up = calls[0]!;
    expect(up.url).toBe("https://model.test/openai/v1/chat/completions");
    expect(up.headers.get("api-key")).toBe("test-az");
    const sent = await up.text();
    for (const secret of ["Testová", "Pacientk", "645312", "Novák"]) expect(sent).not.toContain(secret);
    const body = JSON.parse(sent);
    expect(body.model).toBe("test-model");
    expect(body.reasoning_effort).toBe("low");
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPTS["read-page-cs"].text });
    expect(body.messages[1].content[0].text).toBe("[Část 1]\nPaní [PACIENT] [PACIENT], r.č. [RC]\nKontrola u MUDr. [PERSONAL_3]. CRP 12 mg/l."); // staff numbered in membership order: admin, coord, d1p1
    // Nothing about the document leaves except its text: no document ID or file name.
    expect(sent).not.toContain("A_pacient");
    expect(r.meta).toMatchObject({ provider: "azure-openai", model: "test-model", prompt: "read-page-cs@1", temperature: null, cached: false });
    expect(r.pseudonymized[0]!.originals("[RC]")).toEqual([BN]);
  });

  it("refuses and sends nothing when an identifier remains anywhere in the payload", async () => {
    const { calls } = mockFetch(answer());
    const saved = PROMPTS["read-page-cs"].text;
    // A prompt that names the patient: pseudonymization covers the page text only, the gate covers everything.
    (PROMPTS["read-page-cs"] as { text: string }).text = `${saved}\nPacientka se jmenuje ${FAKE_NAME}.`;
    try {
      const e = await callModel(testEnv(), await request()).catch((x) => x);
      expect(e).toBeInstanceOf(ModelError);
      expect(e.code).toBe("identifier_remains");
      expect(forStep(e)).toBeInstanceOf(NonRetryableError);
      expect(String(e.message)).not.toContain("Testová");
    } finally {
      (PROMPTS["read-page-cs"] as { text: string }).text = saved;
    }
    expect(calls).toHaveLength(0);
    expect(await modelLog()).toEqual([]);
    expect(await modelCalls()).toEqual([]);
  });

  it("writes one access-log row per page before sending, with no patient text, and the outcome on model_calls", async () => {
    mockFetch(answer());
    const req = await request({
      text: [
        { ref: { docId: "A_pacient", page: 1 }, text: PAGE_TEXT },
        { ref: { docId: "A_pacient", page: 2 }, text: "CT hrudníku bez metastáz." },
        { ref: { docId: "A_pacient", page: 2 }, text: "Pokračování strany 2." },
      ],
    });
    const r = await callModel(testEnv(), req);
    const rows = await modelLog();
    expect(rows.map((x) => [x.document_id, x.page_n])).toEqual([["A_pacient", 1], ["A_pacient", 2]]);
    for (const row of rows) {
      expect(row.case_id).toBe("NO-A");
      expect(row.actor_user_id).toBe("d2p1");
      expect(row.what_cs).toBe("Odesláno jazykovému modelu (azure-openai, test-model): read_page, read-page-cs@1");
      const all = JSON.stringify(row);
      for (const secret of ["Testová", "Pacientka", "645312", "Novák", "CRP", "metastáz"]) expect(all).not.toContain(secret);
    }
    const [mc] = await modelCalls();
    expect(mc).toMatchObject({ id: r.meta.call_id, case_id: "NO-A", state: "done", attempts: 1, upstream_status: 200, pages: 2, images: 0, prompt_ref: "read-page-cs@1" });
    expect(JSON.stringify(mc)).not.toContain("Testová");
  });

  it("retries 429 honouring Retry-After within one call, and records the attempts without adding rows", async () => {
    const { calls } = mockFetch(sequence(busy({ "retry-after-ms": "5" }), busy({ "retry-after": "0" }), answer()));
    const log = vi.spyOn(console, "log");
    await callModel(testEnv(), await request());
    expect(calls).toHaveLength(3);
    expect(await modelLog()).toHaveLength(1);
    expect((await modelCalls())[0]).toMatchObject({ state: "done", attempts: 3 });
    // The log line has counts and codes only.
    const lines = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(lines).toContain('"attempts":3');
    expect(lines).not.toContain("Testová");
    expect(lines).not.toContain("secret-detail");
  });

  it("leaves a call that stays busy to the Workflow step's retries, and stops one the model refuses", async () => {
    mockFetch(busy());
    const e = await callModel(testEnv(), await request()).catch((x) => x);
    expect(e).toMatchObject({ code: "busy", retryable: true });
    const step = forStep(e);
    expect(step).not.toBeInstanceOf(NonRetryableError);
    expect(step.message).toBe("model:busy");
    expect((await modelCalls())[0]).toMatchObject({ state: "error", attempts: 4, upstream_status: 429, error_code: "busy" });

    vi.restoreAllMocks();
    mockFetch(() => new Response(JSON.stringify({ error: { message: "Testová" } }), { status: 400 }));
    const e2 = await callModel(testEnv(), await request({ text: [{ ref: { docId: "A_pacient", page: 2 }, text: "Jiná strana." }] })).catch((x) => x);
    expect(e2).toMatchObject({ code: "refused", retryable: false });
    expect(forStep(e2)).toBeInstanceOf(NonRetryableError);
    expect(String(forStep(e2).message)).not.toContain("Testová");
  });

  it("answers a repeated call from the cache without sending or logging", async () => {
    const { calls } = mockFetch(answer("Uloženo."));
    const first = await callModel(testEnv(), await request());
    const again = await callModel(testEnv(), await request());
    expect(calls).toHaveLength(1);
    expect(again.output).toBe("Uloženo.");
    expect(again.meta.cached).toBe(true);
    expect(again.meta.input_sha256).toBe(first.meta.input_sha256);
    expect(await modelLog()).toHaveLength(1);
    const prompt = await loadPrompt("read-page-cs");
    const key = cacheKey("demo-a", "NO-A", "test-model", prompt, first.meta.input_sha256);
    const stored = await (await env.DOCS.get(key))!.text();
    expect(stored).not.toContain("Testová");
  });

  it("keeps the cache per org: the same input in another org is sent again and cached apart", async () => {
    const prompt = await loadPrompt("read-page-cs");
    const sha = "f".repeat(64);
    const a = cacheKey("demo-a", "NO-A", "test-model", prompt, sha);
    const b = cacheKey("demo-b", "NO-A", "test-model", prompt, sha);
    expect(a.startsWith(orgKey("demo-a", "cache/model/"))).toBe(true);
    expect(b.startsWith(orgKey("demo-b", "cache/model/"))).toBe(true);
    expect(a).not.toBe(b);
    expect(a).toContain("test-model/read-page-cs@1/");

    const text = [{ ref: { docId: "b-A_pacient", page: 1 }, text: "CRP 12 mg/l." }];
    const { calls } = mockFetch(answer("Z org A."));
    const ra = await callModel(testEnv(), await request({ text }));
    const rb = await callModel(testEnv(), await request({ text }, "demo-b", "B-NO-A", "b-doc"));
    expect(ra.meta.input_sha256).toBe(rb.meta.input_sha256);
    expect(calls).toHaveLength(2);
    expect(rb.meta.cached).toBe(false);
    expect((await modelLog("demo-b")).map((r) => r.case_id)).toEqual(["B-NO-A"]);
  });

  it("refuses over budget before sending: calls per page, pages per case, pages per org", async () => {
    const { calls } = mockFetch(answer());
    const e1 = testEnv({ MODEL_BUDGET_CALLS_PER_PAGE: "1" });
    await callModel(e1, await request());
    const err = await callModel(e1, await request({ text: [{ ref: { docId: "A_pacient", page: 1 }, text: "Jiný text." }] })).catch((x) => x);
    expect(err).toMatchObject({ code: "budget_page", retryable: false });
    expect(calls).toHaveLength(1);

    const two = [{ ref: { docId: "A_pacient", page: 1 }, text: "a" }, { ref: { docId: "A_pacient", page: 2 }, text: "b" }];
    const e2 = await callModel(testEnv({ MODEL_BUDGET_PAGES_PER_CASE: "2" }), await request({ text: two })).catch((x) => x);
    expect(e2).toMatchObject({ code: "budget_case" });
    const e3 = await callModel(testEnv({ MODEL_BUDGET_PAGES_PER_ORG: "2" }), await request({ text: two })).catch((x) => x);
    expect(e3).toMatchObject({ code: "budget_org" });
    expect(calls).toHaveLength(1);
    expect(await modelLog()).toHaveLength(1);
  });

  it("is off without a key, and refuses a misconfigured provider, sending nothing", async () => {
    const { calls } = mockFetch(answer());
    await expect(callModel(testEnv({ AZURE_OPENAI_KEY: "" }), await request())).rejects.toMatchObject({ code: "model_off" });
    await expect(callModel(testEnv({ MODEL_PROVIDER: "elsewhere" }), await request())).rejects.toMatchObject({ code: "misconfigured" });
    const other = testEnv({ MODEL_PROVIDER: "openai-compatible", MODEL_API_KEY: "test-eu" });
    await callModel(other, await request());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer test-eu");
    expect(calls[0]!.headers.get("api-key")).toBeNull();
  });

  it("refuses a truncated or filtered answer and a too large input", async () => {
    mockFetch(sequence(answer("Přepis bez kon", "length"), answer("", "content_filter")));
    await expect(callModel(testEnv(), await request())).rejects.toMatchObject({ code: "bad_output", retryable: false });
    await expect(callModel(testEnv(), await request({ text: [{ ref: { docId: "A_pacient", page: 2 }, text: "Jiná." }] }))).rejects.toMatchObject({ code: "refused", retryable: false });
    await expect(callModel(testEnv({ MODEL_MAX_INPUT_CHARS: "100" }), await request({ text: [{ ref: { docId: "A_pacient", page: 2 }, text: "x".repeat(200) }] }))).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("page images", () => {
  const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

  it("redacts with names from the case record and the org staff, and sends only a RedactedPage of the same case", async () => {
    const { calls } = mockFetch(async (req) => {
      if (req.url.startsWith("https://page-reader.test/v1/redact")) {
        const b = await req.json<{ pages: { n: number }[] }>();
        return Response.json({ pages: b.pages.map((p) => ({ n: p.n, png_b64: btoa("redacted"), hits: [{ reason: "jméno pacienta", box: [1, 2, 3, 4] }] })) });
      }
      return answer()();
    });
    const identity = await loadCaseIdentity(env.DB, "demo-a", "NO-A");
    const [page] = await redactPages(testEnv(), { org: "demo-a", caseId: "NO-A", docId: "A_pacient", identity }, [{ n: 1, png: PNG, words: [] }]);
    const sentToReader = await calls[0]!.json<{ identity: { names: string[][]; staff: string[][]; birth_number: string } }>();
    expect(sentToReader.identity.names.flat()).toEqual(expect.arrayContaining(["testova", "testove", "pacientka", "pacientky"]));
    expect(sentToReader.identity.staff.flat()).toEqual(expect.arrayContaining(["novak", "novaka", "svobodova", "byvaly"]));
    expect(sentToReader.identity.birth_number).toBe(BN);
    expect(page).toBeInstanceOf(RedactedPage);
    expect(page!.reasons).toEqual(["jméno pacienta"]);

    await callModel(testEnv(), await request({ text: [], images: [page!] }));
    const sent = await calls[1]!.json<{ messages: { content: { type: string; image_url?: { url: string } }[] }[] }>();
    expect(sent.messages[1]!.content[0]!.image_url!.url).toBe(`data:image/png;base64,${btoa("redacted")}`);
    const [row] = await modelLog();
    expect(row).toMatchObject({ document_id: "A_pacient", page_n: 1 });
    expect(row!.what_cs).toContain("obraz strany po začernění");

    // The same redacted page for another case, or a hand-made object, is refused.
    await expect(callModel(testEnv(), await request({ text: [], images: [page!] }, "demo-a", "NO-B"))).rejects.toMatchObject({ code: "image_not_redacted" });
    const fake = { org: "demo-a", caseId: "NO-A", docId: "A_pacient", n: 1, png: PNG, hits: [] } as unknown as RedactedPage;
    await expect(callModel(testEnv(), await request({ text: [], images: [fake] }))).rejects.toMatchObject({ code: "image_not_redacted" });
    expect(() => new RedactedPage(Symbol("x"), "demo-a", "NO-A", "A_pacient", 1, PNG, [])).toThrow();
    // A text-only prompt never takes an image.
    await expect(callModel(testEnv(), await request({ prompt: "summarize-cs", text: [], images: [page!] }))).rejects.toMatchObject({ code: "image_not_redacted" });
  });
});
