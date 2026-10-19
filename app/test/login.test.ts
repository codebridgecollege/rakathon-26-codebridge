// The app with a login (AUTH_MODE=oidc; docs/design/AUTH.md, "The frontend"): the account menu in place of the picker,
// the org and role switch, logout, the way to the login page, and the "Přihlášení vypršelo" dialog that keeps unsaved
// work on the page and sends the refused request again. Against a mocked API; synthetic values only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createFluentVue } from "fluent-vue";
import { bundlesFor } from "../app/lib/i18n";
import { setApi } from "../app/lib/api";
import { loginUrl, useSessionStore } from "../app/stores/session";
import AppHeader from "../app/components/AppHeader.vue";
import SessionExpiredDialog from "../app/components/SessionExpiredDialog.vue";
import { deferred, mockApi, row } from "./helpers";

const orgA = { id: "demo-a", name: "Ukázková nemocnice A", short_name: "Nemocnice A", is_demo: true };
const orgH = { id: "hosp", name: "Nemocnice H", short_name: "H", is_demo: false };
const staff = { depts: [], coord: null, admin: null, roles: {} };
const roleSwitch = [
  { membership_id: "d2p1", name: "MUDr. Svobodová", role: "doctor", fn: "", own: false },
  { membership_id: "admin", name: "Ing. Kovář", role: "admin", fn: "", own: true },
];
const meAdmin = {
  user: { id: "admin", name: "Ing. Kovář", role: "admin", dept: null },
  membership_id: "admin",
  memberships: [
    { id: "admin", org: orgA, role: "admin", fn: "", dept: null },
    { id: "h-admin", org: orgH, role: "admin", fn: "", dept: null },
  ],
  org: orgA,
  data_epoch: 4,
  auth_mode: "oidc",
  impersonating: false,
  real_user: null,
  role_switch: roleSwitch,
  notice_cs: null,
};
const meActing = { ...meAdmin, user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null }, membership_id: "d2p1", impersonating: true, real_user: { id: "admin", name: "Ing. Kovář" } };
const LOST = [401, { error: { code: "unauthenticated", message_cs: "Přihlášení chybí nebo vypršelo. Obnovte stránku." } }];

// The server's view: who the session is (null: no session), changed by the switch routes.
let session: typeof meAdmin | typeof meActing | null;
function server(over: Record<string, unknown> = {}) {
  return mockApi({
    "/health": { ok: true, service: "codebridge-mdt", features: { data: true }, auth_mode: "oidc", demo: { data_epoch: 4 } },
    "/me": () => (session ? session : LOST),
    "/staff": () => (session ? staff : LOST),
    "/patients": () => (session ? { patients: [row(1)], total: 1, page: 0 } : LOST),
    "/tasks": () => (session ? { tasks: [] } : LOST),
    "/workflow": () => (session ? { data_epoch: 4, cases: {}, att: {}, sessions: [], mails: [] } : LOST),
    "/session/role": (_u: string, init: RequestInit) => {
      session = JSON.parse(String(init.body)).membership_id === "d2p1" ? meActing : meAdmin;
      return { ok: true };
    },
    "/session/org": () => ({ ok: true }),
    ...over,
  });
}

async function mountShell() {
  document.body.innerHTML = '<div id="overlay"></div>';
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  const plugins = [createFluentVue({ bundles: bundlesFor("cs") }), router];
  const header = mount(AppHeader, { global: { plugins }, attachTo: document.body });
  mount(SessionExpiredDialog, { global: { plugins }, attachTo: document.body });
  await flushPromises();
  return header;
}

let navigated: string[];
beforeEach(() => {
  setActivePinia(createPinia());
  session = meAdmin;
  navigated = [];
  useSessionStore().setNavigate((u) => navigated.push(u));
});
afterEach(() => vi.unstubAllGlobals());

describe("boot with a login", () => {
  it("shows the account menu instead of the picker and sends no X-Demo-User", async () => {
    const m = server();
    setApi(m.api);
    await useSessionStore().boot();
    const w = await mountShell();
    expect(w.find("select#user").exists()).toBe(false);
    expect(w.get('button[aria-label="Účet: Ing. Kovář"]').text()).toContain("Nemocnice A");
    expect(m.calls.some((c) => new Headers(c.init.headers).has("X-Demo-User"))).toBe(false);
    expect(document.cookie).not.toContain("cb_demo_user=admin");
  });

  it("goes to the login with the way back when there is no session, without an error on screen", async () => {
    session = null;
    setApi(server().api);
    const s = useSessionStore();
    history.replaceState(null, "", "/patient/10/labs?x=1");
    await s.boot();
    expect(navigated).toEqual(["/auth/login?to=%2Fpatient%2F10%2Flabs%3Fx%3D1"]);
    expect(s.error).toBeNull();
    history.replaceState(null, "", "/");
  });

  it("passes a chosen language to the login page", () => {
    expect(loginUrl("/patients", "?lang=sk")).toBe("/auth/login?to=%2Fpatients%3Flang%3Dsk&lang=sk");
    expect(loginUrl("/patients", "", true)).toBe("/auth/login?popup=1");
  });
});

describe("account menu", () => {
  it("lists the person's other orgs and the demo org's roles, and switches role through the server", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    const w = await mountShell();
    await w.get('button[aria-label="Účet: Ing. Kovář"]').trigger("click");
    const menu = w.get('[role="dialog"]');
    expect(menu.text()).toContain("Přepnout organizaci");
    expect(menu.text()).toContain("Nemocnice H");
    expect(menu.text()).toContain("Přepnout roli");
    const entries = menu.findAll("button[aria-pressed]");
    expect(entries.map((b) => [b.text(), b.attributes("aria-pressed")])).toEqual([
      ["MUDr. Svobodová (lékař)", "false"],
      ["Ing. Kovář (správce systému)", "true"],
    ]);
    await entries[0]!.trigger("click");
    await flushPromises();
    expect(m.calls.some((c) => c.url === "/api/session/role")).toBe(true);
    expect(s.me?.user.name).toBe("MUDr. Svobodová");
    await w.get('button[aria-label="Účet: MUDr. Svobodová"]').trigger("click");
    expect(w.get('[role="dialog"]').text()).toContain("Přihlášen(a): Ing. Kovář");
  });

  it("stores drafts before a switch and refuses it when one cannot be stored", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    s.onUserSwitchCheck(() => false);
    expect(await s.switchRole("d2p1")).toBe(false);
    expect(m.calls.some((c) => c.url === "/api/session/role")).toBe(false);
  });

  it("logs out through the Worker and goes where it says (the IdP's logout)", async () => {
    setApi(server().api);
    const s = useSessionStore();
    await s.boot();
    const f = vi.fn(async () => new Response(JSON.stringify({ redirect: "https://idp.test/end_session?x=1" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    expect(await s.logout()).toBe(true);
    expect(f).toHaveBeenCalledWith("/auth/logout", expect.objectContaining({ method: "POST" }));
    expect(navigated).toEqual(["https://idp.test/end_session?x=1"]);
  });
});

describe("a lost session", () => {
  it("goes to the login when nothing is unsaved", async () => {
    setApi(server().api);
    const s = useSessionStore();
    await s.boot();
    session = null;
    await expect(s.loadFromApi()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(navigated).toHaveLength(1);
    expect(navigated[0]).toMatch(/^\/auth\/login\?to=/);
    expect(s.expired).toBeNull();
  });

  it("keeps the page with unsaved work: the dialog, a login in a second window, then the refused write goes again", async () => {
    let saves = 0;
    const m = server({ "/cases/NO-1/protocol": () => (session ? (saves++, { data: {}, data_epoch: 4, state: {} }) : LOST) });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    let dirty = true;
    s.onUnsavedCheck(() => dirty);
    const opened: string[] = [];
    s.setOpenWindow((u) => opened.push(u));
    await mountShell();
    session = null;
    const write = m.api.transport.write("PUT", "/cases/NO-1/protocol", { notes: "x" });
    await flushPromises();
    expect(s.expired).toBe("waiting");
    expect(navigated).toEqual([]);
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain("Přihlášení vypršelo");
    (dlg.querySelectorAll("button")[0] as HTMLButtonElement).click();
    expect(opened).toEqual(["/auth/login?popup=1"]);
    // Not back yet: the dialog says so and stays.
    await s.checkLogin();
    expect(s.expired).toBe("still");
    // Logged in again in the second window, as the same person.
    session = meAdmin;
    await s.checkLogin();
    await expect(write).resolves.toMatchObject({ data_epoch: 4 });
    expect(saves).toBe(1);
    expect(s.expired).toBeNull();
    dirty = false;
  });

  it("does not store the unsaved work under another person who logged in in the second window", async () => {
    const m = server({ "/cases/NO-1/protocol": () => (session ? { data: {}, data_epoch: 4, state: {} } : LOST) });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    s.onUnsavedCheck(() => true);
    let reloaded = 0;
    s.setReload(() => reloaded++);
    session = null;
    const write = m.api.transport.write("PUT", "/cases/NO-1/protocol", { notes: "x" });
    await flushPromises();
    session = { ...meAdmin, user: { ...meAdmin.user, id: "coord", name: "Bc. Marková" }, membership_id: "coord" };
    await s.checkLogin();
    expect(s.expired).toBe("other");
    s.reloadAfterOtherLogin();
    await expect(write).rejects.toMatchObject({ code: "unauthenticated" });
    expect(reloaded).toBe(1);
  });

  it("after a switch, sends a read refused with the old session ID again, but never a write under the new identity", async () => {
    const hold = deferred<void>();
    let writes = 0;
    let reads = 0;
    const m = server({
      "/cases/NO-1/protocol": async () => {
        writes++;
        await hold.promise;
        return LOST;
      },
      "/calendar": async (_u: string, init: RequestInit) => {
        reads++;
        // The resent read must not name the identity of before the switch, or the server would call it changed.
        if (reads > 1) return new Headers(init.headers).get("X-Acting-As") === "admin:admin" ? [409, { error: { code: "session_changed", message_cs: "x" } }] : { days: [] };
        await hold.promise;
        return LOST;
      },
    });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    s.onUnsavedCheck(() => true);
    // Both leave with the old session ID; their 401s arrive only after the role switch took effect.
    const write = m.api.transport.write("PUT", "/cases/NO-1/protocol", { notes: "x" });
    const read = m.api.transport.get("/calendar");
    await flushPromises();
    expect(await s.switchRole("d2p1")).toBe(true);
    hold.resolve();
    await expect(read).resolves.toEqual({ days: [] });
    await expect(write).rejects.toMatchObject({ code: "unauthenticated" });
    expect(writes).toBe(1);
    expect(s.expired).toBeNull();
    expect(navigated).toEqual([]);
  });

  it("names whom the tab shows on every request but /me, and reloads when another tab changed the session", async () => {
    const m = server({ "/patients": (_u: string, init: RequestInit) => (new Headers(init.headers).get("X-Acting-As") === "admin:admin" ? { patients: [row(1)], total: 1, page: 0 } : [409, { error: { code: "session_changed", message_cs: "x" } }]) });
    setApi(m.api);
    const s = useSessionStore();
    let reloaded = 0;
    s.setReload(() => reloaded++);
    await s.boot();
    expect(s.phase).toBe("ready");
    const sent = (p: string) => m.calls.filter((c) => c.url.startsWith(`/api/${p}`)).map((c) => new Headers(c.init.headers).get("X-Acting-As"));
    expect(sent("me")).toEqual([null]);
    expect(sent("staff")).toEqual(["admin:admin"]);
    // A second tab switched role: the server now acts as the doctor, this tab still shows the administrator.
    m.api.setActingAs("d2p1:admin");
    vi.useFakeTimers();
    await expect(m.api.patients()).rejects.toMatchObject({ code: "session_changed" });
    expect(s.error?.message_id).toBe("session-changed-reload");
    vi.advanceTimersByTime(1500);
    vi.useRealTimers();
    expect(reloaded).toBe(1);
  });

  it("after a new login in the second window, switches the same person back to the role the unsaved work belongs to", async () => {
    const m = server({ "/cases/NO-1/protocol": () => (session === meActing ? { data: {}, data_epoch: 4, state: {} } : LOST) });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    await s.switchRole("d2p1");
    s.onUnsavedCheck(() => true);
    session = null;
    const write = m.api.transport.write("PUT", "/cases/NO-1/protocol", { notes: "x" });
    await flushPromises();
    expect(s.expired).toBe("waiting");
    // The new login acts as the administrator again; the store switches back to the doctor, then sends the write.
    session = meAdmin;
    await s.checkLogin();
    await expect(write).resolves.toMatchObject({ data_epoch: 4 });
    expect(m.calls.filter((c) => c.url === "/api/session/role").length).toBe(2);
    expect(s.expired).toBeNull();
  });

  it("does not reload while the lost-login dialog waits, when a request meets the new login's other identity", async () => {
    const m = server({ "/cases/NO-1/protocol": () => LOST, "/calendar": [409, { error: { code: "session_changed", message_cs: "x" } }] });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    s.onUnsavedCheck(() => true);
    void m.api.transport.write("PUT", "/cases/NO-1/protocol", { notes: "x" }).catch(() => {});
    await flushPromises();
    expect(s.expired).toBe("waiting");
    await expect(m.api.transport.get("/calendar")).rejects.toMatchObject({ code: "session_changed" });
    expect(s.resetting).toBe(false);
    expect(s.error).toBeNull();
  });

  it("does nothing special in demo mode", async () => {
    const m = mockApi({
      "/health": { ok: true, service: "codebridge-mdt", features: { data: true }, auth_mode: "demo", demo: { data_epoch: 4 } },
      "/me": [401, { error: { code: "unknown_user", message_cs: "Neznámý uživatel. Vyberte uživatele znovu." } }],
    });
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    expect(s.phase).toBe("failed");
    expect(navigated).toEqual([]);
  });
});
