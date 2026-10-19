// The Dokumenty and Anamnéza tabs against synthetic data shaped like the real extraction (case 10's { case, extra },
// a synthetic patient's { syn }). Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import TabDocuments from "../app/components/patient/TabDocuments.vue";
import TabAnamnesis from "../app/components/patient/TabAnamnesis.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { useSourceStore } from "../app/stores/source";
import { useSessionStore } from "../app/stores/session";
import { usePatientViewStore } from "../app/stores/patientView";
import { mountInCase, setupPatient, type PatientSetup } from "./patient";

const DOCS = [
  { title_cs: "Ambulantní zpráva onkologie", type: "ambulantní zpráva", date: null, pages: [1, 2], readability: "fair", reason_cs: "OCR chyby v datech." },
  { title_cs: "Laboratorní výsledky", type: "jiné", date: "2026-10-06", pages: [3], readability: "good", reason_cs: "Čitelný tisk." },
  { title_cs: "Propouštěcí zpráva", type: "propouštěcí zpráva", date: "03/2024", pages: [4, 5], readability: "poor", reason_cs: "Hlavička nečitelná." },
  { title_cs: "Histologie nefrektomie", type: "histologie", date: "2022", pages: [2], readability: "good", embedded_in_cs: "citace v ambulantní zprávě, původní popis v PDF není" },
];

const fullCase = (extra: Record<string, unknown> = {}, c: Record<string, unknown> = {}): PatientSetup["extraction"] => ({
  case: { file: "10_pacient.pdf", page_count: 5, labs: [], flags: [], ...c },
  extra: { refs: [], documents: DOCS, documents_note_cs: "PDF neobsahuje originální histologii.", ...extra },
});

const bodyRows = (w: ReturnType<typeof mountInCase>) => w.findAll("tbody tr");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Dokumenty", () => {
  it("lists the documents with their readability chip, its reason and a gap for a missing date", () => {
    const w = mountInCase(TabDocuments, setupPatient({ extraction: fullCase() }));
    expect(w.get("h2").text()).toBe("Dokumenty (4)");
    expect(w.get(".head .muted.small").text()).toBe("Zdroj: 10_pacient.pdf, 5 stran");
    const rows = bodyRows(w);
    expect(rows).toHaveLength(4);
    const chips = rows.map((r) => r.get(".chip"));
    expect(chips.map((c) => c.text())).toEqual(["Částečně čitelné", "Dobře čitelné", "Špatně čitelné", "Dobře čitelné"]);
    expect(chips.map((c) => c.classes())).toEqual([
      ["chip", "st-attention"],
      ["chip", "st-ready"],
      ["chip", "k-contradiction"],
      ["chip", "st-ready"],
    ]);
    expect(chips[0]!.attributes("title")).toBe("OCR chyby v datech.");
    // No date: the gap dash with the fixed wording, never an invented day; a partial date stays as written.
    const dateCells = rows.map((r) => r.findAll("td")[2]!);
    expect(dateCells[0]!.get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(dateCells[2]!.text()).toBe("03/2024");
    expect(rows.map((r) => r.findAll("td")[5]!.text())).toEqual(["bez data", "2026", "2024", "2022"]);
  });

  it("reports documents the PDF only cites as missing originals", () => {
    const w = mountInCase(TabDocuments, setupPatient({ extraction: fullCase() }));
    expect(w.get(".question.missing .label").text()).toBe("Chybí originály");
    expect(w.get(".question.missing p").text()).toBe("PDF neobsahuje originální histologii.");
    expect(bodyRows(w)[3]!.get(".note").text()).toBe("citováno v ambulantní zprávě, originál chybí");
    const none = mountInCase(TabDocuments, setupPatient({ extraction: fullCase({ documents_note_cs: null }) }));
    expect(none.find(".question.missing").exists()).toBe(false);
  });

  it("opens a document's first page from the row and from Otevřít, once each", async () => {
    const s = setupPatient({ extraction: fullCase() });
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    const w = mountInCase(TabDocuments, s);
    await bodyRows(w)[2]!.trigger("click");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1]).toEqual({ file: "10_pacient.pdf", page: 4 });
    await bodyRows(w)[1]!.get("button").trigger("click");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]![1]).toEqual({ file: "10_pacient.pdf", page: 3 });
  });

  it("narrows the list with a column filter, and Zrušit filtry clears filters and the search", async () => {
    const w = mountInCase(TabDocuments, setupPatient({ extraction: fullCase() }));
    const head = w.findAll("button.th-f").find((b) => b.text() === "Čitelnost▼")!;
    await head.trigger("click");
    expect(head.attributes("aria-expanded")).toBe("true");
    const pop = w.get('[role="dialog"]');
    expect(pop.attributes("aria-label")).toBe("Filtr Čitelnost");
    expect(pop.findAll("label").map((l) => l.text())).toEqual(["(Vše)", "Částečně čitelné", "Dobře čitelné", "Špatně čitelné"]);
    await pop.findAll("input")[1]!.setValue(false);
    expect(bodyRows(w)).toHaveLength(3);
    expect(w.get("h2").text()).toBe("Dokumenty (3 z 4)");
    expect(head.classes()).toContain("on");
    // The filter stores the code, not the label.
    expect(usePatientViewStore().docFilters.dread).toEqual(["good", "poor"]);
    await pop.findAll("button").find((b) => b.text() === "Hotovo")!.trigger("click");
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    await w.get("input.search").setValue("propouštěcí");
    expect(bodyRows(w)).toHaveLength(1);
    const clear = w.findAll("button").find((b) => b.text().startsWith("Zrušit filtry"))!;
    expect(clear.text()).toBe("Zrušit filtry (2)");
    await clear.trigger("click");
    expect(bodyRows(w)).toHaveLength(4);
    expect((w.get("input.search").element as HTMLInputElement).value).toBe("");
  });

  it("(Vše) unticked shows no document and the empty note", async () => {
    const w = mountInCase(TabDocuments, setupPatient({ extraction: fullCase() }));
    await w.findAll("button.th-f").find((b) => b.text() === "Rok▼")!.trigger("click");
    await w.get('[role="dialog"] input').setValue(false);
    expect(bodyRows(w)).toHaveLength(0);
    expect(w.text()).toContain("Žádný dokument neodpovídá filtru.");
  });

  it("closes the popup on an outside click without acting on it, and on Escape", async () => {
    const s = setupPatient({ extraction: fullCase() });
    const spy = vi.spyOn(useSourceStore(), "openSource").mockResolvedValue();
    const w = mountInCase(TabDocuments, s);
    await w.findAll("button.th-f")[0]!.trigger("click");
    expect(w.find('[role="dialog"]').exists()).toBe(true);
    (bodyRows(w)[0]!.element as HTMLElement).click();
    await nextTick();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    await w.findAll("button.th-f")[0]!.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
  });

  it("opens the upload dialog kind from + Nahrát dokument", async () => {
    const w = mountInCase(TabDocuments, setupPatient({ extraction: fullCase() }));
    await w.findAll("button").find((b) => b.text() === "+ Nahrát dokument")!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "upload" });
  });

  it("shows the reading panel only with the pipeline on and for uploaded files", async () => {
    const docs = [{ ...DOCS[1], file: "S99_upload.pdf" }, DOCS[0]];
    const s = setupPatient({ extraction: { syn: { documents: docs, data_gaps: [], list_entry: { page_count: null } } }, routes: { "/documents/S99_upload/pipeline": { run: null } } });
    const off = mountInCase(TabDocuments, s);
    expect(off.text()).not.toContain("Přečíst bez AI");
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const on = mountInCase(TabDocuments, s);
    expect(on.findAll("button").filter((b) => b.text() === "Přečíst bez AI")).toHaveLength(1);
    // Uploaded files: the count of PDFs; an unknown page count is a gap, not "null".
    expect(on.get(".head .muted.small").text()).toBe("Zdroj: 2 nahraná PDF, - stran");
  });

  it("shows the last reading and its readability warning", async () => {
    const run = { state: "done", label_cs: "Čtení bez AI", readability_cs: "špatná", readability_reasons_cs: ["šum"], verify_count: 3, lab_points: 4, lab_unclear: 1, readability_alert_cs: "Vyžádejte lepší kopii." };
    const s = setupPatient({ extraction: { syn: { documents: [{ ...DOCS[1], file: "S99_upload.pdf" }], data_gaps: [] } }, routes: { "/documents/S99_upload/pipeline": { run } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w = mountInCase(TabDocuments, s);
    await vi.waitFor(() => expect(w.text()).toContain("Přečíst znovu bez AI"));
    expect(w.get(".note span[title]").text()).toBe("Čtení bez AI: čitelnost špatná, 3 místa k ověření, laboratorní hodnoty 4 (k ověření 1).");
    expect(w.get('[role="alert"]').text()).toBe("Vyžádejte lepší kopii.");
  });
});

describe("Dokumenty, reading without AI", () => {
  it("follows a reading still in progress, so a second one cannot start, and shows missing counts as gaps", async () => {
    const s = setupPatient({ extraction: { syn: { documents: [{ ...DOCS[1], file: "S99_upload.pdf" }], data_gaps: [] } }, routes: { "/documents/S99_upload/pipeline": { run: { state: "running", stage_cs: "OCR" } } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w = mountInCase(TabDocuments, s);
    await vi.waitFor(() => expect(w.text()).toContain("Čte se (OCR)…"));
    const btn = w.findAll("button").find((b) => b.text() === "Čtu…")!;
    expect(btn.attributes("disabled")).toBeDefined();
    w.unmount();
    const done = { state: "done", label_cs: "Čtení bez AI", readability_cs: null, verify_count: 1, diff: { same: 5 } };
    const s2 = setupPatient({ extraction: { syn: { documents: [{ ...DOCS[1], file: "S99_upload.pdf" }], data_gaps: [] } }, routes: { "/documents/S99_upload/pipeline": { run: done } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w2 = mountInCase(TabDocuments, s2);
    await vi.waitFor(() => expect(w2.text()).toContain("Přečíst znovu bez AI"));
    expect(w2.get(".note span[title]").text()).toBe("Čtení bez AI: čitelnost -, 1 místo k ověření; proti předem připraveným datům 5 shodných, - k ověření.");
  });
});

describe("Anamnéza", () => {
  const ref = (page: number, quote: string) => ({ file: "10_pacient.pdf", page, quote });
  const anam = {
    OA: [
      { term_cs: "Hypertenzní nemoc", comment_cs: "", refs: [0] },
      { term_cs: "Diabetes mellitus 2. typu", comment_cs: "na PAD", refs: [1], certainty: "unclear_ocr", ocr_note_cs: "V OCR „PAO“." },
    ],
    RA: [],
    FA: [{ drug_cs: "Lék A", strength_cs: "5 mg", dosing_cs: "1-0-0", comment_line_cs: "od 1.9.2026", refs: [2] }],
    FA_warnings: [{ term_cs: "Kontraindikace ACE inhibitorů", comment_cs: "pro riziko", refs: [3] }],
    abusus: [{ term_cs: "Kuřák", comment_cs: "", refs: [0], pack_years_cs: null }],
  };
  const setup = (role?: "doctor" | "coordinator") =>
    setupPatient({ role, extraction: fullCase({ anamnesis_v3: anam, refs: [ref(1, "HT"), ref(2, "DM"), ref(3, "Lék A"), ref(4, "ACE")] }) });

  it("lists findings per section, the drug as one line with its note, and a gap for an empty section", () => {
    const w = mountInCase(TabAnamnesis, setup());
    const cells = w.findAll(".anam3 > div");
    const section = (label: string) => cells[cells.findIndex((c) => c.text() === label) + 1]!;
    expect(section("Osobní anamnéza").findAll("li").map((l) => l.find("b [lang=cs]").text())).toEqual(["Hypertenzní nemoc", "Diabetes mellitus 2. typu"]);
    expect(section("Osobní anamnéza").findAll("li")[1]!.get(".mk.ocr").attributes("title")).toBe("Ověřit čtení: V OCR „PAO“.");
    expect(section("Rodinná anamnéza").get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(section("Farmakologická anamnéza").get("li b").text()).toContain("Lék A 5 mg 1-0-0");
    expect(section("Farmakologická anamnéza").get("li .muted").text()).toContain("od 1.9.2026");
    expect(section("Farmakologická anamnéza").get(".chip").text()).toBe("Pozor");
    // No pack years in the documents: a gap, never a computed number.
    expect(section("Abúzus").get(".small").text()).toBe("Balíčkoroky: -");
    // Sources: each once, in the order the sections use them.
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (4)");
    expect(w.findAll("ol.refs li").map((l) => l.text())).toEqual([
      "Ambulantní zpráva onkologie, s. 1: „HT“",
      "Ambulantní zpráva onkologie, s. 2: „DM“",
      "Laboratorní výsledky, s. 3: „Lék A“",
      "Propouštěcí zpráva, s. 4: „ACE“",
    ]);
  });

  it("offers edit buttons to doctors only, with the old edit keys", async () => {
    const w = mountInCase(TabAnamnesis, setup());
    const li = w.findAll("li").find((l) => l.text().includes("Hypertenzní nemoc"))!;
    await li.get("button.edbtn").trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "OA:0:t", orig: "Hypertenzní nemoc" });
    const coord = mountInCase(TabAnamnesis, setup("coordinator"));
    expect(coord.find("button.edbtn").exists()).toBe(false);
  });
});
