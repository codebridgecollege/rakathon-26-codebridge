<script setup lang="ts">
// A numbered source marker for blocks where the text itself opens the edit dialog.
import { useFluent } from "fluent-vue";
import type { SourceRef } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";

defineProps<{ r: SourceRef | null | undefined; n: number }>();
const { $t } = useFluent();
const c = usePatient();
</script>

<template>
  <button v-if="r" class="ref" data-src :title="$t('patient-src-open')" @click.stop.prevent="c.openSource(r)">[{{ n }}]</button>
</template>
