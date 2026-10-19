// The step 11 components rendered with the Czech catalog: the wording and structure, the accessibility
// they add (dialog role, aria-modal, aria-invalid tied to the message, aria-current on the step), drag and drop, and
// the QR code from the lazily loaded library. Also keeps the intake demo descriptor equal to the committed fixture.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { createFluentVue } from "fluent-vue";
import { bundlesFor } from "../app/lib/i18n";
import { setApi } from "../app/lib/api";
import { INTAKE_DEMO, intakeHint } from "../app/lib/intake-demo";
import { sizeMsg } from "../app/lib/format";
import NewPatientDialog from "../app/components/intake/NewPatientDialog.vue";
import UploadZone from "../app/components/uploads/UploadZone.vue";
import PhoneUploadDialog from "../app/components/phone/PhoneUploadDialog.vue";
import CaseUploads from "../app/components/uploads/CaseUploads.vue";
import { useIntakeStore } from "../app/stores/intake";
import { usePhoneStore } from "../app/stores/phone";
import { useSessionStore } from "../app/stores/session";
import { useUploadsStore } from "../app/stores/uploads";
import { mockApi, meOrg } from "./helpers";

const repo = path.join(import.meta.dirname, "../..");
let pinia: Pinia;
// Each test mounts its own dialogs; listeners of an earlier test must not answer this one's keys.
enableAutoUnmount(afterEach);
const plugins = () => [pinia, createFluentVue({ bundles: bundlesFor("cs") })];

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  document.body.innerHTML = '<div id="overlay"></div><div id="phoneup" class="phonelayer"></div>';
  useSessionStore().me = { user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null }, ...meOrg("d2p1"), auth_mode: "demo", impersonating: false, notice_cs: null };
  setApi(mockApi({}).api);
});

describe("NewPatientDialog", () => {
  it("renders the referral step with its labels, marks and autocomplete tokens", async () => {
    mount(NewPatientDialog, { global: { plugins: plugins() }, attachTo: document.body });
    await useIntakeStore().open();
    await flushPromises();
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute("aria-label")).toBe("Nový pacient");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.querySelector("h2")!.textContent).toBe("Nový pacient");
    expect([...dlg.querySelectorAll(".stepper span")].map((s) => s.textContent)).toEqual(["1. Žádost o konzultaci", "2. Dokumenty", "3. Zpracování"]);
    expect(dlg.querySelector('.stepper [aria-current="step"]')!.textContent).toBe("1. Žádost o konzultaci");
    const labels = [...dlg.querySelectorAll(".formgrid > label")].map((l) => l.textContent!.replace(/\s+/g, " ").trim());
    expect(labels.slice(0, 8)).toEqual([
      "Jméno *",
      "Příjmení *",
      "Rodné číslo * kontroluje se jen formát",
      "Pojišťovnanevybráno111201205207209211213",
      "Jméno lékaře (vlastník)",
      "Odesílající pracoviště",
      "Kontaktní e-mail",
      "Kontaktní telefon",
    ]);
    expect((dlg.querySelector("#nf0") as HTMLInputElement).autocomplete).toBe("off");
    expect((dlg.querySelector("#nf4") as HTMLInputElement).autocomplete).toBe("name");
    expect(dlg.querySelector("#nfg")!.closest("label")!.textContent!.trim()).toBe("Souhlasím, aby FNO použila uvedené osobní údaje ke zpracování požadavku, dle GDPR. *");
    // Focus moved into the dialog.
    expect(document.activeElement).toBe(dlg);
  });

  it("ties each field message to its field and focuses the first refused field", async () => {
    mount(NewPatientDialog, { global: { plugins: plugins() }, attachTo: document.body });
    await useIntakeStore().open();
    await flushPromises();
    const next = [...document.querySelectorAll("button")].find((b) => b.textContent === "Pokračovat")!;
    next.click();
    await flushPromises();
    await nextTick();
    const nf0 = document.querySelector("#nf0")!;
    expect(nf0.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(nf0.getAttribute("aria-describedby")!)!.textContent).toBe("Vyplňte jméno.");
    expect(document.querySelector("#nfg")!.getAttribute("aria-describedby")).toBe("nfg-err");
    expect(document.activeElement).toBe(nf0);
  });

  it("shows the duplicate warning with the link and the override inside one alert", async () => {
    mount(NewPatientDialog, { global: { plugins: plugins() }, attachTo: document.body });
    const s = useIntakeStore();
    await s.open();
    s.dupId = "NO-099";
    await flushPromises();
    const alert = document.querySelector('[role="alert"].fwarn')!;
    expect(alert.textContent!.replace(/\s+/g, " ").trim()).toBe("Pacient s tímto rodným číslem už v databázi je: NO-099. Přesto vytvořit nový záznam");
  });

  it("Escape closes the dialog, but not while the phone dialog is open above it", async () => {
    mount(NewPatientDialog, { global: { plugins: plugins() }, attachTo: document.body });
    const s = useIntakeStore();
    await s.open();
    usePhoneStore().current = { target: "intake", caseId: "NO-012", file: null, state: "loading", id: null, url: null, expires: null, docs: [], seen: new Set() };
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.isOpen).toBe(true);
    usePhoneStore().current = null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.isOpen).toBe(false);
  });
});

describe("UploadZone", () => {
  it("passes dropped files on and marks the zone while a file is dragged over it", async () => {
    const w = mount(UploadZone, { props: { title: "Přetáhněte soubory sem", hint: "nebo klikněte" }, global: { plugins: plugins() } });
    const file = new File(["x"], "a.pdf");
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "" };
    await w.trigger("dragover", { dataTransfer });
    expect(w.classes()).toContain("drop");
    await w.trigger("drop", { dataTransfer });
    expect(w.classes()).not.toContain("drop");
    expect(w.emitted("files")).toEqual([[[file]]]);
    // A drag of something that is not a file (text, a calendar card) is not taken.
    await w.trigger("drop", { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(w.emitted("files")).toHaveLength(1);
    expect(w.find("input[type=file]").attributes("multiple")).toBeDefined();
  });
});

describe("PhoneUploadDialog", () => {
  it("draws the QR code for the link with its accessible name, and never prints the token", async () => {
    mount(PhoneUploadDialog, { global: { plugins: plugins() }, attachTo: document.body });
    usePhoneStore().current = {
      target: "discussion", caseId: "NO-S01", file: "S01_pacient.pdf", state: "open", id: "us1", url: "http://localhost/u#tok-secret-123",
      expires: Date.parse("2026-10-16T10:15:00Z"), docs: [], seen: new Set(),
    };
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));
    await flushPromises();
    const dlg = document.querySelector('#phoneup [role="dialog"]')!;
    expect(dlg.querySelector("h2")!.textContent).toBe("Nahrát z telefonu · NO-S01");
    const svg = dlg.querySelector(".phoneqr svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(dlg.querySelector(".phoneqr")!.textContent).toContain("QR kód pro nahrání z telefonu");
    expect(dlg.textContent).not.toContain("tok-secret-123");
    expect(dlg.querySelector('[role="status"]')!.textContent).toBe("Čekám na soubory z telefonu…");
  });
});

describe("CaseUploads", () => {
  it("lists uploads with size, who, when and phone origin, and hides the zone and remove buttons when locked", async () => {
    const w = mount(CaseUploads, { props: { caseRef: { file: "S01_pacient.pdf", id: "NO-S01" }, locked: true, why: "Případ je uzavřen." }, global: { plugins: plugins() } });
    const u = useUploadsStore();
    u.listOf("S01_pacient.pdf").loaded = true;
    u.listOf("S01_pacient.pdf").docs.push({ id: "u1", name: "foto.jpg", size: 2048, uploaded_by: "MUDr. Svobodová", when: "09:05", source: "phone", readability: "poor", readability_reasons_cs: ["rozmazané"] });
    await flushPromises();
    expect(w.text()).toContain("Případ je uzavřen.");
    expect(w.find(".uplist li .small.muted").text()).toBe("2 kB · MUDr. Svobodová, 09:05 · z telefonu");
    expect(w.find(".uplist [role=alert]").text()).toBe("Dokument je špatně čitelný, vyžádejte lepší kopii. (rozmazané)");
    expect(w.find(".upzone").exists()).toBe(false);
    expect(w.find("button[aria-label^=Odebrat]").exists()).toBe(false);
    expect(w.text()).toContain("Ukázka: asistent nahrané soubory nečte;");
  });
});

describe("formats and the demo descriptor", () => {
  it("formats sizes", () => {
    expect(sizeMsg(10)).toEqual({ id: "upload-size-kb", args: { size: "1" } });
    expect(sizeMsg(1536 * 1024)).toEqual({ id: "upload-size-mb", args: { size: "1,5" } });
    expect(sizeMsg(2 * 1024 * 1024)).toEqual({ id: "upload-size-mb", args: { size: "2,0" } });
  });

  it("matches the committed S02 fixture (fixtures/data/mock-case-S02.json)", () => {
    const s = JSON.parse(readFileSync(path.join(repo, "fixtures/data/mock-case-S02.json"), "utf8"));
    expect(INTAKE_DEMO.rc).toBe(s.list_entry.rc);
    expect(INTAKE_DEMO.name).toBe(s.list_entry.name);
    expect(`${INTAKE_DEMO.folder}.pdf`).toBe(s.file);
    expect(INTAKE_DEMO.pages).toBe(s.list_entry.page_count);
    expect(INTAKE_DEMO.gaps).toBe(s.data_gaps.length);
    expect(INTAKE_DEMO.uploads).toEqual(s.documents.map((d: { upload_name?: string }) => d.upload_name).filter(Boolean));
    expect(JSON.parse(readFileSync(path.join(repo, "samples/S02_pacient/upload/zadost-fhir.json"), "utf8"))).toEqual(s.fhir_referral);
  });

  it("recognises the demo patient by birth number and name in either order, never by the number alone", () => {
    const form = { nf0: "Lipenská", nf1: "Věra", nf2: "5856144019" };
    expect(intakeHint(form, [], [])).toMatchObject({ nameOk: true, ready: false, missing: INTAKE_DEMO.uploads });
    expect(intakeHint({ ...form, nf0: "Jana" }, INTAKE_DEMO.uploads, [])).toMatchObject({ nameOk: false, ready: false });
    expect(intakeHint(form, INTAKE_DEMO.uploads, [])).toMatchObject({ ready: true, missing: [] });
    expect(intakeHint(form, INTAKE_DEMO.uploads, ["S02_pacient.pdf"])).toMatchObject({ exists: true, ready: false });
    expect(intakeHint({ ...form, nf2: "111111/1111" }, [], [])).toBeNull();
  });
});
