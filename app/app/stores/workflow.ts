// The stored workflow state of every case this user may read (GET /workflow) and the task list (GET /tasks). The
// shell keeps the server's objects as they come; the per-case rules of applyCase() in the template (decisions before
// protocol, typed text kept over an older answer) arrive with the screens that show them.
import { defineStore } from "pinia";
import { ref } from "vue";
import { myTasks } from "@codebridge/domain/task-list";
import type { AttSet, CaseState, Mail, Session, Task, Workflow, WorkflowState } from "@codebridge/api-client";

export const useWorkflowStore = defineStore("workflow", () => {
  const cases = ref<Record<string, Partial<CaseState>>>({});
  const att = ref<Record<string, AttSet>>({});
  const sessions = ref<Session[]>([]);
  const mails = ref<Mail[]>([]);
  const tasks = ref<Task[]>([]);

  // GET /workflow and a user switch start from nothing, so a case the new user may not read keeps nothing from the
  // previous user (resetWorkflow() in the template).
  function replace(wf: Workflow, list: Task[]) {
    cases.value = { ...wf.cases };
    att.value = { ...wf.att };
    sessions.value = [...wf.sessions];
    mails.value = [...wf.mails];
    tasks.value = list;
  }

  // A write's state names the parts it changed; only those are replaced (contract: "the page replaces the named
  // parts"). Rows and staff go to their own stores (the session store routes them).
  function applyState(st: WorkflowState) {
    if (st.cases) for (const [id, cs] of Object.entries(st.cases)) cases.value[id] = { ...cases.value[id], ...cs };
    if (st.att) for (const [k, set] of Object.entries(st.att)) {
      // An answer older than the set this page holds must not roll it back.
      if ((set.version ?? 0) >= (att.value[set.key || k]?.version ?? 0)) att.value[set.key || k] = set;
    }
    if (st.sessions) sessions.value = [...st.sessions];
    if (st.mails) mails.value = [...st.mails];
  }

  // A case's tasks from a write's state replace that case's tasks, so the nav badge follows every write.
  function replaceTasksOf(file: string, list: Task[]) {
    tasks.value = [...tasks.value.filter((t) => t.pid !== file), ...list.map((t) => ({ ...t, pid: file }))];
  }

  // "Moje úlohy": assigned to the user, or (for a doctor) on a case they own; the nav badge counts the open ones.
  function openTaskCount(user: string, coordName: string | null, ownerOf: (file: string) => string | undefined) {
    return myTasks(tasks.value, user, coordName, ownerOf).filter((t) => !t.done).length;
  }

  return { cases, att, sessions, mails, tasks, replace, applyState, replaceTasksOf, openTaskCount };
});
