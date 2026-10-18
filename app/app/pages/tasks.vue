<script setup lang="ts">
// Route /tasks: screen S-6, Moje úlohy.
import AppMain from "../components/AppMain.vue";
import TasksView from "../components/lists/TasksView.vue";
</script>

<template>
  <AppMain>
    <TasksView />
  </AppMain>
</template>
