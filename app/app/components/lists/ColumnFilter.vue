<script setup lang="ts">
// One filterable column header with its Excel-style value list (colHead() in the old page). The values are codes; the
// parent gives each its label and the order they are shown in.
import { computed, nextTick, ref, watch } from "vue";
import { useFluent } from "fluent-vue";

const props = defineProps<{
  title: string;
  open: boolean;
  // null: every value passes; a list: only these pass.
  selected: string[] | null;
  values: { code: string; label: string }[];
  resizable: boolean;
}>();
const emit = defineEmits<{ toggle: []; close: []; all: [checked: boolean]; value: [code: string, checked: boolean] }>();
const { $t } = useFluent();
const isOn = (code: string) => !props.selected || props.selected.includes(code);
const dialogLabel = computed(() => $t("patients-filter-dialog", { column: props.title }));

// When the popover closes while focus is in it ("Hotovo", Escape), focus goes back to its header button instead of
// being lost with the removed popover.
const btn = ref<HTMLButtonElement | null>(null);
const pop = ref<HTMLElement | null>(null);
watch(
  () => props.open,
  (o, was) => {
    if (o || !was || !pop.value?.contains(document.activeElement)) return;
    void nextTick(() => btn.value?.focus());
  },
  { flush: "pre" },
);
</script>

<template>
  <th class="th-wrap">
    <button ref="btn" class="th-f" :class="{ on: !!selected }" data-colopen="1" :aria-expanded="open" aria-haspopup="dialog" @click="emit('toggle')">
      {{ title }}<span class="fi" aria-hidden="true">▼</span>
    </button>
    <div v-if="open" ref="pop" class="fpop" role="dialog" :aria-label="dialogLabel">
      <label><input type="checkbox" :checked="!selected" @change="emit('all', ($event.target as HTMLInputElement).checked)"> <b>{{ $t("patients-filter-all") }}</b></label>
      <label v-for="v in values" :key="v.code">
        <input type="checkbox" :value="v.code" :checked="isOn(v.code)" @change="emit('value', v.code, ($event.target as HTMLInputElement).checked)"> {{ v.label }}
      </label>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn small" @click="emit('close')">{{ $t("patients-filter-done") }}</button></div>
    </div>
    <span v-if="resizable" class="colrs" aria-hidden="true" :title="$t('patients-column-resize')" />
  </th>
</template>
