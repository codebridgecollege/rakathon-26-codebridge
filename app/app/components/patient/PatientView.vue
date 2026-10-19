<script setup lang="ts">
// One patient view for every case, driven by what its data holds. The header always
// renders from the list row, so the doctor sees whose case it is while the data loads or after it failed. While the
// data loads there are no tabs and no editable fields, so the one render when the data arrives cannot interrupt
// typing; the tab from the address is kept, so a deep link lands on its tab once the data is there.
import { computed, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { nrOf, tabsFor, type Tab } from "@codebridge/domain/case-data";
import { providePatient } from "../../composables/usePatient";
import { useTabAddress } from "../../composables/useTabAddress";
import { useCasesStore } from "../../stores/cases";
import { usePatientViewStore } from "../../stores/patientView";
import { usePatientsStore } from "../../stores/patients";
import { useOverlayStore } from "../../stores/overlay";
import PatientHeader from "./PatientHeader.vue";
import BriefBlock from "./BriefBlock.vue";
import OrphanList from "./OrphanList.vue";
import ConclusionBox from "./ConclusionBox.vue";
import TabOverview from "./TabOverview.vue";
import TabAnamnesis from "./TabAnamnesis.vue";
import TabDocuments from "./TabDocuments.vue";
import TabLabs from "./TabLabs.vue";
import TabAlerts from "./TabAlerts.vue";
import TabNext from "./TabNext.vue";
import TabDev from "./TabDev.vue";
import TabPrognosis from "./TabPrognosis.vue";
import AlertSignal from "./AlertSignal.vue";
import OverlayHost from "./OverlayHost.vue";
import SessionBar from "../discussion/SessionBar.vue";
import DiscussionCard from "../discussion/DiscussionCard.vue";

const props = defineProps<{ file: string; tab: string | null }>();
const { $t } = useFluent();
const router = useRouter();
const cases = useCasesStore();
const view = usePatientViewStore();
const patients = usePatientsStore();

const c = providePatient(
  computed(() => props.file),
  (id, args) => $t(id, args),
);

const TAB_ID: Record<Tab, string> = {
  overview: "patient-tab-overview",
  anamnesis: "patient-tab-anamnesis",
  documents: "patient-tab-documents",
  labs: "patient-tab-labs",
  alerts: "patient-tab-alerts",
  next: "patient-tab-next",
  dev: "patient-tab-dev",
  prognosis: "patient-tab-prognosis",
};
const state = computed(() => c.entry.value.state);
const tabs = computed(() => tabsFor(c.sec.value));
const current = computed<Tab>(() => (tabs.value.find((t) => t === props.tab) ?? tabs.value[0] ?? "prognosis") as Tab);

// The case on screen is never evicted from the cache, and its own timeline filter starts fresh.
view.enterCase(props.file);
cases.setOpen(props.file);
watch(
  // The guide entry is watched too: "Zkusit znovu" in the guideline panel drops it, and this loads it again.
  () => [props.file, state.value, c.entry.value.guide] as const,
  () => {
    const p = patients.byFile(props.file);
    if (!p) return;
    if (state.value === "absent") void cases.ensureCase(p);
    if (state.value === "ready" && c.sec.value.guidance) void cases.ensureGuidance(p);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (cases.openFile === props.file) cases.setOpen(null);
});

// Once the data is there, the address names the tab actually shown (a missing or unavailable tab falls back to the
// first one), so the address stays in step with the view; a click away made meanwhile wins.
useTabAddress(() => ({ nr: nrOf(props.file), ready: state.value === "ready", shown: current.value, asked: props.tab }));

function openTab(t: Tab) {
  void router.push({ name: "patient", params: { nr: nrOf(props.file), tab: t } });
}
function backToList() {
  void router.push("/patients");
}
// A doctor outside the case's team may open it with a stated reason (break-the-glass) instead of being sent back.
function openBreakGlass() {
  useOverlayStore().open({ kind: "breakglass", file: props.file, msg: c.entry.value.error?.message_cs ?? "" });
}
function retry() {
  const p = patients.byFile(props.file);
  if (p) void cases.retry(p);
}
</script>

<template>
  <div class="page">
    <SessionBar :tab="tab || current" />
    <div class="row"><button class="linkbtn" @click="backToList">{{ $t("patient-back") }}</button></div>
    <template v-if="state === 'absent' || state === 'loading'">
      <PatientHeader :with-report="false" />
      <section class="card"><p class="muted" role="status">{{ $t("patient-loading") }}</p></section>
    </template>
    <template v-else-if="state === 'error'">
      <PatientHeader with-question />
      <section class="card blk">
        <div class="head" style="margin:0"><h2>{{ $t("patient-brief-title") }}</h2><span class="row"><AlertSignal /></span></div>
        <div class="question missing" role="alert"><b>{{ $t("patient-load-failed") }}</b> {{ c.entry.value.error?.message_cs ?? (c.entry.value.error?.message_id ? $t(c.entry.value.error.message_id) : "") }}</div>
        <p>
          <template v-if="c.entry.value.error?.code === 'not_member' && c.isDoctor.value"><button class="btn primary" @click="openBreakGlass">{{ $t("patient-bg-title") }}</button>{{ " " }}</template>
          <button class="btn" @click="retry">{{ $t("patient-retry") }}</button>
        </p>
        <p class="prose" lang="cs">{{ c.p.value.summary || "" }}</p>
        <ConclusionBox />
        <DiscussionCard />
      </section>
      <div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="true">{{ $t("patient-tab-prognosis") }}</button></div>
      <TabPrognosis />
    </template>
    <template v-else>
      <PatientHeader :with-question="!c.sec.value.brief" />
      <BriefBlock />
      <OrphanList />
      <div class="tabs" role="tablist">
        <button v-for="t in tabs" :key="t" class="tab" role="tab" :aria-selected="current === t" @click="openTab(t)">{{ $t(TAB_ID[t]) }}</button>
      </div>
      <TabOverview v-if="current === 'overview'" />
      <TabAnamnesis v-else-if="current === 'anamnesis'" />
      <TabDocuments v-else-if="current === 'documents'" />
      <TabLabs v-else-if="current === 'labs'" />
      <TabAlerts v-else-if="current === 'alerts'" />
      <TabNext v-else-if="current === 'next'" />
      <TabDev v-else-if="current === 'dev'" />
      <TabPrognosis v-else />
    </template>
    <OverlayHost />
  </div>
</template>
