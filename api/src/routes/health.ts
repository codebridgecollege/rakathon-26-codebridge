import { Hono } from "hono";
import type { AppEnv } from "../types";

// Public: it holds no data and no key material; the booleans only say whether a secret is set, so the page
// knows which features this host offers. features.data is true when the data API is switched on and the database
// is seeded; the page then loads its data from the API instead of the copy embedded in the HTML.
async function seededAt(env: Env): Promise<string | null> {
  if (env.DATA_API !== "on" || !env.DB || !env.DOCS) return null;
  try {
    const r = await env.DB.prepare("SELECT seeded_at FROM seed_meta WHERE id = 1").first<{ seeded_at: string }>();
    return r?.seeded_at ?? null;
  } catch {
    // An unmigrated database is "no data", not an outage of the health check.
    return null;
  }
}

export const health = new Hono<AppEnv>().get("/", async (c) => {
  const seeded = await seededAt(c.env);
  return c.json({
    ok: true,
    service: "codebridge-mdt",
    runtime: "worker",
    version: c.env.GIT_SHA || "unknown",
    auth_mode: c.env.AUTH_MODE,
    features: { stt: !!c.env.ELEVENLABS_API_KEY, summarize: !!c.env.AZURE_OPENAI_KEY, data: !!seeded },
    seeded_at: seeded,
    limits: {
      stt_audio_bytes: Number(c.env.STT_MAX_AUDIO_BYTES) || 0,
      summary_chars: Number(c.env.SUMMARY_MAX_CHARS) || 40000,
    },
  });
});
