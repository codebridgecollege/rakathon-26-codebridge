// One write to the API a busy key ignores a second click while the first is on its
// way, the answer's state replaces the parts it names, and a refusal goes through refused() (lib/refused.ts): the
// server's message as a toast, and the conflict's state applied or the stored workflow read again.
import { useFluent } from "fluent-vue";
import { ApiError, type WriteReply } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { refused } from "../lib/refused";
import { useSessionStore } from "../stores/session";
import { usePatientsStore } from "../stores/patients";

// Shared across components: the busy keys of writes in flight.
const busy = new Set<string>();

export function useWrite() {
  const { $t } = useFluent();
  const session = useSessionStore();

  // The server's message as it is; the client's own errors through the catalog.
  const errorText = (e: unknown) =>
    e instanceof ApiError ? (e.message_cs ?? $t(e.message_id ?? "api-error-write-failed")) : $t("api-error-write-failed");

  // The stored state of every case again, through the session store so list rows and tasks follow (a staff rename or
  // removal changes draft steps and attendance on the server).
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
