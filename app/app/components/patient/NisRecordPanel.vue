<script setup lang="ts">
// "Záznam z NIS" (issue #22): the source viewer for a fact that rests on a record in the hospital system. A NIS record
// has no page and no quote; it is its own evidence, so the panel shows which record it is (as the run cites it) and,
// read live from the NIS, the record's own fields, with the whole record one click away. When the NIS now holds a
// newer version than the one the fact was taken from, the panel says so: the fact is not changed by opening it.
import { computed, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import type { NisRef } from "@codebridge/domain/case-data";
import type { NisRecord } from "@codebridge/domain/wire";
import { useApi } from "../../lib/api";
import { fmtWhen } from "../../lib/dates";
import Gap from "./Gap.vue";
import { errMsg, useMsg, type Msg } from "../../lib/msg";
import { useOverlayStore } from "../../stores/overlay";

const props = defineProps<{ o: { kind: "nisrecord"; caseId: string; ref: NisRef } }>();
const { $t } = useFluent();
const fmt = useMsg();
const overlay = useOverlayStore();

const rec = ref<NisRecord | null>(null);
const msg = ref<Msg | null>(null);
const loading = ref(true);
const showJson = ref(false);

onMounted(async () => {
  try {
    rec.value = await useApi().nisRecord(props.o.caseId, props.o.ref.resource, props.o.ref.system);
  } catch (e) {
    msg.value = errMsg(e);
  } finally {
    loading.value = false;
  }
});

// A change is claimed only when both versions are known and differ (FHIR does not order version IDs, so "differs",
// not "newer"); without versions, both last-updated times must be known and differ.
const changed = computed(() => {
  const r = rec.value;
  if (!r) return false;
  if (r.version && props.o.ref.version) return r.version !== props.o.ref.version;
  return !!(r.last_updated && props.o.ref.last_updated && r.last_updated !== props.o.ref.last_updated);
});
const json = computed(() => (rec.value ? JSON.stringify(rec.value.record, null, 2) : ""));
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" aria-modal="true" :aria-label="$t('patient-nisrec-title')">
    <div class="row spread">
      <h2>{{ $t("patient-nisrec-title") }}</h2>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-close") }}</button>
    </div>
    <p class="muted small" style="margin:0">
      {{ $t("patient-nisrec-cited", { resource: o.ref.resource }) }}
      {{ $t("patient-nisrec-cited-version") }} <span v-if="o.ref.version">{{ o.ref.version }}</span><Gap v-else />,
      {{ $t("patient-nisrec-cited-updated") }} <span v-if="o.ref.last_updated">{{ fmtWhen(o.ref.last_updated) }}</span><Gap v-else />
    </p>
    <p v-if="loading" class="small" role="status" style="margin:0">{{ $t("patient-nisrec-loading") }}</p>
    <p v-if="msg" class="small" role="status" style="margin:0">{{ fmt(msg) }}</p>
    <template v-if="rec">
      <p class="muted small" style="margin:0">{{ $t("patient-nisrec-source", { label: rec.label_cs }) }}</p>
      <p v-if="changed" class="question missing small" style="margin:0;padding:6px 10px">{{ $t("patient-nisrec-changed") }}</p>
      <h3 class="small" style="margin:0">{{ $t("patient-nisrec-now") }}</h3>
      <table class="small nisrec">
        <tbody>
          <tr v-for="f in rec.fields" :key="f.field">
            <th scope="row" style="text-align:left;padding-right:12px;vertical-align:top">{{ $t(`patient-nisrec-field-${f.field}`) }}</th>
            <td lang="cs" style="white-space:pre-wrap">{{ f.value }}</td>
          </tr>
        </tbody>
      </table>
      <div class="row">
        <button class="btn small" :aria-expanded="showJson" @click="showJson = !showJson">{{ showJson ? $t("patient-nisrec-hide-record") : $t("patient-nisrec-show-record") }}</button>
      </div>
      <pre v-if="showJson" style="margin:0;max-height:40vh;overflow:auto;background:var(--sunk);border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere">{{ json }}</pre>
    </template>
  </div>
</template>
