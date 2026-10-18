<script setup lang="ts">
// The toasts of stores/toast.ts, styled by .toast. A status role lets
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
