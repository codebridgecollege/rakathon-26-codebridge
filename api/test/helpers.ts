import { vi } from "vitest";
import { env as baseEnv } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../src/index";

export const ORIGIN = "https://example.test";

type Limiter = { limit: (o: { key: string }) => Promise<{ success: boolean }> };
export const allow: Limiter = { limit: async () => ({ success: true }) };
export const deny: Limiter = { limit: async () => ({ success: false }) };

// Each test picks its own vars, secrets and limiters; the real limiter binding would share counters across tests.
export function testEnv(over: Record<string, unknown> = {}): Env {
  return {
    ...baseEnv,
    ELEVENLABS_API_KEY: "test-el",
    AZURE_OPENAI_KEY: "test-az",
    LLM_RETRY_BASE_MS: "1",
    RL_STT_TOKEN: allow,
    RL_STT_BATCH: allow,
    RL_LLM: allow,
    ...over,
  } as unknown as Env;
}

// Calls the Hono app directly inside workerd, so tests can pass an explicit env per case.
export async function call(path: string, init: RequestInit = {}, env: Env = testEnv()): Promise<Response> {
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

type Handler = (req: Request) => Response | Promise<Response>;

// Replaces global fetch for outbound calls; every call is recorded as a Request so tests can read URL, headers, body.
export function mockFetch(handler: Handler) {
  const calls: Request[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    calls.push(req.clone());
    return handler(req);
  });
  return { spy, calls };
}

// A sequence of canned responses, one per outbound call; the last one repeats.
export function sequence(...responses: (() => Response)[]): Handler {
  let i = 0;
  return () => {
    const make = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return make();
  };
}

// One second of 16 kHz 16-bit mono silence, the format the page records.
export function silentWav(seconds = 1, rate = 16000): Uint8Array {
  const dataBytes = seconds * rate * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}
