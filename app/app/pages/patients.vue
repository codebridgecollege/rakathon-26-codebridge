<script setup lang="ts">
// Route /patients: screen S-1. "+ Nový pacient" opens the new-patient dialog, which is ported separately (issue #13,
// step 11): it mounts here, under newPatientOpen.
import { ref } from "vue";
import { useFluent } from "fluent-vue";
import AppMain from "../components/AppMain.vue";
import PatientsView from "../components/lists/PatientsView.vue";
import { toast } from "../lib/toast";
import { useCurrentUser } from "../composables/useCurrentUser";

const { $t } = useFluent();
const me = useCurrentUser();
const newPatientOpen = ref(false);

function openNewPatient() {
  // The administrator only reads; the server refuses the case too.
  if (!me.canRunCases.value) {
    toast($t("patients-new-refused"));
    return;
  }
  newPatientOpen.value = true;
}
</script>

<template>
  <AppMain>
    <PatientsView @open-new-patient="openNewPatient" />
  </AppMain>
</template>
