// Writes from the patient screen, with the old page's behaviour (caseApi() and refused() in the template): every write
// waits for the server and shows the state it answers with; a busy key ignores a second click while the first is on
// its way; a refusal shows the server's message, and a conflict puts the server's state back on screen.
import { ApiError, type WriteReply } from "@codebridge/api-client";
import { useApi } from "./api";
import { toast } from "./toast";
import { useSessionStore } from "../stores/session";

type T = (id: string, args?: Record<string, string | number>) => string;

const BUSY = new Set<string>();

const isStateShape = (c: unknown) => !!c && typeof c === "object" && ["cases", "att", "sessions", "mails", "patient", "staff"].some((k) => k in (c as object));

// The message of an error, in the doctor's language: the server's Czech text as it is, or the client's own message.
export const errorText = (t: T, e: unknown) =>
  e instanceof ApiError ? (e.message_cs ?? t(e.message_id ?? "api-error-write-failed")) : t("api-error-write-failed");

// The stored state of every case again (reloadWorkflow() in the template), so the page never keeps showing a view the
// server refused.
export async function reloadWorkflow(): Promise<void> {
  try {
    const wf = await useApi().workflow();
    useSessionStore().applyState({ cases: wf.cases || {}, att: wf.att || {}, sessions: wf.sessions || [], mails: wf.mails || [] });
  } catch {
    // The refusal was shown; the next action tries again.
  }
}

export function refused(t: T, e: unknown): void {
  const err = e instanceof ApiError ? e : null;
  // A data reset reloads the page with its own message (the session store).
  if (err?.code !== "data_reset") toast(errorText(t, e));
  if (err && isStateShape(err.current)) useSessionStore().applyState(err.current as never);
  // Most conflicts carry no state: read what the server holds now.
  else if (err?.status === 409 && err.code !== "data_reset") void reloadWorkflow();
}

export async function caseWrite<D>(
  t: T,
  call: () => Promise<WriteReply<D>>,
  opts: { busyKey?: string; onOk?: (r: WriteReply<D>) => void; onErr?: (e: unknown) => void } = {},
): Promise<WriteReply<D> | null> {
  const { busyKey } = opts;
  if (busyKey && BUSY.has(busyKey)) return null;
  if (busyKey) BUSY.add(busyKey);
  try {
    const r = await call();
    useSessionStore().applyState(r.state);
    opts.onOk?.(r);
    return r;
  } catch (e) {
    refused(t, e);
    opts.onErr?.(e);
    return null;
  } finally {
    if (busyKey) BUSY.delete(busyKey);
  }
}
