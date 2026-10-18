<script setup lang="ts">
// "Upravit údaj". An edit
// never changes the source document or the extracted value: it is stored next to it with who and when, and the
// original stays in the case history. The server names the edit it replaces (expected_edit_id), so a colleague's
// parallel edit is reported, not lost. Saving the original text or nothing means "back to the original".
import { computed, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import { usePatientsStore } from "../../stores/patients";
import { useSessionStore } from "../../stores/session";
import { useWorkflowStore } from "../../stores/workflow";
import { useOverlayStore } from "../../stores/overlay";
import { useApi } from "../../lib/api";
import { caseWrite } from "../../lib/writes";
import { toast } from "../../lib/toast";

type EditOverlay = { kind: "edit"; file: string; key: string; orig: string; isQuestion: boolean };
const props = defineProps<{ o: EditOverlay }>();
const { $t } = useFluent();
const overlay = useOverlayStore();
const session = useSessionStore();
const p = computed(() => usePatientsStore().byFile(props.o.file));
const cur = computed(() => {
  const id = p.value?.id;
  const edits = (id ? useWorkflowStore().cases[id]?.edits : undefined) as Record<string, { id?: number | null; text: string }> | undefined;
  return edits?.[props.o.key];
});
const text = ref(cur.value?.text ?? props.o.orig);
const box = ref<HTMLTextAreaElement | null>(null);
onMounted(() => box.value?.focus());

function save(revertAsked: boolean) {
  const pr = p.value;
  if (!pr) return;
  const txt = text.value.trim();
  const revert = revertAsked || !txt || txt === props.o.orig;
  const c = cur.value;
  if (revert && !c) {
    overlay.close();
    return;
  }
  const api = useApi();
  void caseWrite(
    $t,
    () =>
      revert
        ? api.deleteEdit(pr.id, props.o.key, { expected_edit_id: c!.id ?? null })
        : api.putEdit(pr.id, props.o.key, { text: txt, orig: props.o.orig ?? "", expected_edit_id: c?.id ?? null }),
    {
      busyKey: `edit:${pr.file}|${props.o.key}`,
      onOk: () => {
        if (overlay.isOpen(props.o)) overlay.close();
        toast(revert ? $t("patient-edit-reverted") : $t("patient-edit-saved"));
      },
    },
  );
}
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" aria-modal="true" :aria-label="$t('patient-edit-dialog')">
    <div class="row spread"><h2>{{ o.isQuestion ? $t("patient-question-title") : $t("patient-edit-dialog") }}</h2><button class="btn small" @click="overlay.close()">{{ $t("patient-close") }}</button></div>
    <div v-if="o.orig" class="small"><span class="label">{{ $t("patient-edit-original") }}</span><p style="margin:2px 0 0" lang="cs">{{ o.orig }}</p></div>
    <textarea ref="box" v-model="text" class="input" lang="cs" :aria-label="o.isQuestion ? $t('patient-question-title') : $t('patient-edit-dialog')" />
    <p class="muted small" style="margin:0">{{ $t("patient-edit-note", { user: session.me?.user.name ?? "" }) }}</p>
    <div class="row" style="justify-content:flex-end">
      <button v-if="cur" class="btn" @click="save(true)">{{ $t("patient-edit-revert") }}</button>
      <button class="btn primary" @click="save(false)">{{ $t("patient-edit-save") }}</button>
    </div>
  </div>
</template>
