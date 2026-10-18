<script setup lang="ts">
// The guideline layer (F-27): verbatim statements from the named guidelines that apply to
// the documented facts, one list per field, sorted by the strength the guideline itself states (round 19), never as
// an order of options for this patient. Literature from PubMed comes after, labelled as literature. The layer can be
// switched off; a failed load says so and offers "Zkusit znovu".
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import type { Item } from "@codebridge/domain/case-data";
import { byTier, isOncology } from "@codebridge/domain/guideline";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { useCasesStore } from "../../stores/cases";
import { useGuide } from "../../lib/guide";
import GuideEntry from "./GuideEntry.vue";
import LitEntry from "./LitEntry.vue";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();
const { G, GL, stmts } = useGuide(c, $t);

const onc = computed(() => byTier(stmts.value.filter((x) => isOncology(GL(x.guideline_id)))));
const other = computed(() => byTier(stmts.value.filter((x) => !isOncology(GL(x.guideline_id)))));
const important = computed(() => ((G.value.not_retrieved || []) as Item[]).filter((n) => n.important));
const lit = computed(() => (G.value.literature || []) as Item[]);
const queries = computed(() => (G.value.queries || []) as Item[]);
const notRetrieved = computed(() => (G.value.not_retrieved || []) as Item[]);
const errText = computed(() => {
  const e = G.value.error;
  return e ? (e.message_cs ?? $t(e.message_id ?? "patient-guide-load-failed")) : "";
});

// The clamp note shows only when the browser really cut the quote at this width.
const root = ref<HTMLElement | null>(null);
function markClamped() {
  root.value?.querySelectorAll<HTMLElement>(".glq.clamp").forEach((q) => q.classList.toggle("isclamped", q.scrollHeight > q.clientHeight + 1));
}
watch([() => stmts.value, () => view.gleOpen, () => view.guideOn], () => void nextTick(markClamped), { deep: true });
onMounted(() => {
  void nextTick(markClamped);
  window.addEventListener("resize", markClamped);
});
onBeforeUnmount(() => window.removeEventListener("resize", markClamped));

const toggle = (e: Event) => (view.guideOn = (e.target as HTMLInputElement).checked);
const retry = () => useCasesStore().retryGuidance(c.p.value.file);
</script>

<template>
  <div ref="root" class="gl" v-if="!view.guideOn || G.loading || G.error || stmts.length || lit.length">
    <div class="row spread">
      <h3 style="margin:0">{{ $t("patient-guide-heading") }}</h3>
      <label class="small muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" :checked="view.guideOn" @change="toggle"> {{ $t("patient-guide-layer-toggle") }}</label>
    </div>
    <p v-if="!view.guideOn" class="muted small" style="margin:6px 0 0">{{ $t("patient-guide-off") }}</p>
    <p v-else-if="G.loading" class="muted small" style="margin:6px 0 0">{{ $t("patient-guide-loading") }}</p>
    <p v-else-if="G.error" class="muted small" role="alert" style="margin:6px 0 0">{{ errText }} <button class="linkbtn small" @click="retry">{{ $t("patient-guide-retry") }}</button></p>
    <template v-else>
      <p class="ordernote">{{ $t("patient-guide-order-note") }}</p>
      <div v-for="(n, i) in important" :key="i" class="synth" style="margin:8px 0" lang="cs">{{ n.note_cs || n.name }}</div>
      <template v-if="onc.length"><h4 class="glh">{{ $t("patient-guide-group-oncology") }}</h4><ol class="gll stmts-onc"><GuideEntry v-for="x in onc" :key="x.id" :x="x" /></ol></template>
      <template v-if="other.length"><h4 class="glh">{{ $t("patient-guide-group-other") }}</h4><ol class="gll stmts-other"><GuideEntry v-for="x in other" :key="x.id" :x="x" /></ol></template>
      <p class="muted small" style="margin:8px 0 0">{{ $t("patient-guide-footer") }}</p>
      <template v-if="lit.length">
        <h4 class="glh">{{ $t("patient-guide-lit-heading") }}</h4>
        <p class="muted small" style="margin:0">{{ $t("patient-guide-lit-intro") }}<template v-if="queries.length">{{ $t("patient-guide-lit-queries") }}<template v-for="(q, i) in queries" :key="i"><template v-if="i">, </template><span lang="en">„{{ q.query }}“</span></template></template>{{ $t("patient-guide-lit-intro-end") }}</p>
        <ol class="gll lit"><LitEntry v-for="a in lit" :key="a.pmid" :a="a" /></ol>
      </template>
      <details v-if="notRetrieved.length" class="srcs">
        <summary class="muted">{{ $t("patient-guide-not-retrieved", { n: notRetrieved.length }) }}</summary>
        <ul class="small muted"><li v-for="(n, i) in notRetrieved" :key="i"><span lang="cs">{{ n.name }}: {{ n.reason }}</span></li></ul>
      </details>
    </template>
  </div>
</template>
