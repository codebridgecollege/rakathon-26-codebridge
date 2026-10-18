<script setup lang="ts">
// Text that opens its source: no [n] markers in the text (round 14), the text itself is
// the link. Without a source the text is shown as it is.
import { useFluent } from "fluent-vue";
import type { SourceRef } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";

defineProps<{ r: SourceRef | null | undefined }>();
const { $t } = useFluent();
const c = usePatient();
</script>

<template>
  <span
    v-if="r"
    class="srcl"
    role="button"
    tabindex="0"
    data-src
    :title="$t('patient-src-open')"
    @click="c.openSource(r)"
    @keydown.enter.space.prevent="c.openSource(r)"
  ><slot /></span>
  <slot v-else />
</template>
