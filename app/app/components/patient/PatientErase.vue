<script setup lang="ts">
// "Smazat pacienta" at the bottom of the patient view, away from the buttons people press during their work. Erasing
// cannot be undone (DATABASE.md, "Erasing a patient"), so the person types the word; the server checks it again. The
// list goes first, because the patient view reads this row until it closes.
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { ApiError } from "@codebridge/api-client";
import { usePatient } from "../../composables/usePatient";
import { useCasesStore } from "../../stores/cases";
import { useSessionStore } from "../../stores/session";
import { useApi } from "../../lib/api";
import { surnameFirst } from "../../lib/patientRow";
import { toast } from "../../lib/toast";

const { $t } = useFluent();
const router = useRouter();
const c = usePatient();
const session = useSessionStore();

async function erase() {
  if (window.prompt($t("patient-erase-prompt", { name: surnameFirst(c.p.value) })) !== "SMAZAT") return;
  try {
    const r = await useApi().eraseCase(c.p.value.id, "SMAZAT");
    toast($t(r.data?.files_left ? "patient-erased-files-left" : "patient-erased"));
    await router.push("/patients");
    useCasesStore().reset();
    // The erasure is done; a list that fails to reload is not a failed erasure, and the next load corrects it.
    await session.loadFromApi().catch(() => {});
  } catch (e) {
    toast(e instanceof ApiError && e.message_cs ? e.message_cs : $t("patient-erase-failed"));
  }
}
</script>

<template>
  <div class="patient-erase"><button class="btn" @click="erase">{{ $t("patient-erase") }}</button></div>
</template>
