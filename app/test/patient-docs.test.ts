// The Dokumenty and Anamnéza tabs against case 10's converted codebridge.extraction/2 run and its stored documents
// (D1 document_parts), and a case made by intake with one stored file per document. Synthetic values only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import TabDocuments from "../app/components/patient/TabDocuments.vue";
import TabAnamnesis from "../app/components/patient/TabAnamnesis.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { useSourceStore } from "../app/stores/source";
import { useSessionStore } from "../app/stores/session";
import { usePatientViewStore } from "../app/stores/patientView";
import type { ExtractionDocument } from "@codebridge/api-client";
import { mountInCase, setupPatient } from "./patient";
import { docsOf, runOf } from "./helpers";

// Case 10's 13 document parts in one PDF. D1 may hold a date as written, partial included; the lab results' part,
// undated in the PDF, gets one here so the table's partial date is tested.
function case10(note = true) {
  const documents = docsOf("NO-010");
  documents[0]!.parts[1]!.date = "10/2026";
  if (!note) documents[0]!.note_cs = null;
  return { extraction: runOf("NO-010"), documents };
}

// A case made by intake: an uploaded file and a part of the case's own PDF, each its own stored document.
function uploadedCase() {
  const extraction = runOf("NO-S01");
  extraction.documents = [
    { document_id: "S99_upload", sha256: null, parts: ["S99_upload/p0"] },
    { document_id: "10_pacient", sha256: null, parts: ["10_pacient/p0"] },
  ];
  const part = (title_cs: string, pages: number[]) => ({ title_cs, type: "jiné", date: null, date_note_cs: null, pages, readability: "good", reason_cs: null });
  const documents: ExtractionDocument[] = [
    { id: "S99_upload", file: "S99_upload.pdf", page_count: 1, note_cs: null, parts: [part("Laboratorní výsledky", [1])] },
    { id: "10_pacient", file: "10_pacient.pdf", page_count: 2, note_cs: null, parts: [part("Ambulantní zpráva", [1, 2])] },
  ];
  return { extraction, documents };
}

const bodyRows = (w: ReturnType<typeof mountInCase>) => w.findAll("tbody tr");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Dokumenty", () => {
  it("lists the documents with their readability chip, its reason and a gap for a missing date", () => {
    const w = mountInCase(TabDocuments, setupPatient(case10()));
    expect(w.get("h2").text()).toBe("Dokumenty (13)");
    expect(w.get(".head .muted.small").text()).toBe("Zdroj: 10_pacient.pdf, 5 stran");
    const rows = bodyRows(w);
    expect(rows).toHaveLength(13);
    const chips = rows.map((r) => r.get(".chip"));
    expect(chips.slice(0, 4).map((c) => c.text())).toEqual(["Částečně čitelné", "Částečně čitelné", "Špatně čitelné", "Dobře čitelné"]);
    expect(chips.slice(0, 4).map((c) => c.classes())).toEqual([
      ["chip", "st-attention"],
      ["chip", "st-attention"],
      ["chip", "k-contradiction"],
      ["chip", "st-ready"],
    ]);
    expect(chips[0]!.attributes("title")).toMatch(/^Text je čitelný, ale OCR chyby v datech a zkratkách/);
    // No date: the gap dash with the fixed wording, never an invented day; a partial date stays as written.
    const dateCells = rows.map((r) => r.findAll("td")[2]!);
    expect(dateCells[0]!.get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(dateCells[1]!.text()).toBe("10/2026");
    expect(dateCells[3]!.text()).toBe("14.9.2026");
    expect(rows.slice(0, 5).map((r) => r.findAll("td")[5]!.text())).toEqual(["bez data", "2026", "bez data", "2026", "2025"]);
  });

  it("reports documents the PDF only cites as missing originals", () => {
    const w = mountInCase(TabDocuments, setupPatient(case10()));
    expect(w.get(".question.missing .label").text()).toBe("Chybí originály");
    expect(w.get(".question.missing p").text()).toMatch(/^PDF neobsahuje originální histologické zprávy \(nefrektomie 2\.6\.2022/);
    // A part all of whose passages are cited in another report (the MR of 14.9.2026) is labelled so; the report
    // that cites it is not.
    expect(bodyRows(w)[3]!.get(".note").text()).toBe("citace v jiné zprávě, originál chybí");
    expect(bodyRows(w)[0]!.find(".note").exists()).toBe(false);
    expect(bodyRows(w).filter((r) => r.find(".note").exists())).toHaveLength(8);
    const none = mountInCase(TabDocuments, setupPatient(case10(false)));
    expect(none.find(".question.missing").exists()).toBe(false);
  });

  it("opens a document's first page from the row and from Otevřít, once each", async () => {
    const s = setupPatient(case10());
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
    const w = mountInCase(TabDocuments, setupPatient(case10()));
    const head = w.findAll("button.th-f").find((b) => b.text() === "Čitelnost▼")!;
    await head.trigger("click");
    expect(head.attributes("aria-expanded")).toBe("true");
    const pop = w.get('[role="dialog"]');
    expect(pop.attributes("aria-label")).toBe("Filtr Čitelnost");
    expect(pop.findAll("label").map((l) => l.text())).toEqual(["(Vše)", "Částečně čitelné", "Dobře čitelné", "Špatně čitelné"]);
    // Eight of the 13 parts read "fair"; three "good" and two "poor" stay.
    await pop.findAll("input")[1]!.setValue(false);
    expect(bodyRows(w)).toHaveLength(5);
    expect(w.get("h2").text()).toBe("Dokumenty (5 z 13)");
    expect(head.classes()).toContain("on");
    // The filter stores the code, not the label.
    expect([...usePatientViewStore().docFilters.dread!].sort()).toEqual(["good", "poor"]);
    await pop.findAll("button").find((b) => b.text() === "Hotovo")!.trigger("click");
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    await w.get("input.search").setValue("echo");
    expect(bodyRows(w)).toHaveLength(1);
    const clear = w.findAll("button").find((b) => b.text().startsWith("Zrušit filtry"))!;
    expect(clear.text()).toBe("Zrušit filtry (2)");
    await clear.trigger("click");
    expect(bodyRows(w)).toHaveLength(13);
    expect((w.get("input.search").element as HTMLInputElement).value).toBe("");
  });

  it("(Vše) unticked shows no document and the empty note", async () => {
    const w = mountInCase(TabDocuments, setupPatient(case10()));
    await w.findAll("button.th-f").find((b) => b.text() === "Rok▼")!.trigger("click");
    await w.get('[role="dialog"] input').setValue(false);
    expect(bodyRows(w)).toHaveLength(0);
    expect(w.text()).toContain("Žádný dokument neodpovídá filtru.");
  });

  it("closes the popup on an outside click without acting on it, and on Escape", async () => {
    const s = setupPatient(case10());
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
    const w = mountInCase(TabDocuments, setupPatient(case10()));
    await w.findAll("button").find((b) => b.text() === "+ Nahrát dokument")!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "upload" });
  });

  it("shows the reading panel only with the pipeline on and for uploaded files", async () => {
    const s = setupPatient({ ...uploadedCase(), routes: { "/documents/S99_upload/pipeline": { run: null } } });
    const off = mountInCase(TabDocuments, s);
    expect(off.text()).not.toContain("Přečíst bez AI");
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const on = mountInCase(TabDocuments, s);
    expect(on.findAll("button").filter((b) => b.text() === "Přečíst bez AI")).toHaveLength(1);
    // Uploaded files: the count of PDFs; the pages of all stored files.
    expect(on.get(".head .muted.small").text()).toBe("Zdroj: 2 nahraná PDF, 3 strany");
  });

  it("shows the last reading and its readability warning", async () => {
    const run = { state: "done", label_cs: "Čtení bez AI", readability_cs: "špatná", readability_reasons_cs: ["šum"], verify_count: 3, lab_points: 4, lab_unclear: 1, readability_alert_cs: "Vyžádejte lepší kopii." };
    const s = setupPatient({ ...uploadedCase(), routes: { "/documents/S99_upload/pipeline": { run } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w = mountInCase(TabDocuments, s);
    await vi.waitFor(() => expect(w.text()).toContain("Přečíst znovu bez AI"));
    expect(w.get(".note span[title]").text()).toBe("Čtení bez AI: čitelnost špatná, 3 místa k ověření, laboratorní hodnoty 4 (k ověření 1).");
    expect(w.get('[role="alert"]').text()).toBe("Vyžádejte lepší kopii.");
  });
});

describe("Dokumenty, reading without AI", () => {
  it("follows a reading still in progress, so a second one cannot start, and shows missing counts as gaps", async () => {
    const s = setupPatient({ ...uploadedCase(), routes: { "/documents/S99_upload/pipeline": { run: { state: "running", stage_cs: "OCR" } } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w = mountInCase(TabDocuments, s);
    await vi.waitFor(() => expect(w.text()).toContain("Čte se (OCR)…"));
    const btn = w.findAll("button").find((b) => b.text() === "Čtu…")!;
    expect(btn.attributes("disabled")).toBeDefined();
    w.unmount();
    const done = { state: "done", label_cs: "Čtení bez AI", readability_cs: null, verify_count: 1, diff: { same: 5 } };
    const s2 = setupPatient({ ...uploadedCase(), routes: { "/documents/S99_upload/pipeline": { run: done } } });
    useSessionStore().me!.features = { pipeline: true, keeps_uploads: false };
    const w2 = mountInCase(TabDocuments, s2);
    await vi.waitFor(() => expect(w2.text()).toContain("Přečíst znovu bez AI"));
    expect(w2.get(".note span[title]").text()).toBe("Čtení bez AI: čitelnost -, 1 místo k ověření; proti předem připraveným datům 5 shodných, - k ověření.");
  });
});

describe("Anamnéza", () => {
  const setup = (role?: "doctor" | "coordinator") => setupPatient({ role, ...case10() });

  it("lists findings per section, the drug as one line with its note, and a gap for an empty section", () => {
    const w = mountInCase(TabAnamnesis, setup());
    const cells = w.findAll(".anam3 > div");
    const section = (label: string) => cells[cells.findIndex((c) => c.text() === label) + 1]!;
    // Case 10's 12 comorbidities, in the documents' order, one with an OCR doubt.
    const oa = section("Osobní anamnéza").findAll("li");
    expect(oa).toHaveLength(12);
    expect(oa.slice(0, 2).map((l) => l.find("b [lang=cs]").text())).toEqual(["Hypertenzní nemoc", "Chronická obstrukční plicní nemoc"]);
    const dyspnoea = oa.find((l) => l.text().startsWith("Dušnost k vyloučení kardiální etiologie"))!;
    expect(dyspnoea.get(".mk.ocr").attributes("title")).toBe("Ověřit čtení: V OCR „dekorigované HT“, pravděpodobně dekompenzované, ověřit.");
    // The family-history check found nothing: the gap dash with its wording.
    expect(section("Rodinná anamnéza").get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    const fa = section("Farmakologická anamnéza").findAll("li");
    expect(fa[0]!.get("b").text()).toContain("Everolimus Sandoz 5 mg 1-0-0");
    expect(fa[1]!.get("b").text()).toContain("Everolimus Sandoz 5 mg 2-0-0");
    expect(fa[1]!.get(".muted").text()).toContain("navýšení z 1-0-0 na 2-0-0 (10 mg denně) od 19.9.2026");
    expect(section("Farmakologická anamnéza").get(".chip").text()).toBe("Pozor");
    expect(section("Farmakologická anamnéza").get(".small").text()).toContain("ACE inhibitory při léčbě everolimem");
    // No pack years in the documents: a gap, never a computed number.
    expect(section("Abúzus").get(".small").text()).toBe("Balíčkoroky: -");
    // No check looked for preventive examinations: "not checked", not a gap.
    expect(section("Preventivní vyšetření").text()).toBe("nezkontrolováno");
    expect(section("Preventivní vyšetření").find(".gapq").exists()).toBe(false);
    // Sources: each once, in the order the sections use them.
    expect(w.get("details.srcs summary").text()).toBe("Zdroje (25)");
    expect(w.findAll("ol.refs li").slice(0, 2).map((l) => l.text())).toEqual([
      "Ambulantní vyšetření kontrolní (onkologie): onkologická anamnéza, doporučení, plán, s. 2: „OA: HN, CHOPN u fumátora (anamn. léčba přerušena pacientem), HLP na dietě,“",
      // A source is titled by the part it names: the pulmonary exam quoted on page 5, not the report around it.
      "Plicní vyšetření 22.5.2026 MUDr. Hofrová, s. 5: „Plicní wš, 22,5,2026 MUDr.Hofrová \nSpirometrie - lehká obstrukce“",
    ]);
  });

  it("offers edit buttons to doctors only, keyed by the fact", async () => {
    const w = mountInCase(TabAnamnesis, setup());
    const li = w.findAll("li").find((l) => l.text().includes("Hypertenzní nemoc"))!;
    await li.get("button.edbtn").trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "f:f-ffa5e9d3:t", orig: "Hypertenzní nemoc" });
    // A drug line and its note are keyed by the medication fact, with the part.
    const drug = w.findAll("li").find((l) => l.text().startsWith("Kapidin 20 mg 1-0-0"))!;
    await drug.findAll("button.edbtn")[0]!.trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "f:f-b428d800:line", orig: "Kapidin 20 mg 1-0-0" });
    const coord = mountInCase(TabAnamnesis, setup("coordinator"));
    expect(coord.find("button.edbtn").exists()).toBe(false);
  });
});
