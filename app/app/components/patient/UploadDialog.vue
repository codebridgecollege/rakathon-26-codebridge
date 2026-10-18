<script setup lang="ts">
// "+ Nahrát dokument" in the documents tab (the upload branch of renderOverlay() in the template). As today it is a
// demonstration: "Vybrat soubory" stores nothing and only shows what would follow (the readability check). The real
// uploads of a case go through "Projednání na MDT" (CaseUploads) and "Nahrát z telefonu", offered here to a user who
// may add documents to an open, unapproved case (canUpload() in the template).
import { computed, ref } from "vue";
import { useFluent } from "fluent-vue";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import { useSessionStore } from "../../stores/session";
import { useOverlayStore } from "../../stores/overlay";
import PhoneUploadButton from "../phone/PhoneUploadButton.vue";

const props = defineProps<{ o: { kind: "upload"; file: string } }>();
const { $t } = useFluent();
const overlay = useOverlayStore();
const session = useSessionStore();
const p = computed(() => usePatientsStore().byFile(props.o.file));
const done = ref(false);
const canUpload = computed(() => {
  const role = session.me?.user.role;
  const proto = (p.value ? useWorkflowStore().cases[p.value.id]?.protocol : undefined) as { state?: string } | undefined;
  return (role === "doctor" || role === "coordinator") && p.value?.status !== "closed" && proto?.state !== "approved";
});
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" :aria-label="$t('patient-upload-title')">
    <div class="row spread"><h2>{{ $t("patient-upload-heading", { id: p?.id ?? "" }) }}</h2><button class="btn small" @click="overlay.close()">{{ $t("patient-close") }}</button></div>
    <div class="drop">{{ $t("patient-upload-drop") }}<br><button class="btn small" style="margin-top:8px" @click="done = true">{{ $t("patient-upload-pick") }}</button></div>
    <PhoneUploadButton v-if="canUpload && p" target="documents" :case-id="p.id" :file="p.file" />
    <p v-if="done" class="small" style="margin:0"><b>{{ $t("patient-upload-done-label") }}</b> {{ $t("patient-upload-done") }}</p>
    <p v-else class="muted small" style="margin:0">{{ $t("patient-upload-note") }}</p>
  </div>
</template>
