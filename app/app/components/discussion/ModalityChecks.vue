<script setup lang="ts">
// "Léčebné modality" in the side panel: for each common treatment modality, the documented facts that bear on it, each
// with its source (modality-checks.ts). The assistant's observation, labelled as such; a modality with no hit is not
// shown as safe, and the data the check needs but the documents lack is listed as missing.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { MODALITIES, modalityChecksOf, type Modality } from "@codebridge/domain/modality-checks";
import { usePatient } from "../../composables/usePatient";
import Marks from "../patient/Marks.vue";
import MdtSource from "./MdtSource.vue";

const { $t } = useFluent();
const c = usePatient();
const result = computed(() => modalityChecksOf(c.cd.value));
const found = (m: Modality) => result.value.checks.find((x) => x.modality === m)?.findings ?? [];
const missing = computed(() => result.value.missing.map((m) => $t(`mdt-panel-missing-${m}`)).join(", "));
</script>

<template>
  <section class="mdtp-sec" data-test="modality-checks">
    <h3>{{ $t("mdt-panel-modalities") }}</h3>
    <p class="muted small" style="margin:0 0 6px">{{ $t("mdt-panel-modalities-note") }}</p>
    <!-- All four modalities always show, so one without a hit does not look cleared by being absent. -->
    <div v-for="m in MODALITIES" :key="m" class="mdtp-mod">
      <div class="mdtp-sub">{{ $t(`mdt-panel-mod-${m}`) }}</div>
      <ul v-if="found(m).length" class="mdtp-list">
        <li v-for="(f, i) in found(m)" :key="i">
          <MdtSource :source="f.source" :text="f.date ? `${f.text} (${f.date})` : f.text" /> <Marks :f="f.item" />
          <span class="muted small" lang="cs"> {{ f.why_cs }}</span>
        </li>
      </ul>
      <p v-else class="muted small" style="margin:0">{{ $t("mdt-panel-mod-nothing") }}</p>
    </div>
    <p class="muted small">{{ $t("mdt-panel-mod-limited") }}</p>
    <p v-if="result.missing.length" class="muted small">{{ $t("mdt-panel-missing", { what: missing }) }}</p>
  </section>
</template>
