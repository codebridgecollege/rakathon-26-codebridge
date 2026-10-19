import { vi } from "vitest";
import { env as baseEnv } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../src/index";

export const ORIGIN = "https://example.test";

type Limiter = { limit: (o: { key: string }) => Promise<{ success: boolean }> };
export const allow: Limiter = { limit: async () => ({ success: true }) };
export const deny: Limiter = { limit: async () => ({ success: false }) };

// Each test picks its own vars, secrets and limiters; the real limiter binding would share counters across tests.
// Every secret and every var a developer might override in .dev.vars is set here, so a local .dev.vars (which the
// test runner loads) neither leaks real keys into a test nor changes the results.
export function testEnv(over: Record<string, unknown> = {}): Env {
  return {
    ...baseEnv,
    ELEVENLABS_API_KEY: "test-el",
    AZURE_OPENAI_KEY: "test-az",
    AI_GATEWAY_TOKEN: "",
    AI_GATEWAY_BASE: "",
    AUTH_MODE: "demo",
    DATA_API: "on",
    CLINICAL_ACCESS: "all_roles",
    // The login is off unless a test turns it on (test/oidc.test.ts); a developer's .dev.vars never reaches a test.
    OIDC_ISSUER: "",
    OIDC_CLIENT_ID: "",
    OIDC_CLIENT_SECRET: "",
    SESSION_KEY: "",
    AZURE_OPENAI_BASE: "https://apim-rakathon-q7146n.azure-api.net/openai/v1",
    AZURE_OPENAI_MODEL: "gpt-6-luna-dz-eu",
    ELEVENLABS_API_BASE: "https://api.elevenlabs.io",
    STT_REALTIME_MODEL: "scribe_v2_realtime",
    STT_BATCH_MODEL: "scribe_v2",
    STT_LANGUAGE: "cs",
    STT_MAX_AUDIO_BYTES: "100000000",
    SUMMARY_MAX_CHARS: "40000",
    LLM_MAX_ATTEMPTS: "4",
    GIT_SHA: "dev",
    LLM_RETRY_BASE_MS: "1",
    RL_STT_TOKEN: allow,
    RL_STT_BATCH: allow,
    RL_LLM: allow,
    RL_AUDIO: allow,
    RL_UPLOAD: allow,
    UPLOAD_POLICY: "fixtures_only",
    UPLOAD_STORE_ORGS: "",
    UPLOAD_MAX_BYTES: "20971520",
    PAGE_READER_URL: "https://page-reader.test",
    PAGE_READER_CONTAINER: "off",
    PIPELINE_ORGS: "",
    STT_BATCH_SEED: "1",
    AUDIO_PART_BYTES: "5242880",
    AUDIO_MAX_MINUTES_PER_CASE: "120",
    // The model interface (src/services/model.ts): a .test host, so an unmocked call never leaves the test.
    MODEL_PROVIDER: "azure-openai",
    MODEL_BASE: "https://model.test/openai/v1",
    MODEL_NAME: "test-model",
    MODEL_API_KEY: "",
    MODEL_REASONING_EFFORT: "low",
    MODEL_TIMEOUT_MS: "5000",
    MODEL_DEADLINE_MS: "20000",
    MODEL_MAX_RETRY_WAIT_MS: "50",
    MODEL_MAX_INPUT_CHARS: "200000",
    MODEL_MAX_IMAGE_BYTES: "4000000",
    MODEL_MAX_OUTPUT_TOKENS: "8000",
    MODEL_BUDGET_WINDOW_HOURS: "24",
    MODEL_BUDGET_PAGES_PER_ORG: "600",
    MODEL_BUDGET_PAGES_PER_CASE: "80",
    MODEL_BUDGET_CALLS_PER_PAGE: "4",
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
