<script setup lang="ts">
// The case header. It renders from the list row, so the doctor
// sees whose case it is while the data loads or after it failed. A missing birth number or age is a gap dash, never a
// guess; a real identity doubt is shown, never merged away silently.
import { computed, ref } from "vue";
import { ApiError } from "@codebridge/api-client";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";
import { useOverlayStore } from "../../stores/overlay";
import { useWorkflowStore } from "../../stores/workflow";
import { useListViewStore } from "../../stores/listView";
import { useSessionStore } from "../../stores/session";
import { useStaffStore } from "../../stores/staff";
import { useCasesStore } from "../../stores/cases";
import { useApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useCurrentUser } from "../../composables/useCurrentUser";
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

// The calendar opens with this case picked for booking.
function schedule() {
  useListViewStore().schedPick = p.value.file;
  void router.push("/calendar");
}
// The lists' start dialog (order and attendance); the overlay host draws it.
function startMdt() {
  if (p.value.slot) overlay.open({ kind: "start", day: p.value.slot.day, from: p.value.file, attOnly: false });
}
// "Import z NIS" only where the org has a NIS configured (/api/me), and for the roles that may search it; elsewhere
// the button does not exist, so the demo shows nothing that cannot work.
const session = useSessionStore();
const { showsSyntheticTag } = useCurrentUser();
const staffStore = useStaffStore();
const teams = computed(() => staffStore.directory?.teams ?? []);
const teamBusy = ref(false);
// Erasing cannot be undone, so the person types the word; the server checks it again. The list goes first, because the
// patient view reads this row until it closes.
async function erase() {
  if (window.prompt($t("patient-erase-prompt", { name: surnameFirst(c.p.value) })) !== "SMAZAT") return;
  const id = c.p.value.id;
  try {
    const r = await useApi().eraseCase(id, "SMAZAT");
    toast($t(r.data?.files_left ? "patient-erased-files-left" : "patient-erased"));
    await router.push("/patients");
    useCasesStore().reset();
    // The erasure is done; a list that fails to reload is not a failed erasure, and the next load corrects it.
    await session.loadFromApi().catch(() => {});
    return;
  } catch (e) {
    toast(e instanceof ApiError && e.message_cs ? e.message_cs : $t("patient-erase-failed"));
  }
}
// Moving a case into a team closes it to the departments, so the list and this view read from the server again.
async function setTeam(ev: Event) {
  const sel = ev.target as HTMLSelectElement;
  if (!sel.value) return;
  // It closes the case to the departments and cannot be undone here, so a slip of the mouse must not do it.
  if (!window.confirm($t("patient-header-team-confirm", { name: sel.selectedOptions[0]?.text ?? "" }))) {
    sel.value = c.p.value.teamId ?? "";
    return;
  }
  teamBusy.value = true;
  try {
    await useApi().setCaseTeam(c.p.value.id, sel.value);
    await session.loadFromApi();
    toast($t("patient-header-team-set"));
  } catch (e) {
    sel.value = c.p.value.teamId ?? "";
    toast(e instanceof ApiError && e.message_cs ? e.message_cs : $t("patient-header-team-failed"));
  } finally {
    teamBusy.value = false;
  }
}
const canNis = computed(() => !!session.me?.nis && (session.me.user.role === "doctor" || session.me.user.role === "coordinator"));
function nis() {
  overlay.open({ kind: "nis", caseId: p.value.id });
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
          <span v-if="p.synthetic && showsSyntheticTag" class="chip plain k-unclear syntag" :title="$t('patient-synthetic-tooltip')">{{ $t("patient-synthetic") }}</span>
        </div>
        <h1 style="margin-top:4px"><span lang="cs">{{ surnameFirst(p) }}</span><span class="idp">{{ $t("patient-header-rc") }} <span v-if="p.rc" lang="cs">{{ p.rc }}</span><Gap v-else /></span><span class="idp">{{ $t("patient-header-age") }} <span v-if="age">{{ age }}</span><Gap v-else /></span></h1>
        <div v-if="p.warn" class="question missing" style="margin:8px 0 0;padding:6px 10px"><b>{{ $t("patient-header-verify-identity") }}</b> <span lang="cs">{{ p.warn }}</span></div>
        <div v-if="p.nameNote" class="muted small namenote">{{ $t("patient-header-name-note") }} <span lang="cs">{{ p.nameNote.text }}</span> <SrcLinks v-if="p.nameNote.src" :refs="[p.nameNote.src as never]" /></div>
        <div class="facts">
          <label v-if="teams.length" class="teamfact">{{ $t("patient-header-team") }}
            <select :value="p.teamId ?? ''" :disabled="teamBusy" @change="setTeam">
              <option v-if="!p.teamId" value="">{{ $t("patient-header-team-none") }}</option>
              <option v-for="t in teams" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
          <span>{{ $t("patient-header-owner") }} <b lang="cs">{{ p.owner }}</b></span><span>{{ $t("patient-header-dept") }} <b><span v-if="p.dept" lang="cs">{{ p.dept }}</span><Gap v-else /></b></span><span>{{ $t("patient-header-next-mdt") }} <b>{{ slotText($t, p.slot) }}</b></span>
        </div>
      </div>
      <div class="row">
        <button class="btn" @click="schedule">{{ p.slot ? $t("patient-action-reschedule") : $t("patient-action-schedule") }}</button>
        <button v-if="p.slot && !live" class="btn" @click="startMdt">{{ $t("patient-action-start-mdt") }}</button>
        <button v-if="canNis" class="btn" @click="nis">{{ $t("patient-action-nis") }}</button>
        <button v-if="c.cd.value?.record?.sections" class="btn" @click="openFhirExport(c, $t)">{{ $t("patient-action-fhir") }}</button>
        <button v-if="props.withReport" class="btn primary" @click="report">{{ $t("patient-action-report") }}</button>
        <button class="btn" @click="erase">{{ $t("patient-erase") }}</button>
      </div>
    </div>
    <QuestionBox v-if="props.withQuestion" />
  </div>
</template>
