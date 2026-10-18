<script setup lang="ts">
// Break-the-glass (INTEGRATION.md): a
// doctor outside the case's team opens it only with a stated reason, which the server keeps in the access log for
// review; the grant expires. After the grant the case is opened again, so the server logs that opening and sends the
// case data.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { usePatientsStore } from "../../stores/patients";
import { useCasesStore } from "../../stores/cases";
import { useOverlayStore } from "../../stores/overlay";
import { useApi } from "../../lib/api";
import { errorText, reloadWorkflow } from "../../lib/writes";
import { toast } from "../../lib/toast";

type BgOverlay = { kind: "breakglass"; file: string; msg: string };
const props = defineProps<{ o: BgOverlay }>();
const { $t } = useFluent();
const overlay = useOverlayStore();
const router = useRouter();
const p = computed(() => usePatientsStore().byFile(props.o.file));
const why = ref("");
const err = ref<string | null>(null);
const busy = ref(false);

async function go() {
  const pr = p.value;
  if (!pr) return;
  const reason = why.value.trim();
  if (reason.length < 10 || reason.length > 500) {
    err.value = $t("patient-bg-reason-invalid");
    return;
  }
  if (busy.value) return;
  busy.value = true;
  err.value = null;
  try {
    await useApi().breakGlass(pr.id, { reason });
  } catch (e) {
    busy.value = false;
    err.value = errorText($t, e);
    return;
  }
  overlay.close();
  // The workflow loaded at startup left this case out (no access then); read it now, so its decisions and tasks show.
  await reloadWorkflow();
  const cases = useCasesStore();
  const e = cases.caseOf(pr.file);
  Object.assign(e, { state: "absent", error: null });
  delete e.guide;
  toast($t("patient-bg-granted"));
  // The opening under the grant is an access of its own in the server's log.
  useApi().caseHeader(pr.id).catch((x: unknown) => toast(errorText($t, x)));
  void cases.ensureCase(pr);
}

function back() {
  overlay.close();
  void router.push("/patients");
}
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" aria-modal="true" :aria-label="$t('patient-bg-title')">
    <div class="row spread"><h2>{{ $t("patient-bg-heading", { id: p?.id ?? "" }) }}</h2><button class="btn small" @click="overlay.close()">{{ $t("patient-close") }}</button></div>
    <p style="margin:0">{{ $t("patient-bg-intro") }}</p>
    <label class="label" for="bgwhy">{{ $t("patient-bg-reason") }}</label>
    <textarea id="bgwhy" v-model="why" class="input" maxlength="500" :aria-invalid="err ? 'true' : undefined" :aria-describedby="err ? 'bgwhy-err' : undefined" />
    <span v-if="err" id="bgwhy-err" class="ferr" role="alert">{{ err }}</span>
    <p class="muted small" style="margin:0">{{ $t("patient-bg-note") }}</p>
    <div class="row" style="justify-content:flex-end">
      <button class="btn" @click="back">{{ $t("patient-bg-back") }}</button>
      <button class="btn primary" :disabled="busy" @click="go">{{ $t("patient-bg-title") }}</button>
    </div>
  </div>
</template>
