<script setup lang="ts">
// The list of uploaded files, shared by the intake, the case's upload panel and the phone
// dialog: name, a line of size and origin, the state chip, an optional remove button, and warnings under the row (a
// document of another patient, a poorly readable copy). Warnings inform and never block.
import { useFluent } from "fluent-vue";
import type { UploadListItem } from "./types";

const props = defineProps<{ items: UploadListItem[] }>();
const emit = defineEmits<{ remove: [key: string | number] }>();
const { $t } = useFluent();
</script>

<template>
  <ul class="uplist">
    <li v-for="it in props.items" :key="it.key">
      <span class="nm" :title="it.name">{{ it.name }}</span><span class="small muted">{{ it.meta }}</span><span :class="['chip', 'plain', it.chip.cls]" :title="it.chip.title">{{ it.chip.text }}</span><button v-if="it.removable" class="btn small" :aria-label="$t('upload-remove', { name: it.name })" @click="emit('remove', it.key)">✕</button>
      <p v-for="(w, i) in it.warnings ?? []" :key="i" class="fwarn" role="alert" style="margin:4px 0 0;flex-basis:100%">{{ w }}</p>
      <slot name="after" :item="it" />
    </li>
  </ul>
</template>
