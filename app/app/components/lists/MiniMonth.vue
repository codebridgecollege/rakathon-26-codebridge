<script setup lang="ts">
// The month grid next to the calendar (miniMonth() in the old page): month arrows, a year picker, and a day button
// that jumps to its week. Today is marked for screen readers too.
import { computed } from "vue";
import { YEARS, miniMonthCells, DEMO_TODAY } from "@codebridge/domain/calendar";
import { fmtMonthName, uiLocale } from "../../lib/format";
import { MINI_WEEKDAY_IDS } from "../../lib/lists";

const props = defineProps<{ month: string; week: string }>();
const emit = defineEmits<{ step: [n: number]; year: [y: number]; jump: [iso: string] }>();
const cells = computed(() => miniMonthCells(props.month, props.week, DEMO_TODAY));
const year = computed(() => Number(props.month.slice(0, 4)));
const name = computed(() => fmtMonthName(props.month, uiLocale()));
</script>

<template>
  <div class="card">
    <div class="row spread" style="margin-bottom:8px">
      <button class="btn small" :aria-label="$t('calendar-month-prev')" @click="emit('step', -1)">‹</button>
      <span class="row"><b>{{ name }}</b>
        <select id="mmyear" class="input" style="width:auto;padding:3px 6px" :aria-label="$t('calendar-year')" :value="year" @change="emit('year', Number(($event.target as HTMLSelectElement).value))">
          <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
        </select>
      </span>
      <button class="btn small" :aria-label="$t('calendar-month-next')" @click="emit('step', 1)">›</button>
    </div>
    <div class="mini">
      <span v-for="id in MINI_WEEKDAY_IDS" :key="id" class="wd">{{ $t(id) }}</span>
      <button
        v-for="c in cells"
        :key="c.iso"
        :class="{ out: c.out, wk: c.inWeek, sem: c.seminar, today: c.today }"
        :aria-label="c.today ? $t('calendar-day-today', { iso: c.iso }) : c.iso"
        :aria-current="c.today ? 'date' : undefined"
        @click="emit('jump', c.iso)"
      >{{ c.day }}</button>
    </div>
  </div>
</template>
