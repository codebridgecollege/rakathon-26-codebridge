<script setup lang="ts">
// "Možná jiný pacient" above the brief: an uploaded document whose patient differs
// from this case's patient is signalled on the case itself, not only in the upload list, so every doctor who opens the
// case sees it. Documents are never merged silently (CLAUDE.md).
import { computed, watch } from "vue";
import { usePatient } from "../../composables/usePatient";
import { useUploadsStore } from "../../stores/uploads";

const c = usePatient();
const uploads = useUploadsStore();
// The case's uploads are read once when the case is shown.
watch(
  () => c.p.value.file,
  () => void uploads.load({ file: c.p.value.file, id: c.p.value.id }),
  { immediate: true },
);
const n = computed(() => uploads.docsOf(c.p.value.file).filter((d) => d.identity === "conflicts").length);
</script>

<template>
  <div v-if="n" class="question missing" role="alert" style="margin-bottom:10px">
    <span class="label">{{ $t("discussion-identity-label") }}</span>
    <p style="font-size:14px">{{ $t("discussion-identity-text", { n }) }}</p>
  </div>
</template>
