<script setup lang="ts">
// "Navrhovaný postup": the referring doctor's proposal and the guideline layer in
// one card. Past decisions live in "Retrospektivní odchylky".
import { usePatient } from "../../composables/usePatient";
import { useFluent } from "fluent-vue";
import MissingSection from "./MissingSection.vue";
import ProposalBox from "./ProposalBox.vue";
import GuideBox from "./GuideBox.vue";
const c = usePatient();
const { $t } = useFluent();
</script>

<template>
  <section class="card blk"><ProposalBox /><GuideBox v-if="c.sec.value.guidance" /><MissingSection v-else :title="$t('patient-tab-next')" /></section>
</template>
