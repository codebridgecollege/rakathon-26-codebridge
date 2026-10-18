// One write to the API as the old page's caseApi() and refused() did it: a busy key ignores a second click while the
// first is on its way, the answer's state replaces the parts it names, and a refusal shows the server's Czech message.
// A conflict's state is applied; a conflict without one reloads the stored workflow, so the page never keeps showing a
// view the server refused.
import { useFluent } from "fluent-vue";
import { ApiError, type WorkflowState, type WriteReply } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { toast } from "../lib/toast";
import { useSessionStore } from "../stores/session";
import { usePatientsStore } from "../stores/patients";

// Shared across components: the busy keys of writes in flight (BUSY in the template).
const busy = new Set<string>();

const STATE_KEYS = ["cases", "att", "sessions", "mails", "patient", "staff"];
const isStateShape = (c: unknown): c is WorkflowState => !!c && typeof c === "object" && STATE_KEYS.some((k) => k in (c as object));

export function useWrite() {
  const { $t } = useFluent();
  const session = useSessionStore();

  // The server's message as it is; the client's own errors through the catalog.
  const errorText = (e: unknown) =>
    e instanceof ApiError ? (e.message_cs ?? $t(e.message_id ?? "api-error-write-failed")) : $t("api-error-write-failed");

  // The stored state of every case again (reloadWorkflow() in the template).
  async function reloadWorkflow() {
    try {
      const wf = await useApi().workflow();
      session.applyState({ cases: wf.cases, att: wf.att, sessions: wf.sessions, mails: wf.mails });
    } catch {
      // The refusal was shown already; the next action tries again.
    }
  }

  // After a refused booking the list is read again, so the calendar shows who holds the slot now.
  async function refreshPatients() {
    try {
      const list = await useApi().patients();
      const store = usePatientsStore();
      for (const row of list.patients) {
        const p = store.byFile(row.file);
        if (p) Object.assign(p, { status: row.status, slot: row.slot, updated: row.updated });
        else store.rows.push(row);
      }
    } catch {
      // The refusal toast already told the user; the next action reloads.
    }
  }

  function refused(e: unknown) {
    const code = e instanceof ApiError ? e.code : "";
    // A data reset reloads the page (session store); its own message says so.
    if (code !== "data_reset") toast(errorText(e));
    const cur = e instanceof ApiError ? e.current : undefined;
    if (isStateShape(cur)) session.applyState(cur);
    else if (e instanceof ApiError && e.status === 409 && code !== "data_reset") void reloadWorkflow();
  }

  async function run<T>(
    send: () => Promise<WriteReply<T>>,
    o: { busy?: string; onOk?: (r: WriteReply<T>) => void; onErr?: (e: unknown) => void } = {},
  ): Promise<WriteReply<T> | null> {
    if (o.busy && busy.has(o.busy)) return null;
    if (o.busy) busy.add(o.busy);
    try {
      const r = await send();
      session.applyState(r.state);
      o.onOk?.(r);
      return r;
    } catch (e) {
      refused(e);
      o.onErr?.(e);
      return null;
    } finally {
      if (o.busy) busy.delete(o.busy);
    }
  }

  return { run, refused, errorText, reloadWorkflow, refreshPatients };
}
