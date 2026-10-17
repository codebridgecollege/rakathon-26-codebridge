import { E, isTimeout, numVar } from "../http/errors";
import { PROMPT } from "../prompts/summarize-cs";
import { fetchWithRetry } from "./retry";

// Summarizes one MDT discussion transcript with the hackathon's Azure OpenAI deployment (EU).
// Logs only the upstream status, attempts and duration; never the transcript or the answer.
export async function summarizeTranscript(env: Env, transcript: string): Promise<string> {
  const base = (env.AI_GATEWAY_BASE || env.AZURE_OPENAI_BASE).replace(/\/+$/, "");
  const headers: Record<string, string> = { "api-key": env.AZURE_OPENAI_KEY, "content-type": "application/json" };
  // AI Gateway is optional: only when AI_GATEWAY_BASE is set; an authenticated gateway also needs its own token.
  if (env.AI_GATEWAY_BASE && env.AI_GATEWAY_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  // The model accepts only its default temperature; the strict prompt does the work instead.
  const body = JSON.stringify({
    model: env.AZURE_OPENAI_MODEL,
    max_completion_tokens: 400,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: transcript },
    ],
  });
  const opts = { attempts: numVar(env.LLM_MAX_ATTEMPTS), baseMs: numVar(env.LLM_RETRY_BASE_MS), timeoutMs: 60000 };
  const started = Date.now();
  let res: Response, attempts: number;
  try {
    ({ res, attempts } = await fetchWithRetry(`${base}/chat/completions`, { method: "POST", headers, body }, opts));
  } catch (e) {
    console.log(JSON.stringify({ route: "summarize", upstream: "fetch_failed", ms: Date.now() - started }));
    throw isTimeout(e) ? E.upstreamTimeout() : E.upstreamError("jazykového modelu");
  }
  console.log(JSON.stringify({ route: "summarize", upstream: res.status, attempts, ms: Date.now() - started }));
  if (res.status === 429 || res.status === 503) throw E.upstreamBusy();
  if (!res.ok) throw E.upstreamError("jazykového modelu");
  let d: { choices?: { message?: { content?: string | null } }[] };
  try {
    d = await res.json();
  } catch {
    throw E.upstreamError("jazykového modelu");
  }
  return (d.choices?.[0]?.message?.content ?? "").trim();
}
