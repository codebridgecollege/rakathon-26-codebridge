<script setup lang="ts">
// "Zahájit MDT" from the calendar or a case header: the day's order of cases and
// who is present. While that day's session already runs, when opened from the discussion card ("Upravit"), or for a
// case without a slot (key "case:<id>"), the same dialog only edits attendance ("Přítomní").
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { dayAgenda, isIsoDayShape } from "@codebridge/domain/calendar";
import { surnameFirst } from "@codebridge/domain/names";
import { useApi } from "../../lib/api";
import { caseRoute } from "../../lib/lists";
import { toast } from "../../lib/toast";
import { useDialogFocus } from "../../lib/dialog";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { useWrite } from "../../composables/useWrite";
import { useAttendanceStore } from "../../stores/attendance";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import { useDiscussionStore } from "../../stores/discussion";
import AttendanceGrid from "./AttendanceGrid.vue";

// day: a seminar day, or "case:<id>" for a case without a slot. from: the case it was opened from, where the session
// starts; attOnly: opened to edit attendance only.
const props = withDefaults(defineProps<{ day: string; from?: string | null; attOnly?: boolean }>(), { from: null, attOnly: false });
const emit = defineEmits<{ close: [] }>();
const { $t } = useFluent();
const router = useRouter();
const me = useCurrentUser();
const text = useListText();
const { run } = useWrite();
const patients = usePatientsStore();
const workflow = useWorkflowStore();
const att = useAttendanceStore();

const isDay = computed(() => isIsoDayShape(props.day));
const agenda = computed(() => (isDay.value ? dayAgenda(patients.rows, props.day) : []));
// The running seminar is the session that has not ended.
const running = computed(() => workflow.sessions.filter((s) => !s.ended_at).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))).at(-1) ?? null);
const editOnly = computed(() => props.attOnly || !isDay.value || running.value?.day === props.day);
const when = computed(() => (isDay.value ? text.dayLabel(props.day) : $t("discussion-attendance-no-slot")));
const label = computed(() => (editOnly.value ? $t("start-mdt-dialog-attendance") : $t("start-mdt-dialog-start")));
const n = computed(() => att.present(props.day).length);

async function start() {
  if (!me.canRunCases.value) {
    toast($t("start-mdt-refused"));
    return;
  }
  // Started from a case header, the session opens on that case; from the calendar, on the first case of the day.
  const first = agenda.value.find((a) => a.file === props.from) ?? agenda.value[0];
  await run(() => useApi().startSession({ day: props.day }), {
    busy: "session",
    onOk: () => {
      emit("close");
      // Opening the case is an access the case view records.
      if (first) {
        useDiscussionStore().clearChoice(first.file);
        void router.push(caseRoute(first.file));
      }
    },
  });
}

// Focus moves into the dialog and back to what opened it; Escape closes it.
const box = ref<HTMLElement | null>(null);
const opener = document.activeElement as HTMLElement | null;
// Tab and Shift+Tab stay inside the dialog (the app's shared dialog focus handling).
const { onKeydown: keepTabInside } = useDialogFocus(box, ref(true));
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
    <div ref="box" class="modal" role="dialog" aria-modal="true" @keydown="keepTabInside" :aria-label="label" tabindex="-1">
      <div class="row spread"><h2>{{ editOnly ? $t("start-mdt-heading-attendance", { day: when }) : $t("start-mdt-heading-start", { day: when }) }}</h2><button class="btn small" @click="emit('close')">{{ $t("lists-dialog-close") }}</button></div>
      <div v-if="!editOnly">
        <span class="label">{{ $t("start-mdt-order", { n: agenda.length }) }}</span>
        <ol style="margin:4px 0 0;padding-left:20px"><li v-for="a in agenda" :key="a.file">{{ a.slot!.time }} {{ surnameFirst(a) }}</li></ol>
      </div>
      <div>
        <span class="label">{{ $t("start-mdt-present", { n }) }}</span>
        <AttendanceGrid :day="day" />
        <p class="muted small" style="margin:6px 0 0">{{ isDay ? $t("start-mdt-applies-day") : $t("discussion-attendance-case-only") }}</p>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button v-if="editOnly" class="btn primary" @click="emit('close')">{{ $t("start-mdt-done") }}</button>
        <button v-else class="btn primary" :disabled="!agenda.length" @click="start">{{ $t("start-mdt-go") }}</button>
      </div>
    </div>
  </Teleport>
</template>
