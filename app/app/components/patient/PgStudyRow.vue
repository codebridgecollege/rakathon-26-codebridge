<script setup lang="ts">
// One population or arm of a study. It keeps the study's own population, treatment and
// time origin next to its values, marks the row as a model extraction to verify, and lists conflicting extractions
// apart from the main cells. Study text is English as published; the model's summaries are Czech.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { PrognosisModel } from "@codebridge/api-client";
import { conflictName, isIsoDay, pgUrl, PG_SINGLE_CELLS, type PgRow, type PgRowLayout } from "@codebridge/domain/prognosis";
import { fmtDate } from "../../lib/dates";
import { nameKeyText, nameText } from "../../stores/prognosis";
import PgMetric from "./PgMetric.vue";
import PgSimilarity from "./PgSimilarity.vue";

const props = defineProps<{ row: PgRow; layout: PgRowLayout; models: PrognosisModel[] }>();
const emit = defineEmits<{ ref: [n: number]; panel: [i: number] }>();
const { $t } = useFluent();

const source = computed(() => props.row.source || {});
const ep = computed(() => props.row.endpoints || {});
const modelLabel = (id: string) => props.models.find((m) => m.id === id)?.label || id;
const labels = (ids: string[] | undefined) => (ids || []).map(modelLabel).join(", ");
// A full ISO day is formatted; a partial date is shown as the source gives it, never completed.
const published = computed(() => {
  const d = source.value.published_date;
  if (d) return isIsoDay(d) ? fmtDate($t, d) : d;
  return source.value.year != null ? String(source.value.year) : "";
});
const link = computed(() => pgUrl(source.value.url));
const linkText = computed(() =>
  source.value.pmid ? $t("patient-pg-link-pubmed", { id: String(source.value.pmid) }) : source.value.doi ? $t("patient-pg-link-doi", { id: String(source.value.doi) }) : $t("patient-src-open"),
);
</script>

<template>
  <tr>
    <td>
      <b lang="en">{{ row.study_title || $t("patient-pg-untitled") }}</b><div class="small">{{ published }} <span lang="en">{{ row.study_type || "" }}</span></div><div><a v-if="link" :href="link" target="_blank" rel="noopener noreferrer">{{ linkText }}</a><template v-else>{{ linkText }}</template></div>
      <span class="chip plain k-unclear">{{ $t("patient-pg-verify") }}</span><details v-if="row.conflicts?.length" class="pg-warning">
        <summary>{{ $t("patient-pg-conflicts", { n: row.conflicts.length }) }}</summary><p>{{ $t("patient-pg-conflicts-note") }}</p><div v-for="(c, ci) in row.conflicts" :key="ci"><b>{{ nameText($t, conflictName(c.field)) }}</b><div v-for="(v, vi) in c.values || []" :key="vi">{{ labels(v.found_by) }}<PgMetric :metric="v" :n="layout.conflicts[ci]?.[vi] ?? null" @ref="emit('ref', $event)" /></div></div>
      </details>
    </td>
    <td>
      <b lang="cs">{{ row.arm || "" }}</b><p lang="cs">{{ row.population || "" }}</p><div v-if="row.sample_size">{{ $t("patient-pg-sample-size", { n: String(row.sample_size) }) }}</div><div class="muted small">{{ $t("patient-pg-time-origin") }}<span v-if="row.time_origin" lang="cs">{{ row.time_origin }}</span><template v-else>{{ $t("patient-gap-not-stated") }}</template></div>
    </td>
    <td>
      <PgSimilarity :s="row.similarity" :panel="layout.panel" @panel="emit('panel', $event)" /><details v-if="row.similarity_variants?.length">
        <summary>{{ $t("patient-pg-sim-variants") }}</summary><div v-for="(v, i) in row.similarity_variants" :key="i">{{ labels(v.found_by) }}<PgSimilarity :s="v.similarity || v" :panel="layout.variantPanels[i] ?? null" @panel="emit('panel', $event)" /></div>
      </details>
    </td>
    <td v-for="k in PG_SINGLE_CELLS" :key="k"><PgMetric :metric="ep[k]" :n="layout.cells[k] ?? null" @ref="emit('ref', $event)" /></td>
    <td>
      <PgMetric :metric="ep.orr" :label="nameKeyText($t, 'orr')" :n="layout.cells.orr ?? null" @ref="emit('ref', $event)" /><PgMetric :metric="ep.dor" :label="nameKeyText($t, 'dor_median')" :n="layout.cells.dor ?? null" @ref="emit('ref', $event)" />
    </td>
    <td>
      <PgMetric :metric="ep.toxicity_grade3" :label="nameKeyText($t, 'grade3')" :n="layout.cells.toxicity_grade3 ?? null" @ref="emit('ref', $event)" /><PgMetric
        :metric="ep.discontinuation_toxicity"
        :label="nameKeyText($t, 'discontinuation')"
        :n="layout.cells.discontinuation_toxicity ?? null"
        @ref="emit('ref', $event)"
      />
    </td>
    <td><PgMetric :metric="ep.burden" :n="layout.cells.burden ?? null" @ref="emit('ref', $event)" /></td>
    <td><div v-for="(m, i) in (row.found_by || []).map(modelLabel)" :key="i" class="small">{{ m }}</div></td>
  </tr>
</template>
