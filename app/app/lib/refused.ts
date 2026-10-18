// A refused write: the server's message as a toast, and the page brought back to what the
// server holds, so it never keeps showing a refused view.
import { ApiError, type WorkflowState } from "@codebridge/api-client";
import { useApi } from "./api";
import { errMsg } from "./msg";
import { useToastStore } from "../stores/toast";
import { useSessionStore } from "../stores/session";
import { useWorkflowStore } from "../stores/workflow";

const STATE_KEYS = ["cases", "att", "sessions", "mails", "patient", "staff"];
const isStateShape = (c: unknown): c is WorkflowState => !!c && typeof c === "object" && STATE_KEYS.some((k) => k in (c as object));

export function refused(e: unknown): void {
  const code = e instanceof ApiError ? e.code : "";
  // A reset of the demo data has its own notice and reload (session store).
  if (code !== "data_reset") useToastStore().show(errMsg(e));
  const current = e instanceof ApiError ? e.current : undefined;
  if (isStateShape(current)) useSessionStore().applyState(current);
  // Most conflicts carry no state: the stored state of every case is read again.
  else if (e instanceof ApiError && e.status === 409 && code !== "data_reset") void reloadWorkflow();
}

async function reloadWorkflow() {
  try {
    const wf = await useApi().workflow();
    useWorkflowStore().applyState({ cases: wf.cases, att: wf.att, sessions: wf.sessions, mails: wf.mails });
  } catch {
    // The refusal was shown; the next action tries again.
  }
}
