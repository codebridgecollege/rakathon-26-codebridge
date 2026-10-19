<script setup lang="ts">
// An empty section of the view, saying which of three it is (EXTRACTION-FORMAT.md, "Checks"): the documents say
// nothing ("-" with "neuvedeno v dostupné dokumentaci" in its tooltip), the processing did not look for it
// ("nezkontrolováno"), and, either way, which pages it could not read. Never a guess.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { SectionCheck } from "@codebridge/domain/run-view";
import Gap from "./Gap.vue";

const props = defineProps<{ check: SectionCheck | null | undefined }>();
const { $t } = useFluent();
const pages = computed(() => [...new Set((props.check?.unreadable || []).map((u) => u.page))].sort((a, b) => a - b).join(", "));
</script>

<template>
  <span v-if="check?.result === 'not_run'" class="muted" :title="$t('patient-check-not-run-tip')">{{ $t("patient-check-not-run") }}</span>
  <span v-else-if="check?.hidden" class="muted">{{ $t("patient-check-hidden") }}</span>
  <Gap v-else />
  <span v-if="pages" class="muted small">{{ " " }}({{ $t("patient-check-unreadable", { pages }) }})</span>
</template>
