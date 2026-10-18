<script setup lang="ts">
// The Prognóza tab (tabPrognosis() in mocks/src/prognosis.js): outcomes of study populations similar to the patient,
// as of the scheduled MDT day, from the search the server recorded or a new search on the local prognosis server.
// The values describe study groups; the doctor judges the individual prognosis, so the tab shows sources, model
// attribution and missing values as missing, and computes nothing itself.
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { pgLayout, PG_ENDPOINTS, type PgRow } from "@codebridge/domain/prognosis";
import { usePatient } from "../../composables/usePatient";
import { useApi } from "../../lib/api";
import { fmtDate } from "../../lib/dates";
import { useOverlayStore } from "../../stores/overlay";
import { useListViewStore } from "../../stores/listView";
import { ENDPOINT_IDS, errText, OS_HEADER_IDS, usePrognosisStore } from "../../stores/prognosis";
import PgStudyRow from "./PgStudyRow.vue";

const { $t } = useFluent();
const { p } = usePatient();
const pg = usePrognosisStore();
const overlay = useOverlayStore();
const router = useRouter();

const c = computed(() => ({ file: p.value.file, id: p.value.id, day: p.value.slot?.day }));
// Each patient and day has its own entry; a new day asks for its own saved search and profile.
watch(
  () => [c.value.file, c.value.id, c.value.day],
  () => pg.load(c.value),
  { immediate: true },
);

const state = computed(() => pg.entryAt(c.value));
const result = computed(() => state.value.result);
const config = computed(() => pg.config);
const day = computed(() => c.value.day);
const models = computed(() => result.value?.models || config.value?.models || []);
const rows = computed(() => (result.value?.rows || []) as PgRow[]);
const canSearch = computed(() => pg.canSearch(c.value));
// The reference numbers and panels come from the rows in reading order; the drawers read the same lists.
const layout = computed(() => pgLayout(rows.value));
watch(
  layout,
  (l, old) => {
    // An open source list or panel points into the old numbering; new rows would put another passage under it.
    if (old && (overlay.current?.kind === "pgrefs" || overlay.current?.kind === "pgpanel")) overlay.close();
    pg.setView(l.refs, l.panels);
  },
  { immediate: true },
);

const connError = computed(() => errText($t, pg.configError || state.value.profileError));
// The missing prognosis server is not reported while a saved search is on its way or shown: it is then expected.
const showConnError = computed(() => !!connError.value && !result.value?.saved && !state.value.savedPending && !state.value.savedChecking);
const searchLabel = computed(() =>
  state.value.savedPending
    ? $t("patient-pg-loading-saved")
    : state.value.pending
      ? $t("patient-pg-search-pending")
      : result.value
        ? $t("patient-pg-show-saved")
        : $t("patient-pg-search"),
);
// "Nalezeno 6 populací / ramen · <time of the search> · uložená rešerše"; the time is shown as the server sends it.
const foundText = computed(() => {
  const r = result.value;
  if (!r) return "";
  const how = r.saved ? $t("patient-pg-found-saved") : r.cache_hit ? $t("patient-pg-found-cached") : "";
  return `${$t("patient-pg-found", { n: r.rows?.length || 0 })}${r.searched_at || ""}${how}`;
});
const emptyText = computed(() =>
  state.value.savedPending
    ? $t("patient-pg-loading-saved")
    : state.value.pending
      ? $t("patient-pg-empty-pending")
      : result.value
        ? $t("patient-pg-empty-no-rows")
        : $t("patient-pg-empty-start"),
);
const facts = computed(() => (state.value.profile?.facts || []) as (string | { text?: string; text_cs?: string; date?: string; source?: unknown })[]);
const factText = (f: (typeof facts.value)[number]) => (typeof f === "string" ? f : f?.text || f?.text_cs || "");
const factSource = (f: (typeof facts.value)[number]) => {
  if (typeof f === "string" || !f?.source) return "";
  return typeof f.source === "string" ? f.source : JSON.stringify(f.source);
};
const footWarnings = computed(() => [...(result.value?.warnings || []), ...models.value.flatMap((m) => m.warnings || [])]);

function openRef(n: number) {
  overlay.open({ kind: "pgrefs", hit: n });
  // A view the server cannot see: the code and the case only, never the study or the value.
  void useApi()
    .auditEvent({ code: "prognosis_sources_opened", case_id: p.value.id })
    .catch(() => {});
}
function openPanel(i: number) {
  overlay.open({ kind: "pgpanel", panel: i });
  void useApi()
    .auditEvent({ code: "prognosis_source_opened", case_id: p.value.id })
    .catch(() => {});
}
function schedule() {
  // The calendar opens with this case picked for booking (S.schedPick in the template).
  useListViewStore().schedPick = p.value.file;
  void router.push("/calendar");
}
</script>

<template>
  <section class="card" aria-labelledby="pg-title">
    <div class="head">
      <div>
        <h2 id="pg-title">{{ $t("patient-pg-title") }}</h2>
        <div class="muted small">{{ $t("patient-pg-subtitle") }}</div>
      </div>
      <span v-if="day" class="chip plain">{{ $t("patient-pg-as-of", { date: fmtDate($t, day) }) }}</span>
    </div>
    <p>{{ $t("patient-pg-intro") }}</p>
    <template v-if="!day">
      <p class="pg-warning">{{ $t("patient-pg-no-slot") }}</p>
      <button class="btn" @click="schedule">{{ $t("patient-pg-schedule") }}</button>
    </template>
    <div v-if="pg.configPending || state.profilePending" class="muted small" role="status">{{ $t("patient-pg-loading-profile") }}</div>
    <div v-if="showConnError" role="alert">
      <p class="pg-warning">{{ connError }}</p>
      <button class="btn small" @click="pg.retry(c)">{{ $t("patient-pg-retry") }}</button>
    </div>
    <p v-if="config && !config.configured" class="pg-warning">
      <span v-if="config.error" lang="cs">{{ config.error }}</span><template v-else>{{ $t("patient-pg-not-configured") }}</template>
    </p>
    <p v-if="state.profile?.available === false" class="pg-warning">
      <span v-if="state.profile.reason" lang="cs">{{ state.profile.reason }}</span><template v-else>{{ $t("patient-pg-profile-unavailable") }}</template>
    </p>
    <details v-if="state.profile" class="pg-profile">
      <summary>{{ $t("patient-pg-profile-summary", { n: facts.length }) }}</summary>
      <p class="muted small">{{ $t("patient-pg-profile-note") }}</p>
      <ul>
        <li v-for="(f, i) in facts" :key="i"><span lang="cs">{{ factText(f) }}</span> <span class="muted small" lang="cs">{{ (typeof f === "string" ? "" : f?.date) || "" }}<template v-if="factSource(f)"> · {{ factSource(f) }}</template></span></li>
      </ul>
      <p v-for="(w, i) in state.profile.warnings || []" :key="i" class="pg-warning small" lang="cs">{{ w }}</p>
    </details>

    <div class="pg-controls">
      <button class="btn primary" :disabled="!canSearch" @click="pg.search(c)">{{ searchLabel }}</button><button v-if="result" class="btn" :disabled="!canSearch" @click="pg.search(c, true)">{{ $t("patient-pg-refresh") }}</button><span class="muted small">{{ $t("patient-pg-abbreviations") }}</span>
    </div>
    <div v-if="state.savedPending" class="pg-busy" role="status">{{ $t("patient-pg-loading-saved") }}</div>
    <div v-if="state.pending" class="pg-busy" role="status">{{ $t("patient-pg-busy") }}</div>
    <p v-if="state.error" class="pg-warning" role="alert">{{ errText($t, state.error) }}</p>
    <p v-if="result?.saved_data_changed" class="pg-warning">{{ $t("patient-pg-saved-stale") }}</p>
    <div v-if="result" class="muted small" role="status">{{ foundText }}</div>
    <div class="scroll" tabindex="0" role="region" :aria-label="$t('patient-pg-table-label')">
      <table class="tbl pg-table">
        <colgroup>
          <col class="pg-col-study" />
          <col class="pg-col-population" />
          <col class="pg-col-similarity" />
          <col class="pg-col-os" span="4" />
          <col class="pg-col-pfs" />
          <col class="pg-col-response" />
          <col class="pg-col-toxicity" />
          <col class="pg-col-burden" />
          <col class="pg-col-model" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{{ $t("patient-pg-col-study") }}</th>
            <th scope="col">{{ $t("patient-pg-col-population") }}</th>
            <th scope="col">{{ $t("patient-pg-col-similarity") }}</th>
            <th v-for="k in PG_ENDPOINTS" :key="k" scope="col" :aria-label="$t(ENDPOINT_IDS[k])">
              <template v-if="OS_HEADER_IDS[k]">{{ $t(OS_HEADER_IDS[k]!) }}<br />{{ $t("patient-pg-col-os") }}</template><template v-else>{{ $t(ENDPOINT_IDS[k]) }}</template>
            </th>
            <th scope="col">{{ $t("patient-pg-col-model") }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-if="rows.length">
            <PgStudyRow v-for="(row, i) in rows" :key="i" :row="row" :layout="layout.rows[i]!" :models="models" @ref="openRef" @panel="openPanel" />
          </template>
          <tr v-else>
            <td colspan="12" class="pg-empty">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-for="(m, i) in models.filter((x) => x.error)" :key="i" class="pg-warning" role="alert" lang="cs">{{ m.error }}</p>
    <aside class="pg-footnotes" :aria-label="$t('patient-pg-footnotes-label')">
      <p v-for="(w, i) in footWarnings" :key="i" lang="cs">{{ w }}</p>
      <p>{{ $t("patient-pg-footnote") }}</p>
    </aside>
  </section>
</template>
