<script setup lang="ts">
// The header's stop button while the AI recorder runs, so a recording can be
// stopped from anywhere in the app. It names the case that takes the words, or says that nothing is being stored when
// no open case can take them.
import { computed } from "vue";
import { useRecorderStore } from "../stores/recorder";
import { usePatientsStore } from "../stores/patients";

const rec = useRecorderStore();
const patients = usePatientsStore();
const caseId = computed(() => (rec.target ? (patients.byFile(rec.target)?.id ?? null) : null));
</script>

<template>
  <button v-if="rec.on" class="recpill" :title="$t('discussion-rec-pill-title')" @click="rec.stop()">
    <span class="recdot" />{{ caseId ? $t("discussion-rec-pill-case", { id: caseId }) : $t("discussion-rec-pill-unsaved") }}
  </button>
</template>
