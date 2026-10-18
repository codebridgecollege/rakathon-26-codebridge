// The list screens' pieces in the app: Intl formatting, the catalog messages they pick by code, what the calendar card
// reads of a case, attendance writes, refusals, and two screens mounted against a mocked API. Synthetic values only.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { RouterView, createRouter, createMemoryHistory } from "vue-router";
import { createFluentVue } from "fluent-vue";
import type { CaseState } from "@codebridge/api-client";
import { bundlesFor, makeBundle } from "../app/lib/i18n";
import { fmtDateTime, fmtDay, fmtDayMonth, fmtMonthName } from "../app/lib/format";
import { MINI_WEEKDAY_IDS, SEMINAR_LABEL_IDS, STATUS_LABEL_IDS, WEEKDAY_IDS, caseRoute, isSlotLocked } from "../app/lib/lists";
import { briefOf, dxLine, questionOf } from "../app/lib/case-brief";
import { setApi } from "../app/lib/api";
import { useSessionStore } from "../app/stores/session";
import { usePatientsStore } from "../app/stores/patients";
import { useWorkflowStore } from "../app/stores/workflow";
import { useAttendanceStore } from "../app/stores/attendance";
import { useListViewStore } from "../app/stores/listView";
import { useToastStore } from "../app/stores/toast";
import { useWrite } from "../app/composables/useWrite";
import PatientsView from "../app/components/lists/PatientsView.vue";
import TasksView from "../app/components/lists/TasksView.vue";
import CalendarView from "../app/components/lists/CalendarView.vue";
import { deferred, mockApi, row } from "./helpers";

const cs = makeBundle("cs");
const fmt = (id: string, args: Record<string, string | number> = {}) => cs.formatPattern(cs.getMessage(id)!.value!, args);

const staff = {
  depts: [{ id: "d2", name: "Klinická onkologie", people: [{ id: "d2p1", pre: "MUDr.", sur: "Svobodová", post: "", fn: "" }, { id: "d2p2", pre: "MUDr.", sur: "Malá", post: "", fn: "" }] }],
  coord: { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" },
  admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" },
  roles: { d2p1: "doctor", d2p2: "doctor", coord: "coordinator", admin: "admin" },
};
const task = (id: number, file: string, done: boolean) => ({ id, pid: file, case_id: "", text: `úloha ${id}`, who: "MUDr. Svobodová", due: null, done, dueSrc: null, dueBy: null, timing: null, fromSugg: null, confirmedBy: null });

function server(over: Record<string, unknown> = {}) {
  return mockApi({
    "/health": { ok: true, service: "codebridge-mdt", features: { data: true }, demo: { data_epoch: 1, reset_enabled: true } },
    "/me": { user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null },
    "/staff": staff,
    "/patients": {
      patients: [
        row(1, { name: "Jan Alfa", submitted: "2026-10-10", status: "new" }),
        row(2, { name: "Eva Beta", submitted: "2026-10-12", status: "ready", slot: { day: "2026-10-22", time: "14:00" } }),
        row(3, { name: "Petr Gama", submitted: "2026-10-01", status: "new", owner: "MUDr. Malá" }),
      ],
      total: 3,
      page: 0,
    },
    "/tasks": { tasks: [task(1, "1_pacient.pdf", false), task(2, "2_pacient.pdf", true)] },
    "/workflow": { data_epoch: 1, cases: {}, att: {}, sessions: [], mails: [] },
    ...over,
  });
}

function mountWith(comp: object) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  return { router, w: mount(comp, { global: { plugins: [createFluentVue({ bundles: bundlesFor("cs") }), router] } }) };
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
});

describe("formatting", () => {
  it("formats days with Intl and keeps anything else as written", () => {
    expect(fmtDay("2026-10-16", "cs")).toBe("16. 10. 2026");
    expect(fmtDayMonth("2026-10-22", "cs")).toBe("22. 10.");
    expect(fmtMonthName("2026-11", "cs")).toBe("listopad");
    // A partial date stays a month, never a made-up day.
    expect(fmtDay("03/2024", "cs")).toBe("03/2024");
    expect(fmtDateTime("nevím", "cs")).toBe("nevím");
    expect(fmtDateTime(null, "cs")).toBe("");
  });
});

describe("list catalog", () => {
  it("has every message picked by a code or filled through <i18n>", () => {
    const ids = [...Object.values(STATUS_LABEL_IDS), ...WEEKDAY_IDS, ...MINI_WEEKDAY_IDS, ...Object.values(SEMINAR_LABEL_IDS)];
    const dir = path.join(import.meta.dirname, "../app/components/lists");
    for (const f of readdirSync(dir)) for (const m of readFileSync(path.join(dir, f), "utf8").matchAll(/path="([a-z0-9-]+)"/g)) ids.push(m[1]!);
    expect(ids.filter((id) => !cs.hasMessage(id))).toEqual([]);
  });

  it("uses the Czech plural forms of the old page", () => {
    expect([1, 3, 5, 0].map((n) => fmt("tasks-waiting", { n }))).toEqual(["1 úloha čeká na vyřízení", "3 úlohy čekají na vyřízení", "5 úloh čeká na vyřízení", "0 úloh čeká na vyřízení"]);
    expect([0, 1, 2].map((n) => fmt("tasks-open-count", { n }))).toEqual(["0 otevřených", "1 otevřená", "2 otevřené"]);
    expect([1, 2, 5].map((n) => fmt("staff-people-count", { n }))).toEqual(["1 osoba", "2 osoby", "5 osob"]);
    expect(fmt("tasks-mail-approval-body", { id: "NO-1", n: 1 })).toMatch(/^K případu NO-1 byla přiřazena 1 nová úloha\./);
    expect(fmt("tasks-mail-approval-body", { id: "NO-1", n: 3 })).toMatch(/byly přiřazeny 3 nové úlohy\./);
    expect(fmt("tasks-mail-approval-body", { id: "NO-1", n: 7 })).toMatch(/bylo přiřazeno 7 nových úloh\./);
    // Leading spaces of suffixes survive Fluent's trimming.
    expect(fmt("calendar-today-suffix")).toBe(" · dnes");
    expect(fmt("calendar-card-edited-suffix")).toBe(" (upraveno lékařem)");
  });
});

describe("calendar card data", () => {
  const p = row(10, { diagnosis: "karcinom ledviny", explicit: false, draft: "Indikace k radioterapii?", question: null });
  const extra = { diagnosis_headline: { histology_cs: "Světlobuněčný karcinom", tnm_cs: "pT3a", tnm_context_cs: "pTNM při diagnóze", ocr_note_cs: "MO/M0" }, onco_summary_v3_cs: "Souhrn [1] případu [2]." };
  const cd = { file: p.file, id: p.id, extraction: { case: {}, extra } };

  it("reads the diagnosis line, the question and the brief, with the doctor's edits", () => {
    expect(dxLine(p, undefined, null)).toEqual({ text: "karcinom ledviny", edited: false, context: null, verify: false });
    expect(dxLine(p, undefined, cd)).toEqual({ text: "Světlobuněčný karcinom, pT3a", edited: false, context: "pTNM při diagnóze", verify: true });
    const edited: Partial<CaseState> = { edits: { dx: { text: "Opraveno", by: "MUDr. X", when: "" }, q: { text: "Upravená otázka", by: "MUDr. X", when: "" } } };
    // An edit replaces the base text and drops the OCR mark it answered.
    expect(dxLine(p, edited, cd)).toMatchObject({ text: "Opraveno", edited: true, verify: false });
    expect(questionOf(p, undefined)).toEqual({ text: "Indikace k radioterapii?", draft: true });
    expect(questionOf(p, edited)).toEqual({ text: "Upravená otázka", draft: false });
    expect(questionOf(row(11), undefined)).toBeNull();
    // A doctor's confirmation of the shown draft removes the draft label; one of an older draft text does not.
    expect(questionOf(p, { qConfirm: { text: "Indikace k radioterapii?", by: "MUDr. X", when: "" } })).toEqual({ text: "Indikace k radioterapii?", draft: false });
    expect(questionOf(p, { qConfirm: { text: "Starší návrh?", by: "MUDr. X", when: "" } })).toEqual({ text: "Indikace k radioterapii?", draft: true });
    // The referral's explicit question is never a draft.
    expect(questionOf(row(12, { explicit: true, question: "Výslovná otázka?", draft: null }), undefined)).toEqual({ text: "Výslovná otázka?", draft: false });
    expect(briefOf(undefined, cd)).toEqual({ text: "Souhrn případu.", edited: false });
    // A synthetic patient's extraction has no brief.
    expect(briefOf(undefined, { file: p.file, id: p.id, extraction: { syn: {} } })).toBeNull();
  });

  it("locks a slot an approved decision was made on, and links the case view", () => {
    const booked = row(2, { slot: { day: "2026-10-22", time: "14:00" } });
    const cases = { "NO-002": { case_id: "NO-002", file: booked.file, decisions: [{ slot: { day: "2026-10-22", time: "14:00" } }] } } as unknown as Record<string, Partial<CaseState>>;
    expect(isSlotLocked(cases, booked)).toBe(true);
    expect(isSlotLocked(cases, { ...booked, slot: { day: "2026-10-22", time: "14:10" } })).toBe(false);
    expect(caseRoute("10_pacient.pdf")).toBe("/patient/10/overview");
  });
});

describe("attendance", () => {
  it("sends ids and the stored version, one request at a time, and shows the stored set afterwards", async () => {
    const hold = deferred<void>();
    const bodies: unknown[] = [];
    let version = 3;
    const m = server({
      "/workflow": { data_epoch: 1, cases: {}, att: { "2026-10-22": { key: "2026-10-22", version: 3, byName: {}, byId: {} } }, sessions: [], mails: [] },
      "/attendance/2026-10-22": async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) await hold.promise;
        version++;
        const names = (JSON.parse(String(init.body)).by_dept.d2 ?? []).map((id: string) => (id === "d2p1" ? "MUDr. Svobodová" : "MUDr. Malá"));
        return { data: {}, data_epoch: 1, state: { att: { "2026-10-22": { key: "2026-10-22", version, byName: { "Klinická onkologie": names }, byId: {} } } } };
      },
    });
    setApi(m.api);
    await useSessionStore().boot();
    const att = useAttendanceStore();
    expect(att.rowsOf("2026-10-22")).toEqual({ "Klinická onkologie": [""] });
    att.setRow("2026-10-22", "Klinická onkologie", 0, "MUDr. Svobodová");
    att.changed("2026-10-22", () => {});
    // Each request is built from the rows when it leaves: let the first one leave before the next change.
    await flushPromises();
    att.addRow("2026-10-22", "Klinická onkologie");
    att.setRow("2026-10-22", "Klinická onkologie", 1, "MUDr. Malá");
    att.changed("2026-10-22", () => {});
    await flushPromises();
    // The second change waits for the first answer.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({ version: 3, by_dept: { d2: ["d2p1"] } });
    hold.resolve();
    await flushPromises();
    expect(bodies[1]).toEqual({ version: 4, by_dept: { d2: ["d2p1", "d2p2"] } });
    await nextTick();
    expect(att.local["2026-10-22"]).toBeUndefined();
    expect(att.present("2026-10-22")).toEqual(["MUDr. Svobodová", "MUDr. Malá"]);
  });

  it("puts the stored rows back when the server refuses", async () => {
    const m = server({ "/attendance/2026-10-22": [403, { error: { code: "role_forbidden", message_cs: "Nemáte oprávnění." } }] });
    setApi(m.api);
    await useSessionStore().boot();
    const att = useAttendanceStore();
    const seen: unknown[] = [];
    att.setRow("2026-10-22", "Klinická onkologie", 0, "MUDr. Svobodová");
    att.changed("2026-10-22", (e) => seen.push(e));
    await flushPromises();
    expect(seen).toHaveLength(1);
    expect(att.present("2026-10-22")).toEqual([]);
  });
});

describe("attendance conflict", () => {
  it("shows the set another user stored, with the server's message, without reloading the workflow", async () => {
    const current = { key: "2026-10-22", version: 9, byName: { "Klinická onkologie": ["MUDr. Malá"] }, byId: {} };
    const m = server({
      "/attendance/2026-10-22": [409, { error: { code: "attendance_conflict", message_cs: "Docházku mezitím změnil někdo jiný.", current } }],
    });
    setApi(m.api);
    await useSessionStore().boot();
    const att = useAttendanceStore();
    const refusedSeen: unknown[] = [];
    att.setRow("2026-10-22", "Klinická onkologie", 0, "MUDr. Svobodová");
    att.changed("2026-10-22", (e) => refusedSeen.push(e));
    await flushPromises();
    expect(att.present("2026-10-22")).toEqual(["MUDr. Malá"]);
    expect(refusedSeen).toHaveLength(0);
    expect(useToastStore().items.map((t) => t.msg)).toEqual([{ text: "Docházku mezitím změnil někdo jiný." }]);
    expect(m.calls.filter((c) => c.url.startsWith("/api/workflow"))).toHaveLength(1);
  });
});

describe("calendar screen", () => {
  async function mountCalendar(me?: unknown) {
    const m = server({
      ...(me ? { "/me": me } : {}),
      "/workflow": { data_epoch: 1, cases: { "NO-002": { case_id: "NO-002", file: "2_pacient.pdf", decisions: [{ slot: { day: "2026-10-22", time: "14:00" } }] } }, att: {}, sessions: [], mails: [] },
    });
    setApi(m.api);
    await useSessionStore().boot();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/calendar/:week?", component: CalendarView }, { path: "/:p(.*)*", component: { render: () => null } }] });
    await router.push("/calendar/2026-10-22");
    const w = mount({ render: () => h(RouterView) }, { global: { plugins: [createFluentVue({ bundles: bundlesFor("cs") }), router] } });
    await flushPromises();
    return { m, w, router };
  }

  it("rewrites a link to any day to its Monday and shows that day's month", async () => {
    const { router, w } = await mountCalendar();
    expect(router.currentRoute.value.path).toBe("/calendar/2026-10-19");
    expect(w.text()).toContain("19. 10. až 23. 10. 2026");
    await router.push("/calendar/2026-12-02");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/calendar/2026-11-30");
    expect(useListViewStore().miniMonth).toBe("2026-12");
  });

  it("locks a slot an approved conclusion was made on: no move, no freeing", async () => {
    const { w } = await mountCalendar();
    await w.find('button.slotbtn.taken[aria-label^="Beta Eva"]').trigger("click");
    const card = w.find('[role="region"]');
    expect(card.text()).toContain("Případ je na tomto termínu projednán");
    const free = card.findAll("button").find((b) => b.text() === "Uvolnit termín")!;
    expect(free.attributes("disabled")).toBeDefined();
    expect(card.findAll("button").some((b) => b.text() === "Změnit termín")).toBe(false);
  });

  it("refuses a booking by the administrator before any request", async () => {
    const admin = { user: { id: "admin", name: "Ing. Kovář", role: "admin", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null };
    const { w, m } = await mountCalendar(admin);
    useListViewStore().schedPick = "1_pacient.pdf";
    await nextTick();
    await w.find('button[aria-label="Volný termín 14:10"]').trigger("click");
    await flushPromises();
    expect(useToastStore().items.map((t) => t.msg)).toEqual([{ text: "Termín plánuje lékař nebo koordinátorka." }]);
    expect(m.calls.some((c) => c.url.includes("/slot"))).toBe(false);
  });
});

describe("refusals", () => {
  async function refuse(body: unknown, status: number) {
    const m = server({ "/tasks/1": [status, body] });
    setApi(m.api);
    await useSessionStore().boot();
    let api!: ReturnType<typeof useWrite>;
    mount(defineComponent({ setup: () => ((api = useWrite()), () => h("p")) }), { global: { plugins: [createFluentVue({ bundles: bundlesFor("cs") })] } });
    await api.run(() => m.api.patchTask(1, { done: true, expected_done: false }));
    await flushPromises();
    return m;
  }

  it("shows the server's message and reloads the workflow after a conflict without state", async () => {
    const m = await refuse({ error: { code: "task_changed", message_cs: "Úlohu mezitím změnil někdo jiný." } }, 409);
    expect(useToastStore().items.map((t) => t.msg)).toEqual([{ text: "Úlohu mezitím změnil někdo jiný." }]);
    expect(m.calls.filter((c) => c.url.startsWith("/api/workflow"))).toHaveLength(2);
  });

  it("applies a conflict's state instead of reloading", async () => {
    const m = await refuse({ error: { code: "slot_taken", message_cs: "Termín je obsazený.", current: { patient: row(1, { status: "scheduled" }) } } }, 409);
    expect(usePatientsStore().byFile("1_pacient.pdf")?.status).toBe("scheduled");
    expect(m.calls.filter((c) => c.url.startsWith("/api/workflow"))).toHaveLength(1);
  });
});

describe("patient list screen", () => {
  it("searches, filters by status through the popover, and shows the range", async () => {
    setApi(server().api);
    await useSessionStore().boot();
    const { w } = mountWith(PatientsView);
    await nextTick();
    const names = () => w.findAll("tbody tr td:nth-child(2) b").map((b) => b.text());
    // Newest referral first; the surname leads.
    expect(names()).toEqual(["Beta Eva", "Alfa Jan", "Gama Petr"]);
    expect(w.text()).toContain("Zobrazeno 1-3 z 3");
    await w.find("input.search").setValue("gama");
    expect(names()).toEqual(["Gama Petr"]);
    await w.find("input.search").setValue("");
    const statusHead = w.findAll("button.th-f").find((b) => b.text().startsWith("Stav"))!;
    await statusHead.trigger("click");
    const pop = w.find('[role="dialog"]');
    expect(pop.attributes("aria-label")).toBe("Filtr Stav");
    const nový = pop.findAll("label").find((l) => l.text() === "Nový")!;
    await nový.find("input").setValue(false);
    expect(names()).toEqual(["Beta Eva"]);
    expect(w.text()).toContain("Zrušit filtry (1)");
    expect(useListViewStore().filters).toEqual({ status: ["ready"] });
  });

  it("books from the list by picking the patient and opening the calendar", async () => {
    setApi(server().api);
    await useSessionStore().boot();
    const { w, router } = mountWith(PatientsView);
    await nextTick();
    await w.findAll("button.linkbtn").find((b) => b.text() === "Naplánovat")!.trigger("click");
    await flushPromises();
    expect(useListViewStore().schedPick).toBe("1_pacient.pdf");
    expect(router.currentRoute.value.path).toBe("/calendar");
  });
});

describe("tasks screen", () => {
  it("marks a task done at once and puts it back when the server refuses", async () => {
    const m = server({ "/tasks/1": [409, { error: { code: "task_changed", message_cs: "Úlohu mezitím změnil někdo jiný." } }] });
    setApi(m.api);
    await useSessionStore().boot();
    useListViewStore().taskScope = "all";
    const { w } = mountWith(TasksView);
    await nextTick();
    expect(w.text()).toContain("1 otevřená");
    const box = w.find('.trow input[type="checkbox"]');
    await box.setValue(true);
    expect(useWorkflowStore().tasks.find((t) => t.id === 1)?.done).toBe(true);
    await flushPromises();
    expect(useWorkflowStore().tasks.find((t) => t.id === 1)?.done).toBe(false);
    expect(useToastStore().items.map((t) => t.msg)).toEqual([{ text: "Úlohu mezitím změnil někdo jiný." }]);
  });

  it("does not let the administrator tick a task", async () => {
    const m = server({ "/me": { user: { id: "admin", name: "Ing. Kovář", role: "admin", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null } });
    setApi(m.api);
    await useSessionStore().boot();
    useListViewStore().taskScope = "all";
    const { w } = mountWith(TasksView);
    await nextTick();
    const box = w.find('.trow input[type="checkbox"]');
    await box.setValue(true);
    await flushPromises();
    expect((box.element as HTMLInputElement).checked).toBe(false);
    expect(m.calls.some((c) => c.url.startsWith("/api/tasks/1"))).toBe(false);
  });
});
