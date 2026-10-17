import { describe, expect, it } from "vitest";
import { call, testEnv } from "./helpers";

describe("GET /api/health", () => {
  it("returns the shared contract shape", async () => {
    // DATA_API off keeps features.data false whatever the local database holds; data-api.test.ts covers it on.
    const res = await call("/api/health", {}, testEnv({ DATA_API: "off" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      service: "codebridge-mdt",
      runtime: "worker",
      version: "dev",
      auth_mode: "demo",
      features: { stt: true, summarize: true, data: false, transcripts: false, pipeline: false },
      seeded_at: null,
      demo: null,
      limits: { stt_audio_bytes: 100000000, summary_chars: 40000, audio_part_bytes: 5242880, audio_max_minutes: 120 },
    });
  });

  it("reports a feature off when its secret is missing", async () => {
    const res = await call("/api/health", {}, testEnv({ ELEVENLABS_API_KEY: "", AZURE_OPENAI_KEY: undefined, DATA_API: "off" }));
    const body = await res.json<{ features: Record<string, boolean> }>();
    expect(body.features).toEqual({ stt: false, summarize: false, data: false, transcripts: false, pipeline: false });
  });

  it("answers in access mode without a token, because it holds no data", async () => {
    const res = await call(
      "/api/health",
      {},
      testEnv({ AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", ACCESS_AUD: "aud" }),
    );
    expect(res.status).toBe(200);
  });

  it("answers unknown API paths with the JSON 404 and no-store", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "not_found", message_cs: "Neznámá adresa API." } });
  });
});
