<script setup lang="ts">
// Route /patients: screen S-1. "+ Nový pacient" opens the new-patient dialog (mounted once in app.vue); the dialog
// itself refuses users who may not create patients. A finished intake that does not open the new patient returns to
// this list with its column filters cleared, as the old page did.
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import AppMain from "../components/AppMain.vue";
import PatientsView from "../components/lists/PatientsView.vue";
import { useNewPatient } from "../composables/useNewPatient";
import { defaultIntakeNavigation } from "../lib/intake-nav";
import { useListViewStore } from "../stores/listView";

const router = useRouter();
const newPatient = useNewPatient();
const v = useListViewStore();

onMounted(() => {
  const nav = defaultIntakeNavigation(router);
  newPatient.setNavigation({
    openPatient: nav.openPatient,
    showList: () => {
      v.filters = {};
      void router.push("/patients");
    },
  });
});
</script>

<template>
  <AppMain>
    <PatientsView @open-new-patient="newPatient.open()" />
  </AppMain>
</template>
