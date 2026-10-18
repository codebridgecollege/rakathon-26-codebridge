<script setup lang="ts">
// "Obnovit ukázková data": the shared demo goes back to the
// seed, and the page reloads so every screen shows it.
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import { useApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useDialogFocus } from "../../lib/dialog";
import { useWrite } from "../../composables/useWrite";

const emit = defineEmits<{ close: [] }>();
const { $t } = useFluent();
const { errorText } = useWrite();
const busy = ref(false);
const err = ref<string | null>(null);

// Replaceable in tests, so a test can see the reload without leaving the page.
const props = defineProps<{ reload?: () => void }>();
const RELOAD_MS = 1200;

async function go() {
  if (busy.value) return;
  busy.value = true;
  err.value = null;
  try {
    await useApi().resetDemo({ confirm: "OBNOVIT" });
  } catch (e) {
    busy.value = false;
    err.value = errorText(e);
    return;
  }
  emit("close");
  toast($t("admin-reset-done"));
  setTimeout(() => (props.reload ?? (() => location.reload()))(), RELOAD_MS);
}

const box = ref<HTMLElement | null>(null);
const opener = document.activeElement as HTMLElement | null;
// Tab and Shift+Tab stay inside the dialog (the app's shared dialog focus handling).
const { onKeydown: keepTabInside } = useDialogFocus(box, ref(true));
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(async () => {
  document.addEventListener("keydown", onKey);
  await nextTick();
  box.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  opener?.focus?.();
});
</script>

<template>
  <Teleport defer to="#overlay">
    <div class="scrim" @click="emit('close')" />
    <div ref="box" class="modal" role="dialog" aria-modal="true" @keydown="keepTabInside" :aria-label="$t('admin-reset')" tabindex="-1">
      <div class="row spread"><h2>{{ $t("admin-reset") }}</h2><button class="btn small" @click="emit('close')">{{ $t("lists-dialog-close") }}</button></div>
      <p style="margin:0">{{ $t("admin-reset-what") }}</p>
      <span v-if="err" class="ferr" role="alert">{{ err }}</span>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" @click="emit('close')">{{ $t("lists-dialog-cancel") }}</button>
        <button class="btn primary" :disabled="busy" @click="go">{{ $t("admin-reset") }}</button>
      </div>
    </div>
  </Teleport>
</template>
