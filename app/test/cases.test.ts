// The case cache must keep the old page's semantics (caseStore in mocks/src/v3-template.html): no load without a
// request to show the case, one request per load, late replies dropped, at most five cases in memory.
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { CASE_CACHE_MAX, useCasesStore } from "../app/stores/cases";
import { setApi } from "../app/lib/api";
import { deferred, mockApi, row } from "./helpers";

const extraction = (id: string) => ({ case_id: id, processing: "full", run: { id: "r1" }, data: { case: { file: "x" }, extra: {} } });
const caseIdOf = (url: string) => decodeURIComponent(url.split("/")[3] ?? "");

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("case cache", () => {
  it("creates an entry as absent and starts no request for it", () => {
    const m = mockApi({});
    setApi(m.api);
    const s = useCasesStore();
    expect(s.caseOf("1_pacient.pdf").state).toBe("absent");
    expect(s.readyData("1_pacient.pdf")).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it("loads a processed case once, however often it is ensured", async () => {
    const m = mockApi({ "/cases/NO-001/extraction": extraction("NO-001") });
    setApi(m.api);
    const s = useCasesStore();
    const p = row(1);
    await Promise.all([s.ensureCase(p), s.ensureCase(p)]);
    await s.ensureCase(p);
    expect(m.calls).toHaveLength(1);
    expect(s.caseOf(p.file).state).toBe("ready");
    expect(s.readyData(p.file)?.extraction).toEqual({ case: { file: "x" }, extra: {} });
  });

  it("marks a case the server lists as unprocessed ready without a request", () => {
    const m = mockApi({});
    setApi(m.api);
    const s = useCasesStore();
    s.ensureCase(row(2, { processing: "none" }));
    expect(s.readyData("2_pacient.pdf")).toEqual({ file: "2_pacient.pdf", id: "NO-002", extraction: null });
    expect(m.calls).toHaveLength(0);
  });

  it("keeps a refusal on the case with the server's message, and does not retry by itself", async () => {
    const m = mockApi({ "/cases/NO-003/extraction": [403, { error: { code: "not_member", message_cs: "Nejste v týmu tohoto případu." } }] });
    setApi(m.api);
    const s = useCasesStore();
    await s.ensureCase(row(3));
    expect(s.caseOf("3_pacient.pdf")).toMatchObject({ state: "error", error: { code: "not_member", status: 403, message_cs: "Nejste v týmu tohoto případu." } });
    await s.ensureCase(row(3));
    expect(m.calls).toHaveLength(1);
    await s.retry(row(3));
    expect(m.calls).toHaveLength(2);
  });

  it("drops a reply that arrives after a reset (user switch)", async () => {
    const held = deferred<unknown>();
    const m = mockApi({ "/cases/NO-004/extraction": () => held.promise });
    setApi(m.api);
    const s = useCasesStore();
    const load = s.ensureCase(row(4));
    s.reset();
    held.resolve(extraction("NO-004"));
    await load;
    expect(s.entries.has("4_pacient.pdf")).toBe(false);
  });

  it("lets only the newest of two requests for a case land", async () => {
    const first = deferred<unknown>();
    let n = 0;
    const m = mockApi({ "/cases/NO-005/extraction": () => (++n === 1 ? first.promise : [403, { error: { code: "not_member", message_cs: "x" } }]) });
    setApi(m.api);
    const s = useCasesStore();
    const a = s.loadCase(row(5));
    await s.retry(row(5));
    first.resolve(extraction("NO-005"));
    await a;
    expect(s.caseOf("5_pacient.pdf").state).toBe("error");
  });

  it(`keeps at most ${CASE_CACHE_MAX} loaded cases, the open one included, dropping the oldest load`, async () => {
    const m = mockApi(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/cases/NO-00${i + 1}/extraction`, (u: string) => extraction(caseIdOf(u))])));
    setApi(m.api);
    const s = useCasesStore();
    let t = 0;
    s.setClock(() => ++t);
    s.setOpen("1_pacient.pdf");
    for (let i = 1; i <= 7; i++) await s.ensureCase(row(i));
    const kept = [...s.entries.keys()];
    expect(kept).toHaveLength(CASE_CACHE_MAX);
    // The open case stays although it loaded first; the oldest of the others go.
    expect(kept).toContain("1_pacient.pdf");
    expect(kept).not.toContain("2_pacient.pdf");
    expect(kept).not.toContain("3_pacient.pdf");
    expect(kept).toContain("7_pacient.pdf");
  });

  it("drops the late reply of an evicted case", async () => {
    const held = deferred<unknown>();
    const m = mockApi({ "/cases/NO-009/extraction": () => held.promise, ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`/cases/NO-00${i + 1}/extraction`, (u: string) => extraction(caseIdOf(u))])) });
    setApi(m.api);
    const s = useCasesStore();
    const late = s.loadCase(row(9));
    // Reset stands in for any drop of the entry; the reply must not recreate it.
    s.entries.delete("9_pacient.pdf");
    held.resolve(extraction("NO-009"));
    await late;
    expect(s.entries.has("9_pacient.pdf")).toBe(false);
  });
});
