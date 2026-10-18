<script setup lang="ts">
// Screen S-7, Administrace (viewAdmin() in the old page), for the administrator only: the server's access log (read
// each time the screen opens; reading it is logged too), the reset of the shared demo data where the server allows
// it, and the doctors' edits of extracted facts.
import { computed, onMounted, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import { useApi } from "../../lib/api";
import { editLogOf } from "../../lib/lists";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { usePatientsStore } from "../../stores/patients";
import { useSessionStore } from "../../stores/session";
import { useWorkflowStore } from "../../stores/workflow";
import ResetDemoDialog from "./ResetDemoDialog.vue";

type LogEntry = { at: string; who: string; case_id: string | null; what: string };

const { $t } = useFluent();
const me = useCurrentUser();
const text = useListText();
const session = useSessionStore();
const patients = usePatientsStore();
const workflow = useWorkflowStore();

const log = ref<LogEntry[] | null>(null);
const failed = ref(false);
const loading = ref(false);
async function load() {
  if (!me.isAdmin.value) return;
  loading.value = true;
  try {
    const r = (await useApi().accessLog()) as { entries?: LogEntry[] };
    log.value = r.entries ?? [];
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// A switch to the administrator while this screen is open reads the log then.
watch(() => me.isAdmin.value, (a) => {
  if (a) void load();
});

const resetEnabled = computed(() => !!session.health?.demo?.reset_enabled);
const resetOpen = ref(false);

// Newest first; the original value stays and the list only grows.
const edits = computed(() => editLogOf(workflow.cases).slice().reverse());
const caseIdOf = (file: string) => patients.byFile(file)?.id ?? file;
</script>

<template>
  <div v-if="!me.isAdmin.value" class="page"><p class="muted">{{ $t("admin-only") }}</p></div>
  <div v-else class="page">
    <div class="pagehead"><div><h1>{{ $t("admin-title") }}</h1><div class="muted small">{{ $t("admin-subtitle") }}</div></div></div>
    <section v-if="resetEnabled" class="card">
      <div class="head"><h2>{{ $t("admin-demo-title") }}</h2><button class="btn" @click="resetOpen = true">{{ $t("admin-reset") }}</button></div>
      <p class="muted small" style="margin:0">{{ $t("admin-reset-what") }}</p>
    </section>
    <section class="card" style="padding:0">
      <div class="scroll">
        <table class="tbl">
          <thead><tr><th>{{ $t("admin-col-time") }}</th><th>{{ $t("admin-col-user") }}</th><th>{{ $t("admin-col-case") }}</th><th>{{ $t("admin-col-action") }}</th></tr></thead>
          <tbody>
            <tr v-if="log === null || loading"><td colspan="4" class="muted" role="status">{{ $t("app-loading") }}</td></tr>
            <tr v-else-if="failed || !log.length"><td colspan="4" class="muted">{{ $t("admin-log-empty") }}</td></tr>
            <template v-else>
              <tr v-for="(a, i) in log" :key="i"><td class="num">{{ text.dateTime(a.at) }}</td><td>{{ a.who }}</td><td class="id">{{ a.case_id || "-" }}</td><td>{{ a.what }}</td></tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <div class="head"><h2>{{ $t("admin-edits-title", { n: edits.length }) }}</h2><span class="muted small">{{ $t("admin-edits-note") }}</span></div>
      <ul class="hist">
        <li v-for="(e, i) in edits" :key="i" class="small">
          <b>{{ caseIdOf(e.pid) }}</b> · {{ e.by }} · {{ text.dateTime(e.when) }}
          <template v-if="e.confirmed"> · <b>{{ $t("admin-edit-confirmed") }}</b><br>{{ $t("admin-edit-draft-unchanged") }} <span class="muted">{{ e.orig }}</span></template>
          <template v-else>
            <template v-if="e.reverted"> · <b>{{ $t("admin-edit-reverted") }}</b></template>
            <br>{{ $t("admin-edit-orig") }} <span class="muted">{{ e.orig || $t("lists-gap-not-stated") }}</span>
            <template v-if="!e.reverted"><br>{{ $t("admin-edit-new") }} {{ e.text }}</template>
          </template>
        </li>
        <li v-if="!edits.length" class="muted small">{{ $t("admin-edits-none") }}</li>
      </ul>
    </section>
    <p class="muted small">{{ $t("admin-footer") }}</p>
    <ResetDemoDialog v-if="resetOpen" @close="resetOpen = false" />
  </div>
</template>
