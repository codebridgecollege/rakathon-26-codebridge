<script setup lang="ts">
// The MDT teams on screen, in the top bar: usually one, several to look at them together, none ticked means all. A hospital
// without teams shows nothing. It closes on a click outside and on Escape.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import { useListViewStore } from "../stores/listView";
import { useStaffStore } from "../stores/staff";

const { $t } = useFluent();
const v = useListViewStore();
const staff = useStaffStore();
const teams = computed(() => staff.directory?.teams ?? []);
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const label = computed(() => {
  const n = v.teamFilter.length;
  if (!n) return $t("lists-team-all");
  if (n === 1) return teams.value.find((t) => t.id === v.teamFilter[0])?.name ?? $t("lists-team-all");
  return $t("lists-team-some", { n });
});
function toggle(id: string, on: boolean) {
  v.teamFilter = on ? [...v.teamFilter, id] : v.teamFilter.filter((x) => x !== id);
  v.page = 0;
}
function clear() {
  v.teamFilter = [];
  v.page = 0;
}
const onDoc = (e: MouseEvent) => {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") open.value = false;
};
onMounted(() => {
  document.addEventListener("click", onDoc);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDoc);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div v-if="teams.length" ref="root" class="teampick">
    <span class="lbl">{{ $t("lists-team-filter") }}</span>
    <button class="btn small" :aria-expanded="open" :aria-label="`${$t('lists-team-filter')}: ${label}`" @click="open = !open">{{ label }} ▾</button>
    <div v-if="open" class="teampop" role="group" :aria-label="$t('lists-team-filter')">
      <button class="linkbtn small" :disabled="!v.teamFilter.length" @click="clear">{{ $t("lists-team-all") }}</button>
      <label v-for="t in teams" :key="t.id"><input type="checkbox" :checked="v.teamFilter.includes(t.id)" @change="toggle(t.id, ($event.target as HTMLInputElement).checked)"> {{ t.name }}</label>
    </div>
  </div>
</template>
