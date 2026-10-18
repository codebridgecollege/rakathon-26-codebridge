<script setup lang="ts">
// The main area with the startup states: a screen renders only once the server's data is in,
// and a failed boot says why instead of showing an empty screen. A notice from the session (a refused user switch, a
// data reset) shows above the screen, which stays usable.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { useSessionStore } from "../stores/session";

const { $t } = useFluent();
const session = useSessionStore();
const errorText = computed(() => {
  const e = session.error;
  return e ? (e.message_cs ?? $t(e.message_id ?? "api-error-request-failed")) : "";
});
</script>

<template>
  <main id="app">
    <p v-if="session.phase === 'booting'" class="muted" role="status" style="padding:32px">{{ $t("app-loading") }}</p>
    <p v-else-if="session.phase === 'failed'" class="muted" role="status" style="padding:32px">{{ $t("boot-failed", { reason: errorText }) }}</p>
    <template v-else>
      <p v-if="session.error" class="muted" role="status" style="padding:16px 32px 0">{{ errorText }}</p>
      <slot />
    </template>
  </main>
</template>
