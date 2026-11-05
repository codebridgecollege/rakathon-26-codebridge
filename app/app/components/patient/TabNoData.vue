<script setup lang="ts">
// A tab with nothing to show yet. The patient view lists every tab; a tab whose data the assistant has not produced says
// so, in the fixed wording (CLAUDE.md: say "not found", never guess), and offers the next step instead of hiding.
import { useFluent } from "fluent-vue";
import type { Tab } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";
import { useOverlayStore } from "../../stores/overlay";

defineProps<{ tab: Tab }>();
const { $t } = useFluent();
const c = usePatient();
const overlay = useOverlayStore();
const upload = () => overlay.open({ kind: "upload", file: c.p.value.file });
</script>

<template>
  <section class="card" role="status">
    <div class="head"><h2>{{ $t("patient-nodata-title") }}</h2></div>
    <p style="margin:0 0 10px">{{ $t(`patient-nodata-${tab}`) }}</p>
    <p class="muted small" style="margin:0 0 10px">{{ $t("patient-nodata-note") }}</p>
    <button v-if="c.canSetStatus.value" class="btn" @click="upload">{{ $t("patient-empty-upload") }}</button>
  </section>
</template>
