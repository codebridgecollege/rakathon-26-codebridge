<script setup lang="ts">
// "Zahájit MDT" from the calendar (the "start" overlay in the old page): the day's order of cases and who is present.
// While that day's session already runs, the same dialog only edits attendance ("Přítomní").
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { dayAgenda } from "@codebridge/domain/calendar";
import { surnameFirst } from "@codebridge/domain/patient-list";
import { useApi } from "../../lib/api";
import { caseRoute } from "../../lib/lists";
import { toast } from "../../lib/toast";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { useWrite } from "../../composables/useWrite";
import { useAttendanceStore } from "../../stores/attendance";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import AttendanceGrid from "./AttendanceGrid.vue";

const props = defineProps<{ day: string }>();
const emit = defineEmits<{ close: [] }>();
const { $t } = useFluent();
const router = useRouter();
const me = useCurrentUser();
const text = useListText();
const { run } = useWrite();
const patients = usePatientsStore();
const workflow = useWorkflowStore();
const att = useAttendanceStore();

const agenda = computed(() => dayAgenda(patients.rows, props.day));
// The running seminar is the session that has not ended (applySessions() in the old page).
const running = computed(() => workflow.sessions.filter((s) => !s.ended_at).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))).at(-1) ?? null);
const editOnly = computed(() => running.value?.day === props.day);
const label = computed(() => (editOnly.value ? $t("start-mdt-dialog-attendance") : $t("start-mdt-dialog-start")));
const n = computed(() => att.present(props.day).length);

async function start() {
  if (!me.canRunCases.value) {
    toast($t("start-mdt-refused"));
    return;
  }
  const first = agenda.value[0];
  await run(() => useApi().startSession({ day: props.day }), {
    busy: "session",
    onOk: () => {
      emit("close");
      // The session opens on the first case of the day; opening it is an access the case view records.
      if (first) void router.push(caseRoute(first.file));
    },
  });
}

// Focus moves into the dialog and back to what opened it; Escape closes it.
const box = ref<HTMLElement | null>(null);
const opener = document.activeElement as HTMLElement | null;
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(async () => {
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  opener?.focus?.();
});
</script>

<template>
  <Teleport defer to="#overlay">
    <div class="scrim" @click="emit('close')" />
    <div ref="box" class="modal" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1">
      <div class="row spread"><h2>{{ editOnly ? $t("start-mdt-heading-attendance", { day: text.dayLabel(day) }) : $t("start-mdt-heading-start", { day: text.dayLabel(day) }) }}</h2><button class="btn small" @click="emit('close')">{{ $t("lists-dialog-close") }}</button></div>
      <div v-if="!editOnly">
        <span class="label">{{ $t("start-mdt-order", { n: agenda.length }) }}</span>
        <ol style="margin:4px 0 0;padding-left:20px"><li v-for="a in agenda" :key="a.file">{{ a.slot!.time }} {{ surnameFirst(a) }}</li></ol>
      </div>
      <div>
        <span class="label">{{ $t("start-mdt-present", { n }) }}</span>
        <AttendanceGrid :day="day" />
        <p class="muted small" style="margin:6px 0 0">{{ $t("start-mdt-applies-day") }}</p>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button v-if="editOnly" class="btn primary" @click="emit('close')">{{ $t("start-mdt-done") }}</button>
        <button v-else class="btn primary" :disabled="!agenda.length" @click="start">{{ $t("start-mdt-go") }}</button>
      </div>
    </div>
  </Teleport>
</template>
