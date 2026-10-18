<script setup lang="ts">
// The running MDT's session bar (screen S-4). While an MDT runs, the only thing that
// changes in the patient view is this bar: the day's cases in order, so the team moves between them without leaving
// the case they look at. A pill opens that case on the same tab; approved cases are ticked.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { dayAgenda } from "@codebridge/domain/calendar";
import { surnameFirst } from "@codebridge/domain/names";
import { nrOf } from "@codebridge/domain/case-data";
import { inSession, runningSession } from "@codebridge/domain/discussion";
import { usePatient } from "../../composables/usePatient";
import { useListText } from "../../composables/useListText";
import { useWorkflowStore } from "../../stores/workflow";
import { usePatientsStore } from "../../stores/patients";
import { useAttendanceStore } from "../../stores/attendance";
import { useDiscussionStore } from "../../stores/discussion";
import { useOverlayStore } from "../../stores/overlay";
import { useRecorderStore } from "../../stores/recorder";
import { useApi } from "../../lib/api";
import { caseWrite } from "../../lib/writes";
import { toast } from "../../lib/toast";
import { msgId } from "../../lib/msg";

const props = defineProps<{ tab: string }>();
const { $t } = useFluent();
const router = useRouter();
const c = usePatient();
const text = useListText();
const workflow = useWorkflowStore();
const patients = usePatientsStore();
const att = useAttendanceStore();
const disc = useDiscussionStore();
const overlay = useOverlayStore();
const rec = useRecorderStore();

const session = computed(() => runningSession(workflow.sessions));
const shown = computed(() => inSession(c.p.value, session.value));
const agenda = computed(() => (session.value ? dayAgenda(patients.rows, session.value.day) : []));
const at = computed(() => agenda.value.findIndex((a) => a.file === c.p.value.file));
const prev = computed(() => agenda.value[at.value - 1] ?? null);
const next = computed(() => agenda.value[at.value + 1] ?? null);
const present = computed(() => (session.value ? att.present(session.value.day).length : 0));
const lastName = (name: string) => name.split(" ").slice(-1)[0];

// Moving to a case from the bar opens its discussion card again (the doctor's earlier choice for it is dropped).
function go(file: string) {
  disc.clearChoice(file);
  void router.push({ name: "patient", params: { nr: nrOf(file), tab: props.tab } });
}
function attendance() {
  if (session.value) overlay.open({ kind: "start", day: session.value.day, from: null, attOnly: false });
}
// Ending the seminar stops the recording; audio of cases that were not approved is not kept for a speaker pass.
function end() {
  const day = session.value?.day;
  if (!day || !c.canSetStatus.value) return;
  void caseWrite($t, () => useApi().endSession(day), {
    busyKey: "session",
    onOk: () => {
      if (rec.on) rec.stop(msgId("discussion-session-rec-stopped"));
      rec.purge(
        patients.rows.map((r) => r.file),
        "session_end",
      );
      toast($t("discussion-session-ended"));
    },
  });
}

// The bar sticks under the top bar, whose height changes when it wraps on narrow screens (measureTop()).
function measureTop() {
  const t = document.querySelector<HTMLElement>(".top");
  if (t) document.documentElement.style.setProperty("--toph", `${t.offsetHeight}px`);
}
// The current case's pill is scrolled into the middle of the agenda, so it is visible on narrow screens.
const agendaEl = ref<HTMLElement | null>(null);
async function centerCurrent() {
  await nextTick();
  const ag = agendaEl.value;
  const cur = ag?.querySelector<HTMLElement>('[aria-current="true"]');
  if (ag && cur) ag.scrollLeft = cur.offsetLeft - ag.offsetLeft - (ag.clientWidth - cur.offsetWidth) / 2;
}
watch(() => [c.p.value.file, shown.value] as const, () => void centerCurrent());
onMounted(() => {
  measureTop();
  void centerCurrent();
  window.addEventListener("resize", measureTop);
});
onBeforeUnmount(() => window.removeEventListener("resize", measureTop));
</script>

<template>
  <div v-if="shown && session" class="sesbar" role="navigation" :aria-label="$t('discussion-session-label')">
    <span class="sestitle">{{ $t("discussion-session-title", { day: text.dayLabel(session.day) }) }}</span>
    <button class="btn small" :disabled="!prev" :aria-label="$t('discussion-session-prev')" @click="prev && go(prev.file)">‹</button>
    <div ref="agendaEl" class="agenda" :aria-label="$t('discussion-session-agenda')">
      <button
        v-for="a in agenda"
        :key="a.file"
        :aria-current="a.file === c.p.value.file ? 'true' : 'false'"
        :aria-label="$t(disc.isApproved(a.file) ? 'discussion-session-pill-approved' : 'discussion-session-pill', { time: a.slot!.time, name: surnameFirst(a), id: a.id })"
        @click="go(a.file)"
      >
        <span class="tm2">{{ a.slot!.time }}</span>{{ lastName(a.name) }}{{ disc.isApproved(a.file) ? " ✓" : "" }}
      </button>
    </div>
    <button class="btn small" :disabled="!next" :aria-label="$t('discussion-session-next')" @click="next && go(next.file)">›</button>
    <button class="btn small" @click="attendance">{{ $t("discussion-session-present", { n: present }) }}</button>
    <button class="btn small" @click="end">{{ $t("discussion-session-end") }}</button>
  </div>
</template>
