<script lang="ts">
// A value of the column: the code the filter stores, the label the list shows, and whether the label is document
// content (a type as written) rather than interface text.
export type ColValue = { code: string; label: string; content?: boolean };
</script>

<script setup lang="ts">
// One filterable column header of the documents table: an Excel-style list of the
// column's values with "(Vše)" (Soňa, round 2). The parent owns the filter and which popup is open, so one popup is
// open at a time and outside clicks and Escape close it in one place.
import { useFluent } from "fluent-vue";

defineProps<{ title: string; values: ColValue[]; filter: string[] | undefined; open: boolean }>();
const emit = defineEmits<{ toggle: []; close: []; all: [checked: boolean]; value: [code: string, checked: boolean] }>();
const { $t } = useFluent();
const checked = (e: Event) => (e.target as HTMLInputElement).checked;
</script>

<template>
  <th class="th-wrap">
    <button :class="['th-f', filter ? 'on' : '']" :aria-expanded="open" @click="emit('toggle')">{{ title }}<span class="fi" aria-hidden="true">▼</span></button>
    <div v-if="open" class="fpop" role="dialog" :aria-label="$t('patient-docs-filter-label', { title })">
      <label><input type="checkbox" :checked="!filter" @change="emit('all', checked($event))"> <b>{{ $t("patient-docs-filter-all") }}</b></label>
      <label v-for="v in values" :key="v.code"><input type="checkbox" :value="v.code" :checked="!filter || filter.includes(v.code)" @change="emit('value', v.code, checked($event))"> <span v-if="v.content" lang="cs">{{ v.label }}</span><template v-else>{{ v.label }}</template></label>
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn small" @click="emit('close')">{{ $t("patient-docs-filter-done") }}</button></div>
    </div>
  </th>
</template>
