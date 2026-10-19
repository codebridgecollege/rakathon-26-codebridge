// The guideline layer, its drawer and the deviation tabs (F-27), against a synthetic guidance reply.
import { afterEach, describe, expect, it } from "vitest";
import TabNext from "../app/components/patient/TabNext.vue";
import TabDev from "../app/components/patient/TabDev.vue";
import GuideDrawer from "../app/components/patient/GuideDrawer.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { usePatientViewStore } from "../app/stores/patientView";
import { mountInCase, setupPatient } from "./patient";
import { docsOf, runOf } from "./helpers";

// Case 10's run; the guidance names its facts by ID: the suspected brain metastasis (f-a0522e68, one passage on
// page 1) and the nephrectomy's histology (f-645cb30b). "f-00000000" is a fact the current run does not hold.
const extraction = runOf("NO-010");
const documents = docsOf("NO-010");
const guide = {
  guidelines: [
    { id: "eu", name: "EU Guideline", society: "ESMO", year: 2021, region: "EU", version: "v1", pdf_url: "https://example.org/g.pdf" },
    { id: "cz", name: "Modrá kniha", society: "ČOS", year: 2026, region: "CZ", field: "cardiology" },
  ],
  statements: [
    { id: "weak", guideline_id: "eu", quote: "Observation may be considered.", evidence: "ESMO: III, C", pdf_page: 7, printed_page: 1338, section: "Radiotherapy", applies_because_cs: "Jedno ložisko.", patient_facts: [{ text: "MR mozku: ložisko", fact_ids: ["f-a0522e68"] }] },
    { id: "strong", guideline_id: "eu", quote: "SRS is recommended for 1-4 BMs.", evidence: "EANO: I, A; ESMO: I, B", pdf_page: 7, section: "Radiotherapy", applies_because_cs: "Počet 1.", patient_facts: [{ text: "bez zdroje", fact_ids: [] }, { text: "starší údaj", fact_ids: ["f-00000000"] }] },
    { id: "cardio", guideline_id: "cz", quote: "Léčba hypertenze.", evidence: "ČOS 2A", section: "Hypertenze" },
  ],
  past_statements: [
    { id: "past-nephrectomy", guideline_id: "cz", decision_cs: "Nefrektomie", decision_date: "2022-06-02", row_index: 0, status: "found", quote: "Základem je léčba chirurgická.", edition: { name: "Modrá kniha", society: "ČOS", version: "28.", year: 2022, valid_from: "2022-03-01", valid_to: "2023-02-28", pdf_url: "https://example.org/mk.pdf" }, pdf_page: 12 },
  ],
  pages: [{ guideline_id: "eu", pdf_page: 7, text: "Intro. SRS is recommended\nfor 1-4 BMs. More." }],
  literature: [],
  not_retrieved: [],
  deviation_case_file: "10_pacient.pdf",
  deviation_findings: [{ id: "f1", title_cs: "HBV nedoloženo", status_cs: "Dokumentační mezera", interpretation_cs: "Neznamená to, že nebyly provedeny.", group_cs: "Hepatologie", statement_ids: ["cardio"], past_statement_id: "past-nephrectomy", source_fact_ids: ["f-645cb30b"], clinical_consequence_cs: "Riziko." }],
};

afterEach(() => (document.body.innerHTML = ""));

describe("guideline layer", () => {
  it("sorts statements strongest first per field and says it is not an order of options", () => {
    const w = mountInCase(TabNext, setupPatient({ extraction, documents, guide }));
    expect(w.text()).toContain("Seřazeno podle síly, kterou uvádí samo doporučení, ne pořadí možností pro tohoto pacienta.");
    expect(w.findAll(".stmts-onc q").map((q) => q.text())).toEqual(["SRS is recommended for 1-4 BMs.", "Observation may be considered."]);
    expect(w.findAll(".stmts-onc .tier").map((c) => c.text())).toEqual(["síla: silné až střední", "síla: slabé"]);
    // ČOS categories are evidence and consensus, not strength.
    expect(w.get(".stmts-other .tier").text()).toBe("síla: neuvedeno");
    expect(w.text()).toContain("asistent postup nenavrhuje");
  });

  it("opens an entry to its reason, the facts with their sources, and the guideline's own grade", async () => {
    const s = setupPatient({ extraction, documents, guide, routes: { "/audit/events": { data: {}, data_epoch: 1, state: {} } } });
    const w = mountInCase(TabNext, s);
    const weak = w.findAll("li.gle").find((l) => l.text().includes("Observation"))!;
    expect(weak.text()).toContain("Proč: Jedno ložisko.");
    expect(weak.text()).toContain("s. 1338 · původní označení: ESMO: III, C");
    expect(weak.find(".glfacts button").text()).toBe("s. 1");
    const strong = w.findAll("li.gle").find((l) => l.text().includes("SRS"))!;
    expect(strong.text()).toContain("(zdroj nedohledán)");
    // A fact the guidance names that the current run does not hold is flagged, never dropped.
    expect(strong.findAll(".glfacts li")[1]!.text()).toMatch(/^starší údaj \(zdroj nedohledán\)\s*Údaj v aktuálním zpracování chybí\.$/);
    expect(weak.text()).not.toContain("Údaj v aktuálním zpracování chybí.");
    await strong.findAll("button").find((b) => b.text() === "otevřít v doporučení")!.trigger("click");
    expect(useOverlayStore().current).toEqual({ kind: "guide", id: "strong" });
    expect(JSON.parse(String(s.calls.at(-1)!.init.body))).toEqual({ code: "guide_opened", case_id: "NO-010" });
  });

  it("switches off, and says when it is loading or failed", async () => {
    const s = setupPatient({ extraction, documents, guide });
    const w = mountInCase(TabNext, s);
    await w.get('input[type="checkbox"]').setValue(false);
    expect(w.text()).toContain("Vypnuto.");
    expect(w.find("q").exists()).toBe(false);
    expect(mountInCase(TabNext, setupPatient({ extraction, documents, guide: { loading: true } })).text()).toContain("Načítám doporučení ze serveru…");
    const err = mountInCase(TabNext, setupPatient({ extraction, documents, guide: { error: { message_cs: null, message_id: "patient-guide-load-failed" } } }));
    expect(err.get('[role="alert"]').text()).toBe("Doporučení se nepodařilo načíst. Zkusit znovu");
  });

  it("marks the quote in the guideline's page text, across line breaks", () => {
    const s = setupPatient({ extraction, documents, guide });
    const w = mountInCase(GuideDrawer, s, { o: { kind: "guide", id: "strong" } });
    expect(w.get("mark").text()).toBe("SRS is recommended\nfor 1-4 BMs.");
    expect(w.get("a.btn").attributes("href")).toBe("https://example.org/g.pdf#page=7");
    expect(w.get(".synth").text()).toContain("Původní označení: EANO: I, A; ESMO: I, B");
  });
});

describe("retrospective deviations", () => {
  it("is a read-only table with eight columns, the valid edition and severity not stated", async () => {
    const w = mountInCase(TabDev, setupPatient({ extraction, documents, guide }));
    const heads = w.findAll(".findings-table th").map((t) => t.text());
    expect(heads).toEqual(["Problém / zjištění", "Oblast", "Závažnost", "Doporučení", "Rok", "Znění doporučení", "Citace z dokumentace", "Možný klinický důsledek"]);
    expect(w.text()).toContain("1 zjištění · bez povinné akce");
    expect(w.text()).toContain("platné od 1. 3. 2022 do 28. 2. 2023");
    expect(w.text()).toContain("Závažnost není klinicky posouzena.");
    expect(w.find(".findings-table td:nth-child(3) .gapq").attributes("title")).toBe("neuvedeno v dostupné dokumentaci");
    expect(w.findAll("input, select, textarea")).toHaveLength(0);
    // The documentation's passage comes from the fact the finding names.
    expect(w.get(".findings-table td:nth-child(7) q").text()).toMatch(/^2\.6\.2022 - stp\. transperitoneálni nefrektomii/);
    expect(w.get("details.deviation-context summary").text()).toBe("Další srovnání minulých rozhodnutí s doporučeními (1)");
  });

  it("shows nothing of the guideline layer while it is off", () => {
    const s = setupPatient({ extraction, documents, guide });
    usePatientViewStore().guideOn = false;
    expect(mountInCase(TabDev, s).text()).toBe("Vrstva doporučení je vypnutá.");
  });
});
