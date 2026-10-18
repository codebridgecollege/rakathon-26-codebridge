// The Prognóza tab's state. Each entry belongs to one patient and one scheduled
// day, and every reply writes into the entry it was asked for, so a late reply never replaces the result of another
// case or day. The config is shared by all cases. The reference list and the panels of the tab on screen are held
// here too, so the drawers read the same numbers the tab shows.
import { defineStore } from "pinia";
import { reactive, shallowRef } from "vue";
import { ApiError, type PrognosisConfig, type PrognosisProfile, type PrognosisResult, type SavedPrognosis } from "@codebridge/api-client";
import {
  factsDiffer,
  findSaved,
  isPgDimension,
  isPgDimStatus,
  type PgDim,
  type PgDimension,
  type PgDimStatus,
  type PgEndpoint,
  type PgName,
  type PgNameKey,
  type PgPanel,
  type PgRef,
  type PgWhat,
} from "@codebridge/domain/prognosis";
import { useApi } from "../lib/api";
import type { T } from "../lib/dates";

// ---------- labels: the catalog IDs of the field, dimension and status names (every possible ID listed here) ----------

const NAME_IDS: Record<PgNameKey, string> = {
  os_6: "patient-pg-ep-os-6",
  os_12: "patient-pg-ep-os-12",
  os_36: "patient-pg-ep-os-36",
  os_60: "patient-pg-ep-os-60",
  pfs: "patient-pg-ep-pfs",
  response: "patient-pg-ep-response",
  toxicity: "patient-pg-ep-toxicity",
  burden: "patient-pg-ep-burden",
  orr: "patient-pg-name-orr",
  dor_median: "patient-pg-name-dor-median",
  grade3: "patient-pg-name-grade3",
  discontinuation: "patient-pg-name-discontinuation",
  conflict_dor: "patient-pg-name-conflict-dor",
  conflict_grade3: "patient-pg-name-conflict-grade3",
};
export const ENDPOINT_IDS: Record<PgEndpoint, string> = {
  os_6: NAME_IDS.os_6,
  os_12: NAME_IDS.os_12,
  os_36: NAME_IDS.os_36,
  os_60: NAME_IDS.os_60,
  pfs: NAME_IDS.pfs,
  response: NAME_IDS.response,
  toxicity: NAME_IDS.toxicity,
  burden: NAME_IDS.burden,
};
// The two-line headers of the OS columns.
export const OS_HEADER_IDS: Partial<Record<PgEndpoint, string>> = {
  os_6: "patient-pg-col-os-6",
  os_12: "patient-pg-col-os-12",
  os_36: "patient-pg-col-os-36",
  os_60: "patient-pg-col-os-60",
};
const DIM_IDS: Record<PgDimension, string> = {
  histology: "patient-pg-dim-histology",
  stage: "patient-pg-dim-stage",
  biomarkers: "patient-pg-dim-biomarkers",
  treatment_line: "patient-pg-dim-treatment-line",
  prior_treatment: "patient-pg-dim-prior-treatment",
  performance_status: "patient-pg-dim-performance-status",
  brain_metastases: "patient-pg-dim-brain-metastases",
  age: "patient-pg-dim-age",
};
const STATUS_IDS: Record<PgDimStatus, string> = {
  match: "patient-pg-status-match",
  mismatch: "patient-pg-status-mismatch",
  unknown: "patient-pg-status-unknown",
  partial: "patient-pg-status-partial",
};

export const nameText = (t: T, n: PgName | null) => (!n ? "" : "key" in n ? t(NAME_IDS[n.key]) : n.raw);
export const nameKeyText = (t: T, k: PgNameKey) => t(NAME_IDS[k]);
// A value with its unit as reported; months are named in the interface language, a text value has no unit.
export const valueText = (t: T, value: unknown, unit: unknown) => {
  const u = unit === "months" ? t("patient-pg-unit-months") : unit === "text" ? "" : unit ? String(unit) : "";
  return `${value}${u ? " " + u : ""}`;
};
// A known dimension key gets the catalog's name, any other key is shown as the server sends it.
export const dimKeyText = (t: T, key: string) => (isPgDimension(key) ? t(DIM_IDS[key]) : key);
export const dimName = (t: T, d: PgDim) => d.label || (d.key ? t(DIM_IDS[d.key]) : d.name);
// A status the server leaves out is "nezjištěno" (not established), never a guessed match.
export const dimStatus = (t: T, d: PgDim) => (isPgDimStatus(d.status) ? t(STATUS_IDS[d.status]) : d.status || t(STATUS_IDS.unknown));
// The entry of the reference list for one value: "arm, field: value unit".
export const whatText = (t: T, w: PgWhat) => {
  const name = nameText(t, w.name);
  return `${w.arm ? w.arm + ", " : ""}${name ? name + ": " : ""}${valueText(t, w.value, w.unit)}`;
};
// An error in the doctor's language: the server's message as sent, or the catalog's.
export const errText = (t: T, e: PgError | null) => (!e ? "" : (e.message_cs ?? t(e.message_id ?? "patient-pg-error-request-failed")));

// An error as the tab shows it: the server's Czech message as it is, or a catalog ID for the client's own errors.
export type PgError = { message_cs: string | null; message_id: string | null };
export type PgResult = PrognosisResult & { saved?: boolean; saved_data_changed?: boolean };

export type PgEntry = {
  profile: PrognosisProfile | null;
  profilePending: boolean;
  profileError: PgError | null;
  pending: boolean;
  result: PgResult | null;
  error: PgError | null;
  savedChecked: boolean;
  // The saved searches are being read from the server: the tab neither offers a search nor reports the missing
  // prognosis server yet.
  savedChecking: boolean;
  savedPending: boolean;
};

// A saved search is shown after this delay ("Načítání uložené rešerše…"), so the tab reads the same as a
// recorded search coming in; counted from the request, so a slow server adds no extra wait.
export const SAVED_DELAY_MS = 2000;

const asError = (e: unknown): PgError =>
  e instanceof ApiError ? { message_cs: e.message_cs, message_id: e.message_cs ? null : e.message_id } : { message_cs: null, message_id: "patient-pg-error-request-failed" };

export const pgKey = (file: string, day: string | null | undefined) => JSON.stringify([file, day || ""]);

type Case = { file: string; id: string; day: string | null | undefined };

export const usePrognosisStore = defineStore("prognosis", () => {
  const config = shallowRef<PrognosisConfig | null>(null);
  const configError = shallowRef<PgError | null>(null);
  const configPending = shallowRef(false);
  const entries = reactive(new Map<string, PgEntry>());
  // What the tab on screen numbered: the drawers open entry n of refs and panel i of panels.
  const refs = shallowRef<PgRef[]>([]);
  const panels = shallowRef<PgPanel[]>([]);

  const blank = (): PgEntry => ({ profile: null, profilePending: false, profileError: null, pending: false, result: null, error: null, savedChecked: false, savedChecking: false, savedPending: false });
  // Creates the entry; called by the actions, never while rendering.
  function entryOf(c: Case): PgEntry {
    const key = pgKey(c.file, c.day);
    if (!entries.has(key)) entries.set(key, blank());
    return entries.get(key)!;
  }
  // The entry for the screen: read only, so a render never writes to the store.
  const EMPTY = blank();
  const entryAt = (c: Case): PgEntry => entries.get(pgKey(c.file, c.day)) ?? EMPTY;

  // The saved search recorded for this patient and day, read once per entry. Without a day nothing can match, so the
  // server is not asked and no access is logged for a view that shows nothing.
  async function loadSaved(c: Case) {
    const state = entryOf(c);
    if (state.savedChecked || state.result) return;
    state.savedChecked = true;
    if (!c.day) return;
    const started = Date.now();
    state.savedChecking = true;
    let saved: SavedPrognosis | null = null;
    try {
      saved = findSaved((await useApi().prognosis(c.id)).saved, c.file, c.day);
    } catch {
      // No saved search to show now; the tab reports the state of the live search, and "Zkusit připojení znovu"
      // asks for the saved search again.
      state.savedChecked = false;
    }
    state.savedChecking = false;
    if (!saved) return;
    state.savedPending = true;
    await new Promise((r) => setTimeout(r, Math.max(0, SAVED_DELAY_MS - (Date.now() - started))));
    state.savedPending = false;
    // A search started meanwhile, or its result, wins over the recorded one.
    if (state.result || state.pending) return;
    // A copy, so marking it saved never changes the server's reply held elsewhere.
    const result = JSON.parse(JSON.stringify(saved.result)) as PgResult;
    result.saved = true;
    result.saved_data_changed = !!state.profile && factsDiffer(state.profile.facts, result.profile?.facts);
    state.result = result;
    state.profile = result.profile ?? null;
  }

  // Opening the tab: the saved search, the shared config once, and the profile for the day once (pgLoad()).
  function load(c: Case) {
    void loadSaved(c);
    if (!config.value && !configPending.value && !configError.value) {
      configPending.value = true;
      useApi()
        .prognosisConfig()
        .then((d) => (config.value = d))
        .catch((e) => (configError.value = asError(e)))
        .finally(() => (configPending.value = false));
    }
    const state = entryOf(c);
    if (!c.day || state.profile || state.profilePending || state.profileError) return;
    state.profilePending = true;
    useApi()
      .prognosisProfile({ patient_id: c.file, scheduled_date: c.day })
      .then((d) => {
        // A saved search keeps its own profile; a newer profile only marks it as resting on older facts.
        if (state.result?.saved) state.result.saved_data_changed = factsDiffer(d.profile?.facts, state.result.profile?.facts);
        else state.profile = d.profile ?? null;
      })
      .catch((e) => (state.profileError = asError(e)))
      .finally(() => (state.profilePending = false));
  }

  const canSearch = (c: Case) => {
    const state = entryAt(c);
    return !!c.day && !state.pending && !state.savedPending && !state.savedChecking && !!state.profile && state.profile.available !== false && !!config.value?.configured;
  };

  // One search request (pgSearch()); without refresh, a result already on screen is shown again instead.
  async function search(c: Case, refresh = false) {
    const state = entryOf(c);
    if (!canSearch(c)) return;
    if (!refresh && state.result) {
      state.error = null;
      return;
    }
    state.pending = true;
    state.error = null;
    try {
      const r = await useApi().prognosisSearch({ patient_id: c.file, scheduled_date: c.day!, refresh });
      state.result = r;
      if (r.profile) state.profile = r.profile;
    } catch (e) {
      state.error = asError(e);
    } finally {
      state.pending = false;
    }
  }

  // "Zkusit připojení znovu": forget the failed config and profile, so opening the tab asks again.
  function retry(c: Case) {
    configError.value = null;
    config.value = null;
    const state = entryOf(c);
    state.profileError = null;
    state.profile = null;
    load(c);
  }

  function setView(r: PgRef[], p: PgPanel[]) {
    refs.value = r;
    panels.value = p;
  }

  return { config, configError, configPending, entries, refs, panels, entryOf, entryAt, load, canSearch, search, retry, setView };
});
