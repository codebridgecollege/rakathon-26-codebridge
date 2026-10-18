<script setup lang="ts">
// The timeline's category icon. Lucide 0.468.0 icons (ISC licence), except the
// scalpel, which is our own drawing in Lucide's style (Lucide has no scalpel; scissors read as "cut", not
// "operation"). The paths are constants of the app, never data, so rendering them as markup is safe.
import { computed } from "vue";
import { EVENT_CATEGORIES, type EventCategory } from "@codebridge/domain/case-view";

const props = defineProps<{ k: string }>();

const NAME: Record<EventCategory, string> = {
  imaging: "scan-line",
  systemic: "syringe",
  medication: "pill",
  mdt: "users-round",
  surgery: "scalpel",
  pathology: "microscope",
  radiotherapy: "target",
  laboratory: "test-tube-diagonal",
  clinical: "stethoscope",
};
const ICON: Record<EventCategory, string> = {
  imaging: '<path d="M3 7V5a2 2 0 0 1 2-2h2" />\n  <path d="M17 3h2a2 2 0 0 1 2 2v2" />\n  <path d="M21 17v2a2 2 0 0 1-2 2h-2" />\n  <path d="M7 21H5a2 2 0 0 1-2-2v-2" />\n  <path d="M7 12h10" />',
  systemic: '<path d="m18 2 4 4" />\n  <path d="m17 7 3-3" />\n  <path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5" />\n  <path d="m9 11 4 4" />\n  <path d="m5 19-3 3" />\n  <path d="m14 4 6 6" />',
  medication: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />\n  <path d="m8.5 8.5 7 7" />',
  mdt: '<path d="M18 21a8 8 0 0 0-16 0" />\n  <circle cx="10" cy="8" r="5" />\n  <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />',
  surgery: '<path d="m2.7 18.9 9-9 2.4 2.4-9 9a1.7 1.7 0 0 1-2.4-2.4Z" stroke-width="1.3" /><path d="m12.5 8.9 8.4-6.7c.9 4.8-.6 8.5-5.6 10.5Z" fill="currentColor" stroke="none" /><path d="m5 18.4 4.8-4.8" stroke-width="1" />',
  pathology: '<path d="M6 18h8" />\n  <path d="M3 22h18" />\n  <path d="M14 22a7 7 0 1 0 0-14h-1" />\n  <path d="M9 14h2" />\n  <path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z" />\n  <path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" />',
  radiotherapy: '<circle cx="12" cy="12" r="10" />\n  <circle cx="12" cy="12" r="6" />\n  <circle cx="12" cy="12" r="2" />',
  laboratory: '<path d="M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3" />\n  <path d="m16 2 6 6" />\n  <path d="M12 16H4" />',
  clinical: '<path d="M11 2v2" />\n  <path d="M5 2v2" />\n  <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />\n  <path d="M8 15a6 6 0 0 0 12 0v-3" />\n  <circle cx="20" cy="10" r="2" />',
};
// An unknown key draws the "clinical" icon.
const key = computed<EventCategory>(() => ((EVENT_CATEGORIES as readonly string[]).includes(props.k) ? (props.k as EventCategory) : "clinical"));
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" :data-icon="NAME[key]" v-html="ICON[key]" />
</template>
