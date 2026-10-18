<script setup lang="ts">
// Route /calendar/<Monday>: screen S-2. The week is in the address, so the browser's back button moves between weeks
// and a link to any day (/calendar/2026-10-22) opens its week.
// One key for every week: Nuxt would otherwise remount the screen whenever the week changes, and a link to a day
// that is not a Monday (rewritten to its Monday) would lose the linked day's month for the mini month on the way.
import { definePageMeta } from "#imports";
import AppMain from "../../components/AppMain.vue";
import CalendarView from "../../components/lists/CalendarView.vue";

definePageMeta({ key: "calendar" });
</script>

<template>
  <AppMain>
    <CalendarView />
  </AppMain>
</template>
