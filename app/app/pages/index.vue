<script setup lang="ts">
// The app opens on the patient list, as today's page does.
import { definePageMeta } from "#imports";

definePageMeta({ redirect: { name: "view", params: { view: "patients" } } });
</script>

<template>
  <div />
</template>
