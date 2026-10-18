// The demo user picker: grouped by org from GET /demo/memberships, a membership id as the value, a switch into org B
// sending that id as X-Demo-User, and the staff-based picker as the fallback. Synthetic values only.
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createFluentVue } from "fluent-vue";
import { bundlesFor } from "../app/lib/i18n";
import { setApi } from "../app/lib/api";
import { useSessionStore } from "../app/stores/session";
import AppHeader from "../app/components/AppHeader.vue";
import { mockApi, row } from "./helpers";

const staff = {
  depts: [{ id: "d2", name: "Klinická onkologie", people: [{ id: "d2p1", pre: "MUDr.", sur: "Svobodová", post: "", fn: "" }] }],
  coord: { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" },
  admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" },
  roles: { d2p1: "doctor", coord: "coordinator", admin: "admin" },
};
const orgA = { id: "org-a", name: "Ukázková nemocnice A", short_name: "A", is_demo: true };
const orgB = { id: "org-b", name: "Ukázková nemocnice B", short_name: "B", is_demo: true };
const picker = {
  orgs: [
    {
      ...orgA,
      people: [
        { id: "d2p1", user_id: "u1", name: "MUDr. Svobodová", role: "doctor", fn: "", dept: "Klinická onkologie" },
        { id: "coord", user_id: "u2", name: "Bc. Marková", role: "coordinator", fn: "koordinátorka MDT", dept: null },
        { id: "admin", user_id: "u3", name: "Ing. Kovář", role: "admin", fn: "", dept: null },
      ],
    },
    {
      ...orgB,
      people: [
        { id: "b-d1p1", user_id: "u4", name: "MUDr. Vlčková", role: "doctor", fn: "", dept: "Onkologie" },
        { id: "b-coord", user_id: "u5", name: "Bc. Holubová", role: "coordinator", fn: "", dept: null },
      ],
    },
  ],
};
const meOf = (membership: string, userId: string, name: string, org: typeof orgA, epoch: number) => ({
  user: { id: userId, name, role: "doctor", dept: null },
  membership_id: membership,
  memberships: [],
  org,
  data_epoch: epoch,
  auth_mode: "demo",
  impersonating: false,
  notice_cs: null,
});

function server(over: Record<string, unknown> = {}) {
  return mockApi({
    "/health": { ok: true, service: "codebridge-mdt", features: { data: true }, auth_mode: "demo", demo: { data_epoch: 2 } },
    "/me": (_u: string, init: RequestInit) => {
      const id = new Headers(init.headers).get("X-Demo-User") ?? "d2p1";
      return id === "b-d1p1" ? meOf("b-d1p1", "u4", "MUDr. Vlčková", orgB, 7) : meOf("d2p1", "u1", "MUDr. Svobodová", orgA, 5);
    },
    "/demo/memberships": picker,
    "/staff": staff,
    "/patients": { patients: [row(1)], total: 1, page: 0 },
    "/tasks": { tasks: [] },
    "/workflow": { data_epoch: 5, cases: {}, att: {}, sessions: [], mails: [] },
    ...over,
  });
}

async function mountHeader() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  const w = mount(AppHeader, { global: { plugins: [createFluentVue({ bundles: bundlesFor("cs") }), router] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
});

describe("demo picker", () => {
  it("groups the people by org, with the old option texts and membership ids as values", async () => {
    setApi(server().api);
    await useSessionStore().boot();
    const w = await mountHeader();
    const groups = w.findAll("select#user optgroup");
    expect(groups.map((g) => g.attributes("label"))).toEqual(["Ukázková nemocnice A", "Ukázková nemocnice B"]);
    const opts = w.findAll("select#user option");
    expect(opts.map((o) => o.text())).toEqual(["MUDr. Svobodová", "Bc. Marková (koordinátorka MDT)", "Ing. Kovář (správce systému)", "MUDr. Vlčková", "Bc. Holubová (koordinátorka MDT)"]);
    expect(opts.map((o) => o.attributes("value"))).toEqual(["d2p1", "coord", "admin", "b-d1p1", "b-coord"]);
    expect(opts[1]?.attributes("title")).toBe("koordinátorka MDT");
    expect((w.find("select#user").element as HTMLSelectElement).value).toBe("d2p1");
  });

  it("sends the membership id of an org B person as X-Demo-User", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    expect(await s.switchUser("b-d1p1")).toBe(true);
    expect(m.api.userId).toBe("b-d1p1");
    const last = (p: string) => new Headers(m.calls.filter((c) => c.url.startsWith(`/api/${p}`)).slice(-1)[0]?.init.headers).get("X-Demo-User");
    expect(last("me")).toBe("b-d1p1");
    expect(last("patients")).toBe("b-d1p1");
    expect(document.cookie).toContain("cb_demo_user=b-d1p1");
    expect(s.me?.org.name).toBe("Ukázková nemocnice B");
  });

  it("me() stores the epoch of the org the request acts in", async () => {
    const m = server();
    m.api.setUser("b-d1p1");
    await m.api.me();
    expect(m.api.epoch).toBe(7);
  });

  it("falls back to the staff-based picker when the server has no membership list", async () => {
    setApi(server({ "/demo/memberships": [404, { error: { code: "not_found", message_cs: "Neznámá adresa API." } }] }).api);
    const s = useSessionStore();
    await s.boot();
    expect(s.phase).toBe("ready");
    expect(s.picker).toBeNull();
    const w = await mountHeader();
    expect(w.findAll("select#user optgroup").map((g) => g.attributes("label"))).toEqual(["Klinická onkologie", "Další role"]);
  });
});
