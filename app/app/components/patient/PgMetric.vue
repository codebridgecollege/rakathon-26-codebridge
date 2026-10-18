<script setup lang="ts">
// One reported value of a study: the value with its unit, its reference number that
// opens the source list at that entry, and the confidence interval as the source gives it. A value the source does not
// report is "-" with the gap wording; nothing is computed in its place.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { isMissing, type PgMetric } from "@codebridge/domain/prognosis";
import { valueText } from "../../stores/prognosis";

const props = withDefaults(defineProps<{ metric: PgMetric | null | undefined; label?: string; n: number | null }>(), { label: "" });
const emit = defineEmits<{ ref: [n: number] }>();
const { $t } = useFluent();

const missing = computed(() => isMissing(props.metric) || props.n === null);
const value = computed(() => (props.metric ? valueText($t, props.metric.value, props.metric.unit) : ""));
</script>

<template>
  <template v-if="missing">
    <div v-if="label">{{ label }}: <span class="muted" :title="$t('patient-gap-not-stated')">-</span></div>
    <span v-else class="muted" :title="$t('patient-gap-not-stated')">-</span>
  </template>
  <div v-else>
    <span v-if="label" class="muted">{{ label }}: </span><b>{{ value }}</b><button class="ref" :title="$t('patient-src-open')" @click="emit('ref', n!)">[{{ n }}]</button>
    <div v-if="metric!.ci" class="muted small" lang="cs">{{ metric!.ci }}</div>
  </div>
</template>
