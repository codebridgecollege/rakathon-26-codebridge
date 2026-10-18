<script setup lang="ts">
// Resolved and acknowledged alerts in a collapsed list at the bottom (warningArchive() in the template). Its summary
// shows how many, as a list length, not a score; its open state is kept across re-renders and between the lists.
import { useFluent } from "fluent-vue";
import type { AlertEntry } from "@codebridge/domain/case-view";
import { usePatientViewStore } from "../../stores/patientView";
import AlertRow from "./AlertRow.vue";

defineProps<{ items: AlertEntry[]; compact?: boolean }>();
const { $t } = useFluent();
const view = usePatientViewStore();
const onToggle = (e: Event) => (view.resolvedOpen = (e.target as HTMLDetailsElement).open);
</script>

<template>
  <details v-if="items.length" class="srcs resolved" :open="view.resolvedOpen" @toggle="onToggle">
    <summary>{{ $t("patient-alert-archive", { n: items.length }) }}</summary>
    <div class="alerts" role="list" style="margin-top:6px">
      <AlertRow v-for="f in items" :key="String(f.i)" :f="f" :compact="compact" />
    </div>
  </details>
</template>
