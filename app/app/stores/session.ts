// Who is using the app and whether the server's data is loaded: boot, switches, the login.
// - Demo mode (AUTH_MODE=demo, local work and the browser suite): no login; the user is picked by hand and travels as a
//   membership id (X-Demo-User, and the cb_demo_user cookie for page images). The picker's label says so.
// - OIDC mode (the deployed hosts): the Worker's login session (an HttpOnly cookie) says who it is. The account menu
//   switches org and, in a demo org, role; a lost session leads to the login, or to the "Přihlášení vypršelo"
//   dialog while something is unsaved (docs/design/AUTH.md, "Losing the session mid-work").
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ApiError, type DemoPicker, type Health, type Me, type WorkflowState } from "@codebridge/api-client";
import { onDataReset, onSessionChanged, onUnauthenticated, useApi } from "../lib/api";
import { chooseLocale, storedLocale } from "../lib/i18n";
import { useCasesStore } from "./cases";
import { usePatientsStore } from "./patients";
import { useStaffStore } from "./staff";
import { useWorkflowStore } from "./workflow";
import { useUploadsStore } from "./uploads";

export type Notice = { message_cs: string | null; message_id: string | null };
// The dialog's states: waiting for the user to log in, checking, the login is not back yet, or another person or role
// logged in, under whom the unsaved work must not be stored.
export type ExpiredState = "waiting" | "checking" | "still" | "other";

// Page images load through <img>, which cannot send a header, so the same membership id also goes in a cookie.
function setDemoUserCookie(id: string) {
  try {
    document.cookie = `cb_demo_user=${encodeURIComponent(id)}; path=/; SameSite=Strict`;
  } catch {
    // Cookies blocked: images then load as the default demo user.
  }
}

const noticeOf = (e: unknown): Notice =>
  e instanceof ApiError ? { message_cs: e.message_cs, message_id: e.message_id } : { message_cs: null, message_id: "api-error-request-failed" };

// The address of the login with the way back to where the user is, in the language the app shows.
export function loginUrl(path: string, search: string, popup = false): string {
  const lang = chooseLocale(search, storedLocale());
  const q = new URLSearchParams(popup ? { popup: "1" } : { to: path + search });
  if (lang !== "cs") q.set("lang", lang);
  return `/auth/login?${q}`;
}

export const useSessionStore = defineStore("session", () => {
  const phase = ref<"booting" | "ready" | "failed">("booting");
  const health = ref<Health | null>(null);
  const me = ref<Me | null>(null);
  // A failed boot or switch; shown in the main area.
  const error = ref<Notice | null>(null);
  // The picker's entries grouped by org (AUTH.md: an entry is a membership, not a person). Null when the server has no
  // such list, and the header then builds today's picker from the staff store.
  const picker = ref<DemoPicker["orgs"] | null>(null);
  const resetting = ref(false);
  const oidc = computed(() => health.value?.auth_mode === "oidc");
  // The "Přihlášení vypršelo" dialog; null when closed.
  const expired = ref<ExpiredState | null>(null);
  // Set while the page goes to the login, so nothing else is drawn over the way out.
  const leavingForLogin = ref(false);
  // Separate so tests can observe a reload or a navigation instead of leaving the page.
  let reload = () => location.reload();
  let navigate = (url: string) => location.assign(url);
  let openWindow = (url: string): void => void window.open(url, "_blank", "noopener");

  onDataReset(() => {
    if (resetting.value) return;
    resetting.value = true;
    error.value = { message_cs: null, message_id: "data-reset-reload" };
    setTimeout(() => reload(), 1500);
  });
  // Another tab switched org or role, or another person logged in: this tab shows someone the session no longer is.
  // While the lost-login dialog waits, the new login acts as the person's first membership until checkLogin switches
  // it back: a request refused in that gap fails like any other (the recorder and the drafts send again) instead of
  // reloading the page the dialog exists to keep.
  onSessionChanged(() => {
    if (resetting.value || expired.value !== null) return;
    resetting.value = true;
    error.value = { message_cs: null, message_id: "session-changed-reload" };
    setTimeout(() => reload(), 1500);
  });

  function setDemoUser(id: string | null) {
    // With a login the session cookie says who it is; a picked id would only be ignored by the server.
    if (oidc.value) id = null;
    useApi().setUser(id);
    if (id) setDemoUserCookie(id);
  }

  // With a login, every request names whom this tab shows, so a switch or another login in a second tab (one session
  // cookie serves them all) is refused instead of acting as someone else here (409 session_changed, then a reload).
  function setShown(who: Me | null) {
    useApi().setActingAs(oidc.value && who ? `${who.membership_id}:${who.real_user?.id ?? who.user.id}` : null);
  }

  // Everything the shell needs from the server. Nothing is assigned until every request succeeded, so a failed
  // switch leaves the previous user's view whole.
  async function loadFromApi() {
    const api = useApi();
    const who = await api.me();
    setDemoUser(who.membership_id);
    setShown(who);
    // Case data loads per case when a case is opened (cases store); /workflow is the stored state of every case this
    // user may read, so a reload shows what the server holds.
    const [staff, list, tasks, wf] = await Promise.all([api.staff(), api.patients(), api.tasks("all"), api.workflow()]);
    useStaffStore().apply(staff);
    usePatientsStore().replace(list.patients, list.total);
    useWorkflowStore().replace(wf, tasks.tasks);
    me.value = who;
  }

  // Only a demo server lists memberships; any failure (404 on an older server) falls back to the staff-based picker.
  async function loadPicker() {
    if (health.value?.auth_mode !== "demo") {
      picker.value = null;
      return;
    }
    // The list on screen stays until the new one arrives, so a refresh after a staff change does not flicker.
    try {
      picker.value = (await useApi().demoMemberships()).orgs;
    } catch {
      picker.value = null;
    }
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
      await loadPicker();
      phase.value = "ready";
    } catch (e) {
      // On the way to the login page: no error flashes before the page goes.
      if (leavingForLogin.value) return;
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
  // Whether something would be lost by leaving the page now (a draft not yet stored, a running recording).
  const unsavedChecks: (() => boolean)[] = [];
  function onUnsavedCheck(fn: () => boolean) {
    unsavedChecks.push(fn);
  }
  const hasUnsaved = () => unsavedChecks.some((fn) => fn());

  // A switch of who acts (the demo picker, or the login's org or role switch): the same protocol for each. Screens
  // store what was typed first and may refuse; the recording stops; the server switches; then everything the new
  // user may see is read again.
  // The org or role switch request while it is on its way, and when the last one took effect: a request that left
  // before then carried the session ID the switch replaced, and is sent again rather than taken for a lost login.
  let rotating: Promise<unknown> | null = null;
  let switchedAt = 0;
  async function runSwitch(serverSwitch: () => Promise<void>, undo: () => void): Promise<boolean> {
    await Promise.all(beforeSwitch.map((fn) => fn()));
    // A screen may refuse the switch (a draft that could not be stored under the user who typed it); nothing of the
    // current user has been ended at this point, so a refusal leaves the view whole.
    for (const check of switchChecks) if (!(await check())) return false;
    await Promise.all(leaving.map((fn) => fn()));
    try {
      await serverSwitch();
      await loadFromApi();
    } catch (e) {
      undo();
      // The session itself is gone; what was typed is stored and the recording has stopped, so the login can come.
      if (oidc.value && e instanceof ApiError && e.status === 401) {
        goToLogin();
        return false;
      }
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

  // A user switch reloads what the server lets the new user see, so the list, tasks and case data follow the new
  // role. A name the server does not know is refused rather than sent under the previous user's id.
  async function switchUser(id: string | null): Promise<boolean> {
    if (!id) {
      await Promise.all(beforeSwitch.map((fn) => fn()));
      error.value = { message_cs: null, message_id: "user-switch-unknown" };
      return false;
    }
    const prev = useApi().userId;
    return runSwitch(
      async () => setDemoUser(id),
      () => setDemoUser(prev),
    );
  }

  // The login's switches (OIDC mode). The server issues a new session cookie; a refusal leaves the old session.
  // From the switch request until the new /me arrives, requests name no identity: the server then does not compare
  // (X-Acting-As is a check between tabs), and a read resent with the new cookie is not refused as "changed".
  async function rotate(call: () => Promise<unknown>) {
    useApi().setActingAs(null);
    const p = call();
    rotating = p;
    try {
      await p;
      switchedAt = performance.now();
    } catch (e) {
      setShown(me.value);
      throw e;
    } finally {
      rotating = null;
    }
  }
  const switchOrg = (orgId: string) => runSwitch(() => rotate(() => useApi().switchOrg(orgId)), () => {});
  const switchRole = (membershipId: string) => runSwitch(() => rotate(() => useApi().switchRole(membershipId)), () => {});

  // "Odhlásit": what was typed is stored first (a refusal keeps the user here), the recording stops, then the Worker
  // ends the session and names the IdP's logout to go to.
  async function logout(): Promise<boolean> {
    await Promise.all(beforeSwitch.map((fn) => fn()));
    for (const check of switchChecks) if (!(await check())) return false;
    await Promise.all(leaving.map((fn) => fn()));
    let next = "/";
    try {
      const r = await fetch("/auth/logout", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
      const body = (await r.json()) as { redirect?: unknown };
      if (typeof body.redirect === "string") next = body.redirect;
    } catch {
      // The server did not answer: the app's own page then shows whether the session is still there.
    }
    leavingForLogin.value = true;
    navigate(next);
    return true;
  }

  function goToLogin() {
    if (leavingForLogin.value) return;
    leavingForLogin.value = true;
    navigate(loginUrl(location.pathname, location.search));
  }

  // The dialog's way back: the person who was here, acting as the same membership.
  let expiredFor: { user: string; membership: string; org: string } | null = null;
  let resume: ((retry: boolean) => void) | null = null;
  let resumed: Promise<boolean> | null = null;

  // Every 401 of the API comes here (lib/api.ts). True sends the refused request again.
  async function handleUnauthenticated(info: { sentAt: number; method: string }): Promise<boolean> {
    if (!oidc.value) return false;
    // The request left with the session ID that a switch is replacing or has replaced. A read goes again under the new
    // identity; a write does not, because it belongs to the user who made it (the switch protocol stored what it could
    // before the switch).
    if (rotating) {
      await rotating.catch(() => undefined);
      return info.method === "GET";
    }
    if (info.sentAt <= switchedAt) return info.method === "GET";
    if (!me.value || !hasUnsaved()) {
      goToLogin();
      return false;
    }
    if (!resumed) {
      expiredFor = { user: me.value.real_user?.id ?? me.value.user.id, membership: me.value.membership_id, org: me.value.org.id };
      expired.value = "waiting";
      resumed = new Promise<boolean>((res) => (resume = res)).finally(() => {
        resumed = null;
        resume = null;
      });
    }
    return resumed;
  }
  onUnauthenticated(handleUnauthenticated);

  // "Přihlásit se v novém okně": the login in a second window, which ends on the Worker's "Přihlášení obnoveno" page.
  function openLoginWindow() {
    openWindow(loginUrl(location.pathname, location.search, true));
  }

  // "Zkusit znovu" (also when the window gets focus back): is the same login back? Then the waiting requests go again.
  async function checkLogin(): Promise<void> {
    if (!expired.value || expired.value === "checking" || expired.value === "other") return;
    expired.value = "checking";
    let who: Me;
    try {
      who = await useApi().me({ retryAfterLogin: false });
    } catch {
      expired.value = "still";
      return;
    }
    // A new login lands in the person's first org as themselves; the same person gets the org and role back that the
    // unsaved work belongs to, with the same switches (and server checks) as the account menu.
    const want = expiredFor;
    if (want && (who.real_user?.id ?? who.user.id) === want.user && who.membership_id !== want.membership) {
      try {
        if (who.org.id !== want.org) await rotate(() => useApi().switchOrg(want.org));
        if (want.membership !== (await useApi().me({ retryAfterLogin: false })).membership_id) await rotate(() => useApi().switchRole(want.membership));
        who = await useApi().me({ retryAfterLogin: false });
      } catch {
        // Not possible any more (a membership ended): the check below shows the other-login state.
      }
    }
    const same = want && (who.real_user?.id ?? who.user.id) === want.user && who.membership_id === want.membership;
    if (!same) {
      expired.value = "other";
      return;
    }
    expired.value = null;
    resume?.(true);
  }

  // "Načíst stránku znovu" after another login: the unsaved work cannot be stored under someone else.
  function reloadAfterOtherLogin() {
    resume?.(false);
    expired.value = null;
    reload();
  }

  // A write's state: rows and staff to their stores, the rest to the workflow store. A case's status, slot and tasks
  // also update its list row and the task list, so the header's badge and the list follow every write.
  function applyState(st: WorkflowState | null | undefined) {
    if (!st) return;
    if (st.staff) {
      useStaffStore().apply(st.staff);
      // A staff change adds, renames or removes picker entries; the picker is the server's list of memberships.
      void loadPicker();
    }
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
  function setNavigate(fn: (url: string) => void) {
    navigate = fn;
  }
  function setOpenWindow(fn: (url: string) => void) {
    openWindow = fn;
  }

  return {
    phase,
    health,
    me,
    picker,
    error,
    resetting,
    oidc,
    expired,
    leavingForLogin,
    boot,
    switchUser,
    switchOrg,
    switchRole,
    logout,
    openLoginWindow,
    checkLogin,
    reloadAfterOtherLogin,
    onBeforeUserSwitch,
    onUserSwitchCheck,
    onUserLeaving,
    onUserSwitched,
    onUnsavedCheck,
    applyState,
    loadFromApi,
    setReload,
    setNavigate,
    setOpenWindow,
  };
});
