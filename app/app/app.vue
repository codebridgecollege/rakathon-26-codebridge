<script setup lang="ts">
// The page frame of today's page: the top bar, the main area (#app) and the two layers the dialogs and the phone
// upload use. Boot runs once here, before any screen reads the stores. The dialogs that any screen may open live here
// once and teleport into their layer: "Nový pacient" into #overlay, "Nahrát z telefonu" into #phoneup above it.
import { onMounted } from "vue";
import { NuxtPage } from "#components";
import AppHeader from "./components/AppHeader.vue";
import AppToasts from "./components/AppToasts.vue";
import NewPatientDialog from "./components/intake/NewPatientDialog.vue";
import PhoneUploadDialog from "./components/phone/PhoneUploadDialog.vue";
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
  <NewPatientDialog />
  <PhoneUploadDialog />
  <AppToasts />
</template>
