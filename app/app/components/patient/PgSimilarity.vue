<script setup lang="ts">
// The similarity of the patient to a study population: the server's orientation
// score, how much of the weight the known facts cover, the critical differences, and a button to the explanation.
// The score is shown only as the server reports it; it is not a survival probability.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { finite, type PgSimilarity } from "@codebridge/domain/prognosis";
import { dimKeyText } from "../../stores/prognosis";

const props = defineProps<{ s: PgSimilarity | null | undefined; panel: number | null }>();
const emit = defineEmits<{ panel: [i: number] }>();
const { $t } = useFluent();

const critical = computed(() => (props.s?.critical_mismatches || []).map((k) => dimKeyText($t, k)).join("; "));
</script>

<template>
  <span v-if="!s" class="muted" :title="$t('patient-gap-not-stated')">-</span>
  <template v-else>
    <span v-if="finite(s.score)" class="pg-score">{{ $t("patient-pg-percent", { v: String(s.score) }) }}</span><span v-else class="muted" :title="$t('patient-gap-not-stated')">-</span><div class="muted small">{{ $t("patient-pg-sim-label") }}<template v-if="finite(s.coverage)"><br>{{ $t("patient-pg-sim-coverage", { v: String(s.coverage) }) }}</template></div><div v-if="critical" class="pg-warning small">{{ $t("patient-pg-sim-critical", { list: critical }) }}</div><button class="linkbtn small" @click="panel !== null && emit('panel', panel)">{{ $t("patient-pg-sim-explain") }}</button>
  </template>
</template>
