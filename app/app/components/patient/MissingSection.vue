<script setup lang="ts">
// No extraction is different from a checked section with no documented findings.
import { useFluent } from "fluent-vue";
defineProps<{ title: string }>();
const { $t } = useFluent();
</script>

<template>
  <section class="card missing-section">
    <h2>{{ title }}</h2>
    <p class="muted" role="status">{{ $t("patient-section-unavailable") }}</p>
  </section>
</template>
