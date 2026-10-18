<script setup lang="ts">
// The drop zone of every upload in the app: files are dropped on it or picked with a
// click, which opens the system file chooser through the hidden input. The input sits inside the label, so its
// accessible name is the zone's text. Every file is passed on; nothing is refused here (the server decides what it
// keeps, and the demo lists every file).
import { ref } from "vue";

const props = withDefaults(defineProps<{ title: string; hint: string; accept?: string; multiple?: boolean; zoneStyle?: string }>(), {
  accept: undefined,
  multiple: true,
  zoneStyle: undefined,
});
const emit = defineEmits<{ files: [files: File[]] }>();

const over = ref(false);
const isFileDrag = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

function onDragOver(e: DragEvent) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  over.value = true;
}
function onDragLeave(e: DragEvent) {
  const zone = e.currentTarget as HTMLElement;
  // Leaving for a child of the zone is not leaving the zone.
  if (!zone.contains(e.relatedTarget as Node | null)) over.value = false;
}
function onDrop(e: DragEvent) {
  over.value = false;
  if (!isFileDrag(e)) return;
  e.preventDefault();
  const list = [...(e.dataTransfer?.files ?? [])];
  if (list.length) emit("files", list);
}
function onChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const list = [...(input.files ?? [])];
  // Cleared, so picking the same file again is a new choice (the input is reset after every pick).
  input.value = "";
  if (list.length) emit("files", list);
}
</script>

<template>
  <label class="upzone" :class="{ drop: over }" :style="props.zoneStyle" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <input type="file" :multiple="props.multiple" :accept="props.accept" @change="onChange"><b>{{ props.title }}</b><span class="small muted">{{ props.hint }}</span>
  </label>
</template>
