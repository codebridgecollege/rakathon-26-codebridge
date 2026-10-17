import { ApiError, E, isTimeout, numVar } from "../http/errors";
import { PROMPT } from "../prompts/summarize-cs";
import { fetchWithRetry } from "./retry";

// Summarizes one MDT discussion transcript with the hackathon's Azure OpenAI deployment (EU).
// Logs only the upstream status, attempts and duration; never the transcript or the answer.
// `attempts` lets the speaker pass Workflow make one call per step attempt: there the step's retry policy is the
// backoff, not an in-process loop. Errors carry the upstream status in `upstream` (never in the response).
export async function summarizeTranscript(env: Env, transcript: string, o: { attempts?: number } = {}): Promise<string> {
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
  const opts = { attempts: o.attempts ?? numVar(env.LLM_MAX_ATTEMPTS), baseMs: numVar(env.LLM_RETRY_BASE_MS), timeoutMs: 60000, deadlineMs: 90000 };
  const started = Date.now();
  let res: Response, attempts: number;
  try {
    ({ res, attempts } = await fetchWithRetry(`${base}/chat/completions`, { method: "POST", headers, body }, opts));
  } catch (e) {
    console.log(JSON.stringify({ route: "summarize", upstream: "fetch_failed", ms: Date.now() - started }));
    throw withUpstream(isTimeout(e) ? E.upstreamTimeout() : E.upstreamError("jazykového modelu"), "network");
  }
  console.log(JSON.stringify({ route: "summarize", upstream: res.status, attempts, ms: Date.now() - started }));
  if (res.status === 429 || res.status === 503) throw withUpstream(E.upstreamBusy(), res.status);
  if (!res.ok) throw withUpstream(E.upstreamError("jazykového modelu"), res.status);
  let d: { choices?: { message?: { content?: string | null } }[] };
  try {
    d = await res.json();
  } catch {
    throw withUpstream(E.upstreamError("jazykového modelu"), 502);
  }
  return (d.choices?.[0]?.message?.content ?? "").trim();
}

function withUpstream(e: ApiError, upstream: number | "network"): ApiError {
  e.upstream = upstream;
  return e;
}
