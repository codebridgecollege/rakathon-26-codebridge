<script setup lang="ts">
// The toasts of stores/toast.ts, styled by the old page's .toast. A status role (which the old page lacked) lets
// screen readers announce them without moving the focus.
import { useToastStore } from "../stores/toast";
import { useMsg } from "../lib/msg";

const toasts = useToastStore();
const fmt = useMsg();
</script>

<template>
  <Teleport to="body">
    <div v-for="t in toasts.items" :key="t.key" class="toast" role="status">{{ fmt(t.msg) }}</div>
  </Teleport>
</template>
