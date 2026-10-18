// The per-case data cache, with these rules:
// - keyed by the list row's file, as every per-case map is;
// - an entry is "absent", "loading", "ready" or "error"; creating one never starts a load, so a list or a calendar
//   card never causes an access;
// - one request per case load (the server logs "case.data" for it), never a prefetch;
// - a reply for an older request, a reset store or an evicted entry is dropped (gen counter and entry identity);
// - at most CASE_CACHE_MAX loaded cases stay in memory, the open one counted among them, and nothing goes to browser
//   storage.
// Nothing is ever "seeded" from the page itself.
import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { ApiError, type Extraction, type PatientRow } from "@codebridge/api-client";
import { useApi } from "../lib/api";

// It bounds how much patient data one tab holds. A privacy-for-convenience trade-off: a larger cache would make
// switching cases faster.
export const CASE_CACHE_MAX = 5;

// The server's extraction objects as they come ({ case, extra } or { syn }); null for a case without a run, which the
// screens show as "not processed". Converting them to the screens' shape (fromFullExtraction, fromSyn) is ported with
// the screens.
export type CaseData = { file: string; id: string; extraction: Extraction["data"] };
export type CaseError = { code: string; status: number | null; message_cs: string | null; message_id: string | null };
export type CaseEntry = {
  state: "absent" | "loading" | "ready" | "error";
  data: CaseData | null;
  error: CaseError | null;
  gen: number;
  loadedAt: number;
  // The guideline layer of a full case (GET /cases/:id/guidance), loaded once when the case is shown; it lives in the
  // entry, so a reset or an eviction drops it with the case data.
  guide?: Guidance;
};
// The guidance reply as it comes, or the load's state. Typed loosely: its screens read it by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Guidance = { loading?: boolean; error?: { message_cs: string | null; message_id: string | null } } & Record<string, any>;

const unprocessed = (p: Pick<PatientRow, "file" | "id">): CaseData => ({ file: p.file, id: p.id, extraction: null });

export const useCasesStore = defineStore("cases", () => {
  const entries = reactive(new Map<string, CaseEntry>());
  // The case on screen (S.pid): never evicted, and the only one whose late reply may change the screen.
  const openFile = ref<string | null>(null);
  // Injectable for tests, so eviction order is deterministic.
  let now = () => Date.now();

  // The entry of a case, created as "absent". It starts no load, but creating the entry writes to the reactive map, so
  // render code reads with readyData() or stateOf(), which never write.
  function caseOf(file: string): CaseEntry {
    let e = entries.get(file);
    if (!e) {
      entries.set(file, { state: "absent", data: null, error: null, gen: 0, loadedAt: 0 });
      e = entries.get(file)!;
    }
    return e;
  }

  // The case data when it is loaded, else null. Never starts a load.
  function readyData(file: string | null | undefined): CaseData | null {
    const e = file ? entries.get(file) : undefined;
    return e && e.state === "ready" ? e.data : null;
  }

  // The state of a case for a view: "absent" without creating an entry.
  function stateOf(file: string | null | undefined): CaseEntry["state"] {
    return (file && entries.get(file)?.state) || "absent";
  }

  function setReady(file: string, data: CaseData) {
    // Updated in place, so a pending load of other parts (guidance, later) still finds its entry.
    Object.assign(caseOf(file), { state: "ready", data, error: null, loadedAt: now() });
  }

  // Starts what the case needs to show. Idempotent: a loading, ready or failed entry is left as it is; a failed one
  // reloads only through retry().
  function ensureCase(p: PatientRow): Promise<void> | void {
    const e = caseOf(p.file);
    if (e.state !== "absent") return;
    if (p.processing === "none") {
      setReady(p.file, unprocessed(p));
      return;
    }
    return loadCase(p);
  }

  async function loadCase(p: PatientRow): Promise<void> {
    const e = caseOf(p.file);
    const gen = ++e.gen;
    e.state = "loading";
    e.error = null;
    let data: CaseData | null = null;
    let err: ApiError | null = null;
    try {
      const ex = await useApi().extraction(p.id);
      const d = ex.data ?? null;
      // All knowledge of the reply's shape sits here, data is null (no run) or holds
      // { case, extra } or { syn }. Anything else is an error on the case, never data that merely looks valid.
      if (d !== null && (typeof d !== "object" || (!("case" in d) && !("syn" in d)))) throw new ApiError("bad_shape", 200, null, "case-data-bad-shape");
      data = { file: p.file, id: p.id, extraction: d };
    } catch (x) {
      err = x instanceof ApiError ? x : new ApiError("network", 0, null, "api-error-network");
    }
    // A reply for an older request (a retry, a user switch, an eviction) must not overwrite newer state.
    if (e.gen !== gen || entries.get(p.file) !== e) return;
    if (err) {
      // A refusal shows on the case itself, never as "not processed".
      e.state = "error";
      e.error = { code: err.code || "network", status: err.status || null, message_cs: err.message_cs ?? null, message_id: err.message_id ?? null };
    } else {
      setReady(p.file, data!);
      evictOld();
    }
  }

  // "Zkusit znovu": the case and its guideline layer load again.
  function retry(p: PatientRow) {
    delete caseOf(p.file).guide;
    return loadCase(p);
  }

  // The guideline layer of a case, loaded once. The server logs "guidance.load"
  // for it. A failed request keeps its message, so the panel says so instead of a spinner that never ends.
  async function ensureGuidance(p: PatientRow): Promise<void> {
    const e = entries.get(p.file);
    if (!e || e.guide) return;
    const gen = e.gen;
    e.guide = { loading: true };
    let res: Guidance;
    try {
      res = (await useApi().guidance(p.id)) as Guidance;
    } catch (x) {
      const err = x instanceof ApiError ? x : null;
      res = { error: { message_cs: err?.message_cs ?? null, message_id: err?.message_id ?? "patient-guide-load-failed" } };
    }
    // A reply for a store that was reset since (user switch) or a newer request must not land in the current entry.
    if (entries.get(p.file) !== e || e.gen !== gen) return;
    e.guide = res;
  }

  // "Zkusit znovu" in the guideline panel: the next render loads it again.
  function retryGuidance(file: string) {
    const e = entries.get(file);
    if (e) delete e.guide;
  }

  // The case that holds a source document: the case's own PDF, or one uploaded PDF per document (a case created by
  // intake). Only loaded cases are searched, so a reference never causes a load.
  function caseFileOfDoc(docFile: string): string | null {
    if (entries.get(docFile)?.state === "ready") return docFile;
    for (const [f, e] of entries) {
      if (e.state !== "ready" || !e.data) continue;
      const d = e.data.extraction as { syn?: { documents?: { file?: string }[] }; extra?: { documents?: { file?: string }[] } } | null;
      const docs = d?.syn?.documents ?? d?.extra?.documents ?? [];
      if (docs.some((x) => x.file === docFile)) return f;
    }
    return null;
  }

  // Keeps at most CASE_CACHE_MAX loaded cases, the open one counted among them; the oldest loads go first. An evicted
  // entry's gen is bumped so its in-flight reply cannot come back.
  function evictOld() {
    const loaded = [...entries].filter(([f, e]) => e.state === "ready" && f !== openFile.value).sort((a, b) => a[1].loadedAt - b[1].loadedAt);
    const keep = CASE_CACHE_MAX - (openFile.value && entries.get(openFile.value) ? 1 : 0);
    for (const [f, e] of loaded.slice(0, Math.max(0, loaded.length - keep))) {
      e.gen++;
      entries.delete(f);
    }
  }

  // Drops every entry (a user switch: the server's answer depends on the user). Bumping gen first makes any reply
  // still on its way stale, so it cannot write into the new store.
  function reset() {
    entries.forEach((e) => {
      e.gen++;
    });
    entries.clear();
  }

  function setOpen(file: string | null) {
    openFile.value = file;
  }

  function setClock(fn: () => number) {
    now = fn;
  }

  return { entries, openFile, caseOf, stateOf, readyData, ensureCase, loadCase, retry, ensureGuidance, retryGuidance, caseFileOfDoc, evictOld, reset, setOpen, setClock };
});
