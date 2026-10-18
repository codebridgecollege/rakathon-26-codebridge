<script setup lang="ts">
// One route per main area (#/patients, #/calendar, ...). The screens are ported one by one (FRONTEND.md,
// "Migration"); until then the main area shows only the startup state.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { definePageMeta } from "#imports";
import { useSessionStore } from "../stores/session";
import { usePatientsStore } from "../stores/patients";

definePageMeta({ name: "view" });

const { $t } = useFluent();
const session = useSessionStore();
const patients = usePatientsStore();
// A development check that the shell reads the server, not shown to users: ?dev in the address before the "#".
const showDev = computed(() => import.meta.dev || new URLSearchParams(location.search).has("dev"));
const errorText = computed(() => {
  const e = session.error;
  return e ? (e.message_cs ?? $t(e.message_id ?? "api-error-request-failed")) : "";
});
</script>

<template>
  <main id="app">
    <p v-if="session.phase === 'booting'" class="muted" role="status" style="padding:32px">{{ $t("app-loading") }}</p>
    <p v-else-if="session.error" class="muted" role="status" style="padding:32px">{{ session.phase === "failed" ? $t("boot-failed", { reason: errorText }) : errorText }}</p>
    <p v-if="showDev && session.phase === 'ready'" class="muted small" data-dev="patient-count" style="padding:32px">{{ $t("dev-patient-count", { n: patients.total }) }}</p>
  </main>
</template>
