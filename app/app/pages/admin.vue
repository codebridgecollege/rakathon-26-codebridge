<script setup lang="ts">
// Route /admin: screen S-7, Administrace (the screen itself refuses anyone but the administrator).
import AppMain from "../components/AppMain.vue";
import AdminView from "../components/lists/AdminView.vue";
</script>

<template>
  <AppMain>
    <AdminView />
  </AppMain>
</template>
