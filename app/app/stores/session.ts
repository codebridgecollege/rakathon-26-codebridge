// Who is using the app and whether the server's data is loaded: boot,
// switchApiUser(). The demo has no login; the user is picked by hand and travels as a staff id (X-Demo-User, and the
// cb_demo_user cookie for page images). The UI says so in the picker's label.
import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError, type Health, type Me, type WorkflowState } from "@codebridge/api-client";
import { onDataReset, useApi } from "../lib/api";
import { useCasesStore } from "./cases";
import { usePatientsStore } from "./patients";
import { useStaffStore } from "./staff";
import { useWorkflowStore } from "./workflow";
import { useUploadsStore } from "./uploads";

export type Notice = { message_cs: string | null; message_id: string | null };

// Page images load through <img>, which cannot send a header, so the same staff id also goes in a cookie.
function setDemoUserCookie(id: string) {
  try {
    document.cookie = `cb_demo_user=${encodeURIComponent(id)}; path=/; SameSite=Strict`;
  } catch {
    // Cookies blocked: images then load as the default demo user.
  }
}

const noticeOf = (e: unknown): Notice =>
  e instanceof ApiError ? { message_cs: e.message_cs, message_id: e.message_id } : { message_cs: null, message_id: "api-error-request-failed" };

export const useSessionStore = defineStore("session", () => {
  const phase = ref<"booting" | "ready" | "failed">("booting");
  const health = ref<Health | null>(null);
  const me = ref<Me | null>(null);
  // A failed boot or switch; shown in the main area.
  const error = ref<Notice | null>(null);
  const resetting = ref(false);
  // Separate so tests can observe a reload instead of navigating away.
  let reload = () => location.reload();

  onDataReset(() => {
    if (resetting.value) return;
    resetting.value = true;
    error.value = { message_cs: null, message_id: "data-reset-reload" };
    setTimeout(() => reload(), 1500);
  });

  function setDemoUser(id: string | null) {
    useApi().setUser(id);
    if (id) setDemoUserCookie(id);
  }

  // Everything the shell needs from the server. Nothing is assigned until every request succeeded, so a failed
  // switch leaves the previous user's view whole.
  async function loadFromApi() {
    const api = useApi();
    const who = await api.me();
    setDemoUser(who.user.id);
    // Case data loads per case when a case is opened (cases store); /workflow is the stored state of every case this
    // user may read, so a reload shows what the server holds.
    const [staff, list, tasks, wf] = await Promise.all([api.staff(), api.patients(), api.tasks("all"), api.workflow()]);
    useStaffStore().apply(staff);
    usePatientsStore().replace(list.patients, list.total);
    useWorkflowStore().replace(wf, tasks.tasks);
    me.value = who;
  }

  async function boot() {
    phase.value = "booting";
    error.value = null;
    try {
      const h = await useApi().health();
      // Only our Worker with a seeded database serves data; anything else (a static host, an unseeded server) has none.
      if (h.service !== "codebridge-mdt" || h.features?.data !== true) throw new ApiError("no_data", 0, null, "api-error-no-api");
      health.value = h;
      await loadFromApi();
      phase.value = "ready";
    } catch (e) {
      setDemoUser(null);
      error.value = noticeOf(e);
      phase.value = "failed";
    }
  }

  // Screens that hold something of the current user (an open intake, a phone upload session) register what to end
  // before a user switch; the switch waits for them.
  const beforeSwitch: (() => Promise<void> | void)[] = [];
  function onBeforeUserSwitch(fn: () => Promise<void> | void) {
    beforeSwitch.push(fn);
  }
  // Checks that may refuse a switch (resolve false; the check shows why), run once the new user is known.
  const switchChecks: (() => Promise<boolean> | boolean)[] = [];
  function onUserSwitchCheck(fn: () => Promise<boolean> | boolean) {
    switchChecks.push(fn);
  }
  // What ends only when the switch goes ahead (the recording, which belongs to the user who started it).
  const leaving: (() => Promise<void> | void)[] = [];
  function onUserLeaving(fn: () => Promise<void> | void) {
    leaving.push(fn);
  }
  // What was read under the previous user and goes once the new user's data is in.
  const switched: (() => void)[] = [];
  function onUserSwitched(fn: () => void) {
    switched.push(fn);
  }

  // A user switch reloads what the server lets the new user see, so the list, tasks and case data follow the new
  // role. A name the server does not know is refused rather than sent under the previous user's id.
  async function switchUser(id: string | null): Promise<boolean> {
    await Promise.all(beforeSwitch.map((fn) => fn()));
    if (!id) {
      error.value = { message_cs: null, message_id: "user-switch-unknown" };
      return false;
    }
    // A screen may refuse the switch (a draft that could not be stored under the user who typed it); nothing of the
    // current user has been ended at this point, so a refusal leaves the view whole.
    for (const check of switchChecks) if (!(await check())) return false;
    await Promise.all(leaving.map((fn) => fn()));
    const prev = useApi().userId;
    setDemoUser(id);
    try {
      await loadFromApi();
    } catch (e) {
      setDemoUser(prev);
      error.value = noticeOf(e);
      return false;
    }
    // The case data and the upload lists were read under the previous user's access; they go with the switch.
    useCasesStore().reset();
    useUploadsStore().reset();
    for (const fn of switched) fn();
    error.value = null;
    return true;
  }

  // A write's state: rows and staff to their stores, the rest to the workflow store. A case's status, slot and tasks
  // also update its list row and the task list, so the header's badge and the list follow every write.
  function applyState(st: WorkflowState | null | undefined) {
    if (!st) return;
    if (st.staff) useStaffStore().apply(st.staff);
    if (st.patient) usePatientsStore().upsert(st.patient);
    for (const cs of Object.values(st.cases ?? {})) {
      const file = usePatientsStore().applyCase(cs);
      if (file && cs.tasks) useWorkflowStore().replaceTasksOf(file, cs.tasks);
    }
    useWorkflowStore().applyState(st);
  }

  function setReload(fn: () => void) {
    reload = fn;
  }

  return { phase, health, me, error, resetting, boot, switchUser, onBeforeUserSwitch, onUserSwitchCheck, onUserLeaving, onUserSwitched, applyState, loadFromApi, setReload };
});
