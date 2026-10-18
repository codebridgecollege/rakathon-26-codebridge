<script setup lang="ts">
// Screen S-2, Kalendář MDT (viewCalendar() in the old page): a week of 10-minute slots around the weekly seminar,
// the mini month, the patients waiting for a slot, and the card of a booked patient. Booking and freeing go by
// buttons (pick a patient, then a free slot), by drag and drop, and from the card; a double click on a booked slot
// opens the case. Slots a conclusion was approved on are locked.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import type { PatientRow } from "@codebridge/api-client";
import {
  DEMO_TODAY,
  dayAgenda,
  inSeminar,
  isIsoDayShape,
  mondayOf,
  monthOfWeek,
  outOfHours,
  seminarOn,
  slotEnd,
  stepMonth,
  stepWeek,
  unscheduledOf,
  visibleTimes,
  weekDays,
} from "@codebridge/domain/calendar";
import { addDays } from "@codebridge/domain/time";
import { surnameFirst } from "@codebridge/domain/names";
import { useApi } from "../../lib/api";
import { SEMINAR_LABEL_IDS, STATUS_DOT, caseRoute, isSlotLocked } from "../../lib/lists";
import { toast } from "../../lib/toast";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { useWrite } from "../../composables/useWrite";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import { useListViewStore } from "../../stores/listView";
import CalendarCard from "./CalendarCard.vue";
import MiniMonth from "./MiniMonth.vue";
import StartMdtDialog from "./StartMdtDialog.vue";

const { $t } = useFluent();
const route = useRoute();
const router = useRouter();
const me = useCurrentUser();
const text = useListText();
const { run, refreshPatients } = useWrite();
const patients = usePatientsStore();
const workflow = useWorkflowStore();
const v = useListViewStore();

// The week lives in the address (#/calendar/<Monday>), so the browser's back button moves between weeks. A link to
// any day opens its week; the mini month then shows that day's month.
let nextMonth: string | null = null;
function goWeek(week: string, month: string | null = null) {
  // The same week does not navigate (the watch would not run), so the month is set here.
  if (week === v.week && route.params.week === week) {
    if (month) v.miniMonth = month;
    return;
  }
  nextMonth = month;
  void router.push(`/calendar/${week}`);
}
watch(
  () => route.params.week,
  (w) => {
    const raw = typeof w === "string" ? w : "";
    if (!raw || !isIsoDayShape(raw)) {
      void router.replace(`/calendar/${v.week}`);
      return;
    }
    const monday = mondayOf(raw);
    const month = nextMonth ?? raw.slice(0, 7);
    v.week = monday;
    v.miniMonth = month;
    // A link to another day is rewritten to its Monday; that second run keeps the linked day's month.
    if (monday !== raw) {
      nextMonth = month;
      void router.replace(`/calendar/${monday}`);
    } else nextMonth = null;
  },
  { immediate: true },
);

const days = computed(() => weekDays(v.week));
const weekEnd = computed(() => addDays(v.week, 4));
const bySlot = computed(() => {
  const m = new Map<string, PatientRow>();
  for (const p of patients.rows) if (p.slot) m.set(`${p.slot.day} ${p.slot.time}`, p);
  return m;
});
const grid = computed(() => visibleTimes(days.value, (d, t) => bySlot.value.has(`${d} ${t}`), v.fullDay));
const unscheduled = computed(() => unscheduledOf(patients.rows, v.schedPick));
const pop = computed(() => (v.calPop ? patients.byFile(v.calPop) ?? null : null));
const picked = computed(() => (v.schedPick ? patients.byFile(v.schedPick) ?? null : null));
const locked = (p: PatientRow) => isSlotLocked(workflow.cases, p);
const seminarText = (d: string) => {
  const s = seminarOn(d);
  return s ? $t("calendar-seminar-hours", { name: $t(SEMINAR_LABEL_IDS[s.kind]!), from: s.from, to: s.to }) : "";
};
const rangeText = computed(() => {
  const a = new Date(`${v.week}T12:00:00Z`);
  const b = new Date(`${weekEnd.value}T12:00:00Z`);
  return $t("calendar-week-range", { d1: a.getUTCDate(), m1: a.getUTCMonth() + 1, d2: b.getUTCDate(), m2: b.getUTCMonth() + 1, year: weekEnd.value.slice(0, 4) });
});

// ---------- navigation ----------
function stepW(n: number) {
  const w = stepWeek(v.week, n);
  if (w) goWeek(w, monthOfWeek(w));
}
function today() {
  goWeek(mondayOf(DEMO_TODAY), DEMO_TODAY.slice(0, 7));
}
function jump(iso: string) {
  goWeek(mondayOf(iso), iso.slice(0, 7));
}
function stepM(n: number) {
  const m = stepMonth(v.miniMonth, n);
  if (m) v.miniMonth = m;
}
function pickYear(y: number) {
  const month = `${y}-${v.miniMonth.slice(5)}`;
  goWeek(mondayOf(`${month}-15`), month);
}

// ---------- booking ----------
const LOCK = () => $t("calendar-lock-why");

async function scheduleAt(file: string, day: string, time: string) {
  const p = patients.byFile(file);
  if (!p) return;
  if (locked(p)) {
    toast(LOCK());
    v.schedPick = null;
    return;
  }
  if (!me.canRunCases.value) {
    toast($t("calendar-book-refused"));
    return;
  }
  await run(() => useApi().putSlot(p.id, { day, time }), {
    busy: "slot",
    onOk: (r) => {
      const warn = r.data?.warning_cs || (outOfHours(day, time) ? $t("calendar-out-of-hours") : "");
      toast(warn ? $t("calendar-booked-warn", { name: surnameFirst(p), slot: text.slotText(p.slot), warn }) : $t("calendar-booked", { name: surnameFirst(p), slot: text.slotText(p.slot) }));
      v.schedPick = null;
      v.calPop = p.file;
    },
    onErr: (e) => {
      if ((e as { code?: string }).code === "slot_taken") void refreshPatients();
    },
  });
}

async function unschedule(file: string) {
  const p = patients.byFile(file);
  if (!p?.slot) return;
  if (locked(p)) {
    toast(LOCK());
    return;
  }
  if (!me.canRunCases.value) {
    toast($t("calendar-unschedule-refused"));
    return;
  }
  await run(() => useApi().deleteSlot(p.id), {
    busy: "slot",
    onOk: () => {
      v.calPop = null;
      v.schedPick = null;
      toast($t("calendar-slot-freed", { name: surnameFirst(p) }));
    },
  });
}

function pick(file: string) {
  v.schedPick = v.schedPick === file ? null : file;
}
function onFree(day: string, time: string) {
  if (!v.schedPick) {
    toast($t("calendar-pick-first"));
    return;
  }
  void scheduleAt(v.schedPick, day, time);
}

// The first click of a booked slot opens its card, a second click on the same slot soon after opens the case. Native
// dblclick is a second path to the same result.
const DBL_MS = 700;
let lastSlot: string | null = null;
let lastAt = 0;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function openCase(file: string) {
  lastSlot = null;
  // Opening a case closes the card, as the old page's openPatient() did.
  v.calPop = null;
  void router.push(caseRoute(file));
}
function onTaken(p: PatientRow) {
  const key = `${p.slot!.day} ${p.slot!.time}`;
  const now = Date.now();
  if (lastSlot === key && now - lastAt < DBL_MS) {
    openCase(p.file);
    return;
  }
  lastSlot = key;
  lastAt = now;
  v.calPop = p.file;
  // Seeing a slot's detail is a view the server cannot see; it is logged with a fixed code, never free text.
  useApi().auditEvent({ code: "slot_detail_viewed", case_id: p.id }).catch(() => {});
  // Scrolling the card into view moves the grid under the pointer, so it waits until a double click is over.
  clearTimeout(scrollTimer);
  const shown = p.file;
  scrollTimer = setTimeout(() => {
    if (v.calPop === shown) document.getElementById("minicard")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, DBL_MS + 20);
}
onBeforeUnmount(() => clearTimeout(scrollTimer));

// ---------- drag and drop ----------
// A patient from the waiting list or a booked slot onto a free slot; a booked patient onto the waiting list frees the
// slot. Picking a patient and then a slot still works for keyboards and touch screens.
const dragFile = ref<string | null>(null);
const dropKey = ref<string | null>(null);
function onDragStart(e: DragEvent, file: string) {
  e.dataTransfer?.setData("text/plain", file);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  dragFile.value = file;
  const el = e.currentTarget as HTMLElement;
  requestAnimationFrame(() => el.classList.add("dragging"));
}
function onDragEnd(e: DragEvent) {
  (e.currentTarget as HTMLElement).classList.remove("dragging");
  dragFile.value = null;
  dropKey.value = null;
}
const draggedHasSlot = computed(() => !!(dragFile.value && patients.byFile(dragFile.value)?.slot));
function onDragOver(e: DragEvent, key: string) {
  if (!dragFile.value) return;
  if (key === "zone" && !draggedHasSlot.value) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropKey.value = key;
}
function onDragLeave(e: DragEvent, key: string) {
  const el = e.currentTarget as HTMLElement;
  if (!el.contains(e.relatedTarget as Node | null) && dropKey.value === key) dropKey.value = null;
}
function onDrop(e: DragEvent, target: { day: string; time: string } | "zone") {
  if (target === "zone" && !draggedHasSlot.value) return;
  e.preventDefault();
  const file = e.dataTransfer?.getData("text/plain") || dragFile.value;
  dragFile.value = null;
  dropKey.value = null;
  if (!file || !patients.byFile(file)) return;
  if (target === "zone") void unschedule(file);
  else void scheduleAt(file, target.day, target.time);
}

// A freed slot closes its card (applyCase() in the old page).
watch(pop, (p) => {
  if (p && !p.slot) v.calPop = null;
});

// ---------- start MDT ----------
const startDay = ref<string | null>(null);
</script>

<template>
  <div class="page">
    <div class="pagehead">
      <div><h1>{{ $t("calendar-title") }}</h1><div class="muted small">{{ rangeText }}</div></div>
      <div class="row">
        <button class="btn small" @click="stepW(-1)">{{ $t("calendar-week-prev") }}</button>
        <button class="btn small" @click="today">{{ $t("calendar-today") }}</button>
        <button class="btn small" @click="stepW(1)">{{ $t("calendar-week-next") }}</button>
      </div>
    </div>
    <div class="calwrap3">
      <div class="stack" style="gap:8px">
        <div class="scroll calscroll">
          <div class="cal">
            <div />
            <div v-for="d in days" :key="d" class="dh" :class="{ today: d === DEMO_TODAY }">
              {{ text.dayLabel(d) }}{{ d === DEMO_TODAY ? $t("calendar-today-suffix") : "" }}<small>{{ seminarText(d) || " " }}</small>
              <button v-if="dayAgenda(patients.rows, d).length" class="btn small primary startmdt" @click="startDay = d">{{ $t("calendar-start-mdt") }}</button>
            </div>
            <template v-for="t in grid.times" :key="t">
              <div class="tm" :class="{ hr: t.endsWith(':00') }">{{ t }}</div>
              <div v-for="d in days" :key="`${d} ${t}`" class="cell" :class="{ sem: inSeminar(d, t), oot: !inSeminar(d, t) && outOfHours(d, t), today: d === DEMO_TODAY }">
                <template v-if="bySlot.get(`${d} ${t}`)">
                  <button
                    v-for="p in [bySlot.get(`${d} ${t}`)!]"
                    :key="p.file"
                    class="slotbtn taken"
                    :draggable="locked(p) ? 'false' : 'true'"
                    :title="$t('calendar-slot-title', { name: surnameFirst(p), rc: p.rc || $t('lists-gap-not-stated') })"
                    :aria-label="$t('calendar-slot-label', { name: surnameFirst(p), rc: p.rc || $t('lists-gap-not-stated'), time: t })"
                    :aria-pressed="v.calPop === p.file"
                    @click="onTaken(p)"
                    @dblclick="openCase(p.file)"
                    @dragstart="!locked(p) && onDragStart($event, p.file)"
                    @dragend="onDragEnd"
                  >
                    <span class="dot" :style="{ background: `var(--${STATUS_DOT[p.status] ?? 'muted'})` }" /><span v-if="outOfHours(d, t)" class="ootm" :title="$t('calendar-out-of-hours-title')" :aria-label="$t('calendar-out-of-hours')">{{ $t("calendar-out-of-hours-mark") }}</span><span class="cid">{{ surnameFirst(p) }}</span><span v-if="p.rc" class="nm">{{ $t("calendar-slot-rc", { rc: p.rc }) }}</span>
                  </button>
                </template>
                <button
                  v-else-if="inSeminar(d, t)"
                  class="slotbtn free"
                  :class="{ target: !!v.schedPick, drop: dropKey === `${d} ${t}` }"
                  :aria-label="$t('calendar-free-slot', { time: t })"
                  @click="onFree(d, t)"
                  @dragover="onDragOver($event, `${d} ${t}`)"
                  @dragleave="onDragLeave($event, `${d} ${t}`)"
                  @drop="onDrop($event, { day: d, time: t })"
                >
                  <span class="tt2">{{ v.schedPick ? t : `${t}-${slotEnd(t)}` }}</span><span v-if="v.schedPick" class="nm">{{ $t("calendar-book-here") }}</span>
                </button>
                <button
                  v-else-if="outOfHours(d, t)"
                  class="slotbtn free oot"
                  :class="{ target: !!v.schedPick, drop: dropKey === `${d} ${t}` }"
                  :title="$t('calendar-out-of-hours-title')"
                  :aria-label="$t('calendar-free-slot-oot', { time: t })"
                  @click="onFree(d, t)"
                  @dragover="onDragOver($event, `${d} ${t}`)"
                  @dragleave="onDragLeave($event, `${d} ${t}`)"
                  @drop="onDrop($event, { day: d, time: t })"
                >
                  <span class="tt2">{{ $t("calendar-free-oot-text", { time: t }) }}</span>
                </button>
              </div>
            </template>
          </div>
        </div>
        <div v-if="grid.canTrim" class="row small muted">
          <span>{{ v.fullDay ? $t("calendar-full-day-shown") : $t("calendar-trimmed-shown", { from: grid.from!, to: grid.to! }) }}</span>
          <button class="linkbtn small" @click="v.fullDay = !v.fullDay">{{ v.fullDay ? $t("calendar-trim") : $t("calendar-full-day") }}</button>
        </div>
        <p class="muted small" style="margin:0">{{ $t("calendar-oot-note") }}</p>
      </div>
      <div class="stack">
        <MiniMonth :month="v.miniMonth" :week="v.week" @step="stepM" @year="pickYear" @jump="jump" />
        <div
          class="card unschedzone"
          :class="{ drop: dropKey === 'zone' }"
          @dragover="onDragOver($event, 'zone')"
          @dragleave="onDragLeave($event, 'zone')"
          @drop="onDrop($event, 'zone')"
        >
          <div class="head"><h2>{{ $t("calendar-unscheduled", { n: unscheduled.length }) }}</h2></div>
          <i18n v-if="picked" path="calendar-pick-hint" tag="p" class="small" style="margin:0 0 8px">
            <template #name><b>{{ surnameFirst(picked) }}</b></template>
            <template #cancel><button class="linkbtn" @click="v.schedPick = null">{{ $t("calendar-pick-cancel") }}</button></template>
          </i18n>
          <p v-else class="muted small" style="margin:0 0 8px">{{ $t("calendar-drag-hint") }}</p>
          <div class="tasklist" role="list" :aria-label="$t('calendar-unscheduled-list')">
            <div
              v-for="p in unscheduled"
              :key="p.file"
              class="row spread dragrow"
              :class="{ sel: v.schedPick === p.file || v.calPop === p.file }"
              role="listitem"
              draggable="true"
              @dragstart="onDragStart($event, p.file)"
              @dragend="onDragEnd"
            >
              <span><b>{{ surnameFirst(p) }}</b> <span class="muted small">{{ $t("calendar-rc-label") }} <template v-if="p.rc">{{ p.rc }}</template><span v-else class="gapq" :title="$t('lists-gap-not-stated')">-</span></span><span class="muted small" style="display:block">{{ p.diagnosis ?? "" }}</span></span>
              <button class="btn small" :class="{ primary: v.schedPick === p.file }" :aria-pressed="v.schedPick === p.file" @click="pick(p.file)">
                {{ v.schedPick === p.file ? $t("calendar-picked") : p.slot ? $t("calendar-move") : $t("calendar-book") }}
              </button>
            </div>
            <span v-if="!unscheduled.length" class="muted small" role="listitem">{{ $t("calendar-all-booked") }}</span>
          </div>
        </div>
        <CalendarCard v-if="pop" :patient="pop" @open="openCase(pop.file)" @pick="pick(pop.file)" @unschedule="unschedule(pop.file)" @close="v.calPop = null" />
      </div>
    </div>
    <StartMdtDialog v-if="startDay" :day="startDay" @close="startDay = null" />
  </div>
</template>
