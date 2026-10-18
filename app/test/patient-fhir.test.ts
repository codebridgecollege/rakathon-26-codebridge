// The FHIR R4 export as the doctor sees it: the dialog's text, download and copy, the audit event, and the Bundle's
// Czech labels from the real catalog. Case NO-010's synthetic seed extraction.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { usePatient, type PatientCtx } from "../app/composables/usePatient";
import { openFhirExport } from "../app/lib/fhirExport";
import { useOverlayStore } from "../app/stores/overlay";
import FhirDialog from "../app/components/patient/FhirDialog.vue";
import { makeBundle } from "../app/lib/i18n";
import { fmtWhen } from "../app/lib/dates";
import { lastToast, mountInCase, setupPatient, type PatientSetup } from "./patient";

// Vitest runs from app/; the jsdom environment gives no file URL to resolve against.
const read = (p: string) => readFileSync(resolve(process.cwd(), "..", p), "utf8");
// The committed fixtures the seed builds case NO-010's extraction from (api/seed/out is gitignored, so a clean
// checkout or CI has no seed output to read).
const seed = { case: JSON.parse(read("fixtures/data/mock-case-10.json")), extra: JSON.parse(read("fixtures/data/mock-case-10-extra.json")) };
const mq = seed.case.mdt_question;
const cs = makeBundle("cs");
const t = (id: string, args?: Record<string, string | number>) => cs.formatPattern(cs.getMessage(id)!.value!, args);

// Opens the export for the set-up case and returns the dialog mounted from the overlay it opened.
function exportCase(s: PatientSetup = {}) {
  const setup = setupPatient({
    p: { name: "Daniel Poláček", draft: mq.question_draft_cs, qkind: mq.question_kind, basis: mq.question_basis, ...s.p },
    extraction: { case: seed.case, extra: seed.extra },
    routes: { "/audit/events": { ok: true } },
    ...s,
  });
  let ctx!: PatientCtx;
  mountInCase(defineComponent({ setup: () => ((ctx = usePatient()), () => h("div")) }), setup);
  openFhirExport(ctx, t);
  const o = useOverlayStore().current as { kind: "fhir"; id: string; bundle: any };
  return { setup, o, w: mountInCase(FhirDialog, setup, { o }) };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Export FHIR dialog", () => {
  it("reads as the old dialog: title, counts, identity warning, buttons and the JSON", () => {
    const { o, w } = exportCase();
    expect(o).toMatchObject({ kind: "fhir", id: "NO-010" });
    expect(w.get(".modal").attributes()).toMatchObject({ role: "dialog", "aria-label": "Export FHIR" });
    expect(w.get("h2").text()).toBe("Export FHIR R4 · NO-010");
    const n = o.bundle.entry.length;
    // The old page counted with a plain object, so types are listed in order of first appearance.
    const counts: Record<string, number> = {};
    for (const e of o.bundle.entry) counts[e.resource.resourceType] = (counts[e.resource.resourceType] || 0) + 1;
    const list = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ");
    expect(list).toMatch(/^Composition 1, Device 1, Patient 1, DocumentReference 1, /);
    expect(w.get("p.muted").text()).toBe(
      `Případ jako balík FHIR R4 (Bundle, ${n} záznamů): ${list}. Každý údaj má záznam Provenance s dokumentem, stranou a citací. Vše je návrh asistenta, neověřený lékařem. Uložená kopie prošla oficiálním validátorem HL7 bez chyb (fhir/README.md).`,
    );
    expect(w.get("p.synth").text()).toBe("Export obsahuje identifikaci pacienta. V pilotu by šel přes FHIR rozhraní nemocnice, ne jako soubor.");
    expect(w.findAll("button").map((b) => b.text())).toEqual(["Zavřít", "Stáhnout JSON", "Kopírovat"]);
    expect(JSON.parse(w.get("pre").text()).resourceType).toBe("Bundle");
  });

  it("counts entries with the Czech plural", () => {
    expect(t("patient-fhir-dialog-counts", { n: 1, counts: "x" })).toMatch(/^Případ jako balík FHIR R4 \(Bundle, 1 záznam\): x\./);
    expect(t("patient-fhir-dialog-counts", { n: 3, counts: "x" })).toMatch(/\(Bundle, 3 záznamy\)/);
    expect(t("patient-fhir-dialog-counts", { n: 245, counts: "x" })).toMatch(/\(Bundle, 245 záznamů\)/);
  });

  it("logs the export with its fixed audit code and the case ID only", async () => {
    const { setup } = exportCase();
    await flushPromises();
    const call = setup.calls.find((c) => c.url.endsWith("/audit/events"))!;
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ code: "fhir_exported", case_id: "NO-010" });
  });

  it("downloads the JSON as application/fhir+json named after the case", async () => {
    const { w } = exportCase();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    URL.revokeObjectURL = vi.fn();
    let name = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    await w.findAll("button")[1]!.trigger("click");
    expect(name).toBe("NO-010-fhir-r4.json");
    expect(blobs[0]!.type).toBe("application/fhir+json");
    expect(await blobs[0]!.text()).toBe(w.get("pre").text());
  });

  it("copies the JSON and says so; a refused copy asks to select the text by hand", async () => {
    const { w } = exportCase();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("no"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await w.findAll("button")[2]!.trigger("click");
    await flushPromises();
    expect(writeText.mock.calls[0]![0]).toBe(w.get("pre").text());
    expect(lastToast()).toBe("Zkopírováno do schránky");
    await w.findAll("button")[2]!.trigger("click");
    await flushPromises();
    expect(lastToast()).toBe("Kopírování se nepodařilo; označte text ručně");
  });

  it("closes on the scrim and on Zavřít", async () => {
    const { w } = exportCase();
    await w.get(".scrim").trigger("click");
    expect(useOverlayStore().current).toBeNull();
    const again = exportCase().w;
    await again.findAll("button")[0]!.trigger("click");
    expect(useOverlayStore().current).toBeNull();
  });
});

describe("the Bundle's Czech labels", () => {
  const sections = (b: any) => b.entry[0].resource.section;

  it("titles the Composition's sections and marks it as the assistant's unverified draft", () => {
    const { o } = exportCase();
    const comp = o.bundle.entry[0].resource;
    expect(comp.status).toBe("preliminary");
    expect(comp.title).toBe("Podklady pro MDT, NO-010 (návrh asistenta, neověřeno lékařem)");
    expect(sections(o.bundle).map((s: any) => s.title).slice(0, 4)).toEqual(["Otázka pro MDT", "Shrnutí", "Průběh onemocnění", "Diagnóza a přidružená onemocnění"]);
    const device = o.bundle.entry.find((e: any) => e.resource.resourceType === "Device").resource;
    expect(device.deviceName[0].name).toBe("CodeBridge MDT asistent (maketa)");
  });

  it("exports the drafted question as a draft with the passage it rests on", () => {
    const { o } = exportCase();
    const div = sections(o.bundle)[0].text.div;
    expect(div).toContain(`${mq.question_draft_cs} [otázka podle účelu v dokumentu, návrh asistenta, neověřeno lékařem] Účel v dokumentu: „${mq.question_basis[0].quote}“ (10_pacient.pdf, s. 3).`);
    const prov = o.bundle.entry.find((e: any) => e.resource.activity?.text === "Návrh otázky pro MDT asistentem z citovaných pasáží; neověřeno lékařem");
    expect(prov).toBeTruthy();
  });

  it("names who confirmed the draft and when, the server's ISO time in local format", () => {
    const when = "2026-10-18T08:00:00.000Z";
    const { o } = exportCase({ wf: { qConfirm: { text: mq.question_draft_cs, by: "MUDr. Svobodová", when } } });
    expect(fmtWhen(when)).not.toBe(when);
    expect(sections(o.bundle)[0].text.div).toContain(`[návrh asistenta, potvrdil(a) MUDr. Svobodová, ${fmtWhen(when)}]`);
  });

  it("exports a doctor's question with its tag", () => {
    const { o } = exportCase({ wf: { edits: { q: { id: 1, text: "Indikace k radiochirurgii?", by: "MUDr. Novák", when: "not-a-date" } } } });
    expect(sections(o.bundle)[0].text.div).toBe('<div xmlns="http://www.w3.org/1999/xhtml">Indikace k radiochirurgii? [doplněno lékařem]</div>');
  });

  it("says an out-of-range lab value was evaluated by the assistant", () => {
    const { o } = exportCase();
    const hs = o.bundle.entry.find((e: any) => e.resource.code?.text === "hsCRP").resource;
    expect(hs.interpretation[0].text).toBe("Nad rozmezím (vyhodnotil asistent podle uvedeného rozmezí)");
    expect(hs.note[0].text).toBe("V dokumentu: 9,5 mg/l");
  });
});

describe("catalog use", () => {
  const ftl = read("i18n/cs/patient.ftl");

  it("passes only literal patient-fhir- IDs, and every one is in the catalog", () => {
    const builder = read("packages/domain/src/fhir-export.ts");
    const calls = [...builder.matchAll(/\bt\(([^,)]+)/g)].map((m) => m[1]!.trim());
    expect(calls.length).toBeGreaterThan(20);
    for (const c of calls) expect(c).toMatch(/^"patient-fhir-[a-z0-9-]+"$/);
    const ids = [...(builder + read("app/app/components/patient/FhirDialog.vue")).matchAll(/["'](patient-fhir-[a-z0-9-]+)["']/g)].map((m) => m[1]!);
    for (const id of new Set(ids)) expect(ftl, id).toMatch(new RegExp(`^${id} =`, "m"));
  });
});
