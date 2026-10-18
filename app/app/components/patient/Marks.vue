<script setup lang="ts">
// Quiet certainty markers next to a fact (marks() in the template): an icon with a tooltip instead of a grey comment
// line (round 2). Every fact still shows its certainty, as CLAUDE.md requires; only the wording sits in the tooltip.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { marksOf } from "@codebridge/domain/case-view";
import type { Item } from "@codebridge/domain/case-data";

const props = defineProps<{ f: Item | null | undefined }>();
const { $t } = useFluent();
const marks = computed(() => (props.f ? marksOf(props.f) : []));
</script>

<template>
  <template v-for="(m, i) in marks" :key="i">
    <span v-if="m.kind === 'ocr'" class="mk ocr" :title="$t('patient-mark-ocr', { note: m.note || $t('patient-mark-ocr-default') })">!</span>
    <span v-else-if="m.kind === 'inferred'" class="mk obs" :title="$t('patient-mark-inferred')">i</span>
    <span v-else-if="m.kind === 'planned'" class="mk plan" :title="m.note ? $t('patient-mark-planned-note', { note: m.note }) : $t('patient-mark-planned')">?</span>
    <span v-else-if="m.kind === 'note'" class="mk obs" :title="$t('patient-mark-note', { note: m.note })">i</span>
    <span v-else class="mk ocr" style="background:var(--conflict-soft);color:var(--conflict)" :title="m.note ? $t('patient-mark-conflict-note', { note: m.note }) : $t('patient-mark-conflict')">≠</span>
  </template>
</template>
