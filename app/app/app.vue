<script setup lang="ts">
// The page frame of today's page: the top bar, the main area (#app) and the two layers the dialogs and the phone
// upload use. Boot runs once here, before any screen reads the stores.
import { onMounted } from "vue";
import { NuxtPage } from "#components";
import AppHeader from "./components/AppHeader.vue";
import { useSessionStore } from "./stores/session";

const session = useSessionStore();
onMounted(() => {
  void session.boot();
});
</script>

<template>
  <AppHeader />
  <NuxtPage />
  <div id="overlay" />
  <div id="phoneup" class="phonelayer" />
</template>
