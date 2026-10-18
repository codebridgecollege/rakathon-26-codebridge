// The case upload list and the phone upload session against a mocked API (S.ups, addUploadsApi and phoneOpen...phoneEnd
// ). Synthetic values only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { setApi } from "../app/lib/api";
import { useUploadsStore } from "../app/stores/uploads";
import { usePhoneStore, PHONE_POLL_MS } from "../app/stores/phone";
import { useIntakeStore } from "../app/stores/intake";
import { useSessionStore } from "../app/stores/session";
import { useToastStore } from "../app/stores/toast";
import { mockApi, deferred } from "./helpers";

type Call = { url: string; init: RequestInit };
const method = (c: Call) => c.init.method ?? "GET";
const path = (c: Call) => c.url.replace(/^\/api/, "").split("?")[0];
const ok = <T>(data: T) => ({ data, data_epoch: 1, state: {} });
const doc = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, file: name, origin: "upload", size: 2048, identity: "ok", identity_cs: null, source: null, ...extra });
const S01 = { file: "S01_pacient.pdf", id: "NO-S01" };

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().me = { user: { id: "d2p1", name: "MUDr. Svobodová", role: "doctor", dept: null }, auth_mode: "demo", impersonating: false, notice_cs: null };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("case uploads", () => {
  it("loads the case's uploaded documents once, leaving out its own seeded ones", async () => {
    const m = mockApi({ "/cases/NO-S01/documents": { case_id: "NO-S01", processing_level: "full", documents: [doc("seed1", "zprava.pdf", { origin: "seed" }), doc("u1", "a.pdf")] } });
    setApi(m.api);
    const u = useUploadsStore();
    await u.load(S01);
    await u.load(S01);
    expect(u.docsOf(S01.file).map((d) => d.id)).toEqual(["u1"]);
    expect(m.calls).toHaveLength(1);
  });

  it("lists each file at once with the user and time, then takes the server's answer", async () => {
    const hold = deferred<unknown>();
    const m = mockApi({ "/cases/NO-S01/documents": (_u: string, init: RequestInit) => (init.method === "POST" ? hold.promise.then(() => [201, ok({ document: doc("u9", "b.pdf") })]) : { documents: [] }) });
    setApi(m.api);
    const u = useUploadsStore();
    const p = u.add(S01, [new File(["x"], "b.pdf")]);
    expect(u.docsOf(S01.file)[0]).toMatchObject({ name: "b.pdf", uploaded_by: "MUDr. Svobodová", local: true });
    expect(useToastStore().items[0]!.msg).toEqual({ id: "uploads-added", args: { n: 1 } });
    hold.resolve(null);
    await p;
    expect(u.docsOf(S01.file).map((d) => d.id)).toEqual(["u9"]);
  });

  it("keeps a file the server did not take, and flags a document of another patient with a toast", async () => {
    let n = 0;
    const m = mockApi({
      "/cases/NO-S01/documents": () =>
        ++n === 1 ? [503, { error: { code: "busy", message_cs: "Zaneprázdněno." } }] : [201, ok({ document: doc("u2", "cizi.pdf", { identity: "conflicts", identity_cs: "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu." }) })],
    });
    setApi(m.api);
    const u = useUploadsStore();
    await u.add(S01, [new File(["x"], "a.pdf"), new File(["y"], "cizi.pdf")]);
    expect(u.docsOf(S01.file).map((d) => [d.name, !!d.local])).toEqual([["a.pdf", true], ["cizi.pdf", false]]);
    expect(useToastStore().items.map((t) => t.msg)).toContainEqual({ text: "Jméno nebo rodné číslo v dokumentu se neshoduje s pacientem případu." });
  });

  it("removes a stored document on the server and a local row without a request; a refusal keeps the row", async () => {
    let refuse = false;
    const m = mockApi({ "/documents/u1": () => (refuse ? [409, { error: { code: "locked", message_cs: "Záznam je uzamčen." } }] : ok({ removed: "u1" })), "/workflow": { cases: {}, att: {}, sessions: [], mails: [] } });
    setApi(m.api);
    const u = useUploadsStore();
    u.listOf(S01.file).docs.push({ ...doc("u1", "a.pdf"), uploaded_by: null }, { id: "local-1", name: "b.pdf", size: 1, uploaded_by: null, local: true });
    refuse = true;
    await u.remove(S01, "u1");
    expect(u.docsOf(S01.file)).toHaveLength(2);
    expect(useToastStore().items.at(-1)?.msg).toEqual({ text: "Záznam je uzamčen." });
    refuse = false;
    await u.remove(S01, "u1");
    await u.remove(S01, "local-1");
    expect(u.docsOf(S01.file)).toEqual([]);
    expect(m.calls.filter((c) => method(c) === "DELETE")).toHaveLength(2);
  });

  it("drops what it read on a user switch, and a late answer cannot come back", async () => {
    const hold = deferred<unknown>();
    const m = mockApi({ "/cases/NO-S01/documents": () => hold.promise.then(() => ({ documents: [doc("u1", "a.pdf")] })) });
    setApi(m.api);
    const u = useUploadsStore();
    const p = u.load(S01);
    u.reset();
    hold.resolve(null);
    await p;
    expect(u.docsOf(S01.file)).toEqual([]);
  });
});

describe("phone upload", () => {
  function phoneServer(polls: unknown[]) {
    return mockApi({
      "/upload-sessions": [201, ok({ id: "us1", token: "secret-token", case_id: "NO-S01", target: "discussion", state: "open", expires_at: "2026-10-16T10:15:00Z", file_count: 0, max_files: 30 })],
      "/upload-sessions/us1": (_u: string, init: RequestInit) =>
        init.method === "DELETE" ? ok({ id: "us1", state: "closed" }) : (polls.length > 1 ? polls.shift() : polls[0]),
      "/cases/NO-S01/documents": { documents: [] },
    });
  }
  const poll = (docs: unknown[], state = "open") => ({ id: "us1", case_id: "NO-S01", target: "discussion", state, expires_at: "2026-10-16T10:15:00Z", file_count: docs.length, max_files: 30, documents: docs });

  it("opens a session, builds the /u link from the token and adds the phone's files to the case list once each", async () => {
    vi.useFakeTimers();
    const f = doc("p1", "foto.jpg", { source: "phone" });
    const m = phoneServer([poll([]), poll([f]), poll([f])]);
    setApi(m.api);
    const ph = usePhoneStore();
    await ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    expect(ph.current?.state).toBe("open");
    expect(ph.current?.url).toBe(`${location.origin}/u#secret-token`);
    await vi.advanceTimersByTimeAsync(PHONE_POLL_MS * 3);
    expect(ph.current?.docs.map((d) => d.id)).toEqual(["p1"]);
    expect(useUploadsStore().docsOf("S01_pacient.pdf").map((d) => d.id)).toEqual(["p1"]);
  });

  it("ends the session on close, looks once more later, and stops polling", async () => {
    vi.useFakeTimers();
    const m = phoneServer([poll([])]);
    setApi(m.api);
    const ph = usePhoneStore();
    await ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    ph.close();
    expect(ph.current).toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    expect(m.calls.filter((c) => method(c) === "DELETE" && path(c) === "/upload-sessions/us1")).toHaveLength(1);
    const after = m.calls.length;
    await vi.advanceTimersByTimeAsync(PHONE_POLL_MS * 4);
    expect(m.calls.length).toBe(after);
  });

  it("ends a session created after the dialog was closed", async () => {
    const hold = deferred<unknown>();
    const m = mockApi({
      "/upload-sessions": () => hold.promise.then(() => [201, ok({ id: "us1", token: "t", case_id: "NO-S01", target: "discussion", state: "open", expires_at: "2026-10-16T10:15:00Z", file_count: 0, max_files: 30 })]),
      "/upload-sessions/us1": ok({}),
    });
    setApi(m.api);
    const ph = usePhoneStore();
    const p = ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    ph.close();
    hold.resolve(null);
    await p;
    await vi.waitFor(() => expect(m.calls.some((c) => method(c) === "DELETE" && path(c) === "/upload-sessions/us1")).toBe(true));
  });

  it("shows the code as expired when the server says so, and a refusal to open closes the dialog with the message", async () => {
    vi.useFakeTimers();
    const m = phoneServer([poll([], "expired")]);
    setApi(m.api);
    const ph = usePhoneStore();
    await ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    await vi.advanceTimersByTimeAsync(PHONE_POLL_MS);
    expect(ph.current?.state).toBe("expired");
    ph.close();

    setActivePinia(createPinia());
    setApi(mockApi({ "/upload-sessions": [403, { error: { code: "role_forbidden", message_cs: "Vaše role tuto změnu nemůže provést." } }] }).api);
    const ph2 = usePhoneStore();
    await ph2.open("discussion", "NO-S01", "S01_pacient.pdf");
    expect(ph2.current).toBeNull();
    expect(useToastStore().items.at(-1)?.msg).toEqual({ text: "Vaše role tuto změnu nemůže provést." });
  });

  it("files for an intake join the open intake's list, marked by their source", async () => {
    vi.useFakeTimers();
    const f = doc("p1", "zadanka.jpg", { source: "phone" });
    const m = mockApi({
      "/upload-sessions": [201, ok({ id: "us1", token: "t", case_id: "NO-012", target: "intake", state: "open", expires_at: "2026-10-16T10:15:00Z", file_count: 0, max_files: 30 })],
      "/upload-sessions/us1": { ...poll([f]), case_id: "NO-012", target: "intake" },
      "/cases": [201, ok({ case_id: "NO-012", file: "12_novy.pdf", intake: true })],
    });
    setApi(m.api);
    const intake = useIntakeStore();
    await intake.open();
    Object.assign(intake.form, { nf0: "A", nf1: "B", nf2: "111111/1111", nfg: true });
    await intake.next();
    await usePhoneStore().open("intake", "NO-012");
    await vi.advanceTimersByTimeAsync(PHONE_POLL_MS);
    expect(intake.files.map((x) => [x.name, x.doc?.source])).toEqual([["zadanka.jpg", "phone"]]);
  });

  it("a user switch ends the session under the user who opened it", async () => {
    const m = phoneServer([poll([])]);
    setApi(m.api);
    m.api.setUser("d2p1");
    const ph = usePhoneStore();
    await ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    // What the switch hook does (plugins/intake.ts): close, then the session store sets the new user.
    ph.close();
    m.api.setUser("coord");
    const del = m.calls.find((c) => method(c) === "DELETE" && path(c) === "/upload-sessions/us1");
    expect(new Headers(del!.init.headers).get("X-Demo-User")).toBe("d2p1");
  });

  it("a closed tab ends the session with a keepalive request", async () => {
    const m = phoneServer([poll([])]);
    setApi(m.api);
    const ph = usePhoneStore();
    await ph.open("discussion", "NO-S01", "S01_pacient.pdf");
    window.dispatchEvent(new Event("pagehide"));
    const c = m.calls.find((x) => method(x) === "DELETE" && path(x) === "/upload-sessions/us1");
    expect(c?.init.keepalive).toBe(true);
    ph.close();
  });
});
