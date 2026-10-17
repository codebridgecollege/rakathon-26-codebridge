import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../types";
import { E, numVar } from "../http/errors";
import { rateLimit } from "../http/rate-limit";
import { summarizeTranscript } from "../services/azure-openai";
import { PROMPT_VERSION } from "../prompts/summarize-cs";

export const summarize = new Hono<AppEnv>().post(
  "/",
  rateLimit("RL_LLM"),
  // 40 000 Czech characters is at most about 160 KB of UTF-8; anything bigger is refused before parsing.
  bodyLimit({
    maxSize: 256 * 1024,
    onError: () => {
      throw E.transcriptTooLarge();
    },
  }),
  async (c) => {
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      throw E.unsupportedMediaType();
    }
    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      throw E.badRequest();
    }
    const transcript = (parsed as { transcript?: unknown } | null)?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) throw E.badRequest();
    // Refused rather than cut silently: a summary of half a discussion would look complete.
    if (transcript.length > numVar(c.env.SUMMARY_MAX_CHARS)) throw E.transcriptTooLarge();
    if (!c.env.AZURE_OPENAI_KEY) throw E.notConfigured();
    const summary = await summarizeTranscript(c.env, transcript);
    return c.json({ summary, model: c.env.AZURE_OPENAI_MODEL, prompt_version: PROMPT_VERSION });
  },
);
