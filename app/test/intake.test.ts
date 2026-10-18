// The "Nový pacient" store against a mocked API: the same requests and decisions as the old page's intake in API mode
// (newCaseApi, newUploadsApi, discardIntake, completeIntakeApi). Synthetic values only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { setApi } from "../app/lib/api";
import { useIntakeStore } from "../app/stores/intake";
import { useSessionStore } from "../app/stores/session";
import { usePatientsStore } from "../app/stores/patients";
import { useToastStore } from "../app/stores/toast";
import { mockApi, row, deferred } from "./helpers";

type Call = { url: string; init: RequestInit };
const method = (c: Call) => c.init.method ?? "GET";
const path = (c: Call) => c.url.replace(/^\/api/, "").split("?")[0];
const bodyOf = (c: Call) => JSON.parse(String(c.init.body ?? "{}"));
const ok = <T>(data: T, state: unknown = {}) => ({ data, data_epoch: 1, state });
const doc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, file: name, origin: "upload", size: 10, identity: "ok", identity_cs: null, type_cs: null, source: null, ...extra });

function asDoctor() {
  useSessionStore().me = { user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null };
}

const nav = { openPatient: vi.fn(), showList: vi.fn() };

function server(over: Record<string, unknown> = {}) {
  let docN = 0;
  const m = mockApi({
    "/cases": (_u: string, init: RequestInit) => [201, ok({ case_id: "NO-012", file: "12_novy.pdf", intake: JSON.parse(String(init.body)).intake === true })],
    "/cases/NO-012/documents": (_u: string, init: RequestInit) => {
      const name = decodeURIComponent(new Headers(init.headers).get("X-File-Name") ?? "");
      return [201, ok({ document: doc(`doc${++docN}`, name) })];
    },
    "/cases/NO-012/intake": () => ok({ discarded: "NO-012" }),
    "/documents/doc1": () => ok({ removed: "doc1" }),
    "/fhir/referral": () =>
      ok({ form: {}, fields: { nf0: "Alena", nf1: "Ukázková", nf2: "715309/1236", nf3: "111" }, found: ["Patient", "Coverage"], missing_cs: ["lékař", "telefon"], referral_sha256: "abc" }),
    ...over,
  });
  setApi(m.api);
  return m;
}

beforeEach(() => {
  setActivePinia(createPinia());
  nav.openPatient.mockReset();
  nav.showList.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

async function openFilled(s = useIntakeStore()) {
  asDoctor();
  s.setNavigation(nav);
  await s.open();
  Object.assign(s.form, { nf0: " Alena ", nf1: "Ukázková", nf2: "715309/1236", nfg: true });
  return s;
}

describe("opening", () => {
  it("is for doctors and the coordinator; others get the old page's note", async () => {
    server();
    useSessionStore().me = { user: { id: "admin", name: "Ing. Kovář", role: "admin", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null };
    const s = useIntakeStore();
    expect(await s.open()).toBe(false);
    expect(s.isOpen).toBe(false);
    expect(useToastStore().items.map((t) => t.msg)).toEqual([{ id: "intake-only-doctor-or-coordinator" }]);
  });
});

describe("the referral", () => {
  it("names every missing field, focuses the first, and sends nothing", async () => {
    const m = server();
    asDoctor();
    const s = useIntakeStore();
    await s.open();
    s.form.nf5 = " Nemocnice Test ";
    expect(await s.next()).toBe("nf0");
    expect(s.errs).toEqual({
      nf0: { id: "intake-error-first-name" },
      nf1: { id: "intake-error-last-name" },
      nf2: { id: "intake-error-birth-number" },
      nfg: { id: "intake-error-consent" },
    });
    // Typed values stay, trimmed.
    expect(s.form.nf5).toBe("Nemocnice Test");
    s.form.nf2 = "12345";
    await s.next();
    expect(s.errs.nf2).toEqual({ id: "intake-error-birth-number-format" });
    expect(m.calls).toHaveLength(0);
  });

  it("creates the case open for intake with the form's fields and a key, never the consent text", async () => {
    const m = server();
    const s = await openFilled();
    s.form.nfq = "Otázka?";
    await s.next();
    expect(s.step).toBe(1);
    expect(s.caseId).toBe("NO-012");
    const c = m.calls.find((x) => path(x) === "/cases")!;
    expect(bodyOf(c)).toEqual({ first_name: "Alena", last_name: "Ukázková", birth_number: "715309/1236", consent: true, question: "Otázka?", intake: true });
    expect(new Headers(c.init.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("reuses the idempotency key after a lost answer, and takes a new one for a changed referral", async () => {
    let n = 0;
    const m = server({ "/cases": () => (++n === 1 ? new Promise((_, rej) => rej(new TypeError("Failed to fetch"))) : [201, ok({ case_id: "NO-012", file: "12_novy.pdf", intake: true })]) });
    const s = await openFilled();
    await s.next();
    expect(s.step).toBe(0);
    await s.next();
    const keys = m.calls.filter((x) => path(x) === "/cases").map((c) => new Headers(c.init.headers).get("Idempotency-Key"));
    expect(keys[0]).toBe(keys[1]);
  });

  it("warns about a birth number in the list and creates a second record only when confirmed", async () => {
    const m = server();
    usePatientsStore().replace([row(1, { rc: "7153091236", name: "Alena Ukázková" })], 1);
    const s = await openFilled();
    await s.next();
    expect(s.dup).toBe("1_pacient.pdf");
    expect(s.dupRow?.id).toBe("NO-001");
    expect(m.calls).toHaveLength(0);
    await s.confirmDuplicate();
    expect(s.step).toBe(1);
    expect(bodyOf(m.calls.find((x) => path(x) === "/cases")!).duplicate_override).toEqual({ birth_number: "7153091236" });
  });

  it("asks again when the confirmed birth number is changed", async () => {
    server();
    usePatientsStore().replace([row(1, { rc: "715309/1236" }), row(2, { rc: "111111/1111" })], 2);
    const s = await openFilled();
    await s.next();
    s.form.nf2 = "111111/1111";
    await s.confirmDuplicate();
    // The confirmation was for 1111111111 now, as typed; a further change is checked again.
    s.form.nf2 = "715309/1236";
    await s.back();
    await s.next();
    expect(s.dup).toBe("1_pacient.pdf");
  });

  it("shows the server's duplicate of a case this user cannot see, and continues with the override", async () => {
    let n = 0;
    const m = server({
      "/cases": () =>
        ++n === 1
          ? [409, { error: { code: "duplicate_birth_number", message_cs: "Pacient s tímto rodným číslem už v databázi je.", current: { case_id: "NO-099", file: "99_pacient.pdf" } } }]
          : [201, ok({ case_id: "NO-012", file: "12_novy.pdf", intake: true })],
    });
    const s = await openFilled();
    await s.next();
    expect(s.step).toBe(0);
    expect(s.dup).toBeNull();
    expect(s.dupId).toBe("NO-099");
    await s.confirmDuplicate();
    expect(s.step).toBe(1);
    const posts = m.calls.filter((x) => path(x) === "/cases");
    expect(bodyOf(posts[1]!).duplicate_override).toEqual({ birth_number: "7153091236" });
    // A refused referral (status 409) gets a new key for the next attempt.
    expect(new Headers(posts[0]!.init.headers).get("Idempotency-Key")).not.toBe(new Headers(posts[1]!.init.headers).get("Idempotency-Key"));
  });

  it("puts the server's field messages on the fields", async () => {
    server({ "/cases": () => [422, { error: { code: "invalid_input", message_cs: "Údaje nejsou vyplněné správně.", fields: { birth_number: "Rodné číslo zadejte ve tvaru 123456/7890." } } }] });
    const s = await openFilled();
    await s.next();
    expect(s.errs).toEqual({ nf2: { text: "Rodné číslo zadejte ve tvaru 123456/7890." } });
    expect(useToastStore().items.at(-1)?.msg).toEqual({ text: "Údaje nejsou vyplněné správně." });
  });
});

describe("FHIR import", () => {
  it("refuses text that is not JSON without a request", async () => {
    const m = server();
    const s = await openFilled();
    await s.fhirImport("{nope");
    expect(s.fhirMsg).toEqual({ id: "intake-fhir-bad-json" });
    expect(m.calls).toHaveLength(0);
  });

  it("fills the fields the server found, lists the missing ones and never ticks the consent", async () => {
    server({ "/fhir/referral": () => ok({ form: {}, fields: { nf0: "Alena", nf2: "715309/1236", nfg: true }, found: ["Patient"], missing_cs: ["lékař"], referral_sha256: "abc" }) });
    asDoctor();
    const s = useIntakeStore();
    await s.open();
    s.setFhirOpen(true);
    await s.fhirImport('{"resourceType":"Patient"}');
    expect(s.form.nf0).toBe("Alena");
    expect(s.form.nfg).toBe(false);
    expect(s.fhirOpen).toBe(false);
    expect(s.fhirMsg).toEqual({ id: "intake-fhir-loaded-missing", args: { found: "Patient", missing: "lékař" } });
  });

  it("sends the referral's hash with the new case", async () => {
    const m = server();
    const s = await openFilled();
    await s.fhirImport("{}");
    Object.assign(s.form, { nf0: "Alena", nfg: true });
    await s.next();
    expect(bodyOf(m.calls.find((x) => path(x) === "/cases")!).referral_sha256).toBe("abc");
  });

  it("pastes the synthetic S02 referral as the sample", async () => {
    server();
    const s = await openFilled();
    await s.fhirSample();
    expect(JSON.parse(s.fhirText).resourceType).toBe("Bundle");
  });
});

describe("documents", () => {
  const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

  it("lists every file at once, uploads each in turn and skips a name already listed", async () => {
    const m = server();
    const s = await openFilled();
    await s.next();
    s.addFiles([pdf("a.pdf"), pdf("b.pdf")]);
    expect(s.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
    s.addFiles([pdf("a.pdf")]);
    expect(useToastStore().items.at(-1)?.msg).toEqual({ id: "intake-already-uploaded", args: { names: "a.pdf" } });
    await vi.waitFor(() => expect(s.files.every((f) => f.doc)).toBe(true));
    expect(m.calls.filter((c) => path(c) === "/cases/NO-012/documents")).toHaveLength(2);
  });

  it("removes a file on the server, also one removed while its upload was on its way", async () => {
    const hold = deferred<unknown>();
    const m = server({ "/cases/NO-012/documents": () => hold.promise.then(() => [201, ok({ document: doc("doc1", "a.pdf") })]) });
    const s = await openFilled();
    await s.next();
    s.addFiles([pdf("a.pdf")]);
    s.removeFile(s.files[0]!.key);
    hold.resolve(null);
    await vi.waitFor(() => expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/documents/doc1")).toBe(true));
    expect(s.files).toEqual([]);
  });

  it("keeps a file the server did not take listed, so the demo never shows an upload error", async () => {
    server({ "/cases/NO-012/documents": () => [503, { error: { code: "busy", message_cs: "Server je zaneprázdněn." } }] });
    const s = await openFilled();
    await s.next();
    s.addFiles([pdf("a.pdf")]);
    await vi.waitFor(() => expect(s.files).toHaveLength(1));
    expect(useToastStore().items).toHaveLength(0);
  });
});

describe("discarding", () => {
  it("closing the dialog discards the open intake on the server", async () => {
    const m = server();
    const s = await openFilled();
    await s.next();
    s.close();
    expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/cases/NO-012/intake")).toBe(true);
    expect(s.isOpen).toBe(false);
  });

  it("Zpět discards it too, and the next Pokračovat waits for that before a new referral", async () => {
    const hold = deferred<unknown>();
    const m = server({ "/cases/NO-012/intake": () => hold.promise.then(() => ok({ discarded: "NO-012" })) });
    const s = await openFilled();
    await s.next();
    s.back();
    expect(s.step).toBe(0);
    const again = s.next();
    await Promise.resolve();
    expect(m.calls.filter((c) => path(c) === "/cases")).toHaveLength(1);
    hold.resolve(null);
    await again;
    expect(m.calls.filter((c) => path(c) === "/cases")).toHaveLength(2);
  });

  it("a case created after the dialog closed is discarded at once", async () => {
    const hold = deferred<unknown>();
    const m = server({ "/cases": () => hold.promise.then(() => [201, ok({ case_id: "NO-012", file: "12_novy.pdf", intake: true })]) });
    const s = await openFilled();
    const p = s.next();
    s.close();
    hold.resolve(null);
    await p;
    await vi.waitFor(() => expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/cases/NO-012/intake")).toBe(true));
  });
});

describe("processing and completion", () => {
  it("waits for the uploads, asks the server's verdict, then completes and opens the new patient", async () => {
    vi.useFakeTimers();
    const patient = row(12, { file: "S02_pacient.pdf", id: "NO-S02", name: "Věra Lipenská" });
    const m = server({
      "/cases/NO-012/intake": (_u: string, init: RequestInit) =>
        (init.method ?? "GET") === "GET" ? { case_id: "NO-012", ready: true, fixture_id: "S02", expected: 7, present: 7, missing_cs: [], reason_cs: "", documents: [] } : ok({}),
      "/cases/NO-012/intake/complete": () => ok({ case_id: "NO-012", attached: true, run_id: "r", reason_cs: "", documents: 7 }, { patient }),
    });
    const s = await openFilled();
    Object.assign(s.form, { nf0: "Věra", nf1: "Lipenská", nf2: "585614/4019" });
    await s.next();
    s.addFiles(["01", "02", "03", "04", "05", "06", "07"].map((n) => new File(["%PDF"], (s as unknown as { hint: { demo: { uploads: string[] } } }).hint.demo.uploads.find((u) => u.startsWith(n))!)));
    await s.next();
    expect(s.step).toBe(2);
    await vi.advanceTimersByTimeAsync(450 + 3 * 550);
    expect(s.progress).toBe(4);
    await vi.waitFor(() => expect(s.done).toBe(true));
    expect(s.prepared).toBe(true);
    // The verdict was asked after every upload had been answered.
    const order = m.calls.map((c) => `${method(c)} ${path(c)}`);
    expect(order.lastIndexOf("POST /cases/NO-012/documents")).toBeLessThan(order.indexOf("GET /cases/NO-012/intake"));
    await s.complete();
    expect(s.isOpen).toBe(false);
    expect(usePatientsStore().byId("NO-S02")).toBeTruthy();
    expect(useToastStore().items.at(-1)?.msg).toEqual({ id: "intake-added", args: { id: "NO-S02" } });
    expect(nav.openPatient).toHaveBeenCalledWith("S02_pacient.pdf");
    // A completed intake is not discarded by the close that follows it.
    expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/cases/NO-012/intake")).toBe(false);
  });

  it("goes to the list when nothing attached, and says the record stays without extraction", async () => {
    vi.useFakeTimers();
    server({
      "/cases/NO-012/intake": () => ({ case_id: "NO-012", ready: false, fixture_id: null, expected: 0, present: 0, missing_cs: [], reason_cs: "", documents: [] }),
      "/cases/NO-012/intake/complete": () => ok({ case_id: "NO-012", attached: false, run_id: null, reason_cs: "", documents: 1 }, { patient: row(12, { id: "NO-012", file: "12_novy.pdf" }) }),
    });
    const s = await openFilled();
    await s.next();
    s.addFiles([new File(["x"], "x.pdf")]);
    await s.next();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.done).toBe(true));
    expect(s.prepared).toBe(false);
    await s.complete();
    expect(nav.showList).toHaveBeenCalled();
    expect(useToastStore().items.at(-1)?.msg).toEqual({ id: "intake-added", args: { id: "NO-012" } });
  });

  it("an unanswered verdict still ends the processing, as not attached", async () => {
    vi.useFakeTimers();
    server({ "/cases/NO-012/intake": () => [500, {}] });
    const s = await openFilled();
    await s.next();
    s.addFiles([new File(["x"], "x.pdf")]);
    await s.next();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(s.done).toBe(true));
    expect(s.verdict).toEqual({ ready: false });
  });
});

describe("user switch", () => {
  it("discards the open intake and waits for it before the switch", async () => {
    const m = server();
    const s = await openFilled();
    await s.next();
    await s.closeForUserSwitch();
    expect(s.isOpen).toBe(false);
    expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/cases/NO-012/intake")).toBe(true);
  });
});
