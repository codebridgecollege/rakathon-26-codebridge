import { describe, expect, it, vi } from "vitest";
import { ApiError, CLIENT_ERROR_IDS, PROGNOSIS_ERROR_IDS, createApiClient } from "../src/index";

type Call = { url: string; init: RequestInit };

// A fetch that records each request and answers from a queue of [status, body, content-type].
function mockFetch(...answers: [number, unknown, string?][]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const a = answers.shift();
    if (!a) throw new TypeError("Failed to fetch");
    const [status, body, type = "application/json"] = a;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const headersOf = (c: Call) => new Headers(c.init.headers);

describe("reads", () => {
  it("sends the demo user and no epoch, and returns the body as is", async () => {
    const m = mockFetch([200, { user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null } }]);
    const api = createApiClient({ fetch: m.fn });
    api.setUser("d2p1");
    const me = await api.me();
    expect(me.user.id).toBe("d2p1");
    expect(m.calls[0]!.url).toBe("/api/me");
    const h = headersOf(m.calls[0]!);
    expect(h.get("X-Demo-User")).toBe("d2p1");
    expect(h.get("X-Data-Epoch")).toBeNull();
    expect(m.calls[0]!.init.cache).toBe("no-store");
    expect(m.calls[0]!.init.credentials).toBe("same-origin");
  });

  it("sends no X-Demo-User before a user is known", async () => {
    const m = mockFetch([200, { ok: true }]);
    await createApiClient({ fetch: m.fn }).me();
    expect(headersOf(m.calls[0]!).has("X-Demo-User")).toBe(false);
  });

  it("takes the epoch from health and from the workflow", async () => {
    const m = mockFetch([200, { service: "codebridge-mdt", demo: { data_epoch: 3 } }], [200, { data_epoch: 4, cases: {}, att: {}, sessions: [], mails: [] }]);
    const api = createApiClient({ fetch: m.fn });
    await api.health();
    expect(api.epoch).toBe(3);
    await api.workflow();
    expect(api.epoch).toBe(4);
  });

  it("passes the server's Czech message through unchanged", async () => {
    const m = mockFetch([403, { error: { code: "not_member", message_cs: "Nejste v týmu tohoto případu." } }]);
    const e = await createApiClient({ fetch: m.fn }).extraction("NO-010").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: "not_member", status: 403, message_cs: "Nejste v týmu tohoto případu.", message_id: null });
  });

  it("treats an HTML answer as no API, with a catalog ID instead of text", async () => {
    const m = mockFetch([200, "<!doctype html><p>Pages</p>", "text/html"]);
    const e = await createApiClient({ fetch: m.fn }).health().catch((x) => x);
    expect(e).toMatchObject({ code: "no_api", message_cs: null, message_id: CLIENT_ERROR_IDS.get.no_api });
  });

  it("maps a network failure to code network, status 0", async () => {
    const m = mockFetch();
    const e = await createApiClient({ fetch: m.fn }).staff().catch((x) => x);
    expect(e).toMatchObject({ code: "network", status: 0, message_id: CLIENT_ERROR_IDS.get.network });
  });

  it("maps a timeout to code timeout", async () => {
    const slow = (async (_u: unknown, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const e = await createApiClient({ fetch: slow }).health({ timeout: 10 }).catch((x) => x);
    expect(e).toMatchObject({ code: "timeout", status: 0 });
  });

  it("escapes path parameters and builds the query", async () => {
    const m = mockFetch([200, {}], [200, { tasks: [] }], [200, {}]);
    const api = createApiClient({ fetch: m.fn });
    await api.extraction("NO/010 x");
    await api.tasks("mine");
    await api.caseHeader("NO-010", true);
    expect(m.calls.map((c) => c.url)).toEqual(["/api/cases/NO%2F010%20x/extraction", "/api/tasks?scope=mine", "/api/cases/NO-010?via=link"]);
  });
});

describe("writes", () => {
  it("sends JSON with the user, the epoch and the idempotency key, and returns the envelope", async () => {
    const m = mockFetch([200, { service: "codebridge-mdt", demo: { data_epoch: 7 } }], [200, { data: { id: "dec1" }, data_epoch: 7, state: { cases: {} } }]);
    const api = createApiClient({ fetch: m.fn });
    api.setUser("d2p1");
    await api.health();
    const r = await api.approve("NO-010", { conclusion: "x" }, "key-1");
    expect(r).toEqual({ data: { id: "dec1" }, data_epoch: 7, state: { cases: {} } });
    const c = m.calls[1]!;
    expect(c.init.method).toBe("POST");
    expect(c.url).toBe("/api/cases/NO-010/decisions");
    expect(JSON.parse(String(c.init.body))).toEqual({ conclusion: "x" });
    const h = headersOf(c);
    expect(h.get("Content-Type")).toBe("application/json");
    expect(h.get("X-Demo-User")).toBe("d2p1");
    expect(h.get("X-Data-Epoch")).toBe("7");
    expect(h.get("Idempotency-Key")).toBe("key-1");
  });

  it("sends no Idempotency-Key where the route needs none", async () => {
    const m = mockFetch([200, { data: {}, data_epoch: 1, state: {} }]);
    await createApiClient({ fetch: m.fn }).setStatus("NO-010", { to: "ready", expected_status: "new" });
    expect(headersOf(m.calls[0]!).has("Idempotency-Key")).toBe(false);
  });

  it("refreshes the epoch from every answer that carries one, a refusal included", async () => {
    // The server's refusals carry no epoch today; apiWrite() in the template reads it from any answer, and so does
    // the client.
    const m = mockFetch([200, { data: {}, data_epoch: 5, state: {} }], [409, { error: { code: "slot_taken", message_cs: "Termín mezitím obsadil jiný případ. Vyberte jiný." }, data_epoch: 6 }]);
    const api = createApiClient({ fetch: m.fn });
    await api.putSlot("NO-010", { day: "2026-10-22", time: "14:00" });
    expect(api.epoch).toBe(5);
    const e = await api.putSlot("NO-010", { day: "2026-10-22", time: "14:00" }).catch((x) => x);
    expect(api.epoch).toBe(6);
    expect(e).toMatchObject({ code: "slot_taken", status: 409, message_cs: "Termín mezitím obsadil jiný případ. Vyberte jiný." });
  });

  it("carries the server's current state and field messages on a refusal", async () => {
    const m = mockFetch([409, { error: { code: "protocol_conflict", message_cs: "Koncept mezitím upravil(a) jiný uživatel.", current: { version: 4 }, fields: { concl: "x" } } }]);
    const e = await createApiClient({ fetch: m.fn }).putProtocol("NO-010", { version: 3, concl: "a" }).catch((x) => x);
    expect(e.current).toEqual({ version: 4 });
    expect(e.fields).toEqual({ concl: "x" });
  });

  it("signals a data reset once, however many writes are refused with it", async () => {
    const reset = { error: { code: "data_reset", message_cs: "Ukázková data byla obnovena, stránka se znovu načte." } };
    const m = mockFetch([409, reset], [409, reset]);
    const onDataReset = vi.fn();
    const api = createApiClient({ fetch: m.fn, onDataReset });
    await api.patchTask(1, { done: true, expected_done: false }).catch(() => {});
    await api.patchTask(1, { done: true, expected_done: false }).catch(() => {});
    expect(onDataReset).toHaveBeenCalledTimes(1);
  });

  it("marks a lost write with status 0, so an approval keeps its key for the retry", async () => {
    const m = mockFetch();
    const e = await createApiClient({ fetch: m.fn }).approve("NO-010", {}, "k").catch((x) => x);
    expect(e).toMatchObject({ code: "network", status: 0, message_id: CLIENT_ERROR_IDS.write.network });
  });

  it("uses the write fallback ID when a refusal has no message", async () => {
    const m = mockFetch([500, {}]);
    const e = await createApiClient({ fetch: m.fn }).sendDigest().catch((x) => x);
    expect(e).toMatchObject({ code: "error", status: 500, message_cs: null, message_id: CLIENT_ERROR_IDS.write.fallback });
  });

  it("sends a document as a raw body with its encoded file name", async () => {
    const m = mockFetch([201, { data: { id: "doc1" }, data_epoch: 1, state: {} }]);
    const file = new Blob(["%PDF"], { type: "application/pdf" });
    await createApiClient({ fetch: m.fn }).uploadDocument("NO-010", file, "zpráva ř.pdf");
    const h = headersOf(m.calls[0]!);
    expect(h.get("Content-Type")).toBe("application/pdf");
    expect(h.get("X-File-Name")).toBe(encodeURIComponent("zpráva ř.pdf"));
    expect(m.calls[0]!.init.body).toBe(file);
  });
});

describe("prognosis search", () => {
  // A fetch that never answers until its request is aborted, to read the time limit of a call.
  function hangingFetch() {
    return vi.fn(
      (_url: string | URL | Request, init: RequestInit = {}) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    ) as unknown as typeof fetch;
  }

  it("reads the saved searches of a case, the config and the profile at their paths", async () => {
    const m = mockFetch([200, { saved: [] }], [200, { configured: false }], [200, { profile: { available: true } }]);
    const api = createApiClient({ fetch: m.fn });
    expect(await api.prognosis("NO 010")).toEqual({ saved: [] });
    await api.prognosisConfig();
    await api.prognosisProfile({ patient_id: "10_pacient.pdf", scheduled_date: "2026-10-22" });
    expect(m.calls.map((c) => c.url)).toEqual([
      "/api/cases/NO%20010/prognosis",
      "/api/prognosis/config",
      "/api/prognosis/profile?patient_id=10_pacient.pdf&scheduled_date=2026-10-22",
    ]);
  });

  it("posts the search with its body", async () => {
    const m = mockFetch([200, { rows: [] }]);
    await createApiClient({ fetch: m.fn }).prognosisSearch({ patient_id: "10_pacient.pdf", scheduled_date: "2026-10-22", refresh: true });
    expect(m.calls[0]!.url).toBe("/api/prognosis");
    expect(m.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(m.calls[0]!.init.body))).toEqual({ patient_id: "10_pacient.pdf", scheduled_date: "2026-10-22", refresh: true });
  });

  it("gives the reads 45 s and the search 330 s, then a timeout ID", async () => {
    vi.useFakeTimers();
    try {
      const api = createApiClient({ fetch: hangingFetch() });
      let read: unknown = "pending";
      void api.prognosisConfig().catch((e) => (read = e));
      await vi.advanceTimersByTimeAsync(44999);
      expect(read).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toMatchObject({ code: "timeout", message_cs: null, message_id: PROGNOSIS_ERROR_IDS.timeout });

      let search: unknown = "pending";
      void api.prognosisSearch({ patient_id: "x", scheduled_date: "2026-10-22", refresh: false }).catch((e) => (search = e));
      await vi.advanceTimersByTimeAsync(329999);
      expect(search).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(search).toMatchObject({ code: "timeout", message_id: PROGNOSIS_ERROR_IDS.timeout });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a host without the prognosis server by a catalog ID, not text", async () => {
    const m = mockFetch([200, "<!doctype html>", "text/html"], [404, "<p>404</p>", "text/html"]);
    const api = createApiClient({ fetch: m.fn });
    expect(await api.prognosisConfig().catch((x) => x)).toMatchObject({ code: "no_api", message_cs: null, message_id: PROGNOSIS_ERROR_IDS.no_api });
    expect(await api.prognosisSearch({ patient_id: "x", scheduled_date: "d", refresh: false }).catch((x) => x)).toMatchObject({ message_id: PROGNOSIS_ERROR_IDS.no_api });
  });

  it("passes the Worker's Czech message through, and a refusal without one gets the prognosis fallback", async () => {
    const m = mockFetch([404, { error: { code: "not_found", message_cs: "Neznámá adresa API." } }], [500, {}]);
    const api = createApiClient({ fetch: m.fn });
    expect(await api.prognosisConfig().catch((x) => x)).toMatchObject({ code: "not_found", message_cs: "Neznámá adresa API.", message_id: null });
    expect(await api.prognosisProfile({ patient_id: "x", scheduled_date: "d" }).catch((x) => x)).toMatchObject({
      status: 500,
      message_cs: null,
      message_id: PROGNOSIS_ERROR_IDS.fallback,
    });
  });
});
