<script setup lang="ts">
// "Import z NIS" (issue #22, phase 1): find the case's patient in the hospital system (NIS, read over FHIR) and link one
// record to the patient. The person picks; the server reads the record again, refuses a different birth number and a
// record the NIS merged into another, and asks for confirmation when the patient here has no birth number. Nothing is
// merged. The national register is a labelled stub. Unlinking asks first: it takes the NIS data and the documents the
// import brought out of the patient's cases.
import { computed, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import type { NisCandidate, NisLink, NisSearch, NisStatus } from "@codebridge/domain/wire";
import { useApi } from "../../lib/api";
import { errMsg, msgId, useMsg, type Msg } from "../../lib/msg";
import { useOverlayStore } from "../../stores/overlay";

const props = defineProps<{ o: { kind: "nis"; caseId: string } }>();
const { $t } = useFluent();
const fmt = useMsg();
const overlay = useOverlayStore();
const api = useApi();

const status = ref<NisStatus | null>(null);
const result = ref<NisSearch | null>(null);
const link = ref<NisLink | null>(null);
// Typed only when the patient row has no birth number; it goes to the server in the request body and nowhere else.
const typed = ref("");
const confirmed = ref<Record<string, boolean>>({});
const busy = ref(false);
const msg = ref<Msg | null>(null);
// Unlinking deletes the documents the import brought into the patient's cases, so it asks once more before it runs.
const confirmUnlink = ref(false);

onMounted(async () => {
  try {
    status.value = await api.nisStatus(props.o.caseId);
    link.value = status.value.link;
  } catch (e) {
    msg.value = errMsg(e);
  }
});

async function run<T>(fn: () => Promise<T>): Promise<T | null> {
  busy.value = true;
  msg.value = null;
  try {
    return await fn();
  } catch (e) {
    msg.value = errMsg(e);
    return null;
  } finally {
    busy.value = false;
  }
}

const body = () => (status.value?.has_birth_number ? {} : { birth_number: typed.value.trim() });

async function search() {
  const r = await run(() => api.nisSearch(props.o.caseId, body()));
  if (r) {
    result.value = r.data;
    link.value = r.data.link;
  }
}

async function linkTo(c: NisCandidate) {
  const r = await run(() => api.nisLink(props.o.caseId, { nis_patient_id: c.nis_id, ...body(), ...(c.needs_confirmation ? { confirm_unverified: !!confirmed.value[c.nis_id] } : {}) }));
  if (r) {
    link.value = r.data.link;
    result.value = null;
  }
}

async function unlink() {
  const r = await run(() => api.nisUnlink(props.o.caseId));
  confirmUnlink.value = false;
  if (r) {
    link.value = null;
    const d = r.data.documents;
    msg.value = msgId("patient-nis-unlinked", { withdrawn: d.withdrawn, pending: d.withdraw_pending, other: d.not_allowed });
  }
}

const label = computed(() => status.value?.label_cs ?? result.value?.label_cs ?? "");
const gender = (g: string | null) => (g === "male" ? $t("patient-nis-gender-male") : g === "female" ? $t("patient-nis-gender-female") : "-");
const identityText = (c: NisCandidate) =>
  c.identity === "matches" ? $t("patient-nis-identity-matches") : c.identity === "conflicts" ? $t("patient-nis-identity-conflicts") : $t("patient-nis-identity-unverified");
const linkedText = (l: NisLink) =>
  l.identity_check === "matches" ? $t("patient-nis-linked-matches") : l.identity_check === "matches_name_differs" ? $t("patient-nis-linked-name-differs") : $t("patient-nis-linked-unverified");
const nameText = (c: NisCandidate) => (c.name_match === "spelling" ? $t("patient-nis-name-spelling") : c.name_match === "different" ? $t("patient-nis-name-different") : "");
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" aria-modal="true" :aria-label="$t('patient-nis-title')">
    <div class="row spread">
      <h2>{{ $t("patient-nis-heading", { id: o.caseId }) }}</h2>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-close") }}</button>
    </div>
    <p v-if="label" class="muted small" style="margin:0">{{ $t("patient-nis-source", { label }) }}</p>

    <div v-if="link" class="card" style="margin:0">
      <p style="margin:0"><b>{{ $t("patient-nis-linked", { id: link.nis_patient_id }) }}</b></p>
      <p class="muted small" style="margin:4px 0 0">
        {{ linkedText(link) }}
        {{ $t("patient-nis-linked-by", { name: link.by_name, at: link.at.slice(0, 10) }) }}
      </p>
      <p class="muted small" style="margin:4px 0 0">{{ $t("patient-nis-phase-note") }}</p>
      <button v-if="!confirmUnlink" class="btn small" style="margin-top:8px" :disabled="busy" @click="confirmUnlink = true">{{ $t("patient-nis-unlink") }}</button>
      <template v-else>
        <p class="small" style="margin:8px 0 0">{{ $t("patient-nis-unlink-warning") }}</p>
        <div class="row" style="margin-top:6px">
          <button class="btn small" :disabled="busy" @click="unlink">{{ $t("patient-nis-unlink-confirm") }}</button>
          <button class="btn small" :disabled="busy" @click="confirmUnlink = false">{{ $t("patient-nis-unlink-cancel") }}</button>
        </div>
      </template>
    </div>

    <template v-else-if="status">
      <p class="small" style="margin:0">{{ $t("patient-nis-intro") }}</p>
      <p class="muted small" style="margin:0">{{ $t("patient-nis-phase-note") }}</p>
      <label v-if="!status.has_birth_number" class="small" style="display:block">
        {{ $t("patient-nis-rc-label") }}
        <input v-model="typed" class="input" inputmode="numeric" autocomplete="off" :placeholder="$t('patient-nis-rc-placeholder')" style="margin-left:6px">
        <span class="muted" style="display:block">{{ $t("patient-nis-rc-missing") }}</span>
      </label>
      <div class="row">
        <button class="btn primary" :disabled="busy || (!status.has_birth_number && !typed.trim())" @click="search">
          {{ status.has_birth_number ? $t("patient-nis-search-own") : $t("patient-nis-search") }}
        </button>
      </div>
    </template>

    <p v-if="msg" class="small" role="status" style="margin:0">{{ fmt(msg) }}</p>

    <template v-if="result && !link">
      <p v-if="!result.candidates.length" class="small" style="margin:0">{{ $t("patient-nis-none") }}</p>
      <p v-if="result.duplicates" class="question missing small" style="margin:0;padding:6px 10px">{{ $t("patient-nis-duplicates") }}</p>
      <p v-if="result.truncated" class="muted small" style="margin:0">{{ $t("patient-nis-truncated") }}</p>
      <p v-if="result.other_records_hidden" class="muted small" style="margin:0">{{ $t("patient-nis-hidden", { n: result.other_records_hidden }) }}</p>
      <ul class="nis-cands" style="list-style:none;padding:0;margin:0;display:grid;gap:8px">
        <li v-for="c in result.candidates" :key="c.nis_id" class="card" style="margin:0">
          <div class="row spread">
            <b lang="cs">{{ c.name ?? "-" }}</b>
            <span class="muted small">{{ $t("patient-nis-record", { id: c.nis_id }) }}</span>
          </div>
          <p class="small" style="margin:4px 0 0">
            {{ $t("patient-nis-born") }} {{ c.birth_date ?? "-" }} · {{ gender(c.gender) }} · {{ identityText(c) }}
            <span v-if="nameText(c)"> · {{ nameText(c) }}</span>
          </p>
          <p v-if="c.reason_cs" class="small" style="margin:4px 0 0" lang="cs">{{ c.reason_cs }}</p>
          <template v-if="c.linkable">
            <label v-if="c.needs_confirmation" class="small" style="display:block;margin-top:6px">
              <input v-model="confirmed[c.nis_id]" type="checkbox"> {{ $t("patient-nis-confirm") }}
            </label>
            <button class="btn small" style="margin-top:6px" :disabled="busy || (c.needs_confirmation && !confirmed[c.nis_id])" @click="linkTo(c)">
              {{ $t("patient-nis-link") }}
            </button>
          </template>
        </li>
      </ul>
    </template>

    <p v-if="status" class="synth small" style="margin:0;border-style:dashed">
      <b>{{ $t("patient-nis-register-label") }}</b> <span lang="cs">{{ status.national_register.message_cs }}</span>
    </p>
  </div>
</template>
