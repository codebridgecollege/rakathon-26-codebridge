// The MDT report "Záznam z MDT" (PRODUCT.md F-31): the printed markup for a draft and an approved record, the gap
// wording, the ticks, the snapshot without identity that the server stores, the server's markup rules, the dialog and
// the PDF's file name. Case NO-010's synthetic seed extraction.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises } from "@vue/test-utils";
import { validateReportHtml } from "../../api/src/domain/report";
import { makeBundle } from "../app/lib/i18n";
import { fillIdent, reportFileName, reportHtmlFor, type ReportProto } from "../app/lib/report";
import { reportPdf } from "../app/lib/report-pdf";
import { useReportStore } from "../app/stores/report";
import { usePatientViewStore } from "../app/stores/patientView";
import { useCasesStore } from "../app/stores/cases";
import { useAttendanceStore } from "../app/stores/attendance";
import { useDiscussionStore } from "../app/stores/discussion";
import ReportDialog from "../app/components/discussion/ReportDialog.vue";
import { lastToast, mountInCase, setupPatient, type PatientSetup } from "./patient";

const read = (p: string) => readFileSync(resolve(process.cwd(), "..", p), "utf8");
const seed = { case: JSON.parse(read("mocks/src/data/mock-case-10.json")), extra: JSON.parse(read("mocks/src/data/mock-case-10-extra.json")) };
const cs = makeBundle("cs");
const t = (id: string, args?: Record<string, string | number>) => cs.formatPattern(cs.getMessage(id)!.value!, args);

const NAME = "Daniel Poláček";
const RC = "800101/1234";
const ident = { birthNumber: RC, names: [NAME, "Poláček Daniel"] };
const draft: ReportProto = { state: "draft", concl: "", steps: [] };
const approved: ReportProto = { state: "approved", concl: "Stereotaktická radioterapie ložiska v mozečku.", steps: [{ text: "Objednat SRS", who: "Bc. Marková", due: "2026-10-30" }], approver: "MUDr. Svobodová" };

function setup(s: PatientSetup = {}) {
  return setupPatient({
    p: { name: NAME, rc: RC, age: "45 let", slot: { day: "2026-10-22", time: "14:00" }, ...s.p },
    extraction: { case: seed.case, extra: seed.extra },
    routes: { "/audit/events": { ok: true } },
    ...s,
  });
}
const file = "10_pacient.pdf";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("reportHtmlFor", () => {
  it("prints an assistant's drafted question as a draft with its passage, and a confirmed one with who confirmed it", () => {
    const p = { explicit: false, question: null, draft: "Jaký postup u ložiska?", qkind: "assistant_inference", basis: [{ role: "finding", quote: "ložisko v mozečku", source: { file, page: 3 } }] };
    setup({ p });
    expect(reportHtmlFor(t, file, draft, [])).toContain(
      "<h4>Prezentován pro</h4><p>Jaký postup u ložiska? [návrh otázky asistentem, neověřeno lékařem] Vychází z: „ložisko v mozečku“ (10_pacient.pdf, s. 3).</p>",
    );
    setup({ p, wf: { qConfirm: { text: p.draft, by: "MUDr. Svobodová", when: "2026-10-16T10:00:00Z" } } });
    const html = reportHtmlFor(t, file, draft, []);
    expect(html).toMatch(/<p>Jaký postup u ložiska\? \[návrh asistenta, potvrdil\(a\) MUDr\. Svobodová, [^\]]+\]/);
    expect(html).not.toContain("neověřeno lékařem] Vychází");
  });

  it("prints a draft with its mark, the identity, the attendees and the default ticks", () => {
    setup();
    const html = reportHtmlFor(t, file, draft, ["MUDr. A", "MUDr. B"]);
    expect(html).toContain('<p class="report-meta">Datum MDT: Čt 22. 10. 2026 · 14:00-14:10 · ID NO-010 · Koncept</p>');
    expect(html).toContain(`<p>Poláček Daniel · RČ: ${RC} · věk: 45 · ID NO-010</p>`);
    expect(html).toContain("<h4>Přítomní</h4><p>MUDr. A, MUDr. B</p>");
    // Default ticks: the summary and imaging, histology, past treatment; not the anamnesis, findings or current state.
    expect(html).toContain("<h4>NO</h4>");
    for (const h of ["Zobrazovací vyšetření", "Histologie", "Prodělaná léčba"]) expect(html).toContain(`<h4>${h}</h4>`);
    for (const h of ["Anamnéza", "Klinický nález", "Aktuální stav"]) expect(html).not.toContain(`<h4>${h}</h4>`);
    expect(html).toContain('<p id="rep-concl">Zatím nezapsán.</p>');
    expect(html).toContain("<h4>Další kroky</h4><p>Žádné.</p>");
    // Every source marker has its number in the list.
    expect(html).toMatch(/<span class="src"> \[1\]<\/span>/);
    expect(html).toContain('<h4>Zdroje</h4><ol class="src">');
    expect(html).toMatch(/^<article class="sheet">/);
    expect(html).toContain('<img src="data:image/png;base64,');
  });

  it("prints every anamnesis section when ticked, an empty one with the full gap wording", () => {
    setup();
    expect(reportHtmlFor(t, file, draft, [])).not.toContain("Alergologická anamnéza");
    useReportStore().setPicked("anamnesis", true);
    const html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain('<li><span style="text-decoration:underline">Alergologická anamnéza:</span> neuvedeno v dostupné dokumentaci</li>');
    expect(html).toContain("<h4>Anamnéza</h4><ul>");
    expect(html).toContain("<br><b>Pozor:</b> ");
    // Unticking a section drops it.
    useReportStore().setPicked("imaging", false);
    expect(reportHtmlFor(t, file, draft, [])).not.toContain("<h4>Zobrazovací vyšetření</h4>");
  });

  it("prints an approved record without the draft mark, with its conclusion and steps", () => {
    setup();
    const html = reportHtmlFor(t, file, approved, []);
    expect(html).not.toContain("Koncept");
    expect(html).toContain('<p id="rep-concl">Stereotaktická radioterapie ložiska v mozečku.</p>');
    expect(html).toContain("<li>Objednat SRS · Bc. Marková · do 30. 10. 2026</li>");
    expect(html).toContain("<h4>Přítomní</h4><p>nezadáno</p>");
  });

  it("marks a doctor's edit and escapes every value", () => {
    setup({ wf: { edits: { brief: { text: "Upravený <b>souhrn</b>", by: "MUDr. X", when: "2026-10-18T10:00:00Z" } } as never } });
    const html = reportHtmlFor(t, file, { ...draft, concl: "a < b & \"c\"" }, ["<script>"]);
    expect(html).toContain("<h4>NO</h4><p>Upravený &lt;b&gt;souhrn&lt;/b&gt; [upraveno lékařem]</p>");
    expect(html).toContain("a &lt; b &amp; &quot;c&quot;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("says when the case is not processed or failed to load, never that nothing is missing", () => {
    setup({ extraction: null });
    let html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain("<h4>Podklady</h4><p>Dokumentace případu není zpracovaná; anamnéza a nálezy se do reportu netisknou. Chybějící podklady nezkontrolovány.</p>");
    expect(html).toContain("<h4>NO</h4><p>neuvedeno v dostupné dokumentaci</p>");
    Object.assign(useCasesStore().caseOf(file), { state: "error", data: null });
    html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain("Podklady případu se nepodařilo načíst ze serveru");
  });

  it("prints the deviations heading only with the guideline layer on and statements loaded", () => {
    setup({ guide: { statements: [{ id: "s1", quote: "Q" }], guidelines: [] } });
    const html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain("<h4>Odchylky od doporučení</h4><p>Žádné dřívější posouzení není zaznamenáno.</p>");
    usePatientViewStore().guideOn = false;
    expect(reportHtmlFor(t, file, draft, [])).not.toContain("Odchylky od doporučení");
  });

  it("leaves the identity out of the stored snapshot, which passes the server's rules; fillIdent puts it back", () => {
    const { p } = setup();
    useReportStore().setPicked("anamnesis", true);
    for (const k of ["clinical_finding", "current_state"]) useReportStore().setPicked(k, true);
    const snap = reportHtmlFor(t, file, approved, ["MUDr. A"], { withIdentity: false });
    expect(snap).toContain('<h4>Pacient</h4><p class="pt-ident"></p>');
    expect(snap).not.toContain(RC);
    expect(snap).not.toContain("Poláček");
    expect(() => validateReportHtml(snap, ident)).not.toThrow();
    // The full report carries the identity, which the server refuses to store.
    expect(() => validateReportHtml(reportHtmlFor(t, file, approved, []), ident)).toThrow();
    const filled = fillIdent(snap, p, t);
    expect(filled).toContain(`<p class="pt-ident">Poláček Daniel · RČ: ${RC} · věk: 45 · ID NO-010</p>`);
  });

  it("prints the certainty tags and numbers sources in the old order: anamnesis, brief, findings", () => {
    const extra = structuredClone(seed.extra);
    extra.anamnesis_v3.RA = [{ term_cs: "Term", comment_cs: "pozn.", certainty: "conflicting", note_cs: "jiný rok", refs: [] }];
    extra.anamnesis_v3.PA = [{ term_cs: "Plán", change_status: "planned_unconfirmed", ocr_note_cs: "čteno", ocr_check: { mark: false } }];
    extra.anamnesis_v3.SA = [{ term_cs: "Neguje", negated: true, certainty: "inferred" }];
    setup({ extraction: { case: seed.case, extra } });
    useReportStore().setPicked("anamnesis", true);
    const html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain("<b>Term</b>, pozn. [rozpor mezi dokumenty: jiný rok]</li>");
    // An OCR doubt both readings cleared prints no "verify" tag.
    expect(html).toContain("<b>Plán</b> [plánováno, neověřeno]</li>");
    expect(html).toContain("<b>Neguje</b> [zápor v dokumentu] [pozorování asistenta]</li>");
    // The anamnesis is numbered first, although the brief prints above it.
    expect(html.indexOf('<span class="src"> [1]</span>')).toBeGreaterThan(html.indexOf("<h4>Anamnéza</h4>"));
    expect(html.indexOf("<h4>NO</h4>")).toBeLessThan(html.indexOf("<h4>Anamnéza</h4>"));
  });

  it("prints a partial case's processed parts and its missing documents with their kind and source", () => {
    setup({
      extraction: { syn: { documents: [{ title_cs: "Zpráva", pages: [1] }], data_gaps: [{ kind: "missing", text_cs: "Chybí histologie", source: { file: "a.pdf", page: 2 } }, { kind: "unclear", text_cs: "Nejasné datum" }] } },
    });
    const html = reportHtmlFor(t, file, draft, []);
    expect(html).toContain(
      "<h4>Podklady</h4><p>Syntetický pacient: zpracované jsou dokumenty, chybějící podklady; anamnéza a nálezy se do reportu netisknou.</p><h4>Chybějící a nejasné podklady</h4><ul><li>Chybí histologie (a.pdf, s. 2)</li><li>Nejasné: Nejasné datum</li></ul>",
    );
    // No finding groups to tick without a record, and no source list.
    expect(html).not.toContain("<h4>Zdroje</h4>");
  });
});

// The dialog loads the PDF library on open; in the test DOM the scripts fail quietly instead of logging.
function stubScripts() {
  const add = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation(((n: Node) => {
    if (n instanceof HTMLScriptElement) {
      queueMicrotask(() => n.onerror?.(new Event("error")));
      return n;
    }
    return add(n);
  }) as never);
}

describe("ReportDialog", () => {
  const dialog = (s: PatientSetup = {}) => {
    stubScripts();
    const st = setup(s);
    return { st, w: mountInCase(ReportDialog, st, { o: { kind: "report", file } }) };
  };

  it("shows the ticks per case data, re-renders the draft on a tick and says it downloads a draft", async () => {
    const { w } = dialog();
    expect(w.find("h2").text()).toBe("Záznam z MDT · NO-010");
    const boxes = w.findAll('input[type="checkbox"]');
    expect(boxes.map((b) => b.attributes("data-pickrep"))).toEqual(["summary", "anamnesis", "clinical_finding", "imaging", "histology", "past_treatment", "current_state"]);
    expect(boxes.map((b) => (b.element as HTMLInputElement).checked)).toEqual([true, false, false, true, true, true, false]);
    expect(w.text()).toContain("Závěr zatím není schválený; report se stáhne jako koncept.");
    expect(w.find("#report").html()).not.toContain("Alergologická anamnéza");
    await boxes[1]!.setValue(true);
    expect(w.find("#report").html()).toContain("Alergologická anamnéza:</span> neuvedeno v dostupné dokumentaci");
    expect(w.find('[role="dialog"]').attributes("aria-modal")).toBe("true");
    expect(w.find('[role="dialog"]').attributes("aria-label")).toBe("Záznam z MDT");
    expect(w.find("#report-error").attributes("hidden")).toBeDefined();
  });

  it("uses the attendance of the case's day for the draft", () => {
    stubScripts();
    const st = setup();
    useAttendanceStore().setRow("2026-10-22", "onko", 0, "MUDr. Přítomná");
    const w = mountInCase(ReportDialog, st, { o: { kind: "report", file } });
    expect(w.find("#report").html()).toContain("MUDr. Přítomná");
  });

  it("after approval shows the frozen snapshot with identity, and the ticks chosen then, disabled", () => {
    const snap = '<article class="sheet"><h4>Pacient</h4><p class="pt-ident"></p><p>Zmrazený text</p></article>';
    const { w } = dialog({
      wf: {
        protocol: { state: "approved", concl: "Pozdější text", steps: [], version: 3, approved_at: "2026-10-18T10:00:00Z", approver: "MUDr. Svobodová" },
        decisions: [{ id: "d1", version: 1, text: "Závěr", by: "MUDr. Svobodová", when: "2026-10-18T10:00:00Z", attSnap: [], pickSnap: ["summary", "histology"], reportSnap: snap }],
      } as never,
    });
    const boxes = w.findAll('input[type="checkbox"]');
    expect(boxes.every((b) => (b.element as HTMLInputElement).disabled)).toBe(true);
    expect(boxes.filter((b) => (b.element as HTMLInputElement).checked).map((b) => b.attributes("data-pickrep"))).toEqual(["summary", "histology"]);
    const rep = w.find("#report").html();
    expect(rep).toContain("Zmrazený text");
    expect(rep).not.toContain("Pozdější text");
    expect(rep).toContain(`Poláček Daniel · RČ: ${RC}`);
    expect(w.text()).toMatch(/^.*Report je uzamčen ve stavu při schválení \(.+\)\. Pozdější úpravy se do něj nepromítnou; změna vyžaduje nový závěr\./s);
  });

  it("shows the error and a toast when the PDF library is not there", async () => {
    // No library on window and the scripts cannot load in the test DOM: the export says it is unavailable.
    const { w, st } = dialog();
    await w.find('[data-act="download"]').trigger("click");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
    expect(w.find("#report-error").text()).toBe("PDF se nepodařilo vytvořit: PDF export není dostupný. Obnovte stránku a zkuste to znovu.");
    expect(w.find("#report-error").attributes("hidden")).toBeUndefined();
    expect(lastToast()).toBe("discussion-report-failed");
    expect(w.find('[data-act="download"]').text()).toBe("Stáhnout PDF");
    // Nothing was downloaded, so nothing is logged.
    expect(st.calls.some((c) => c.url.includes("/audit/events"))).toBe(false);
  });
});

describe("ReportDialog download", () => {
  // A stand-in for jsPDF with the calls the layout makes; the real library is checked by the e2e download.
  class FakePdf {
    texts: string[] = [];
    addFileToVFS() {}
    addFont() {}
    setProperties() {}
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    addPage() {}
    text(s: string) {
      this.texts.push(s);
    }
    splitTextToSize(s: string) {
      return [s];
    }
    getTextWidth(s: string) {
      return s.length;
    }
    setDrawColor() {}
    setLineWidth() {}
    line() {}
    addImage() {}
    getNumberOfPages() {
      return 1;
    }
    setPage() {}
    output() {
      return new ArrayBuffer(4);
    }
  }
  afterEach(() => {
    delete (window as { jspdf?: unknown }).jspdf;
    delete (window as { MDT_PDF_FONTS?: unknown }).MDT_PDF_FONTS;
  });

  it("names the draft PDF, logs the download as an audit event and says it is ready", async () => {
    Object.assign(window, { jspdf: { jsPDF: FakePdf }, MDT_PDF_FONTS: { normal: "x", bold: "y" } });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const st = setup();
    const w = mountInCase(ReportDialog, st, { o: { kind: "report", file } });
    const btn = w.find('[data-act="download"]');
    await btn.trigger("click");
    expect(btn.text()).toBe("Připravuji PDF…");
    expect(btn.attributes("disabled")).toBeDefined();
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
    expect(names).toEqual(["GLIDE-MDT-NO-010-2026-10-22-koncept.pdf"]);
    expect(lastToast()).toBe("discussion-report-ready");
    expect(btn.text()).toBe("Stáhnout PDF");
    const audit = st.calls.find((c) => c.url.includes("/audit/events"));
    expect(JSON.parse(String(audit?.init.body))).toEqual({ code: "report_downloaded", case_id: "NO-010" });
  });

  it("re-renders the draft preview when the conclusion or the steps change", async () => {
    stubScripts();
    const st = setup();
    const w = mountInCase(ReportDialog, st, { o: { kind: "report", file } });
    const pr = useDiscussionStore().protoOf(file);
    pr.concl = "Nový závěr";
    pr.steps.push({ text: "Krok", who: "Bc. Marková", due: "2026-10-30" });
    await flushPromises();
    const rep = w.find("#report").html();
    expect(rep).toContain('<p id="rep-concl">Nový závěr</p>');
    expect(rep).toContain("<li>Krok · Bc. Marková · do 30. 10. 2026</li>");
  });
});

describe("report PDF", () => {
  it("throws the Czech error when the library is absent", () => {
    expect(() => reportPdf(t, "<article></article>", { id: "NO-010" })).toThrow("PDF export není dostupný. Obnovte stránku a zkuste to znovu.");
  });

  it("names the file by case, slot day and draft state", () => {
    expect(reportFileName("NO-010", "2026-10-22", true)).toBe("GLIDE-MDT-NO-010-2026-10-22-koncept.pdf");
    expect(reportFileName("NO-010", "2026-10-22", false)).toBe("GLIDE-MDT-NO-010-2026-10-22.pdf");
    expect(reportFileName("NO-S01", null, true)).toBe("GLIDE-MDT-NO-S01-bez-data-koncept.pdf");
  });
});
