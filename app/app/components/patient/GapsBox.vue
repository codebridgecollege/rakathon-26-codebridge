<script setup lang="ts">
// The brief's alert panel behind "⚠ Upozornění": the alerts for the MDT question first
// (CLAUDE.md: question-relevant alerts first), then the brief's own data gaps; the full list stays in the tab.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import { topAlerts } from "@codebridge/domain/case-view";
import { nrOf } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";
import AlertRow from "./AlertRow.vue";
import AlertArchive from "./AlertArchive.vue";

const { $t } = useFluent();
const c = usePatient();
const router = useRouter();

const t = computed(() => topAlerts(c.cd.value?.alerts ?? null, c.alertHist.value));
const gaps = computed(() => t.value.open.filter((f) => String(f.i).startsWith("gap:")));

function allAlerts() {
  void router.push({ name: "patient", params: { nr: nrOf(c.p.value.file), tab: "alerts" } });
}
</script>

<template>
  <div class="brief-gaps">
    <div class="row spread">
      <span class="label">{{ t.top.length ? $t("patient-gaps-for-question") : $t("patient-gaps-title") }}</span>
      <button class="linkbtn small" @click="allAlerts">{{ $t("patient-gaps-all") }}</button>
    </div>
    <div v-if="t.top.length" class="alerts" role="list" style="margin-top:6px">
      <AlertRow v-for="f in t.top" :key="String(f.i)" :f="f" compact />
    </div>
    <p v-if="!t.top.length && !gaps.length" class="muted small">{{ $t("patient-gaps-none") }}</p>
    <template v-if="gaps.length">
      <!-- A case without an extracted brief has data gaps of its documents, not of a summary. -->
      <span class="label" style="display:block;margin-top:12px">{{ c.sec.value.brief ? $t("patient-gaps-brief") : $t("patient-gaps-documents") }}</span>
      <div class="alerts" role="list" style="margin-top:6px">
        <AlertRow v-for="f in gaps" :key="String(f.i)" :f="f" compact />
      </div>
    </template>
    <AlertArchive :items="t.archived" compact />
    <div class="disclaim">{{ $t("patient-alerts-disclaimer") }}</div>
  </div>
</template>
