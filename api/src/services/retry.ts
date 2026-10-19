export type RetryOpts = {
  attempts: number;
  baseMs: number;
  maxDelayMs?: number;
  timeoutMs: number;
  // Total time for all attempts and waits; the page should not wait minutes for one summary.
  deadlineMs?: number;
  retryOn?: number[];
};

// About 70 teams share the hackathon endpoint (CLAUDE.md): back off exponentially on 429 and 503, honor
// Retry-After, cap the wait. Only for re-sendable bodies (string or ArrayBuffer), never a stream.
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  o: RetryOpts,
): Promise<{ res: Response; attempts: number }> {
  const retryOn = o.retryOn ?? [429, 503];
  const maxDelay = o.maxDelayMs ?? 8000;
  const end = Date.now() + (o.deadlineMs ?? Infinity);
  for (let i = 1; ; i++) {
    const timeout = Math.max(1, Math.min(o.timeoutMs, end - Date.now()));
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      // The caller records how many times the body was sent, also when the last attempt failed on the network.
      if (e instanceof Error) (e as Error & { attempts?: number }).attempts = i;
      throw e;
    }
    if (!retryOn.includes(res.status) || i >= o.attempts) return { res, attempts: i };
    const ra = retryAfterMs(res.headers);
    const base = ra ?? o.baseMs * 2 ** (i - 1);
    // Jitter spreads retries from many isolates so they do not hit the endpoint in lockstep.
    const wait = Math.min(maxDelay, base) * (0.8 + Math.random() * 0.4);
    // No time left for another attempt after the wait: report the refusal now instead of timing out later.
    if (Date.now() + wait + 1000 > end) return { res, attempts: i };
    // The body of a refused call is not needed; cancelling frees the connection.
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait));
  }
}

// The wait the server asks for: Azure sends retry-after-ms next to Retry-After (seconds or an HTTP date).
export function retryAfterMs(h: Headers, now = Date.now()): number | null {
  const ms = Number(h.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const raw = h.get("retry-after");
  if (!raw) return null;
  const s = Number(raw);
  if (Number.isFinite(s) && s > 0) return s * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > now ? at - now : null;
}
