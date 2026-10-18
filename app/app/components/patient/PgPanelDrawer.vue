<script setup lang="ts">
// The similarity explanation of one study population: how the server's orientation score came about, dimension by dimension, with the
// patient's and the study's own words. It says plainly that the score is not a survival probability.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { finite, pgDimensions } from "@codebridge/domain/prognosis";
import { useOverlayStore } from "../../stores/overlay";
import { dimKeyText, dimName, dimStatus, usePrognosisStore } from "../../stores/prognosis";

const props = defineProps<{ o: { kind: "pgpanel"; panel: number } }>();
const { $t } = useFluent();
const overlay = useOverlayStore();
const pg = usePrognosisStore();

const pn = computed(() => pg.panels[props.o.panel] ?? null);
const s = computed(() => pn.value?.similarity ?? null);
const dims = computed(() => pgDimensions(s.value));
const critical = computed(() => (s.value?.critical_mismatches || []).map((k) => dimKeyText($t, k)).join("; "));
// Coverage as the server reports it; a value it leaves out is not shown, never assumed.
const coverage = computed(() => {
  const c = s.value?.coverage;
  if (c === undefined || c === null) return null;
  return typeof c === "object" ? JSON.stringify(c) : String(c);
});
</script>

<template>
  <div class="scrim" @click="overlay.close()"></div>
  <aside class="drawer" role="dialog" aria-modal="true" :aria-label="pn ? $t('patient-pg-sim-explain') : $t('patient-pg-title')" style="grid-template-rows: auto minmax(0, 1fr)">
    <header>
      <div>
        <div class="label">{{ $t("patient-pg-panel-label") }}</div>
        <h2 style="margin-top: 4px" lang="en">{{ pn?.study || "" }}</h2>
        <div v-if="s && finite(s.score)" class="muted small">{{ $t("patient-pg-panel-sub", { v: String(s.score) }) }}</div>
      </div>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-pg-close") }}</button>
    </header>
    <div class="pgpanel">
      <template v-if="s">
        <p v-if="s.method" lang="cs">{{ s.method }}</p>
        <p>{{ $t("patient-pg-panel-disclaimer") }}</p>
        <p v-if="coverage !== null">{{ $t("patient-pg-panel-coverage", { v: coverage }) }}</p>
        <ul>
          <li v-for="(d, i) in dims" :key="i">
            <b>{{ dimName($t, d) }}</b>: {{ dimStatus($t, d) }}<template v-if="d.reason"> · <span lang="cs">{{ d.reason }}</span></template><div v-if="d.patient_quote">{{ $t("patient-pg-panel-patient") }}<span lang="cs">{{ d.patient_quote }}</span></div><div v-if="d.study_quote">{{ $t("patient-pg-panel-study") }}<span lang="en">{{ d.study_quote }}</span></div>
          </li>
        </ul>
        <p v-if="critical" class="pg-warning">{{ $t("patient-pg-panel-critical", { list: critical }) }}</p>
      </template>
    </div>
  </aside>
</template>
