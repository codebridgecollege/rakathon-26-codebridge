<script setup lang="ts">
// Attendance selects for one seminar day: one row per present person and department,
// "+ další" adds a row, "− odebrat" removes one. The server takes attendance only from doctors and the coordinator, so
// anyone else reads the names.
import { computed } from "vue";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useWrite } from "../../composables/useWrite";
import { useAttendanceStore } from "../../stores/attendance";
import { useStaffStore } from "../../stores/staff";

const props = defineProps<{ day: string }>();
const me = useCurrentUser();
const staff = useStaffStore();
const att = useAttendanceStore();
const { refused } = useWrite();

const rows = computed(() => att.rowsOf(props.day));
const present = computed(() => att.present(props.day));
// The tooltip of a name: function and department.
const tip = (fn: string, dept: string) => [fn, dept].filter(Boolean).join(", ");

function onPick(dept: string, k: number, ev: Event) {
  if (!me.canRunCases.value) return;
  att.setRow(props.day, dept, k, (ev.target as HTMLSelectElement).value);
  att.changed(props.day, refused);
}
function add(dept: string) {
  if (!me.canRunCases.value) return;
  att.addRow(props.day, dept);
}
function remove(dept: string, k: number) {
  if (!me.canRunCases.value) return;
  if (att.removeRow(props.day, dept, k)) att.changed(props.day, refused);
}
</script>

<template>
  <p v-if="!me.canRunCases.value" style="margin:4px 0 0">{{ present.join(", ") || $t("calendar-attendance-none") }}</p>
  <div v-else class="att">
    <template v-for="d in staff.depts" :key="d.id">
      <template v-for="(val, k) in rows[d.name] ?? ['']" :key="`${d.id}-${k}`">
        <span class="dept">{{ k === 0 ? d.name : "" }}</span>
        <select class="input" :aria-label="d.name" :value="val" @change="onPick(d.name, k, $event)">
          <option value="">{{ $t("calendar-attendance-pick") }}</option>
          <option v-for="x in d.people" :key="x.id" :value="x.name" :disabled="(rows[d.name] ?? []).includes(x.name) && val !== x.name" :title="tip(x.fn, d.name)">{{ x.name }}</option>
        </select>
        <button v-if="k === 0" class="btn" :disabled="(rows[d.name] ?? []).length >= d.people.length" @click="add(d.name)">{{ $t("calendar-attendance-add") }}</button>
        <button v-else class="btn" :aria-label="$t('calendar-attendance-remove-row', { dept: d.name })" @click="remove(d.name, k)">{{ $t("calendar-attendance-remove") }}</button>
      </template>
    </template>
  </div>
</template>
