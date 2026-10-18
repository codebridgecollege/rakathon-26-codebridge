// "Projednání na MDT" (S-5): the record's autosave and conflict bar, approval with its idempotency key, a new version,
// the drafted tasks and the session bar (S-4). Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import DiscussionCard from "../app/components/discussion/DiscussionCard.vue";
import SessionBar from "../app/components/discussion/SessionBar.vue";
import ConclusionBox from "../app/components/patient/ConclusionBox.vue";
import IdentityBanner from "../app/components/discussion/IdentityBanner.vue";
import { useDiscussionStore } from "../app/stores/discussion";
import { useWorkflowStore } from "../app/stores/workflow";
import { useStaffStore } from "../app/stores/staff";
import { useOverlayStore } from "../app/stores/overlay";
import { useUploadsStore } from "../app/stores/uploads";
import { useRecorderStore } from "../app/stores/recorder";
import { useSessionStore } from "../app/stores/session";
import { useCasesStore } from "../app/stores/cases";
import { lastToast, mountInCase, setupPatient } from "./patient";
import { deferred } from "./helpers";

const STAFF = {
  depts: [
    { id: "d1", name: "Neurochirurgie", people: [{ id: "d1p1", pre: "MUDr.", sur: "Novák", post: "", fn: "" }] },
    { id: "d2", name: "Klinická onkologie", people: [{ id: "u1", pre: "MUDr.", sur: "Svobodová", post: "", fn: "" }] },
  ],
  coord: { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" },
  admin: null,
  roles: { d1p1: "doctor", u1: "doctor", coord: "coordinator" } as Record<string, "doctor" | "coordinator" | "admin">,
};
const ok = (data: unknown = {}, state: unknown = {}) => ({ data, data_epoch: null, state });
// An extraction of the "full" level, the one that has a guideline layer (sectionsOf().guidance).
const FULL = { case: { sections: {} }, extra: { refs: [{ file: "10_pacient.pdf", page: 1, quote: "MR mozku" }], onco_detailed_v3: [{ refs: [0] }] } };
const reply = (init: RequestInit) => JSON.parse(String(init.body ?? "{}"));

function setup(o: Parameters<typeof setupPatient>[0] = {}) {
  const s = setupPatient({ extraction: null, ...o, p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled", ...(o.p ?? {}) } });
  useStaffStore().apply(STAFF as never);
  return s;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("discussion card", () => {
  it("is collapsed without a draft, and approval needs a doctor and a written conclusion", async () => {
    const s = setup();
    const w = mountInCase(DiscussionCard, s);
    expect(w.get("details").attributes("open")).toBeUndefined();
    expect(w.get("summary").attributes("aria-expanded")).toBe("false");
    const btn = w.findAll("button").find((b) => b.text() === "Schválit závěr MDT")!;
    expect(btn.attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("asistent závěr nenavrhuje");
    expect(w.text()).toContain("schvaluje za tým: MUDr. Svobodová");
    useDiscussionStore().setText(s.p.file, "concl", "Kontrolní MR.");
    await flushPromises();
    // A written draft opens the card, so the approve button is reachable.
    expect(w.get("details").attributes("open")).toBeDefined();
    expect(w.get(".chip.st-attention").text()).toBe("Koncept, neschváleno");
    expect(w.findAll("button").find((b) => b.text() === "Schválit závěr MDT")!.attributes("disabled")).toBeUndefined();
  });

  it("the coordinator writes notes but never approves", () => {
    const w = mountInCase(DiscussionCard, setup({ role: "coordinator", userName: "Bc. Marková", wf: { protocol: { concl: "X", state: "draft", version: 1 } } }));
    expect(w.text()).toContain("schvaluje lékař");
    expect(w.findAll("button").find((b) => b.text() === "Schválit závěr MDT")!.attributes("disabled")).toBeDefined();
    expect(w.get("#notes").attributes("disabled")).toBeUndefined();
  });

  it("autosaves after a pause with the version it was typed against, and a conflict shows both choices", async () => {
    vi.useFakeTimers();
    const bodies: unknown[] = [];
    const s = setup({
      wf: { protocol: { notes: "", concl: "", steps: [], state: "draft", version: 3 } },
      routes: {
        "/cases/NO-010/protocol": (_u: string, init: RequestInit) => {
          bodies.push(reply(init));
          return bodies.length === 1
            ? ok({ version: 4 })
            : [409, { error: { code: "protocol_conflict", message_cs: "Koncept mezitím upravil(a) MUDr. Malá.", current: { notes: "Jejich.", conclusion: "", steps: [], version: 6 } } }];
        },
      },
    });
    const w = mountInCase(DiscussionCard, s);
    const d = useDiscussionStore();
    d.setText(s.p.file, "notes", "Moje.");
    await vi.advanceTimersByTimeAsync(900);
    expect(bodies[0]).toEqual({ version: 3, notes: "Moje." });
    expect(d.protoOf(s.p.file).version).toBe(4);
    d.setText(s.p.file, "notes", "Moje druhá.");
    expect(await d.flush(s.p.file)).toBe(false);
    await flushPromises();
    const bar = w.get('[role="alert"]');
    expect(bar.text()).toContain("Koncept mezitím upravil(a) MUDr. Malá.");
    await bar.findAll("button").find((b) => b.text() === "Načíst uloženou verzi")!.trigger("click");
    expect(d.protoOf(s.p.file).notes).toBe("Jejich.");
    expect(d.protoOf(s.p.file).version).toBe(6);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it("keeps typed text when an older answer arrives meanwhile", async () => {
    const s = setup({ wf: { protocol: { notes: "", state: "draft", version: 2 } } });
    mountInCase(DiscussionCard, s);
    const d = useDiscussionStore();
    d.setText(s.p.file, "notes", "Rozepsáno");
    useWorkflowStore().applyState({ cases: { "NO-010": { protocol: { notes: "starší", state: "draft", version: 2 } } } });
    await flushPromises();
    expect(d.protoOf(s.p.file).notes).toBe("Rozepsáno");
  });

  it("approval stores first, sends one idempotency key and the frozen attendance with the approver, and reuses the key after a lost answer", async () => {
    const keys: (string | null)[] = [];
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    const s = setup({
      wf: { protocol: { notes: "", concl: "Kontrolní MR mozku za 3 měsíce.", steps: [], state: "draft", version: 5 } },
      routes: {
        "/cases/NO-010/decisions": (_u: string, init: RequestInit) => {
          keys.push(new Headers(init.headers).get("Idempotency-Key"));
          bodies.push(reply(init));
          n++;
          if (n === 1) throw new TypeError("network down");
          return ok({ speaker_pass_job_id: null }, { cases: { "NO-010": { protocol: { concl: "Kontrolní MR mozku za 3 měsíce.", state: "approved", version: 6, approver: "MUDr. Svobodová", approved_at: "2026-10-16T12:00:00Z" } } } });
        },
      },
    });
    const w = mountInCase(DiscussionCard, s);
    const d = useDiscussionStore();
    await d.approve(s.p.file, { name: "MUDr. Svobodová", isDoctor: true });
    await d.approve(s.p.file, { name: "MUDr. Svobodová", isDoctor: true });
    await flushPromises();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[0]).toMatchObject({ protocol_version: 5, conclusion: "Kontrolní MR mozku za 3 měsíce.", attendance_expected: ["MUDr. Svobodová"] });
    // The snapshot never holds the patient's identity: the server refuses one that does.
    expect(String(bodies[0]!.report_html)).toContain('<p class="pt-ident"></p>');
    expect(d.protoOf(s.p.file).state).toBe("approved");
    expect(lastToast()).toBe("discussion-approved");
    expect(w.text()).toContain("Schválil(a) za tým MUDr. Svobodová");
  });

  it("does not approve while a conflict waits, and never twice", async () => {
    const calls: string[] = [];
    const s = setup({ wf: { protocol: { concl: "X", state: "approved", version: 2 } }, routes: { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) } });
    mountInCase(DiscussionCard, s);
    await useDiscussionStore().approve(s.p.file, { name: "MUDr. Svobodová", isDoctor: true });
    expect(calls).toHaveLength(0);
  });

  it("a new version names the decision it replaces; a closed case offers none", async () => {
    const sent: unknown[] = [];
    const s = setup({
      p: { status: "done" },
      wf: { protocol: { concl: "A", state: "approved", version: 3 }, decisions: [{ id: "dec1", version: 1, text: "A", by: "MUDr. Svobodová", when: "2026-10-16T12:00:00Z", attSnap: ["MUDr. Svobodová"] }] },
      routes: { "/cases/NO-010/decisions/new-version": (_u: string, init: RequestInit) => (sent.push(reply(init)), ok()) },
    });
    const w = mountInCase(DiscussionCard, s);
    expect(w.text()).toContain("Uzavřít případ");
    await w.findAll("button").find((b) => b.text() === "Nový závěr (nahradí platný)")!.trigger("click");
    await flushPromises();
    expect(sent).toEqual([{ expected_decision_id: "dec1" }]);
    // The frozen attendance shows, not today's list.
    expect(w.text()).toContain("Přítomní (1)");
  });

  it("drafted tasks quote their clause and only a doctor confirms them", async () => {
    const sugg = [{ id: 7, text: "Objednat: kontrolní MR mozku za 3 měsíce", quote: "kontrolní MR mozku za 3 měsíce", who: "Bc. Marková", due: "2027-01-16", dueSrc: "computed", dueBy: null, timing: "za 3 měsíce", state: "draft", by: null, when: null }];
    const confirmed: string[] = [];
    const doc = setup({ wf: { protocol: { concl: "A", state: "approved", version: 3 }, sugg: sugg as never }, routes: { "/suggestions/7/confirm": () => (confirmed.push("7"), ok()) } });
    const w = mountInCase(DiscussionCard, doc);
    expect(w.text()).toContain("Návrh asistenta, nepotvrzeno");
    expect(w.text()).toContain("Ze závěru: „kontrolní MR mozku za 3 měsíce“");
    await w.findAll("button").find((b) => b.text() === "Potvrdit")!.trigger("click");
    await flushPromises();
    expect(confirmed).toEqual(["7"]);
    const coord = mountInCase(DiscussionCard, setup({ role: "coordinator", userName: "Bc. Marková", wf: { protocol: { concl: "A", state: "approved", version: 3 }, sugg: sugg as never } }));
    expect(coord.findAll("button").some((b) => b.text() === "Potvrdit")).toBe(false);
    expect(coord.text()).toContain("čeká na potvrzení lékařem");
    expect(coord.text()).toContain("Potvrdit nebo zamítnout návrh může jen lékař.");
  });

  it("attendance opens the attendance dialog for the seminar day", async () => {
    const w = mountInCase(DiscussionCard, setup());
    await w.findAll("button").find((b) => b.text() === "Upravit")!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "start", day: "2026-10-22", attOnly: true });
    expect(w.text()).toContain("Platí pro celý seminář (Čt 22. 10. 2026). Jména podle seznamu Personál pracoviště.");
  });
});

describe("conclusion draft", () => {
  it("a doctor writes it under the valid conclusion, which stays until the new one is approved", () => {
    const s = setup({ wf: { protocol: { concl: "", state: "draft", version: 4 }, decisions: [{ id: "d1", version: 1, text: "Platný.", by: "MUDr. Novák", when: "2026-10-16T12:00:00Z" }] as never } });
    const w = mountInCase(ConclusionBox, s);
    expect(w.text()).toContain("Platný.");
    expect(w.text()).toContain("Koncept nového závěru (nahradí platný až po schválení)");
    expect(w.get("#concl").attributes("placeholder")).toMatch(/^Závěr a další postup, píše lékař/);
    expect(w.get("#concl").attributes("aria-describedby")).toBe("concl-new-label");
    expect(w.get("#concldraft").attributes("hidden")).toBeDefined();
  });
});

describe("session bar", () => {
  it("lists the day's cases with the current one marked and approved ones ticked", () => {
    const s = setup({ wf: { protocol: { state: "approved", version: 2 } } });
    useWorkflowStore().sessions = [{ day: "2026-10-22", started_by: "MUDr. Svobodová", started_at: "2026-10-22T12:00:00Z", ended_at: null }];
    const w = mountInCase(SessionBar, s, { tab: "overview" });
    expect(w.get('[role="navigation"]').attributes("aria-label")).toBe("Probíhající MDT");
    const pill = w.get('[aria-current="true"]');
    expect(pill.attributes("aria-label")).toBe("14:00 10 Pacient, NO-010, závěr schválen");
    expect(pill.text()).toContain("✓");
  });

  it("is absent outside the running seminar's day", () => {
    const s = setup();
    useWorkflowStore().sessions = [{ day: "2026-10-29", started_by: null, started_at: "2026-10-29T12:00:00Z", ended_at: null }];
    expect(mountInCase(SessionBar, s, { tab: "overview" }).find('[role="navigation"]').exists()).toBe(false);
  });
});

describe("identity banner", () => {
  it("signals uploaded documents of another patient on the case", async () => {
    const hold = deferred<unknown>();
    const s = setup({ routes: { "/cases/NO-010/documents": () => hold.promise } });
    const w = mountInCase(IdentityBanner, s);
    hold.resolve({ case_id: "NO-010", processing_level: "full", documents: [{ id: "a", name: "x.pdf", origin: "upload", identity: "conflicts", identity_cs: "x" }] });
    await flushPromises();
    expect(useUploadsStore().docsOf(s.p.file)).toHaveLength(1);
    expect(w.get('[role="alert"]').text()).toContain("U 1 nahraného dokumentu se jméno nebo rodné číslo neshoduje");
  });
});

describe("approval guards and what ends with a case", () => {
  const doctor = { name: "MUDr. Svobodová", isDoctor: true };

  it("never approves a closed case or for a non-doctor", async () => {
    const calls: string[] = [];
    const routes = { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) };
    const closed = setup({ p: { status: "closed" }, wf: { protocol: { concl: "A", state: "draft", version: 1 } }, routes });
    await useDiscussionStore().approve(closed.p.file, doctor);
    const coord = setup({ wf: { protocol: { concl: "A", state: "draft", version: 1 } }, routes });
    await useDiscussionStore().approve(coord.p.file, { name: "Bc. Marková", isDoctor: false });
    expect(calls).toHaveLength(0);
  });

  // A click right after the case opens, while its data is still on its way, used to be refused with a toast and was
  // lost (seen on CI). It now waits and approves once the data lands.
  it("a click while the case data still loads waits for it, then approves once", async () => {
    const calls: string[] = [];
    const s = setupPatient({ p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled" }, wf: { protocol: { concl: "A", state: "draft", version: 1 } }, routes: { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) } });
    useCasesStore().caseOf(s.p.file).state = "loading";
    const d = useDiscussionStore();
    const done = d.approve(s.p.file, doctor);
    await flushPromises();
    expect(d.approving(s.p.file)).toBe(true);
    // A second click while it waits is the same approval, not a second one.
    await d.approve(s.p.file, doctor);
    expect(calls).toHaveLength(0);
    Object.assign(useCasesStore().caseOf(s.p.file), { state: "ready", data: { file: s.p.file, id: s.p.id, extraction: null }, loadedAt: 1 });
    await done;
    expect(calls).toHaveLength(1);
    expect(d.approving(s.p.file)).toBe(false);
  });

  it("a click while the guideline layer still loads waits for it, then approves", async () => {
    const calls: string[] = [];
    const s = setupPatient({
      p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled" },
      extraction: FULL,
      guide: { loading: true },
      wf: { protocol: { concl: "A", state: "draft", version: 1 } },
      routes: { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) },
    });
    const d = useDiscussionStore();
    const done = d.approve(s.p.file, doctor);
    await flushPromises();
    expect(d.approving(s.p.file)).toBe(true);
    expect(calls).toHaveLength(0);
    useCasesStore().caseOf(s.p.file).guide = { statements: [] };
    await done;
    expect(calls).toHaveLength(1);
  });

  it("gives up with the message when the guideline layer does not arrive in time, and sends nothing", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const s = setupPatient({
      p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled" },
      extraction: FULL,
      guide: { loading: true },
      wf: { protocol: { concl: "A", state: "draft", version: 1 } },
      routes: { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) },
    });
    const d = useDiscussionStore();
    const done = d.approve(s.p.file, doctor);
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(lastToast()).toBe("discussion-approve-wait-guide");
    expect(calls).toHaveLength(0);
    expect(d.approving(s.p.file)).toBe(false);
  });

  it("a user switch while the click waits ends the approval quietly, with nothing sent", async () => {
    const calls: string[] = [];
    const s = setupPatient({
      p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled" },
      extraction: FULL,
      guide: { loading: true },
      wf: { protocol: { concl: "A", state: "draft", version: 1 } },
      routes: { "/cases/NO-010/decisions": () => (calls.push("x"), ok()) },
    });
    const d = useDiscussionStore();
    const done = d.approve(s.p.file, doctor);
    await flushPromises();
    d.reset();
    await done;
    expect(calls).toHaveLength(0);
    expect(lastToast()).toBeUndefined();
  });

  it("stops waiting at once when a version conflict appears meanwhile, and says so", async () => {
    const calls: string[] = [];
    const save = deferred<unknown>();
    const s = setupPatient({
      p: { slot: { day: "2026-10-22", time: "14:00" }, status: "scheduled" },
      extraction: FULL,
      // The guideline layer never arrives in this test: only the conflict can end the wait before the deadline.
      guide: { loading: true },
      wf: { protocol: { concl: "A", state: "draft", version: 1 } },
      routes: {
        "/cases/NO-010/protocol": async () => {
          await save.promise;
          return [409, { error: { code: "protocol_conflict", message_cs: "Koncept mezitím upravil(a) MUDr. Malá.", current: { notes: "", conclusion: "C", steps: [], version: 2 } } }];
        },
        "/cases/NO-010/decisions": () => (calls.push("x"), ok()),
      },
    });
    const d = useDiscussionStore();
    d.setText(s.p.file, "concl", "B");
    // The blur's save, then the click; the save comes back with a colleague's newer draft.
    const saved = d.flush(s.p.file);
    const done = d.approve(s.p.file, doctor);
    save.resolve(null);
    await saved;
    await done;
    expect(d.conflictOf(s.p.file)).not.toBeNull();
    expect(lastToast()).toBe("discussion-approve-conflict-first");
    expect(calls).toHaveLength(0);
    expect(d.approving(s.p.file)).toBe(false);
  });

  it("a click that also blurs the conclusion field approves after that field's save, with the saved version", async () => {
    const order: string[] = [];
    const save = deferred<unknown>();
    let approved: Record<string, unknown> | null = null;
    const s = setup({
      wf: { protocol: { notes: "", concl: "", steps: [], state: "draft", version: 4 } },
      routes: {
        "/cases/NO-010/protocol": async () => {
          order.push("save");
          await save.promise;
          return ok({ version: 5 });
        },
        "/cases/NO-010/decisions": (_u: string, init: RequestInit) => {
          order.push("approve");
          approved = reply(init);
          return ok();
        },
      },
    });
    const d = useDiscussionStore();
    d.setText(s.p.file, "concl", "Kontrolní MR mozku za 3 měsíce.");
    // The blur's save starts first (focusout), then the click's approval.
    void d.flush(s.p.file);
    const done = d.approve(s.p.file, doctor);
    await flushPromises();
    expect(order).toEqual(["save"]);
    expect(d.approving(s.p.file)).toBe(true);
    save.resolve(null);
    await done;
    expect(order).toEqual(["save", "approve"]);
    expect(approved).toMatchObject({ protocol_version: 5, conclusion: "Kontrolní MR mozku za 3 měsíce." });
  });

  it("a definite refusal drops the idempotency key, so the next approval is a new request", async () => {
    const keys: (string | null)[] = [];
    let n = 0;
    const s = setup({
      wf: { protocol: { concl: "A", state: "draft", version: 1 } },
      routes: {
        "/cases/NO-010/decisions": (_u: string, init: RequestInit) => {
          keys.push(new Headers(init.headers).get("Idempotency-Key"));
          return ++n === 1 ? [409, { error: { code: "attendance_changed", message_cs: "Přítomní se mezitím změnili." } }] : ok();
        },
        "/workflow": { data_epoch: null, cases: {}, att: {}, sessions: [], mails: [] },
      },
    });
    await useDiscussionStore().approve(s.p.file, doctor);
    await useDiscussionStore().approve(s.p.file, doctor);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("only a doctor starts a new conclusion", async () => {
    const sent: unknown[] = [];
    const s = setup({ p: { status: "done" }, wf: { protocol: { concl: "A", state: "approved", version: 3 } }, routes: { "/cases/NO-010/decisions/new-version": () => (sent.push(1), ok()) } });
    await useDiscussionStore().newVersion(s.p.file, false);
    expect(sent).toHaveLength(0);
  });

  it("closing the case from the card purges its recording audio", async () => {
    const s = setup({
      p: { status: "done" },
      wf: { protocol: { concl: "A", state: "approved", version: 3 } },
      routes: { "/cases/NO-010/status": ok({ slot_released: false }) },
    });
    const purge = vi.spyOn(useRecorderStore(), "purge");
    const w = mountInCase(DiscussionCard, s);
    await w.findAll("button").find((b) => b.text() === "Uzavřít případ")!.trigger("click");
    await flushPromises();
    expect(purge).toHaveBeenCalledWith([s.p.file], "closed");
  });

  it("ending the seminar stops the recording and purges every case's audio", async () => {
    const s = setup({ routes: { "/sessions/2026-10-22": ok() } });
    useWorkflowStore().sessions = [{ day: "2026-10-22", started_by: null, started_at: "2026-10-22T12:00:00Z", ended_at: null }];
    const purge = vi.spyOn(useRecorderStore(), "purge");
    const w = mountInCase(SessionBar, s, { tab: "overview" });
    await w.findAll("button").find((b) => b.text() === "Ukončit MDT")!.trigger("click");
    await flushPromises();
    expect(purge).toHaveBeenCalledWith([s.p.file], "session_end");
    expect(lastToast()).toBe("MDT ukončeno");
  });

  it("a draft that cannot be stored refuses a user switch, so nothing typed is lost", async () => {
    const s = setup({
      wf: { protocol: { notes: "", state: "draft", version: 1 } },
      routes: { "/cases/NO-010/protocol": () => [503, { error: { code: "unavailable", message_cs: "Server je přetížený." } }] },
    });
    const d = useDiscussionStore();
    d.setText(s.p.file, "notes", "Rozepsáno");
    expect(await useSessionStore().switchUser("coord")).toBe(false);
    expect(lastToast()).toBe("discussion-switch-unsaved");
    expect(d.protoOf(s.p.file).notes).toBe("Rozepsáno");
  });
});
