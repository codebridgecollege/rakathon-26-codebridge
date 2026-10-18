<script setup lang="ts">
// Route /calendar/<Monday>: screen S-2. The week is in the address, so the browser's back button moves between weeks
// and today's links (#calendar/2026-10-22) keep working.
import AppMain from "../../components/AppMain.vue";
import CalendarView from "../../components/lists/CalendarView.vue";
</script>

<template>
  <AppMain>
    <CalendarView />
  </AppMain>
</template>
