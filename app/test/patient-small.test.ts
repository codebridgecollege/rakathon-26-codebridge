// The small building blocks every patient card uses: the gap dash, doctor edits, certainty marks and source links.
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import Gap from "../app/components/patient/Gap.vue";
import Ed from "../app/components/patient/Ed.vue";
import Marks from "../app/components/patient/Marks.vue";
import SrcLinks from "../app/components/patient/SrcLinks.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { mountInCase, setupPatient } from "./patient";

describe("gap dash", () => {
  it("shows a dash whose tooltip is the fixed gap wording", () => {
    const w = mountInCase(Gap, setupPatient());
    expect(w.get(".gapq").text()).toBe("-");
    expect(w.get(".gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
  });
});

describe("doctor edits", () => {
  it("offers the edit button to doctors only, and it opens the edit dialog with the original", async () => {
    const doc = setupPatient();
    const w = mountInCase(Ed, doc, { k: "dx", orig: "Původní text" });
    expect(w.text()).toContain("Původní text");
    await w.get("button.edbtn").trigger("click");
    expect(useOverlayStore().current).toMatchObject({ kind: "edit", key: "dx", orig: "Původní text" });
    const coord = mountInCase(Ed, setupPatient({ role: "coordinator" }), { k: "dx", orig: "Původní text" });
    expect(coord.find("button.edbtn").exists()).toBe(false);
  });

  it("shows the doctor's text marked as edited, with who, when and the original in the tooltip", () => {
    const s = setupPatient({ wf: { edits: { dx: { id: 1, text: "Opraveno", by: "MUDr. Novák", when: "not-a-date" } } } });
    const w = mountInCase(Ed, s, { k: "dx", orig: "" });
    expect(w.get(".edited").text()).toBe("Opraveno");
    expect(w.get(".edtag").text()).toBe("upraveno");
    // An empty original is the gap wording, never an empty string.
    expect(w.get(".edtag").attributes("title")).toBe("Upravil(a) MUDr. Novák, not-a-date. Původně: neuvedeno v dostupné dokumentaci");
  });
});

describe("certainty marks", () => {
  it("marks an unclear reading unless both OCR readings agree", () => {
    const w = mountInCase(Marks, setupPatient(), { f: { certainty: "unclear_ocr", ocr_note_cs: "V OCR „MO“." } });
    expect(w.get(".mk.ocr").attributes("title")).toBe("Ověřit čtení: V OCR „MO“.");
    const cleared = mountInCase(Marks, setupPatient(), { f: { ocr_note_cs: "V OCR „MO“.", ocr_check: { mark: false } } });
    expect(cleared.find(".mk").exists()).toBe(false);
  });

  it("labels an inference as the assistant's observation and a plan as unconfirmed", () => {
    const w = mountInCase(Marks, setupPatient(), { f: { certainty: "inferred" } });
    expect(w.get(".mk.obs").attributes("title")).toBe("Pozorování asistenta, v dokumentu výslovně není");
    const plan = mountInCase(Marks, setupPatient(), { f: { certainty: "planned" } });
    expect(plan.get(".mk.plan").attributes("title")).toBe("Plánováno, dokument neuvádí, že se stalo");
  });
});

describe("source links", () => {
  it("names links by page and numbers a second link to the same page", () => {
    const refs = [
      { file: "10_pacient.pdf", page: 2, quote: "A" },
      { file: "10_pacient.pdf", page: 2, quote: "B" },
      { file: "10_pacient.pdf", page: 3, quote: "C" },
    ];
    const Host = defineComponent({ setup: () => () => h("div", [h(SrcLinks, { refs })]) });
    const w = mountInCase(Host, setupPatient());
    expect(w.findAll("button").map((b) => b.text())).toEqual(["s. 2 (1)", "s. 2 (2)", "s. 3"]);
    expect(w.findAll("button")[0]!.attributes("aria-label")).toBe("Otevřít zdroj, strana 2: A");
  });
});
