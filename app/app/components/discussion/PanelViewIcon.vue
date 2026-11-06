<script setup lang="ts">
// The symbols of the switch between the side panel and the whole window: four arrows pointing out (make the patient view
// fill the window) or in (make room for the panel). Drawn here, so no licensed icon set comes in.
defineProps<{ kind: "expand" | "collapse" }>();
</script>

<template>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="kind === 'expand'">
      <path d="M9 3H3v6M3 3l7 7" /><path d="M15 3h6v6M21 3l-7 7" /><path d="M9 21H3v-6M3 21l7-7" /><path d="M15 21h6v-6M21 21l-7-7" />
    </template>
    <template v-else>
      <path d="M4 10h6V4M10 10L3 3" /><path d="M20 10h-6V4M14 10l7-7" /><path d="M4 14h6v6M10 14l-7 7" /><path d="M20 14h-6v6M14 14l7 7" />
    </template>
  </svg>
</template>
