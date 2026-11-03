<script setup lang="ts">
// A fact in the MDT side panel: a link to its source, or plain text when it has none, so nothing looks clickable and
// then does nothing.
import type { SourceRef } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";

defineProps<{ text: string; source: SourceRef | undefined }>();
const c = usePatient();
</script>

<template>
  <button v-if="source" class="linkbtn" lang="cs" @click="c.openSource(source)">{{ text }}</button>
  <span v-else lang="cs">{{ text }}</span>
</template>
