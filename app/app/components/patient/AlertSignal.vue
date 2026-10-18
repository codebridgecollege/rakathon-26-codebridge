<script setup lang="ts">
// The place of the brief's "⚠ Upozornění" button always carries a signal: missing-document alerts are always on
// (CLAUDE.md, team decision 2026-10-17). A case whose check has not run says so; a failed load says the result is not
// known; neither is ever "nothing missing". When a document is missing the button itself is the signal.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { hasMissing, missingState } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();

const state = computed(() => missingState(c.entry.value.state, c.cd.value?.alerts, c.alertHist.value));
const warn = computed(() => !!hasMissing(c.cd.value?.alerts ?? null, c.alertHist.value));
</script>

<template>
  <span v-if="state === 'failed'" class="unchecked" role="status">{{ $t("patient-missing-failed") }}</span>
  <span v-else-if="state === 'unchecked'" class="unchecked" role="status">{{ $t("patient-missing-unchecked") }}</span>
  <button
    v-else-if="state !== 'loading'"
    :class="['btn', 'small', 'gapsbtn', warn ? 'warn' : '']"
    :aria-expanded="view.gapsOpen"
    @click="view.gapsOpen = !view.gapsOpen"
  >{{ warn ? $t("patient-gaps-toggle-missing") : $t("patient-gaps-toggle") }} {{ view.gapsOpen ? "▴" : "▾" }}</button>
</template>
