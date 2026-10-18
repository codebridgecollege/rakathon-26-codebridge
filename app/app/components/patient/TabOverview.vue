<script setup lang="ts">
// "Přehled": the oncology summary next to the patient's current state (round 25:
// on wide screens the summary is as tall as the state card and scrolls inside).
import OncoCard from "./OncoCard.vue";
import StatusCard from "./StatusCard.vue";
</script>

<template>
  <div class="grid2 ovgrid">
    <div class="stack ovleft"><OncoCard /></div>
    <div class="stack"><StatusCard /></div>
  </div>
</template>
