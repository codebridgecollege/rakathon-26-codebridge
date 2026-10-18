<script setup lang="ts">
// "Navrhovaný postup": the referring doctor's proposal and the guideline layer in
// one card. Past decisions live in "Retrospektivní odchylky".
import ProposalBox from "./ProposalBox.vue";
import GuideBox from "./GuideBox.vue";
</script>

<template>
  <section class="card blk"><ProposalBox /><GuideBox /></section>
</template>
