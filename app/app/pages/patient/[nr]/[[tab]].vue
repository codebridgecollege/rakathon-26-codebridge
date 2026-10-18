<script setup lang="ts">
// The patient detail route, #/patient/<nr>/<tab> (screen S-3). Old links without the slash (#patient/10/labs) reach
// this route too: Vue Router reads the hash after "#" as the path, so "patient/10/labs" becomes "/patient/10/labs".
// Opening a case is an access the server logs (GET /cases/:id); a refusal returns to the list, and a doctor outside
// the case's team is offered break-the-glass instead.
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { definePageMeta } from "#imports";
import { ApiError } from "@codebridge/api-client";
import { nrOf } from "@codebridge/domain/case-data";
import PatientView from "../../../components/patient/PatientView.vue";
import { useSessionStore } from "../../../stores/session";
import { usePatientsStore } from "../../../stores/patients";
import { useOverlayStore } from "../../../stores/overlay";
import { useApi } from "../../../lib/api";
import { toast } from "../../../lib/toast";
import { errorText } from "../../../lib/writes";
import { consumeViaLink } from "../../../lib/navigation";

definePageMeta({ name: "patient" });

const { $t } = useFluent();
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const patients = usePatientsStore();
const overlay = useOverlayStore();

const nr = computed(() => String(route.params.nr ?? ""));
const tab = computed(() => (route.params.tab ? String(route.params.tab) : null));
const row = computed(() => patients.rows.find((p) => nrOf(p.file) === nr.value) ?? null);
const errorMsg = computed(() => {
  const e = session.error;
  return e ? (e.message_cs ?? $t(e.message_id ?? "api-error-request-failed")) : "";
});

// Each opening of a case (a new case, a reload, back or forward) goes to the server's access log.
watch(
  () => [session.phase, row.value?.file, session.me?.user.id] as const,
  ([phase, file], prev) => {
    if (phase !== "ready") return;
    const p = row.value;
    if (!p) {
      // A case this user may not see, or a number that is no case: back to the list, as an unknown link does today.
      void router.replace({ name: "view", params: { view: "patients" } });
      return;
    }
    if (prev && prev[0] === "ready" && prev[1] === file && prev[2] === session.me?.user.id) return;
    const viaLink = consumeViaLink();
    useApi()
      .caseHeader(p.id, viaLink)
      .catch((e: unknown) => {
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "not_member" && session.me?.user.role === "doctor" && row.value?.file === p.file) {
          overlay.open({ kind: "breakglass", file: p.file, msg: err.message_cs ?? "" });
          return;
        }
        toast(errorText($t, e));
        if (err && err.status >= 400 && err.status < 500 && row.value?.file === p.file) {
          overlay.close();
          void router.push({ name: "view", params: { view: "patients" } });
        }
      });
  },
  { immediate: true },
);
</script>

<template>
  <main id="app">
    <p v-if="session.phase === 'booting'" class="muted" role="status" style="padding:32px">{{ $t("app-loading") }}</p>
    <p v-else-if="session.phase === 'failed'" class="muted" role="status" style="padding:32px">{{ $t("boot-failed", { reason: errorMsg }) }}</p>
    <PatientView v-else-if="row" :key="row.file" :file="row.file" :tab="tab" />
  </main>
</template>
