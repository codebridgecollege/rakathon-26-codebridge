<script setup lang="ts">
// Development harness, never in a production build (nuxt.config.ts drops pages named dev-* unless APP_DEV_PAGES=1).
// It opens the step 11 components outside the screens that will hold them, which are ported separately: "Nový
// pacient" (the patient list's button), the case upload panel of "Projednání na MDT" and the phone dialog. The
// e2e harness specs (e2e/harness/) drive it. Its own labels are English on purpose: it is not a screen users see.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { surnameFirst } from "@codebridge/domain/names";
import { definePageMeta } from "#imports";
import { usePatientsStore } from "../stores/patients";
import { useSessionStore } from "../stores/session";
import { useNewPatient } from "../composables/useNewPatient";
import CaseUploads from "../components/uploads/CaseUploads.vue";
import { defaultIntakeNavigation } from "../lib/intake-nav";

definePageMeta({ name: "dev-intake" });

const patients = usePatientsStore();
const session = useSessionStore();
const newPatient = useNewPatient();
const picked = ref("");
const locked = ref(false);
// The patient view is not ported yet: the harness shows where a finished intake would go instead of navigating.
const went = ref("");
const router = useRouter();
onMounted(() => newPatient.setNavigation({ openPatient: (f) => (went.value = `patient ${f}`), showList: () => (went.value = "patient list") }));
onBeforeUnmount(() => newPatient.setNavigation(defaultIntakeNavigation(router)));
const target = computed(() => patients.rows.find((p) => p.file === picked.value) ?? patients.rows.find((p) => p.id === "NO-S01") ?? patients.rows[0] ?? null);
</script>

<template>
  <main id="app" style="padding:16px;display:grid;gap:16px">
    <section v-if="session.phase === 'ready'">
      <h2>Patients (stand-in for the list)</h2>
      <button class="btn primary" @click="newPatient.open()">+ Nový pacient</button>
      <p v-if="went">Would open: {{ went }}</p>
      <table>
        <thead><tr><th>Name</th><th>Case</th><th>File</th></tr></thead>
        <tbody>
          <tr v-for="p in patients.rows" :key="p.file"><td>{{ surnameFirst(p) }}</td><td>{{ p.id }}</td><td>{{ p.file }}</td></tr>
        </tbody>
      </table>
    </section>
    <section v-if="target" aria-label="Case uploads">
      <h2>Uploads of {{ target.id }}</h2>
      <label>Case <select v-model="picked"><option v-for="p in patients.rows" :key="p.file" :value="p.file">{{ p.id }}</option></select></label>
      <label><input v-model="locked" type="checkbox"> locked</label>
      <CaseUploads :case-ref="{ file: target.file, id: target.id }" :locked="locked" :why="locked ? 'Locked in the harness.' : ''" />
    </section>
  </main>
</template>
