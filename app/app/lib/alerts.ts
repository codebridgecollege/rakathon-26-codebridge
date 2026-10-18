// Alert handling: "Vzít na vědomí" and "Vyřešeno", both reversible with
// "Vrátit". Every action is a new history entry with who and when; nothing is edited or removed. The entry shows at
// once; the server stores it against the state this page saw, and a refusal takes it out again.
import { toRaw } from "vue";
import type { AlertAction, AlertKey, AlertEvent } from "@codebridge/domain/case-view";
import { alertState } from "@codebridge/domain/case-view";
import type { PatientCtx } from "../composables/usePatient";
import { useApi } from "./api";
import { refused } from "./writes";
import { useSessionStore } from "../stores/session";
import { useWorkflowStore } from "../stores/workflow";
import type { T } from "./dates";

export async function alertAct(c: PatientCtx, t: T, i: AlertKey, action: AlertAction): Promise<void> {
  // The administrator reads; the server refuses alert events from that role, so nothing is sent.
  if (!c.canSetStatus.value) return;
  const p = c.p.value;
  const before = alertState(c.alertHist.value, i).state;
  const wf = useWorkflowStore();
  // Read back through the store: the value "??=" returns is the plain object, whose changes would not redraw.
  wf.cases[p.id] ??= { case_id: p.id, file: p.file };
  const cs = wf.cases[p.id]!;
  const entry: AlertEvent = { i, action, who: c.userName.value, when: new Date().toISOString() };
  cs.alertHist = [...((cs.alertHist ?? []) as AlertEvent[]), entry] as never;
  try {
    const r = await useApi().alertEvent(p.id, i, { action, expected_state: before });
    useSessionStore().applyState(r.state);
  } catch (e) {
    const now = wf.cases[p.id];
    // The store hands back reactive proxies; the entry is found by its raw object.
    if (now) now.alertHist = ((now.alertHist ?? []) as AlertEvent[]).filter((x) => toRaw(x) !== entry) as never;
    refused(t, e);
  }
}
