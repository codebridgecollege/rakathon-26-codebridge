<script setup lang="ts">
// A missing value shows as "-" with the fixed gap wording in its tooltip (team decision 2026-10-16, DASH in the
// template). Never a guess, never "neguje", never "neprovedeno".
import { useFluent } from "fluent-vue";

const { $t } = useFluent();
</script>

<template>
  <span class="gapq" :title="$t('patient-gap-not-stated')">-</span>
</template>
