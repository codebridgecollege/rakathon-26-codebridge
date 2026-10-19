<script setup lang="ts">
// The "Upozornění" tab: alerts for the MDT question first (CLAUDE.md), then the rest
// grouped by kind; headings carry no counts, so numbers never read as a score. Resolved ones sit at the bottom.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { topAlerts } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import AlertRow from "./AlertRow.vue";
import AlertArchive from "./AlertArchive.vue";

const { $t } = useFluent();
const c = usePatient();

const t = computed(() => topAlerts(c.cd.value?.alerts ?? null, c.alertHist.value));
const rest = computed(() => t.value.open.filter((f) => !f.relevant));
const GROUPS: [string, string][] = [
  ["contradiction", "patient-alerts-more-contradiction"],
  ["missing", "patient-alerts-more-missing"],
  ["chronology", "patient-alerts-more-chronology"],
  ["unclear", "patient-alerts-more-unclear"],
  ["poor_copy", "patient-alerts-more-poor-copy"],
  ["identity", "patient-alerts-more-identity"],
];
const groups = computed(() => GROUPS.map(([k, id]) => ({ k, id, items: rest.value.filter((f) => f.kind === k) })).filter((g) => g.items.length));
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ $t("patient-alerts-title") }}</h2><span class="muted small">{{ $t("patient-alerts-disclaimer") }}</span></div>
    <template v-if="t.top.length">
      <h3 style="margin:14px 0 6px">{{ $t("patient-alerts-for-question") }}</h3>
      <div class="alerts" role="list"><AlertRow v-for="f in t.top" :key="String(f.i)" :f="f" /></div>
    </template>
    <h3 v-if="rest.length" style="margin:18px 0 0">{{ $t("patient-alerts-other") }}</h3>
    <template v-for="g in groups" :key="g.k">
      <h4 style="margin:10px 0 6px;font-size:13px">{{ $t(g.id) }}</h4>
      <div class="alerts" role="list"><AlertRow v-for="f in g.items" :key="String(f.i)" :f="f" /></div>
    </template>
    <AlertArchive :items="t.archived" />
  </section>
</template>
