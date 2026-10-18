<script setup lang="ts">
// "Přihlášení vypršelo" (docs/design/AUTH.md, "Losing the session mid-work"): the login session ended while a draft or a
// recording was not stored. The page stays; the login opens in a second window, and once it is back the refused
// requests go out again. Checked again when this window gets focus back, so a closed login window is often enough.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import { useDialogFocus } from "../lib/dialog";
import { useSessionStore } from "../stores/session";

const { $t } = useFluent();
const session = useSessionStore();
const open = computed(() => session.expired !== null);
const box = ref<HTMLElement | null>(null);
const { onKeydown } = useDialogFocus(box, open);

function onFocus() {
  if (session.expired === "waiting" || session.expired === "still") void session.checkLogin();
}
onMounted(() => window.addEventListener("focus", onFocus));
onBeforeUnmount(() => window.removeEventListener("focus", onFocus));
</script>

<template>
  <Teleport defer to="#overlay">
    <template v-if="open">
      <div class="scrim" />
      <div ref="box" class="modal" role="alertdialog" aria-modal="true" :aria-label="$t('session-expired-title')" tabindex="-1" @keydown="onKeydown">
        <h2>{{ $t("session-expired-title") }}</h2>
        <template v-if="session.expired === 'other'">
          <p role="alert" style="margin:0">{{ $t("session-expired-other") }}</p>
          <div class="row" style="justify-content:flex-end">
            <button class="btn primary" @click="session.reloadAfterOtherLogin()">{{ $t("session-expired-reload") }}</button>
          </div>
        </template>
        <template v-else>
          <p style="margin:0">{{ $t("session-expired-body") }}</p>
          <span v-if="session.expired === 'still'" class="ferr" role="alert">{{ $t("session-expired-still") }}</span>
          <span v-if="session.expired === 'checking'" class="muted small" role="status">{{ $t("session-expired-checking") }}</span>
          <div class="row" style="justify-content:flex-end">
            <button class="btn" @click="session.openLoginWindow()">{{ $t("session-expired-login") }}</button>
            <button class="btn primary" :disabled="session.expired === 'checking'" @click="session.checkLogin()">{{ $t("session-expired-retry") }}</button>
          </div>
        </template>
      </div>
    </template>
  </Teleport>
</template>
