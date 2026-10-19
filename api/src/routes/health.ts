import { Hono } from "hono";
import type { AppEnv } from "../types";
import { pipelineOn } from "../services/page-reader";
import { orgStmt } from "../store/sql";
import { demoMembership } from "../store/people";
import { demoUserOf } from "../middleware/viewer";
import { LEGACY_ORG } from "../domain/orgs";

// Public: it holds no data and no key material; the booleans only say whether a secret is set, so the page
// knows which features this host offers. features.data is true when the data API is switched on and the database
// is seeded; the app then loads its data from the API.
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

// A demo org's state for the "ukázková data" banner and the write header X-Data-Epoch. No data, no identity. Each org
// has its own epoch; this route answers before any login, so it uses the org of the picked demo user (AUTH_MODE=demo)
// or demo org A. /api/me and every write answer carry the epoch of the org the request acts in.
async function demoState(env: Env, demoUser: string | null) {
  if (!(await seededAt(env))) return null;
  try {
    const m = demoUser ? await demoMembership(env.DB, demoUser) : null;
    return await orgStmt(env.DB, m?.org_id ?? LEGACY_ORG, "SELECT data_epoch, reset_at, seed_version FROM demo_state WHERE org_id = ?org").first<{
      data_epoch: number;
      reset_at: string | null;
      seed_version: string | null;
    }>();
  } catch {
    return null;
  }
}

export const health = new Hono<AppEnv>().get("/", async (c) => {
  const seeded = await seededAt(c.env);
  const demo = await demoState(c.env, c.env.AUTH_MODE === "demo" ? demoUserOf(c) : null);
  return c.json({
    ok: true,
    service: "codebridge-mdt",
    runtime: "worker",
    version: c.env.GIT_SHA || "unknown",
    auth_mode: c.env.AUTH_MODE,
    // transcripts: the server stores the AI recording and runs the speaker pass (step 5); the page then uses it.
    // pipeline: the document pipeline without an LLM can run (step 6: PAGE_READER_URL or the page reader container is set).
    features: { stt: !!c.env.ELEVENLABS_API_KEY, summarize: !!c.env.AZURE_OPENAI_KEY, data: !!seeded, transcripts: !!seeded && !!c.env.SPEAKER_PASS, pipeline: !!seeded && pipelineOn(c.env) },
    seeded_at: seeded,
    demo: demo ? { ...demo, reset_enabled: c.env.DEMO_RESET_ENABLED === "true" } : null,
    limits: {
      stt_audio_bytes: Number(c.env.STT_MAX_AUDIO_BYTES) || 0,
      summary_chars: Number(c.env.SUMMARY_MAX_CHARS) || 40000,
      audio_part_bytes: Number(c.env.AUDIO_PART_BYTES) || 5242880,
      audio_max_minutes: Number(c.env.AUDIO_MAX_MINUTES_PER_CASE) || 120,
    },
  });
});
