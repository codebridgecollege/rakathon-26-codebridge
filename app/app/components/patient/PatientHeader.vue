<script setup lang="ts">
// The case header (patientHeader() and headerActions() in the template). It renders from the list row, so the doctor
// sees whose case it is while the data loads or after it failed. A missing birth number or age is a gap dash, never a
// guess; a real identity doubt is shown, never merged away silently.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";
import { useOverlayStore } from "../../stores/overlay";
import { useWorkflowStore } from "../../stores/workflow";
import { useListViewStore } from "../../stores/listView";
import { slotText } from "../../lib/dates";
import { ageNum, surnameFirst } from "../../lib/patientRow";
import { openFhirExport } from "../../lib/fhirExport";
import Gap from "./Gap.vue";
import SrcLinks from "./SrcLinks.vue";
import StatusMenu from "./StatusMenu.vue";
import QuestionBox from "./QuestionBox.vue";

// withReport: the report waits while the case data loads; withQuestion: a case without a brief shows its MDT question
// here instead of under the brief.
const props = withDefaults(defineProps<{ withReport?: boolean; withQuestion?: boolean }>(), { withReport: true, withQuestion: false });
const { $t } = useFluent();
const c = usePatient();
const router = useRouter();
const overlay = useOverlayStore();
const workflow = useWorkflowStore();

const p = computed(() => c.p.value);
const age = computed(() => ageNum(p.value));
// The running MDT is the session that has not ended; a case on its day shows no "Zahájit MDT".
const live = computed(() => {
  const open = workflow.sessions.filter((s) => !s.ended_at).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))).at(-1);
  return !!(open && p.value.slot && open.day === p.value.slot.day);
});

// The calendar opens with this case picked for booking (S.schedPick in the template).
function schedule() {
  useListViewStore().schedPick = p.value.file;
  void router.push("/calendar");
}
// The lists' start dialog (order and attendance); the overlay host draws it.
function startMdt() {
  if (p.value.slot) overlay.open({ kind: "start", day: p.value.slot.day, from: p.value.file, attOnly: false });
}
// The report dialog and its PDF (components/discussion/ReportDialog.vue).
function report() {
  overlay.open({ kind: "report", file: c.p.value.file });
}
</script>

<template>
  <div class="card patient-identity">
    <div class="phead">
      <div>
        <div class="row">
          <span class="label">{{ p.id }}</span>
          <StatusMenu />
          <span v-if="p.synthetic" class="chip plain k-unclear syntag" :title="$t('patient-synthetic-tooltip')">{{ $t("patient-synthetic") }}</span>
        </div>
        <h1 style="margin-top:4px"><span lang="cs">{{ surnameFirst(p) }}</span><span class="idp">{{ $t("patient-header-rc") }} <span v-if="p.rc" lang="cs">{{ p.rc }}</span><Gap v-else /></span><span class="idp">{{ $t("patient-header-age") }} <span v-if="age">{{ age }}</span><Gap v-else /></span></h1>
        <div v-if="p.warn" class="question missing" style="margin:8px 0 0;padding:6px 10px"><b>{{ $t("patient-header-verify-identity") }}</b> <span lang="cs">{{ p.warn }}</span></div>
        <div v-if="p.nameNote" class="muted small namenote">{{ $t("patient-header-name-note") }} <span lang="cs">{{ p.nameNote.text }}</span> <SrcLinks v-if="p.nameNote.src" :refs="[p.nameNote.src as never]" /></div>
        <div class="facts">
          <span>{{ $t("patient-header-owner") }} <b lang="cs">{{ p.owner }}</b></span><span>{{ $t("patient-header-dept") }} <b><span v-if="p.dept" lang="cs">{{ p.dept }}</span><Gap v-else /></b></span><span>{{ $t("patient-header-next-mdt") }} <b>{{ slotText($t, p.slot) }}</b></span>
        </div>
      </div>
      <div class="row">
        <button class="btn" @click="schedule">{{ p.slot ? $t("patient-action-reschedule") : $t("patient-action-schedule") }}</button>
        <button v-if="p.slot && !live" class="btn" @click="startMdt">{{ $t("patient-action-start-mdt") }}</button>
        <button v-if="c.cd.value?.record?.sections" class="btn" @click="openFhirExport(c, $t)">{{ $t("patient-action-fhir") }}</button>
        <button v-if="props.withReport" class="btn primary" @click="report">{{ $t("patient-action-report") }}</button>
      </div>
    </div>
    <QuestionBox v-if="props.withQuestion" />
  </div>
</template>
