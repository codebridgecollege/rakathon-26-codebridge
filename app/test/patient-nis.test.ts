// "Import z NIS" (issue #22) as the user sees it: the header button exists only where the org has a NIS and for the
// roles that may search it; the dialog searches by the patient's own birth number (or a typed one, which travels in the
// body only), lists every candidate with why it can or cannot be linked, asks for confirmation when identity cannot be
// checked, and shows the national register as a labelled stub.
import { afterEach, describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";
import PatientHeader from "../app/components/patient/PatientHeader.vue";
import NisDialog from "../app/components/patient/NisDialog.vue";
import { useSessionStore } from "../app/stores/session";
import { useOverlayStore } from "../app/stores/overlay";
import { mountInCase, setupPatient } from "./patient";

const STUB = { status: "stub", message_cs: "Zde ověříme pacienta v národním registru obyvatel (IHE PDQm). V prototypu není napojeno, nic se neověřuje." };
const cand = (id: string, extra: Record<string, unknown> = {}) => ({
  nis_id: id, version: "1", last_updated: null, name: "Jiří Zkušební", birth_date: "1972-09-05", gender: "male", active: true,
  birth_number_matches: true, replaced_by: null, links: [], identity: "cannot_verify", name_match: "cannot_verify", needs_confirmation: true, linkable: true, reason_cs: null, ...extra,
});
const reply = (data: unknown) => ({ data, data_epoch: 1, state: {} });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Import z NIS button", () => {
  it("is hidden without a NIS and for the administrator", () => {
    let s = setupPatient();
    expect(mountInCase(PatientHeader, s).text()).not.toContain("Import z NIS");
    s = setupPatient({ role: "admin" });
    useSessionStore().me!.nis = { label_cs: "Testovací NIS" };
    expect(mountInCase(PatientHeader, s).text()).not.toContain("Import z NIS");
  });

  it("opens the dialog for the case when the org has a NIS", async () => {
    const s = setupPatient({ role: "coordinator" });
    useSessionStore().me!.nis = { label_cs: "Testovací NIS" };
    const w = mountInCase(PatientHeader, s);
    const b = w.findAll("button").find((x) => x.text() === "Import z NIS")!;
    await b.trigger("click");
    expect(useOverlayStore().current).toEqual({ kind: "nis", caseId: "NO-010" });
  });
});

describe("Import z NIS dialog", () => {
  it("searches by a typed birth number in the body, flags duplicates and a merged record, and links only after confirmation", async () => {
    const s = setupPatient({
      routes: {
        "/cases/NO-010/nis": { label_cs: "Testovací NIS", has_birth_number: false, link: null, national_register: STUB },
        "/cases/NO-010/nis/search": reply({
          label_cs: "Testovací NIS",
          duplicates: true,
          truncated: false,
          other_records_hidden: 2,
          link: null,
          national_register: STUB,
          candidates: [
            cand("cb-f01-a"),
            cand("cb-f01-b", { active: false, replaced_by: "cb-f01-a", linkable: false, reason_cs: "Záznam byl v NIS sloučen do záznamu cb-f01-a." }),
            cand("cb-f01-c", { name: "Jiri Zkusebni" }),
          ],
        }),
        "/cases/NO-010/nis/link": reply({ link: { nis_patient_id: "cb-f01-a", nis_version: "1", identity_check: "cannot_verify", by_name: "MUDr. Svobodová", at: "2026-10-19T08:00:00Z" } }),
      },
    });
    const w = mountInCase(NisDialog, s, { o: { kind: "nis", caseId: "NO-010" } });
    await flushPromises();
    expect(w.text()).toContain("Zdroj: Testovací NIS (FHIR R4, jen čtení)");
    expect(w.text()).toContain("Národní registr (ukázka):");
    expect(w.text()).toContain("Import převezme údaje a dokumenty z propojeného záznamu NIS do případu.");
    expect(w.text()).toContain("V prototypu není napojeno");
    await w.get("input").setValue("720905/3005");
    await w.findAll("button").find((x) => x.text() === "Vyhledat v NIS")!.trigger("click");
    await flushPromises();
    const search = s.calls.find((c) => c.url.endsWith("/nis/search"))!;
    expect(search.url).not.toContain("720905");
    expect(JSON.parse(String(search.init.body))).toEqual({ birth_number: "720905/3005" });
    expect(w.text()).toContain("V NIS je pro toto rodné číslo více záznamů");
    expect(w.text()).toContain("NIS vrátil 2 záznamy bez hledaného rodného čísla; nezobrazují se.");
    expect(w.text()).toContain("Záznam byl v NIS sloučen do záznamu cb-f01-a.");
    const links = w.findAll("button").filter((x) => x.text() === "Propojit");
    // The merged record has no button; the two others wait for the confirmation.
    expect(links).toHaveLength(2);
    expect(links[0]!.attributes("disabled")).toBeDefined();
    await w.findAll("input[type=checkbox]")[0]!.setValue(true);
    await w.findAll("button").filter((x) => x.text() === "Propojit")[0]!.trigger("click");
    await flushPromises();
    const link = s.calls.find((c) => c.url.endsWith("/nis/link"))!;
    expect(JSON.parse(String(link.init.body))).toEqual({ nis_patient_id: "cb-f01-a", birth_number: "720905/3005", confirm_unverified: true });
    expect(w.text()).toContain("Propojeno se záznamem NIS cb-f01-a");
    expect(w.text()).toContain("Rodné číslo nebylo možné ověřit, propojení potvrdil uživatel.");
  });

  it("asks before unlinking, which removes the NIS documents, and says how many went", async () => {
    const linked = { nis_patient_id: "cb-f01-a", nis_version: "1", identity_check: "matches", by_name: "MUDr. Svobodová", at: "2026-10-19T08:00:00Z" };
    const s = setupPatient({
      routes: {
        "/cases/NO-010/nis": { label_cs: "Testovací NIS", has_birth_number: true, link: linked, national_register: STUB },
        "/cases/NO-010/nis/link": reply({ link: null, documents: { withdrawn: 2, withdraw_pending: 1, not_allowed: 0 } }),
      },
    });
    const w = mountInCase(NisDialog, s, { o: { kind: "nis", caseId: "NO-010" } });
    await flushPromises();
    await w.findAll("button").find((x) => x.text() === "Zrušit propojení")!.trigger("click");
    // The first click only warns.
    expect(s.calls.some((c) => c.url.endsWith("/nis/link"))).toBe(false);
    expect(w.text()).toContain("dokumenty převzaté z NIS (jejich obsah se smaže)");
    await w.findAll("button").find((x) => x.text() === "Zrušit propojení a odebrat dokumenty z NIS")!.trigger("click");
    await flushPromises();
    expect(s.calls.find((c) => c.url.endsWith("/nis/link"))!.init.method).toBe("DELETE");
    expect(w.text()).toContain("Propojení zrušeno. Odebráno dokumentů z NIS: 2. Zatím nelze odebrat: 1 (dokument se zpracovává nebo je případ uzamčen).");
    expect(w.text()).not.toContain("mimo váš tým");
  });

  it("shows the server's refusal as worded", async () => {
    const s = setupPatient({
      routes: {
        "/cases/NO-010/nis": { label_cs: "Testovací NIS", has_birth_number: true, link: null, national_register: STUB },
        "/cases/NO-010/nis/search": [503, { error: { code: "upstream_busy", message_cs: "Služba je přetížená, zkuste to znovu za chvíli." } }],
      },
    });
    const w = mountInCase(NisDialog, s, { o: { kind: "nis", caseId: "NO-010" } });
    await flushPromises();
    expect(w.find("input").exists()).toBe(false);
    await w.findAll("button").find((x) => x.text() === "Vyhledat v NIS podle rodného čísla pacienta")!.trigger("click");
    await flushPromises();
    expect(JSON.parse(String(s.calls.find((c) => c.url.endsWith("/nis/search"))!.init.body))).toEqual({});
    expect(w.text()).toContain("Služba je přetížená");
  });
});
