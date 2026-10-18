// Boot and user switch, against a mocked API: the same requests as the old page's boot(), nothing assigned from a
// failed load, and a switch that the server refuses keeps the previous user.
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { setApi } from "../app/lib/api";
import { useSessionStore } from "../app/stores/session";
import { useStaffStore } from "../app/stores/staff";
import { usePatientsStore } from "../app/stores/patients";
import { useWorkflowStore } from "../app/stores/workflow";
import { useCasesStore } from "../app/stores/cases";
import { mockApi, row } from "./helpers";

const staff = {
  depts: [{ id: "d2", name: "Klinická onkologie", people: [{ id: "d2p1", pre: "MUDr.", sur: "Svobodová", post: "", fn: "" }, { id: "d2p3", pre: "Bc.", sur: "Sestra", post: "", fn: "" }] }],
  coord: { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" },
  admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" },
  roles: { d2p1: "doctor", d2p3: "staff", coord: "coordinator", admin: "admin" },
};
const health = { ok: true, service: "codebridge-mdt", features: { data: true }, demo: { data_epoch: 2 } };
const meOf = (id: string, name: string, role = "doctor") => ({ user: { id, name, role, dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null });

function server(over: Record<string, unknown> = {}) {
  return mockApi({
    "/health": health,
    "/me": (_u: string, init: RequestInit) => {
      const id = new Headers(init.headers).get("X-Demo-User") ?? "d2p1";
      return id === "coord" ? meOf("coord", "Bc. Marková", "coordinator") : meOf("d2p1", "MUDr. Svobodová");
    },
    "/staff": staff,
    "/patients": { patients: [row(1), row(2, { owner: "MUDr. Svobodová" })], total: 2, page: 0 },
    "/tasks": { tasks: [{ id: 1, pid: "2_pacient.pdf", case_id: "NO-002", text: "x", who: "Bc. Marková", due: null, done: false, dueSrc: null, dueBy: null, timing: null, fromSugg: null, confirmedBy: null }] },
    "/workflow": { data_epoch: 3, cases: {}, att: {}, sessions: [], mails: [] },
    ...over,
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("boot", () => {
  it("loads health, me, staff, patients, tasks and workflow, and sends the user the server named", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    expect(s.phase).toBe("ready");
    expect(m.calls.map((c) => c.url.split("?")[0]).sort()).toEqual(["/api/health", "/api/me", "/api/patients", "/api/staff", "/api/tasks", "/api/workflow"]);
    expect(new Headers(m.calls.find((c) => c.url.startsWith("/api/staff"))!.init.headers).get("X-Demo-User")).toBe("d2p1");
    expect(m.api.epoch).toBe(3);
    expect(usePatientsStore().total).toBe(2);
    expect(document.cookie).toContain("cb_demo_user=d2p1");
  });

  it("derives the picker's doctors from the server's roles, not from titles", async () => {
    setApi(server().api);
    await useSessionStore().boot();
    const st = useStaffStore();
    expect(st.doctorsByDept.flatMap((d) => d.people.map((p) => p.id))).toEqual(["d2p1"]);
    expect(st.coord?.name).toBe("Bc. Marková");
    expect(st.idOfName("Ing. Kovář")).toBe("admin");
  });

  it("counts the user's open tasks as the nav badge does", async () => {
    setApi(server().api);
    await useSessionStore().boot();
    const owner = (f: string) => usePatientsStore().byFile(f)?.owner;
    // The doctor owns case 2, so its task counts for her; the coordinator has it assigned.
    expect(useWorkflowStore().openTaskCount("MUDr. Svobodová", "Bc. Marková", owner)).toBe(1);
    expect(useWorkflowStore().openTaskCount("Bc. Marková", "Bc. Marková", owner)).toBe(1);
  });

  it("fails without data on a host that is not our API, and assigns nothing", async () => {
    setApi(server({ "/health": { ok: true, service: "something-else", features: { data: true } } }).api);
    const s = useSessionStore();
    await s.boot();
    expect(s.phase).toBe("failed");
    expect(s.error?.message_id).toBe("api-error-no-api");
    expect(usePatientsStore().rows).toHaveLength(0);
  });

  it("assigns nothing when one of the loads fails", async () => {
    setApi(server({ "/workflow": [503, { error: { code: "data_unavailable", message_cs: "Data případu se nepodařilo načíst. Zkuste to znovu." } }] }).api);
    const s = useSessionStore();
    await s.boot();
    expect(s.phase).toBe("failed");
    expect(s.error?.message_cs).toBe("Data případu se nepodařilo načíst. Zkuste to znovu.");
    expect(usePatientsStore().rows).toHaveLength(0);
    expect(useStaffStore().directory).toBeNull();
  });
});

describe("user switch", () => {
  it("reloads under the new user and empties the case cache", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    useCasesStore().caseOf("1_pacient.pdf");
    expect(await s.switchUser("coord")).toBe(true);
    expect(s.me?.user.id).toBe("coord");
    expect(m.api.userId).toBe("coord");
    expect(useCasesStore().entries.size).toBe(0);
  });

  it("keeps the previous user when the server refuses the new one", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    useCasesStore().caseOf("1_pacient.pdf");
    let fail = false;
    const refusing = server({ "/staff": () => (fail ? [401, { error: { code: "unknown_user", message_cs: "Neznámý uživatel. Vyberte uživatele znovu." } }] : staff) });
    setApi(refusing.api);
    refusing.api.setUser("d2p1");
    fail = true;
    expect(await s.switchUser("coord")).toBe(false);
    expect(refusing.api.userId).toBe("d2p1");
    expect(s.error?.message_cs).toBe("Neznámý uživatel. Vyberte uživatele znovu.");
    expect(useCasesStore().entries.size).toBe(1);
  });

  it("refuses a name the server does not know without a request", async () => {
    const m = server();
    setApi(m.api);
    const s = useSessionStore();
    await s.boot();
    const before = m.calls.length;
    expect(await s.switchUser(null)).toBe(false);
    expect(m.calls.length).toBe(before);
    expect(s.error?.message_id).toBe("user-switch-unknown");
  });
});
