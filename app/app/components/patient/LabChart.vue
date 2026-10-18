<script setup lang="ts">
// The trend of one lab test across the documented draws (labChart() in the template): the reference range as a green
// band, a dot per value that the document gives, red when outside the range. Fewer than two values draw no chart;
// a point is never invented to fill one.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { LabDraw, LabTest } from "@codebridge/domain/case-data";
import { CHART, chartGeometry } from "@codebridge/domain/labs";
import { fmtDate, fmtNumber } from "../../lib/dates";

const props = defineProps<{ t: LabTest; draws: LabDraw[] }>();
const { $t } = useFluent();
const g = computed(() => chartGeometry(props.t, props.draws));
const { W, H, L, R } = CHART;
const dotTitle = (draw: number, value: string | null) => {
  const d = props.draws[draw]!;
  return `${fmtDate($t, d.date)} ${d.time || ""}: ${value ?? ""} ${props.t.unit ?? ""}`;
};
</script>

<template>
  <p v-if="!g" class="muted small">{{ $t("patient-labs-chart-needs-two") }}</p>
  <svg v-else class="chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="$t('patient-labs-chart-label', { name: t.name_cs })">
    <template v-if="g.band">
      <rect :x="g.band.x" :y="g.band.y" :width="g.band.width" :height="g.band.height" fill="var(--ok-soft)" />
      <text :x="g.band.labelX" :y="g.band.labelY" text-anchor="end" font-size="11" fill="var(--ok)">{{ $t("patient-labs-chart-range", { range: t.reference_range }) }}</text>
    </template>
    <template v-for="(k, i) in g.ticks" :key="`t${i}`">
      <text :x="L - 6" :y="k.y + 4" text-anchor="end" font-size="11" fill="var(--muted)">{{ fmtNumber(k.value) }}</text>
      <line :x1="L" :x2="W - R" :y1="k.y" :y2="k.y" stroke="var(--line)" />
    </template>
    <text v-for="l in g.xLabels" :key="`x${l.draw}`" :x="l.x" :y="H - 12" :text-anchor="l.anchor" font-size="11" fill="var(--muted)">{{ fmtDate($t, draws[l.draw]!.date) }}</text>
    <path :d="g.path" fill="none" stroke="var(--accent)" stroke-width="2" />
    <circle v-for="dot in g.dots" :key="`d${dot.draw}`" :cx="dot.x" :cy="dot.y" r="4.5" :fill="dot.out ? 'var(--conflict)' : 'var(--accent)'"><title>{{ dotTitle(dot.draw, dot.point.value) }}</title></circle>
  </svg>
</template>
