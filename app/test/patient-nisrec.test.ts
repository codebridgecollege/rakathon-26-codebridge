// "Záznam z NIS" (issue #22): a source that is a NIS record opens its own panel instead of a page, shows which record
// the fact was taken from, the record's fields as the NIS gives them now, says when the NIS holds a newer version, and
// keeps the whole record one click away.
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import NisRecordPanel from "../app/components/patient/NisRecordPanel.vue";
import SrcLinks from "../app/components/patient/SrcLinks.vue";
import { useOverlayStore } from "../app/stores/overlay";
import { usePatient, type PatientCtx } from "../app/composables/usePatient";
import { mountInCase, setupPatient } from "./patient";
import { nisRecordFields } from "@codebridge/domain/nis-record";
import { loadLocale, makeBundle } from "../app/lib/i18n";

const ref = { system: "https://nis.test/fhir", resource: "Observation/o1", version: "1", last_updated: "2026-10-19T08:00:00Z" };
const record = (version: string) => ({
  label_cs: "Testovací NIS",
  resource: "Observation/o1",
  version,
  last_updated: "2026-10-20T08:00:00Z",
  fields: [
    { field: "name", value: "Kreatinin" },
    { field: "value", value: "142 µmol/l" },
  ],
  record: { resourceType: "Observation", id: "o1" },
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NIS record source", () => {
  it("opens the NIS panel, not a page, from a source link labelled as a NIS record", async () => {
    const s = setupPatient();
    const w = mountInCase(SrcLinks, s, { refs: [{ page: "NIS", quote: ref.resource, nis: ref }] });
    expect(w.get("button").text()).toBe("záznam z NIS");
    let ctx!: PatientCtx;
    mountInCase(defineComponent({ setup: () => ((ctx = usePatient()), () => h("div")) }), s);
    ctx.openSource({ page: "NIS", quote: ref.resource, nis: ref });
    expect(useOverlayStore().current).toEqual({ kind: "nisrecord", caseId: "NO-010", ref });
    expect(s.calls.some((c) => c.url.includes("/pages/"))).toBe(false);
  });

  it("shows the cited record and its fields, and says so when the NIS holds a newer version", async () => {
    const s = setupPatient({ routes: { "/cases/NO-010/nis/record": record("2") } });
    const w = mountInCase(NisRecordPanel, s, { o: { kind: "nisrecord", caseId: "NO-010", ref } });
    await flushPromises();
    expect(s.calls[0]!.url).toContain("resource=Observation%2Fo1");
    expect(w.text()).toContain("Údaj převzat ze záznamu Observation/o1, verze 1");
    expect(w.text()).toContain("Kreatinin");
    expect(w.text()).toContain("142 µmol/l");
    expect(w.findAll("th").map((x) => x.text())).toEqual(["Název", "Hodnota"]);
    expect(w.text()).toContain("V NIS je nyní verze 2; údaj byl převzat z verze 1.");
    expect(w.find("pre").exists()).toBe(false);
    await w.findAll("button").find((b) => b.text() === "Zobrazit celý záznam")!.trigger("click");
    expect(JSON.parse(w.get("pre").text())).toEqual({ resourceType: "Observation", id: "o1" });
  });

  it("says nothing about versions when they agree, and shows the server's refusal as worded", async () => {
    let s = setupPatient({ routes: { "/cases/NO-010/nis/record": record("1") } });
    let w = mountInCase(NisRecordPanel, s, { o: { kind: "nisrecord", caseId: "NO-010", ref } });
    await flushPromises();
    expect(w.text()).not.toContain("V NIS je nyní verze");
    document.body.innerHTML = "";
    s = setupPatient({ routes: { "/cases/NO-010/nis/record": [404, { error: { code: "nis_record_not_found", message_cs: "Tento záznam v NIS nebyl nalezen nebo nepatří k propojenému pacientovi." } }] } });
    w = mountInCase(NisRecordPanel, s, { o: { kind: "nisrecord", caseId: "NO-010", ref } });
    await flushPromises();
    expect(w.text()).toContain("nepatří k propojenému pacientovi");
  });

  it("has a label in every language for every field the panel can show", async () => {
    const all = nisRecordFields({
      resourceType: "MedicationStatement", status: "x", verificationStatus: { text: "x" }, clinicalStatus: { text: "x" }, category: [{ text: "x" }],
      class: { code: "x" }, code: { text: "x", coding: [{ code: "x" }] }, valueString: "x", interpretation: [{ text: "x" }], referenceRange: [{ text: "x" }],
      effectiveDateTime: "x", onsetString: "x", abatementString: "x", dosage: [{ text: "x" }], reasonCode: [{ text: "x" }],
      serviceProvider: { display: "x" }, conclusion: "x", note: [{ text: "x" }], issued: "x",
    }).map((f) => f.field);
    expect(all).toHaveLength(19);
    for (const lang of ["cs", "sk", "en"] as const) {
      await loadLocale(lang);
      const b = makeBundle(lang);
      for (const f of all) expect(b.getMessage(`patient-nisrec-field-${f}`), `${lang} ${f}`).toBeTruthy();
    }
  });
});
