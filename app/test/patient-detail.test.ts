// The patient header, status menu, MDT question, brief, alerts, timeline and overview cards (screen S-3), mounted with
// the real Czech catalog against synthetic cases. Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import PatientHeader from "../app/components/patient/PatientHeader.vue";
import StatusMenu from "../app/components/patient/StatusMenu.vue";
import QuestionBox from "../app/components/patient/QuestionBox.vue";
import BriefBlock from "../app/components/patient/BriefBlock.vue";
import AlertSignal from "../app/components/patient/AlertSignal.vue";
import TabAlerts from "../app/components/patient/TabAlerts.vue";
import TimelineCard from "../app/components/patient/TimelineCard.vue";
import OncoCard from "../app/components/patient/OncoCard.vue";
import StatusCard from "../app/components/patient/StatusCard.vue";
import EditDialog from "../app/components/patient/EditDialog.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { useCasesStore } from "../app/stores/cases";
import { useWorkflowStore } from "../app/stores/workflow";
import { lastToast, mountInCase, setupPatient, type PatientSetup } from "./patient";

const SRC = (page: number, quote: string) => ({ file: "10_pacient.pdf", page, quote });
const reply = (state: unknown = {}) => ({ data: {}, data_epoch: 1, state });

// A full case shaped like the real extraction (fewer fields), synthetic text.
function fullCase(extra: Record<string, unknown> = {}, caseOver: Record<string, unknown> = {}) {
  return {
    case: {
      page_count: 5,
      flags: [
        { kind: "missing", text_cs: "Otázka pro MDT neuvedena.", based_on: [SRC(3, "Zadávám k projednání.")], note: "Pozorování asistenta. Formulář chybí.", relevant: true },
        { kind: "contradiction", text_cs: "Dvě různá data operace.", based_on: [SRC(1, "op. 2.6.2022")] },
        { kind: "chronology", text_cs: "Strany nejsou v pořadí.", based_on: [SRC(2, "restaging 3/2022")] },
      ],
      sections: { imaging: [] },
      ...caseOver,
    },
    extra: {
      refs: [SRC(1, "C64 diag. 4/2022"), SRC(1, "nefrektomie 2.6.2022"), SRC(4, "Subj. toleruje výborně."), SRC(4, "TK 155/70")],
      onco_summary_v3_cs: "Pacient s karcinomem ledviny [1]. Nyní ložisko v mozečku [2].",
      onco_summary_v3_refs: [SRC(1, "C64 diag. 4/2022"), SRC(1, "MR mozku")],
      data_gaps_v3: [{ kind: "missing", text_cs: "Věk neuveden.", refs: [] }],
      diagnosis_headline: { histology_cs: "Světlobuněčný karcinom", grade_cs: "G2", tnm_cs: "pT2a pN1 M0", tnm_context_cs: "stadium při diagnóze", histology_date_cs: "2.6.2022", ocr_note_cs: "V OCR „MO“.", mkn_cs: "C64 Novotvar ledviny", refs: [0, 1] },
      onco_compact_v3: { lines: [{ text_cs: "St. p. nefrektomii", kind: "surgery", date_sort: "2022-06-02", refs: [1] }, { text_cs: "Plánována kontrola", kind: "plan", refs: [] }] },
      status_praesens: {
        exam_title_cs: "Ambulantní kontrola",
        exam_date_cs: null,
        items: [
          { group: "subjective", label_cs: "Subjektivně", text_cs: "Toleruje výborně.", refs: [2] },
          { group: "objective", label_cs: "Vitální funkce", text_cs: "krevní tlak 155/70 mmHg, pulz 68/min", refs: [3] },
          { group: "objective", label_cs: "Zevní genitál", text_cs: "nevyšetřen", refs: [3] },
        ],
      },
      timeline_cards_v3: [
        { date: "2.6.2022", date_sort: "2022-06-02", kind: "surgery", title_cs: "Nefrektomie", text_cs: "vpravo", source: SRC(1, "nefrektomie") },
        { date: "4/2022", date_sort: "2022-04", kind: "diagnosis", title_cs: "Diagnóza", text_cs: "karcinom", source: SRC(1, "diag. 4/2022"), note_cs: "Den neuveden." },
        { date: "10/2026", date_sort: "2026-10", kind: "imaging", status: "planned", title_cs: "MR mozku", text_cs: "kontrola" },
      ],
      documents: [{ title_cs: "Ambulantní zpráva", pages: [1, 2, 3, 4] }],
      ...extra,
    },
  };
}

function withRouter(s: ReturnType<typeof setupPatient>, comp: unknown, props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", name: "view", component: { render: () => null } }, { path: "/patient/:nr/:tab?", name: "patient", component: { render: () => null } }] });
  const Host = defineComponent({ setup: () => () => h(comp as never, props) });
  const w = mountInCase(Host, s);
  w.vm.$.appContext.app.use(router);
  return { w, router };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("case header", () => {
  it("shows the case ID, owner, slot, and a dash with the gap wording for the missing birth number and age", () => {
    const s = setupPatient({ p: { status: "ready", slot: { day: "2026-10-22", time: "14:00" }, name: "Daniel Poláček" }, extraction: fullCase() });
    const w = mountInCase(PatientHeader, s);
    expect(w.text()).toContain("NO-010");
    expect(w.get("h1").text()).toBe("Poláček DanielRČ: -Věk: -");
    expect(w.findAll("h1 .gapq").map((g) => g.attributes("title"))).toEqual(["neuvedeno v dostupné dokumentaci", "neuvedeno v dostupné dokumentaci"]);
    expect(w.text()).toContain("Vlastník: MUDr. Svobodová");
    expect(w.text()).toContain("Příští MDT: Čt 22. 10. 2026 · 14:00-14:10");
    expect(w.findAll("button.btn").map((b) => b.text())).toEqual(["Změnit termín", "Zahájit MDT", "Export FHIR", "Stáhnout report (PDF)"]);
  });

  it("offers FHIR export only when the case has finding groups, and no report while loading", () => {
    const s = setupPatient({ extraction: { syn: { documents: [] } } });
    const w = mountInCase(PatientHeader, s, { withReport: false });
    expect(w.findAll("button.btn").map((b) => b.text())).toEqual(["Naplánovat"]);
    expect(w.text()).toContain("Příští MDT: nenaplánováno");
  });

  it("shows an identity doubt and the synthetic patient label", () => {
    const s = setupPatient({ p: { warn: "Jméno se v dokumentech liší.", synthetic: true } });
    const w = mountInCase(PatientHeader, s);
    expect(w.get(".question.missing").text()).toBe("Ověřit identitu: Jméno se v dokumentech liší.");
    expect(w.get(".syntag").text()).toBe("syntetický pacient");
  });
});

describe("status menu", () => {
  it("offers a doctor the allowed moves and shows an empty history", async () => {
    const s = setupPatient({ p: { status: "ready", slot: { day: "2026-10-22", time: "14:00" } } });
    const w = mountInCase(StatusMenu, s);
    expect(w.get("button.chip").text()).toBe("Připraven ▾");
    await w.get("button.chip").trigger("click");
    const menu = w.get('[role="dialog"]');
    expect(menu.attributes("aria-label")).toBe("Stav případu");
    expect(menu.findAll("button.btn").map((b) => b.text())).toEqual(["Vrátit na: Naplánován", "Změnit na: Vyžaduje pozornost", "Uzavřít případ", "Zavřít"]);
    expect(menu.text()).toContain("V této relaci beze změn.");
  });

  it("sends the move with the status the doctor saw and toasts the change", async () => {
    const s = setupPatient({
      p: { status: "ready", slot: { day: "2026-10-22", time: "14:00" } },
      routes: { "/cases/NO-010/status": reply({ cases: { "NO-010": { case_id: "NO-010", status: "attention" } } }) },
    });
    const w = mountInCase(StatusMenu, s);
    await w.get("button.chip").trigger("click");
    await w.findAll('[role="dialog"] button').find((b) => b.text() === "Změnit na: Vyžaduje pozornost")!.trigger("click");
    await flushPromises();
    const call = s.calls.find((c) => c.url.includes("/status"))!;
    expect(JSON.parse(String(call.init.body))).toEqual({ to: "attention", expected_status: "ready" });
    expect(w.get("button.chip").text()).toBe("Vyžaduje pozornost ▾");
    expect(lastToast()).toBe("Stav změněn na Vyžaduje pozornost");
  });

  it("lets the administrator only read, with the history newest first", async () => {
    const s = setupPatient({
      role: "admin",
      p: { status: "attention" },
      wf: { statusHist: [{ from: "new", to: "ready", by: "MUDr. A", when: "x1", how: "ručně" }, { from: "ready", to: "attention", by: "MUDr. B", when: "x2", how: "ručně" }] },
    });
    const w = mountInCase(StatusMenu, s);
    expect(w.get("button.chip").attributes("title")).toBe("Naposledy změnil(a) MUDr. B, x2. Kliknutím zobrazíte historii.");
    await w.get("button.chip").trigger("click");
    expect(w.text()).toContain("Stav mění lékař nebo koordinátorka; správce jen čte.");
    expect(w.findAll('[role="dialog"] button').map((b) => b.text())).toEqual(["Zavřít"]);
    expect(w.findAll("li").map((l) => l.text())).toEqual(["Připraven -> Vyžaduje pozornost · MUDr. B, x2 · ručně", "Nový -> Připraven · MUDr. A, x1 · ručně"]);
  });
});

describe("the MDT question", () => {
  const draft = { draft: "Jaký postup u ložiska?", qkind: "document_purpose", explicit: false, question: null };

  it("lets a doctor edit the drafted question and confirm that draft by its hash", async () => {
    const s = setupPatient({ p: draft, wf: { draft_sha: "abc" }, routes: { "/cases/NO-010/question/confirm": reply({ cases: { "NO-010": { qConfirm: { text: draft.draft, by: "MUDr. Svobodová", when: "t" } } } }) } });
    const w = mountInCase(QuestionBox, s);
    expect(w.get(".bh").text()).toBe("Otázka pro MDT");
    const text = w.get('.edl[role="button"]');
    expect(text.text()).toBe("Jaký postup u ložiska?");
    await text.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "q", orig: "Jaký postup u ložiska?", isQuestion: true });
    await w.get("button.btn").trigger("click");
    await flushPromises();
    expect(JSON.parse(String(s.calls.find((c) => c.url.includes("confirm"))!.init.body))).toEqual({ draft_sha: "abc" });
    expect(w.find("button.btn").exists()).toBe(false);
    expect(lastToast()).toBe("Otázka potvrzena");
  });

  it("shows the coordinator the question as plain text without a confirm button", () => {
    const w = mountInCase(QuestionBox, setupPatient({ role: "coordinator", p: draft }));
    expect(w.find('[role="button"]').exists()).toBe(false);
    expect(w.find("button").exists()).toBe(false);
    expect(w.text()).toContain("Jaký postup u ložiska?");
  });

  it("says the question is not stated when there is neither a question nor a draft", () => {
    const w = mountInCase(QuestionBox, setupPatient({ p: { draft: null, explicit: false } }));
    expect(w.get(".question").classes()).toContain("missing");
    expect(w.get("b").text()).toBe("Výslovná otázka neuvedena v dostupné dokumentaci.");
  });
});

describe("missing-document signal", () => {
  it("is never silent: unchecked for an unprocessed case, failed for a failed load", () => {
    const un = mountInCase(AlertSignal, setupPatient({ extraction: null }));
    expect(un.get('[role="status"]').text()).toBe("⚠ Chybějící podklady nezkontrolovány (případ nezpracován)");
    const s = setupPatient();
    Object.assign(useCasesStore().caseOf(s.p.file), { state: "error", error: { code: "network", status: 0, message_cs: null, message_id: "api-error-network" } });
    expect(mountInCase(AlertSignal, s).get('[role="status"]').text()).toBe("⚠ Chybějící podklady nelze ověřit (načtení selhalo)");
  });

  it("fills the button amber when a document is missing, and opens the panel", async () => {
    const s = setupPatient({ extraction: fullCase() });
    const w = withRouter(s, BriefBlock).w;
    const b = w.get("button.gapsbtn");
    expect(b.text()).toBe("⚠ Upozornění · chybí podklady ▾");
    expect(b.classes()).toContain("warn");
    await b.trigger("click");
    expect(w.get("button.gapsbtn").attributes("aria-expanded")).toBe("true");
    expect(w.text()).toContain("Upozornění k dotazu na MDT");
    expect(w.text()).toContain("Chybějící a nejasné údaje ve stručném souhrnu");
    expect(w.text()).toContain("Pozorování asistenta, ne klinický závěr. Upozornění neblokují projednání.");
  });
});

describe("brief", () => {
  it("links each clause to its source and lists the sources", async () => {
    const s = setupPatient({ extraction: fullCase() });
    const w = withRouter(s, BriefBlock).w;
    expect(w.get("h2").text()).toBe("Stručný souhrn");
    const links = w.findAll(".prose .srcl");
    expect(links.map((l) => l.text())).toEqual(["Pacient s karcinomem ledviny", "Nyní ložisko v mozečku"]);
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (2)");
  });

  it("says a case without a brief shows the list's summary, with what was processed", () => {
    const s = setupPatient({ p: { summary: "Jednořádkový souhrn.", pages: 9 }, extraction: { syn: { documents: [{ title_cs: "A" }], data_gaps: [] } } });
    const w = withRouter(s, BriefBlock).w;
    expect(w.get(".chip.st-new").text()).toBe("Zpracováno: dokumenty, chybějící podklady");
    expect(w.text()).toContain("Souhrn ze seznamu pacientů, bez odkazů na zdroj. Zdroj: 10_pacient.pdf, 9 s.");
  });
});

describe("alerts tab", () => {
  it("lists question alerts first, the rest by kind, and labels them as the assistant's observations", () => {
    const w = mountInCase(TabAlerts, setupPatient({ extraction: fullCase() }));
    expect(w.findAll("h3").map((x) => x.text())).toEqual(["K dotazu na MDT", "Ostatní upozornění"]);
    expect(w.findAll("h4").map((x) => x.text())).toEqual(["Rozpor, další", "Chybí, další", "Chronologie, další"]);
    expect(w.text()).toContain("Pozorování asistenta, ne klinický závěr. Upozornění neblokují projednání.");
    // The note keeps its text without the repeated prefix.
    expect(w.text()).toContain("Formulář chybí.");
    expect(w.text()).not.toContain("Pozorování asistenta. Formulář");
  });

  it("shows an acknowledgement at once, stores it against the state seen, and archives it", async () => {
    const s = setupPatient({ extraction: fullCase(), routes: { "/cases/NO-010/alerts/1/events": reply({ cases: { "NO-010": { alertHist: [{ i: 1, action: "ack", who: "MUDr. Svobodová", when: "2026-10-16T10:00:00Z" }] } } }) } });
    const w = mountInCase(TabAlerts, s);
    const row = w.findAll(".alert").find((a) => a.text().includes("Dvě různá data operace."))!;
    await row.findAll("button").find((b) => b.text() === "Vzít na vědomí")!.trigger("click");
    await flushPromises();
    expect(JSON.parse(String(s.calls.at(-1)!.init.body))).toEqual({ action: "ack", expected_state: "open" });
    expect(w.get("details.resolved summary").text()).toBe("Vyřešené / vzaté na vědomí (1)");
    expect(w.get("details.resolved").text()).toContain("Vzal(a) na vědomí MUDr. Svobodová");
  });

  it("takes a refused event back out", async () => {
    const s = setupPatient({ extraction: fullCase(), routes: { "/cases/NO-010/alerts/1/events": [409, { error: { code: "alert_changed", message_cs: "Upozornění mezitím změnil kolega." } }], "/workflow": { data_epoch: 1, cases: {}, att: {}, sessions: [], mails: [] } } });
    const w = mountInCase(TabAlerts, s);
    const row = w.findAll(".alert").find((a) => a.text().includes("Dvě různá data operace."))!;
    await row.findAll("button").find((b) => b.text() === "Vyřešeno")!.trigger("click");
    await flushPromises();
    expect(w.find("details.resolved").exists()).toBe(false);
    expect(useWorkflowStore().cases["NO-010"]?.alertHist).toEqual([]);
    expect(lastToast()).toBe("Upozornění mezitím změnil kolega.");
  });

  it("offers no alert actions to the administrator", () => {
    const w = mountInCase(TabAlerts, setupPatient({ role: "admin", extraction: fullCase() }));
    expect(w.findAll(".alert").length).toBeGreaterThan(0);
    expect(w.findAll(".albtns button")).toHaveLength(0);
  });
});

describe("timeline", () => {
  const s = () => setupPatient({ extraction: fullCase() });

  it("counts events and categories, keeps partial dates, and marks plans", () => {
    const w = mountInCase(TimelineCard, s());
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 3 z 3 událostí · 9 z 9 kategorií");
    expect(w.findAll(".ev .date").map((d) => d.text())).toEqual(["4/2022", "2.6.2022", "10/2026 · plán"]);
    expect(w.findAll(".tlyear").map((y) => y.text())).toEqual(["2022", "2026"]);
    expect(w.get(".ev .mk").attributes("title")).toBe("Den neuveden.");
  });

  it("hides a category, and 'Vše' turns all on or off", async () => {
    const w = mountInCase(TimelineCard, s());
    const boxes = w.findAll('input[type="checkbox"]');
    const imaging = boxes[1]!;
    await imaging.setValue(false);
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 2 z 3 událostí · 8 z 9 kategorií");
    expect((boxes[0]!.element as HTMLInputElement).indeterminate).toBe(true);
    await boxes[0]!.setValue(true);
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 3 z 3 událostí · 9 z 9 kategorií");
    await w.findAll('input[type="checkbox"]')[0]!.setValue(false);
    expect(w.text()).toContain("Všechny kategorie jsou skryté. Zaškrtněte kategorii nebo Vše.");
  });

  it("opens an event's own source", async () => {
    const w = mountInCase(TimelineCard, setupPatient({ extraction: fullCase(), routes: { "/documents/10_pacient/pages/1": { n: 1, pages: [{ n: 1 }] } } }));
    await w.findAll(".ev")[0]!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "source", cite: SRC(1, "diag. 4/2022"), page: 1 });
  });
});

describe("overview cards", () => {
  it("shows the stage at diagnosis with its date and the OCR doubt, and the compact lines with pins", () => {
    const w = mountInCase(OncoCard, setupPatient({ extraction: fullCase() }));
    expect(w.get(".dxh").text()).toContain("Světlobuněčný karcinom, G2, pT2a pN1 M0");
    expect(w.get(".dxh").text()).toContain("(pTNM při diagnóze, 6/2022)");
    expect(w.get(".dxh .mk.ocr").attributes("title")).toBe("Ověřit čtení: V OCR „MO“.");
    expect(w.findAll(".orow .dt").map((d) => d.text())).toEqual(["2. 6. 2022", ""]);
    expect(w.findAll(".lpin").map((p) => p.attributes("aria-label"))).toEqual(["Chirurgie a výkony", "Klinický stav a ostatní, plánováno"]);
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (2)");
  });

  it("numbers the current state's sources in reading order, leaves out what was not examined, and dashes a missing value", () => {
    const w = mountInCase(StatusCard, setupPatient({ extraction: fullCase() }));
    const text = w.get(".stc").text();
    expect(text).toContain("Subjektivně: Toleruje výborně[1].");
    expect(text).toContain("TK/P 155/70 mmHg / 68/min[2], TT -, PS (ECOG) -.");
    expect(text).not.toContain("nevyšetřen");
    expect(w.findAll(".stc .gapq")).toHaveLength(2);
  });
});

describe("edit dialog", () => {
  const open = (s: PatientSetup) => {
    const setup = setupPatient(s);
    const o = { kind: "edit" as const, file: setup.p.file, key: "oc:0", orig: "Původní řádek", isQuestion: false };
    useOverlayStore().open(o);
    return { setup, w: mountInCase(EditDialog, setup, { o }) };
  };

  it("saves a doctor's text next to the original, naming the edit it replaces", async () => {
    const { setup, w } = open({ routes: { "/cases/NO-010/edits/oc%3A0": reply() } });
    expect(w.text()).toContain("Úprava se uloží jako změna od MUDr. Svobodová s časem.");
    await w.get("textarea").setValue("Opravený řádek");
    await w.findAll("button").find((b) => b.text() === "Uložit")!.trigger("click");
    await flushPromises();
    const call = setup.calls.at(-1)!;
    expect(call.init.method).toBe("PUT");
    expect(JSON.parse(String(call.init.body))).toEqual({ text: "Opravený řádek", orig: "Původní řádek", expected_edit_id: null });
    expect(useOverlayStore().current).toBeNull();
  });

  it("reverts an existing edit, and saving the original text counts as a revert", async () => {
    const { setup, w } = open({ wf: { edits: { "oc:0": { id: 7, text: "Opravený", by: "MUDr. A", when: "t" } } }, routes: { "/cases/NO-010/edits/oc%3A0": reply() } });
    await w.get("textarea").setValue("Původní řádek");
    await w.findAll("button").find((b) => b.text() === "Uložit")!.trigger("click");
    await flushPromises();
    const call = setup.calls.at(-1)!;
    expect(call.init.method).toBe("DELETE");
    expect(JSON.parse(String(call.init.body))).toEqual({ expected_edit_id: 7 });
  });

  it("closes without a request when nothing was edited and nothing changed", async () => {
    const { setup, w } = open({});
    await w.get("textarea").setValue("");
    await w.findAll("button").find((b) => b.text() === "Uložit")!.trigger("click");
    expect(setup.calls).toHaveLength(0);
    expect(useOverlayStore().current).toBeNull();
  });
});
