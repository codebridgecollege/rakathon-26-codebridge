<script setup lang="ts">
// Screen S-7, Administrace, for the administrator only: the server's access log (read
// each time the screen opens; reading it is logged too), the reset of the shared demo data where the server allows
// it, and the doctors' edits of extracted facts.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiError } from "@codebridge/api-client";
import { useFluent } from "fluent-vue";
import { useApi } from "../../lib/api";
import { editLogOf } from "../../lib/lists";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { usePatientsStore } from "../../stores/patients";
import { useSessionStore } from "../../stores/session";
import { useWorkflowStore } from "../../stores/workflow";
import ResetDemoDialog from "./ResetDemoDialog.vue";

// acted_as: after a role switch in a demo org, the person acted as; who stays the person logged in.
type LogEntry = { at: string; who: string; acted_as?: string | null; case_id: string | null; what: string };

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

// "Probudit čtečku stránek": only where the pipeline runs for this org (never in demo org A). The first call after a
// deploy may find the container still starting; the page then asks again a few times on its own, with no error shown.
const pipelineOn = computed(() => session.me?.features?.pipeline === true);
const WARM_TRIES = 6;
const WARM_PAUSE_MS = 10_000;
const warm = ref<"idle" | "waking" | "ready" | "starting">("idle");
// The loop belongs to this screen and this user: leaving the screen, or a switch of org or role, ends it, so no try
// goes out later under another session (a refused one would land in that org's access log).
let wakeGen = 0;
const owner = () => `${session.me?.org?.id ?? ""}|${session.me?.membership_id ?? ""}`;
onBeforeUnmount(() => wakeGen++);
watch(owner, () => {
  wakeGen++;
  warm.value = "idle";
});
async function wake() {
  if (warm.value === "waking") return;
  const mine = ++wakeGen;
  warm.value = "waking";
  for (let i = 0; i < WARM_TRIES; i++) {
    try {
      const r = await useApi().warmPipeline();
      if (mine !== wakeGen) return;
      if (r.data.ok) {
        warm.value = "ready";
        return;
      }
    } catch (e) {
      if (mine !== wakeGen) return;
      // A refusal (no permission, pipeline off for the org, session gone) will not change by waiting: stop quietly.
      // Only an unanswered call (network, timeout, a cold instance) is tried again.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) break;
      if (e instanceof ApiError && e.code === "pipeline_off") break;
    }
    if (i < WARM_TRIES - 1) await new Promise((r) => setTimeout(r, WARM_PAUSE_MS));
    if (mine !== wakeGen) return;
  }
  warm.value = "starting";
}
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
    <section v-if="pipelineOn" class="card">
      <div class="head"><h2>{{ $t("admin-pipeline-title") }}</h2><button class="btn" :disabled="warm === 'waking'" @click="wake">{{ $t("admin-pipeline-wake") }}</button></div>
      <p class="muted small" style="margin:0" role="status">{{ warm === "waking" ? $t("admin-pipeline-waking") : warm === "ready" ? $t("admin-pipeline-ready") : warm === "starting" ? $t("admin-pipeline-starting") : $t("admin-pipeline-what") }}</p>
    </section>
    <section class="card" style="padding:0">
      <div class="scroll">
        <table class="tbl">
          <thead><tr><th>{{ $t("admin-col-time") }}</th><th>{{ $t("admin-col-user") }}</th><th>{{ $t("admin-col-case") }}</th><th>{{ $t("admin-col-action") }}</th></tr></thead>
          <tbody>
            <tr v-if="log === null || loading"><td colspan="4" class="muted" role="status">{{ $t("app-loading") }}</td></tr>
            <tr v-else-if="failed || !log.length"><td colspan="4" class="muted">{{ $t("admin-log-empty") }}</td></tr>
            <template v-else>
              <tr v-for="(a, i) in log" :key="i"><td class="num">{{ text.dateTime(a.at) }}</td><td>{{ a.acted_as ? $t("admin-log-acting-as", { who: a.who, as: a.acted_as }) : a.who }}</td><td class="id">{{ a.case_id || "-" }}</td><td>{{ a.what }}</td></tr>
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
