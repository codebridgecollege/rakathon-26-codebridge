<script setup lang="ts">
// The card of a booked patient next to the calendar (the minicard in viewCalendar()). It shows the extracted
// diagnosis and brief only when the case is already loaded: opening the card is not opening the case, so it never
// starts a load and never writes a server access-log row. role="dialog" names it for screen readers (the old page's
// card had no role; e2e/README.md lists the gap).
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { PatientRow } from "@codebridge/api-client";
import { ageOf } from "@codebridge/domain/patient-list";
import { surnameFirst } from "@codebridge/domain/names";
import { DEMO_TODAY } from "@codebridge/domain/calendar";
import { STATUS_CLASS, caseStateOf, isSlotLocked } from "../../lib/lists";
import { briefOf, dxLine, questionOf } from "../../lib/case-brief";
import { useListText } from "../../composables/useListText";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useWorkflowStore } from "../../stores/workflow";
import { useCasesStore } from "../../stores/cases";

const props = defineProps<{ patient: PatientRow }>();
const emit = defineEmits<{ open: []; pick: []; unschedule: []; close: [] }>();
const { $t } = useFluent();
const text = useListText();
const me = useCurrentUser();
const workflow = useWorkflowStore();
const cases = useCasesStore();

const p = computed(() => props.patient);
const cs = computed(() => caseStateOf(workflow.cases, p.value));
const cd = computed(() => cases.readyData(p.value.file));
const name = computed(() => surnameFirst(p.value));
const age = computed(() => ageOf(p.value, DEMO_TODAY));
const locked = computed(() => isSlotLocked(workflow.cases, p.value));
const dx = computed(() => dxLine(p.value, cs.value, cd.value));
const question = computed(() => questionOf(p.value, cs.value));
const brief = computed(() => briefOf(cs.value, cd.value));
const dxText = computed(() =>
  [
    dx.value.text,
    dx.value.edited ? $t("calendar-card-edited-suffix") : "",
    dx.value.context ? $t("calendar-card-dx-context", { context: dx.value.context }) : "",
    dx.value.verify ? $t("calendar-card-verify-suffix") : "",
  ].join(""),
);
const briefText = computed(() => (brief.value ? $t("calendar-card-brief", { text: brief.value.text.slice(0, 260) }) + (brief.value.edited ? $t("calendar-card-edited-suffix") : "") : (p.value.summary ?? "")));
</script>

<template>
  <div id="minicard" class="minicard" role="dialog" :aria-label="name">
    <div class="row spread"><span class="label">{{ $t("calendar-card-patient") }}</span><span class="chip" :class="STATUS_CLASS[p.status]">{{ text.statusLabel(p.status) }}</span></div>
    <h2>{{ name }}</h2>
    <div class="facts" style="margin:0">
      <span>{{ $t("calendar-card-rc") }} <b>{{ p.rc || "-" }}</b></span>
      <span v-if="age">{{ $t("calendar-card-age") }} <b>{{ age.n }}</b></span>
      <span>{{ $t("calendar-card-slot") }} <b>{{ text.slotText(p.slot) }}</b></span>
      <span>{{ $t("calendar-card-owner") }} <b>{{ p.owner }}</b></span>
    </div>
    <div><span class="label">{{ $t("calendar-card-diagnosis") }}</span><p style="margin:2px 0 0;font-weight:700">{{ dxText }}</p></div>
    <div class="question" :class="{ missing: !question }" style="padding:8px 12px">
      <span class="label">{{ $t("calendar-card-question") }}</span>
      <p style="font-size:14px">
        <span v-if="me.isDoctor.value" class="edl"><b v-if="!question">{{ $t("calendar-card-question-missing") }}</b><template v-else>{{ question }}</template></span>
        <template v-else><b v-if="!question">{{ $t("calendar-card-question-missing") }}</b><template v-else>{{ question }}</template></template>
      </p>
    </div>
    <p class="small" style="margin:0">{{ briefText }}</p>
    <div class="row" style="gap:6px">
      <button class="btn primary" @click="emit('open')">{{ $t("calendar-card-open") }}</button>
      <button v-if="locked" class="btn" disabled :title="$t('calendar-lock-why')">{{ $t("calendar-card-unschedule") }}</button>
      <template v-else>
        <button class="btn" @click="emit('pick')">{{ $t("calendar-card-move") }}</button>
        <button class="btn" @click="emit('unschedule')">{{ $t("calendar-card-unschedule") }}</button>
      </template>
      <button class="btn" :aria-label="$t('calendar-card-close')" style="margin-left:auto" @click="emit('close')">✕</button>
    </div>
    <p v-if="locked" class="muted small lockwhy" style="margin:0">{{ $t("calendar-lock-why") }}</p>
  </div>
</template>
