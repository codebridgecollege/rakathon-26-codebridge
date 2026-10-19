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
import { docsOf, edit, runOf } from "./helpers";

const SRC = (page: number, quote: string) => ({ file: "10_pacient.pdf", page, quote });
const reply = (state: unknown = {}) => ({ data: {}, data_epoch: 1, state });

// Case 10 as the server sends it: the converted codebridge.extraction/2 run and its stored documents.
const case10 = () => ({ extraction: runOf("NO-010"), documents: docsOf("NO-010") });

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
    const s = setupPatient({ p: { status: "ready", slot: { day: "2026-10-22", time: "14:00" }, name: "Daniel Poláček" }, ...case10() });
    const w = mountInCase(PatientHeader, s);
    expect(w.text()).toContain("NO-010");
    expect(w.get("h1").text()).toBe("Poláček DanielRČ: -Věk: -");
    expect(w.findAll("h1 .gapq").map((g) => g.attributes("title"))).toEqual(["neuvedeno v dostupné dokumentaci", "neuvedeno v dostupné dokumentaci"]);
    expect(w.text()).toContain("Vlastník: MUDr. Svobodová");
    expect(w.text()).toContain("Příští MDT: Čt 22. 10. 2026 · 14:00-14:10");
    expect(w.findAll("button.btn").map((b) => b.text())).toEqual(["Změnit termín", "Zahájit MDT", "Export FHIR", "Stáhnout report (PDF)"]);
  });

  it("offers FHIR export only when the case has finding groups, and no report while loading", () => {
    // S01's run has no record, so no finding groups.
    const s = setupPatient({ extraction: runOf("NO-S01"), documents: docsOf("NO-S01") });
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
    // The draft is labelled as the assistant's, outside the edit button, which names the label as its description.
    const label = w.get(".qlbl.draft");
    expect(label.text()).toBe("Návrh asistenta");
    expect(label.attributes("tabindex")).toBe("0");
    expect(text.attributes("aria-describedby")).toBe(label.attributes("id"));
    await text.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "q", orig: "Jaký postup u ložiska?", isQuestion: true });
    await w.get("button.btn").trigger("click");
    await flushPromises();
    expect(JSON.parse(String(s.calls.find((c) => c.url.includes("confirm"))!.init.body))).toEqual({ draft_sha: "abc" });
    expect(w.find("button.btn").exists()).toBe(false);
    expect(lastToast()).toBe("Otázka potvrzena");
    // Once a doctor confirmed it, the question is no longer labelled a draft.
    expect(w.find(".qlbl").exists()).toBe(false);
  });

  it("shows the coordinator the question as plain text without a confirm button", () => {
    const w = mountInCase(QuestionBox, setupPatient({ role: "coordinator", p: draft }));
    expect(w.find('[role="button"]').exists()).toBe(false);
    expect(w.find("button").exists()).toBe(false);
    expect(w.text()).toContain("Jaký postup u ložiska?");
    expect(w.get(".qlbl.draft").text()).toBe("Návrh asistenta");
  });

  it("quotes the passage a draft rests on in the label's tooltip", () => {
    const basis = [{ role: "purpose", quote: "k posouzení dalšího postupu", source: { file: "NO-010_A.pdf", page: 2 } }];
    const w = mountInCase(QuestionBox, setupPatient({ p: { ...draft, basis } }));
    const tip = w.get(".qlbl.draft").attributes("title") ?? "";
    expect(tip).toContain("Žádanka výslovnou otázku neuvádí.");
    expect(tip).toContain("Účel v dokumentu: „k posouzení dalšího postupu“ (NO-010_A.pdf, s. 2).");
  });

  it("labels no question a doctor edited or confirmed, and never the referral's explicit question", () => {
    const edited = mountInCase(QuestionBox, setupPatient({ p: draft, wf: { edits: { q: edit("Upravená otázka?", "MUDr. A", { when: "t" }) } } }));
    expect(edited.text()).toContain("Upravená otázka?");
    expect(edited.find(".qlbl").exists()).toBe(false);
    const confirmed = mountInCase(QuestionBox, setupPatient({ p: draft, wf: { qConfirm: { text: draft.draft, by: "MUDr. A", when: "t" } } }));
    expect(confirmed.text()).toContain("Jaký postup u ložiska?");
    expect(confirmed.find(".qlbl").exists()).toBe(false);
    // A confirmation of an older draft text does not cover a re-extracted draft: that one is labelled again.
    const stale = mountInCase(QuestionBox, setupPatient({ p: draft, wf: { qConfirm: { text: "Starší návrh?", by: "MUDr. A", when: "t" } } }));
    expect(stale.get(".qlbl.draft").text()).toBe("Návrh asistenta");
    const explicit = mountInCase(QuestionBox, setupPatient({ p: { explicit: true, question: "Výslovná otázka?", draft: null } }));
    expect(explicit.text()).toContain("Výslovná otázka?");
    expect(explicit.find(".qlbl").exists()).toBe(false);
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
    const s = setupPatient({ ...case10() });
    const w = withRouter(s, BriefBlock).w;
    const b = w.get("button.gapsbtn");
    expect(b.text()).toBe("⚠ Upozornění · chybí podklady ▾");
    expect(b.classes()).toContain("warn");
    await b.trigger("click");
    expect(w.get("button.gapsbtn").attributes("aria-expanded")).toBe("true");
    expect(w.text()).toContain("Upozornění k dotazu na MDT");
    // The question's alert first, then the missing documents that do not bear on the question.
    expect(w.text()).toContain("Výslovná otázka pro MDT neuvedena v dostupné dokumentaci.");
    expect(w.text()).toContain("Chybějící a nejasné podklady");
    expect(w.text()).toContain("Originální zpráva v dostupné dokumentaci chybí, jen citace: světlobuněčný renální adenokarcinom G2");
    expect(w.text()).toContain("Pozorování asistenta, ne klinický závěr. Upozornění neblokují projednání.");
  });
});

describe("brief", () => {
  it("links each clause to its source and lists the sources", async () => {
    const s = setupPatient({ ...case10() });
    const w = withRouter(s, BriefBlock).w;
    expect(w.get("h2").text()).toBe("Stručný souhrn");
    // One link per brief sentence of the run, each opening the passages of the facts it rests on.
    const links = w.findAll(".prose .srcl");
    expect(links.map((l) => l.text())).toEqual(runOf("NO-010").brief!.sentences.map((x) => x.text));
    expect(links[0]!.text()).toMatch(/^Pacient s metastatickým světlobuněčným renálním karcinomem G2/);
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (18)");
  });

  it("says a case without a brief shows the list's summary, with what was processed", () => {
    // S01's run looked at labs and requests only, so it has no brief.
    const s = setupPatient({ p: { summary: "Jednořádkový souhrn.", pages: 9 }, extraction: runOf("NO-S01"), documents: docsOf("NO-S01") });
    const w = withRouter(s, BriefBlock).w;
    expect(w.get(".chip.st-new").text()).toBe("Zpracováno: dokumenty, chybějící podklady, laboratoř");
    expect(w.text()).toContain("Souhrn ze seznamu pacientů, bez odkazů na zdroj. Zdroj: 10_pacient.pdf, 9 s.");
  });
});

describe("alerts tab", () => {
  it("lists question alerts first, the rest by kind, and labels them as the assistant's observations", () => {
    // The consultation-form alert's note, given the prefix a producer may repeat.
    const run = runOf("NO-010");
    run.alerts.find((a) => a.id === "al-d7fce3c0")!.note = "Pozorování asistenta. Formulář FNO má pole „Otázka na NOCO“.";
    const w = mountInCase(TabAlerts, setupPatient({ extraction: run, documents: docsOf("NO-010") }));
    expect(w.findAll("h3").map((x) => x.text())).toEqual(["K dotazu na MDT", "Ostatní upozornění"]);
    expect(w.findAll("h4").map((x) => x.text())).toEqual(["Rozpor, další", "Chybí, další", "Nejasné, další"]);
    expect(w.text()).toContain("Pozorování asistenta, ne klinický závěr. Upozornění neblokují projednání.");
    // The question's alerts come first, with their messages in the interface language.
    const top = w.findAll(".alert").map((a) => a.text());
    expect(top[0]).toMatch(/^ChybíVýslovná otázka pro MDT neuvedena v dostupné dokumentaci\. Účel dle dokumentu: projednání nálezu MR mozku/);
    expect(top[1]).toMatch(/^ChybíKonzultační formulář v dostupné dokumentaci nenalezen\./);
    // The note keeps its text without the repeated prefix.
    expect(w.text()).toContain("Formulář FNO má pole „Otázka na NOCO“.");
    expect(w.text()).not.toContain("Pozorování asistenta. Formulář");
  });

  it("shows an acknowledgement at once, stores it against the state seen, and archives it", async () => {
    // Events are keyed by the alert's ID, here the date contradiction's.
    const s = setupPatient({
      ...case10(),
      routes: { "/cases/NO-010/alerts/al-4b4cc309/events": reply({ cases: { "NO-010": { alertHist: [{ alert_id: "al-4b4cc309", action: "ack", who: "MUDr. Svobodová", when: "2026-10-16T10:00:00Z" }] } } }) },
    });
    const w = mountInCase(TabAlerts, s);
    const row = w.findAll(".alert").find((a) => a.text().includes("Rozdílné datum téhož vyšetření"))!;
    await row.findAll("button").find((b) => b.text() === "Vzít na vědomí")!.trigger("click");
    await flushPromises();
    expect(s.calls.at(-1)!.url).toBe("/api/cases/NO-010/alerts/al-4b4cc309/events");
    expect(JSON.parse(String(s.calls.at(-1)!.init.body))).toEqual({ action: "ack", expected_state: "open" });
    expect(w.get("details.resolved summary").text()).toBe("Vyřešené / vzaté na vědomí (1)");
    expect(w.get("details.resolved").text()).toContain("Vzal(a) na vědomí MUDr. Svobodová");
  });

  it("takes a refused event back out", async () => {
    const s = setupPatient({ ...case10(), routes: { "/cases/NO-010/alerts/al-4b4cc309/events": [409, { error: { code: "alert_changed", message_cs: "Upozornění mezitím změnil kolega." } }], "/workflow": { data_epoch: 1, cases: {}, att: {}, sessions: [], mails: [] } } });
    const w = mountInCase(TabAlerts, s);
    const row = w.findAll(".alert").find((a) => a.text().includes("Rozdílné datum téhož vyšetření"))!;
    await row.findAll("button").find((b) => b.text() === "Vyřešeno")!.trigger("click");
    await flushPromises();
    expect(w.find("details.resolved").exists()).toBe(false);
    expect(useWorkflowStore().cases["NO-010"]?.alertHist).toEqual([]);
    expect(lastToast()).toBe("Upozornění mezitím změnil kolega.");
  });

  it("offers no alert actions to the administrator", () => {
    const w = mountInCase(TabAlerts, setupPatient({ role: "admin", ...case10() }));
    expect(w.findAll(".alert").length).toBeGreaterThan(0);
    expect(w.findAll(".albtns button")).toHaveLength(0);
  });
});

describe("timeline", () => {
  const s = () => setupPatient({ ...case10() });

  it("counts events and categories, keeps partial dates, and marks plans", () => {
    const w = mountInCase(TimelineCard, s());
    // Case 10's 16 timeline cards (views.timeline), a partial date kept as written, the undated plan last.
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 16 z 16 událostí · 9 z 9 kategorií");
    expect(w.findAll(".ev .date").map((d) => d.text())).toEqual([
      "4/2022",
      "2.6.2022",
      "25.10.2022",
      "6.3.2023",
      "27.3.2023",
      "27.6.2023",
      "21.11.2023",
      "10.11.2025",
      "16.1.2026",
      "27.1.2026",
      "28.4.2026",
      "26.8.2026",
      "3.9.2026",
      "14.9.2026",
      "9.10.2026 · plán",
      "Bez data · plán",
    ]);
    expect(w.findAll(".tlyear").map((y) => y.text())).toEqual(["2022", "2023", "2025", "2026", "Bez data"]);
    expect(w.get(".ev .mk").attributes("title")).toBe("Přesný den ani vyšetření, kterým byla diagnóza stanovena, uvedeny nejsou.");
  });

  it("hides a category, and 'Vše' turns all on or off", async () => {
    const w = mountInCase(TimelineCard, s());
    const boxes = w.findAll('input[type="checkbox"]');
    const imaging = boxes[1]!;
    await imaging.setValue(false);
    // Six of the 16 cards are imaging.
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 10 z 16 událostí · 8 z 9 kategorií");
    expect((boxes[0]!.element as HTMLInputElement).indeterminate).toBe(true);
    await boxes[0]!.setValue(true);
    expect(w.get('[role="status"]').text()).toBe("Zobrazeno 16 z 16 událostí · 9 z 9 kategorií");
    await w.findAll('input[type="checkbox"]')[0]!.setValue(false);
    expect(w.text()).toContain("Všechny kategorie jsou skryté. Zaškrtněte kategorii nebo Vše.");
  });

  it("opens an event's own source", async () => {
    const w = mountInCase(TimelineCard, setupPatient({ ...case10(), routes: { "/documents/10_pacient/pages/1": { n: 1, pages: [{ n: 1 }] } } }));
    await w.findAll(".ev")[0]!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "source", cite: SRC(1, "C64 \nZhoubný novotvar ledviny mimo pánvičku \nRCC lok. pokročilý diag. 4/2022"), page: 1 });
  });
});

describe("overview cards", () => {
  it("shows the stage at diagnosis with its date and the OCR doubt, and the compact lines with pins", () => {
    const w = mountInCase(OncoCard, setupPatient({ ...case10() }));
    expect(w.get(".dxh").text()).toContain("Světlobuněčný renální adenokarcinom, G2, pT2a pN1 M0");
    expect(w.get(".dxh").text()).toContain("pT2a pN1 M0✎ (pTNM při diagnóze, 6/2022)");
    expect(w.get(".dxh .mk.ocr").attributes("title")).toBe("Ověřit čtení: V textu „MO“, čteno jako M0.");
    // Case 10's 16 composed oncology lines (views.onco_lines), by date, the last two planned.
    const dates = w.findAll(".orow .dt").map((d) => d.text());
    expect(dates).toHaveLength(16);
    expect(dates.slice(0, 3)).toEqual(["2. 6. 2022", "25. 10. 2022", "6. 3. 2023"]);
    expect(dates.at(-1)).toBe("9. 10. 2026");
    const pins = w.findAll(".lpin").map((p) => p.attributes("aria-label"));
    expect(pins.slice(0, 3)).toEqual(["Chirurgie a výkony", "Chirurgie a výkony", "Zobrazovací vyšetření"]);
    expect(pins.slice(-2)).toEqual(["Systémová protinádorová léčba, plánováno", "Klinický stav a ostatní, plánováno"]);
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (66)");
  });

  it("numbers the current state's sources in reading order, leaves out what was not examined, and dashes a missing value", () => {
    const w = mountInCase(StatusCard, setupPatient({ ...case10() }));
    const text = w.get(".stc").text();
    expect(text).toMatch(/^Subjektivně: Nově předepsaný everolimus toleruje výborně, nemá s ním žádný problém\[1\], Nechutenství není/);
    expect(text).toContain("Krevní tlak nyní neměřil, protože byl na dovolené[5].Objektivně: TK/P 155/70 mmHg[6] / 68/min[6], TT -, PS (ECOG) 1[7];");
    expect(text).toContain("jizvy pod pravým i levým obloukem žeberním klidné[18].");
    // The run states "Zevní genitál: nevyšetřen" and "per rectum: nevyšetřen"; neither shows.
    expect(text).not.toContain("nevyšetřen");
    // The temperature is not stated: one dash with the gap wording.
    expect(w.findAll(".stc .gapq")).toHaveLength(1);
  });
});

describe("edit dialog", () => {
  // A composed line's edit, keyed by the line ID ("v:" and the ID, edits.ts), never by its position.
  const open = (s: PatientSetup) => {
    const setup = setupPatient(s);
    const o = { kind: "edit" as const, file: setup.p.file, key: "v:vl-a8eede21", orig: "Původní řádek", isQuestion: false };
    useOverlayStore().open(o);
    return { setup, w: mountInCase(EditDialog, setup, { o }) };
  };

  it("saves a doctor's text next to the original, naming the edit it replaces", async () => {
    const { setup, w } = open({ routes: { "/cases/NO-010/edits/v%3Avl-a8eede21": reply() } });
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
    const { setup, w } = open({ wf: { edits: { "v:vl-a8eede21": edit("Opravený", "MUDr. A", { id: 7, when: "t" }) } }, routes: { "/cases/NO-010/edits/v%3Avl-a8eede21": reply() } });
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
