import { afterEach, describe, expect, it, vi } from "vitest";
import { call, deny, mockFetch, sequence, testEnv } from "./helpers";
import { PROMPT, PROMPT_VERSION } from "../src/prompts/summarize-cs";
import { fetchWithRetry } from "../src/services/retry";

const ok = () => Response.json({ choices: [{ message: { content: "  Indikována chemoterapie.  " } }] });
const status = (s: number, text = `upstream said ${s} secret-detail`) => () => new Response(text, { status: s });

const post = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => ({
  method: "POST",
  headers,
  body: typeof body === "string" ? body : JSON.stringify(body),
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/summarize", () => {
  it("summarizes with the model and prompt from configuration", async () => {
    const { calls } = mockFetch(ok);
    const res = await call("/api/summarize", post({ transcript: "Lékař: navrhujeme chemoterapii." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      summary: "Indikována chemoterapie.",
      model: "gpt-6-luna-dz-eu",
      prompt_version: PROMPT_VERSION,
    });
    expect(calls).toHaveLength(1);
    const up = calls[0]!;
    expect(up.url).toBe("https://apim-rakathon-q7146n.azure-api.net/openai/v1/chat/completions");
    expect(up.headers.get("api-key")).toBe("test-az");
    const sent = await up.json<{ model: string; messages: { role: string; content: string }[] }>();
    expect(sent.model).toBe("gpt-6-luna-dz-eu");
    expect(sent.messages).toEqual([
      { role: "system", content: PROMPT },
      { role: "user", content: "Lékař: navrhujeme chemoterapii." },
    ]);
  });

  it("retries on 429 and succeeds", async () => {
    const { calls } = mockFetch(sequence(status(429), status(429), ok));
    const res = await call("/api/summarize", post({ transcript: "x" }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("gives up after the configured attempts with upstream_busy, without leaking the upstream status", async () => {
    const { calls } = mockFetch(status(429));
    const res = await call("/api/summarize", post({ transcript: "x" }));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("upstream_busy");
    expect(text).not.toContain("429");
    expect(calls).toHaveLength(4);
  });

  it("maps an upstream error to 502 without its status or body", async () => {
    mockFetch(status(500));
    const res = await call("/api/summarize", post({ transcript: "x" }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toEqual({
      code: "upstream_error",
      message_cs: "Služba jazykového modelu odpověděla chybou.",
    });
    expect(text).not.toContain("500");
    expect(text).not.toContain("secret-detail");
  });

  it("maps an upstream timeout to 504", async () => {
    mockFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await call("/api/summarize", post({ transcript: "x" }));
    expect(res.status).toBe(504);
  });

  it("refuses a transcript over SUMMARY_MAX_CHARS", async () => {
    const { calls } = mockFetch(ok);
    const res = await call("/api/summarize", post({ transcript: "a".repeat(11) }), testEnv({ SUMMARY_MAX_CHARS: "10" }));
    expect(res.status).toBe(413);
    expect((await res.json<{ error: { message_cs: string } }>()).error.message_cs).toBe(
      "Přepis je příliš dlouhý ke shrnutí.",
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a body over 256 KB", async () => {
    const res = await call("/api/summarize", post({ transcript: "a".repeat(300 * 1024) }));
    expect(res.status).toBe(413);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("too_large");
  });

  it("refuses bad JSON, an empty transcript and a wrong content type", async () => {
    expect((await call("/api/summarize", post("{nope"))).status).toBe(400);
    expect((await call("/api/summarize", post({ transcript: "   " }))).status).toBe(400);
    expect((await call("/api/summarize", post({ transcript: 3 }))).status).toBe(400);
    expect((await call("/api/summarize", post("null"))).status).toBe(400);
    const res = await call("/api/summarize", post({ transcript: "x" }, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("answers not_configured without the key", async () => {
    const res = await call("/api/summarize", post({ transcript: "x" }), testEnv({ AZURE_OPENAI_KEY: "" }));
    expect(res.status).toBe(503);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("not_configured");
  });

  it("goes through AI Gateway when configured", async () => {
    const { calls } = mockFetch(ok);
    const env = testEnv({ AI_GATEWAY_BASE: "https://gateway.ai.cloudflare.com/v1/acc/gw/azure/", AI_GATEWAY_TOKEN: "gw" });
    const res = await call("/api/summarize", post({ transcript: "x" }), env);
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://gateway.ai.cloudflare.com/v1/acc/gw/azure/chat/completions");
    expect(calls[0]!.headers.get("cf-aig-authorization")).toBe("Bearer gw");
  });

  it("returns 429 with Retry-After when the limiter refuses", async () => {
    const { calls } = mockFetch(ok);
    const res = await call("/api/summarize", post({ transcript: "x" }), testEnv({ RL_LLM: deny }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe("rate_limited");
    expect(calls).toHaveLength(0);
  });

  it("refuses a request from another origin", async () => {
    const { calls } = mockFetch(ok);
    const foreign = await call("/api/summarize", {
      ...post({ transcript: "x" }),
      headers: { "content-type": "application/json", origin: "https://evil.test" },
    });
    expect(foreign.status).toBe(403);
    expect((await foreign.json<{ error: { code: string } }>()).error.code).toBe("bad_origin");
    const crossSite = await call("/api/summarize", {
      ...post({ transcript: "x" }),
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
  });

  it("refuses a POST without an Origin header", async () => {
    const { calls } = mockFetch(ok);
    const res = await call("/api/summarize", {
      ...post({ transcript: "x" }),
      headers: { "content-type": "application/json", origin: "" },
    });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("sends no-store on refusals as well", async () => {
    const tooLong = await call("/api/summarize", post({ transcript: "a".repeat(11) }), testEnv({ SUMMARY_MAX_CHARS: "10" }));
    const tooBig = await call("/api/summarize", post({ transcript: "a".repeat(300 * 1024) }));
    const wrongType = await call("/api/summarize", post({ transcript: "x" }, { "content-type": "text/plain" }));
    for (const res of [tooLong, tooBig, wrongType]) expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stops retrying when the next wait would pass the overall deadline", async () => {
    const { calls } = mockFetch(status(429));
    const started = Date.now();
    const { res, attempts } = await fetchWithRetry(
      "https://upstream.test/x",
      { method: "POST", body: "{}" },
      { attempts: 4, baseMs: 2000, timeoutMs: 1000, deadlineMs: 1500 },
    );
    expect(res.status).toBe(429);
    expect(attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
