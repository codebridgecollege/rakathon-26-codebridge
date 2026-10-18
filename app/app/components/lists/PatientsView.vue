<script setup lang="ts">
// Screen S-1, Databáze pacientů (viewPatients() in the old page): search, the submitted-date range, Excel-style column
// filters, column resize, pages of 20, booking from the list and opening a case. Same markup and classes as the old
// page, so the copied CSS styles it unchanged.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import type { PatientRow } from "@codebridge/api-client";
import {
  FILTER_COLUMNS,
  PAGE_SIZE,
  activeFilterCount,
  ageOf,
  columnValues,
  filterPatients,
  pageRange,
  surnameFirst,
  toggleFilterAll,
  toggleFilterValue,
  type FilterColumn,
} from "@codebridge/domain/patient-list";
import { DEMO_TODAY } from "@codebridge/domain/calendar";
import { STATUS_CLASS, caseRoute } from "../../lib/lists";
import { useListText } from "../../composables/useListText";
import { usePatientsStore } from "../../stores/patients";
import { useListViewStore } from "../../stores/listView";
import ColumnFilter from "./ColumnFilter.vue";

const emit = defineEmits<{ openNewPatient: [] }>();
const { $t } = useFluent();
const router = useRouter();
const patients = usePatientsStore();
const v = useListViewStore();
const text = useListText();

// The open filter popover; it closes on a click outside it and on Escape.
const colOpen = ref<FilterColumn | null>(null);

const titles = computed<Record<FilterColumn, string>>(() => ({
  owner: $t("patients-col-owner"),
  dept: $t("patients-col-dept"),
  slot: $t("patients-col-slot"),
  status: $t("patients-col-status"),
}));

function valueLabel(key: FilterColumn, code: string): string {
  if (key === "dept") return code || "-";
  if (key === "slot") return code ? text.dayYear(code) : $t("lists-slot-none");
  if (key === "status") return text.statusLabel(code);
  return code;
}
// Each column's choices over all rows, ordered by what the user reads.
const choices = computed(() =>
  Object.fromEntries(
    FILTER_COLUMNS.map((k) => [
      k,
      columnValues(k, patients.rows)
        .map((code) => ({ code, label: valueLabel(k, code) }))
        .sort((a, b) => a.label.localeCompare(b.label, "cs")),
    ]),
  ) as Record<FilterColumn, { code: string; label: string }[]>,
);

const filtered = computed(() => filterPatients(patients.rows, { q: v.q, filters: v.filters, from: v.subFrom, to: v.subTo }));
const range = computed(() => pageRange(filtered.value.length, v.page, v.showAll));
const shown = computed(() => filtered.value.slice(range.value.start, range.value.end));
const active = computed(() => activeFilterCount(v.filters));

function onFilterAll(k: FilterColumn, checked: boolean) {
  v.filters = toggleFilterAll(v.filters, k, checked);
}
function onFilterValue(k: FilterColumn, code: string, checked: boolean) {
  v.filters = toggleFilterValue(v.filters, k, columnValues(k, patients.rows), code, checked);
}
function clearFilters() {
  v.filters = {};
}
function setPage(n: number) {
  v.page = n;
}
function onDate(which: "from" | "to", ev: Event) {
  const val = (ev.target as HTMLInputElement).value;
  if (which === "from") v.subFrom = val;
  else v.subTo = val;
  v.page = 0;
}

// A drag of a column edge must not count as a click on the header or a row.
let resizedAt = 0;
const justResized = () => Date.now() - resizedAt < 300;

function open(p: PatientRow) {
  if (justResized()) return;
  void router.push(caseRoute(p.file));
}
function book(p: PatientRow) {
  // "Naplánovat" picks the patient and opens the calendar to choose a slot.
  v.schedPick = p.file;
  v.calPop = null;
  void router.push("/calendar");
}
function toggleCol(k: FilterColumn) {
  if (justResized()) return;
  colOpen.value = colOpen.value === k ? null : k;
}

// Column resize: the first drag freezes the current widths, then only the dragged column changes. The widths last for
// the session (list view store), as in the old page.
const table = ref<HTMLTableElement | null>(null);
function onResizeStart(e: PointerEvent) {
  const h = (e.target as HTMLElement).closest(".colrs");
  if (!h || !table.value) return;
  e.preventDefault();
  e.stopPropagation();
  const ths = [...table.value.querySelectorAll("thead th")];
  if (!v.colWidths) v.colWidths = ths.map((th) => Math.round(th.getBoundingClientRect().width));
  const i = ths.indexOf(h.closest("th")!);
  const x0 = e.clientX;
  const w0 = v.colWidths[i]!;
  h.classList.add("on");
  const move = (ev: PointerEvent) => {
    const next = [...v.colWidths!];
    next[i] = Math.max(48, w0 + ev.clientX - x0);
    v.colWidths = next;
  };
  const up = () => {
    h.classList.remove("on");
    resizedAt = Date.now();
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
}
const tableStyle = computed(() => (v.colWidths ? { tableLayout: "fixed" as const, width: `${v.colWidths.reduce((a, b) => a + b, 0)}px` } : undefined));

function onDocClick(e: MouseEvent) {
  if (colOpen.value && !(e.target as HTMLElement).closest?.(".fpop,[data-colopen]")) colOpen.value = null;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && colOpen.value) colOpen.value = null;
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});

const age = (p: PatientRow) => ageOf(p, DEMO_TODAY);
</script>

<template>
  <div class="page">
    <div class="pagehead">
      <div><h1>{{ $t("patients-title") }}</h1><div class="muted small">{{ $t("patients-subtitle") }}</div></div>
      <button class="btn primary" @click="emit('openNewPatient')">{{ $t("patients-new") }}</button>
    </div>
    <div class="toolbar">
      <input id="q" v-model="v.q" class="search" :placeholder="$t('patients-search-placeholder')" :aria-label="$t('patients-search-label')">
      <label class="small muted row" style="gap:6px">{{ $t("patients-submitted-from") }} <input id="subfrom" class="input" type="date" :value="v.subFrom" style="width:auto" @change="onDate('from', $event)"></label>
      <label class="small muted row" style="gap:6px">{{ $t("patients-submitted-to") }} <input id="subto" class="input" type="date" :value="v.subTo" style="width:auto" @change="onDate('to', $event)"></label>
      <span class="muted small">{{ $t("patients-count", { shown: filtered.length, total: patients.rows.length }) }}</span>
      <button v-if="active" class="linkbtn small" @click="clearFilters">{{ $t("patients-clear-filters", { n: active }) }}</button>
    </div>
    <div class="card" style="padding:0">
      <div class="scroll" :style="{ minHeight: `${colOpen ? 360 : 0}px` }">
        <table ref="table" class="tbl dense rsz" :style="tableStyle" @pointerdown.capture="onResizeStart">
          <colgroup v-if="v.colWidths"><col v-for="(w, i) in v.colWidths" :key="i" :style="{ width: `${w}px` }"></colgroup>
          <thead>
            <tr>
              <th>{{ $t("patients-col-id") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
              <th>{{ $t("patients-col-patient") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
              <th>{{ $t("patients-col-rc") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
              <th>{{ $t("patients-col-age") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
              <th>{{ $t("patients-col-diagnosis") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
              <ColumnFilter
                v-for="k in FILTER_COLUMNS"
                :key="k"
                :title="titles[k]"
                :open="colOpen === k"
                :selected="v.filters[k] ?? null"
                :values="choices[k]"
                :resizable="true"
                @toggle="toggleCol(k)"
                @close="colOpen = null"
                @all="onFilterAll(k, $event)"
                @value="(code, checked) => onFilterValue(k, code, checked)"
              />
              <th>{{ $t("patients-col-submitted") }}<span class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" /></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in shown" :key="p.file" class="click" :class="{ closed: p.status === 'closed' }" @click="open(p)">
              <td class="id nw">{{ p.id }}</td>
              <td>
                <b>{{ surnameFirst(p) }}</b>
                <template v-if="p.warn">{{ " " }}<span class="tag ocr">{{ $t("patients-verify-identity") }}</span></template>
                <template v-if="p.synthetic">{{ " " }}<span class="chip plain k-unclear syntag" :title="$t('patients-synthetic-tooltip')">{{ $t("patients-synthetic") }}</span></template>
              </td>
              <td class="num" :class="{ muted: !p.rc }" :title="p.rc ? '' : $t('patients-rc-missing')">{{ p.rc || "-" }}</td>
              <td class="num" :class="{ muted: !age(p) }" :title="age(p)?.computed ? $t('patients-age-computed') : undefined">{{ age(p)?.n ?? "-" }}</td>
              <td><b style="font-weight:600">{{ p.diagnosis ?? "" }}</b></td>
              <td>{{ p.owner }}</td>
              <td><template v-if="p.dept">{{ p.dept }}</template><span v-else class="gapq" :title="$t('lists-gap-not-stated')">-</span></td>
              <td class="num nw">
                <template v-if="p.slot">{{ text.slotText(p.slot) }}</template>
                <button v-else class="linkbtn" @click.stop="book(p)">{{ $t("patients-book") }}</button>
              </td>
              <td><span class="chip" :class="STATUS_CLASS[p.status]">{{ text.statusLabel(p.status) }}</span></td>
              <td class="num nw">{{ text.date(p.submitted) }}</td>
            </tr>
            <tr v-if="!shown.length"><td colspan="12" class="muted">{{ $t("patients-none") }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="row spread" style="padding:10px 14px;border-top:1px solid var(--line)">
        <span class="muted small">{{ v.showAll ? $t("patients-shown-all", { n: filtered.length }) : $t("patients-shown-range", { from: filtered.length ? range.start + 1 : 0, to: range.end, total: filtered.length }) }}</span>
        <span class="row">
          <button v-if="v.showAll" class="btn small" @click="v.showAll = false; v.page = 0">{{ $t("patients-paged") }}</button>
          <template v-else>
            <button class="btn small" :disabled="!range.page" @click="setPage(range.page - 1)">{{ $t("patients-page-prev") }}</button>
            <button v-for="i in range.pages" :key="i" class="btn small" :class="{ primary: i - 1 === range.page }" :aria-current="i - 1 === range.page ? 'page' : undefined" @click="setPage(i - 1)">{{ i }}</button>
            <button class="btn small" :disabled="range.page >= range.pages - 1" @click="setPage(range.page + 1)">{{ $t("patients-page-next") }}</button>
            <button v-if="filtered.length > PAGE_SIZE" class="btn small" @click="v.showAll = true">{{ $t("patients-show-all", { n: filtered.length - shown.length }) }}</button>
          </template>
        </span>
      </div>
    </div>
  </div>
</template>
