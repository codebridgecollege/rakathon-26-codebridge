<script setup lang="ts">
// One guideline statement (stmtHtml() in the template, round 21): the headline is the verbatim quote and one strength
// chip on the common scale; a click opens "Proč" (the documented facts with their sources) and, in small print, the
// full citation with the guideline's own grade. Long quotes clamp on screen only; the text is never shortened.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { Item } from "@codebridge/domain/case-data";
import { categoriesOf, clampable, quoteLang, tierCodes, tiersOf } from "@codebridge/domain/guideline";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { pageOf, useGuide } from "../../lib/guide";
import { openGuide } from "../../lib/guideDrawer";
import SrcLinks from "./SrcLinks.vue";

const props = defineProps<{ x: Item }>();
const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();
const { GL, citeOf, factRefs } = useGuide(c, $t);

const g = computed(() => GL(props.x.guideline_id));
const tier = computed(() => tiersOf(props.x)[0]);
const tierLabel = computed(() => {
  const { from, to } = tierCodes(props.x);
  const f = $t("patient-guide-tier", { code: from });
  return to ? $t("patient-guide-tier-range", { from: f, to: $t("patient-guide-tier", { code: to }) }) : f;
});
const cats = computed(() => categoriesOf(props.x));
const lang = computed(() => quoteLang(g.value));
const facts = computed(() => ((props.x.patient_facts || []) as string[]).map((f) => ({ f, refs: factRefs(f) })));
const onToggle = (e: Event) => (view.gleOpen = { ...view.gleOpen, [props.x.id]: (e.target as HTMLDetailsElement).open });
</script>

<template>
  <li class="gle" :data-tier="tier">
    <details :open="!!view.gleOpen[x.id]" @toggle="onToggle">
      <summary><q :class="['glq', clampable(x.quote) ? 'clamp' : '']" :lang="lang">{{ x.quote }}</q><span :class="['chip', 'plain', 'tier', `tier-${tier}`]" :title="$t('patient-guide-tier-tooltip')">{{ $t("patient-guide-tier-chip", { tier: tierLabel }) }}</span><span v-if="clampable(x.quote)" class="clampnote">{{ $t("patient-guide-clamp-note") }}</span></summary>
      <div class="glbody">
        <p class="glwhy"><b>{{ $t("patient-guide-why") }}</b> <span lang="cs">{{ x.applies_because_cs || "" }}</span></p>
        <ul v-if="facts.length" class="glfacts">
          <li v-for="(it, i) in facts" :key="i"><span lang="cs">{{ it.f }}</span> <SrcLinks v-if="it.refs.length" :refs="it.refs" /><span v-else class="muted small">{{ $t("patient-guide-no-source") }}</span></li>
        </ul>
        <p class="glmeta"><span :lang="lang">{{ g.name || "" }}, {{ g.society || "" }} {{ g.year || "" }}<template v-if="g.type_cs"> · {{ g.type_cs }}</template> · {{ x.section || "" }}</span> · {{ pageOf($t, x) }} · {{ $t("patient-guide-original-grade") }} <template v-if="x.type === 'guideline_text'">{{ $t("patient-guide-grade-chapter-text") }}</template><template v-else><span :lang="lang">{{ x.evidence || $t("patient-guide-grade-none") }}</span><template v-if="cats.length"> {{ $t("patient-guide-grade-categories", { cats: cats.join(", ") }) }}</template></template> · <button class="linkbtn small" :title="citeOf(x)" @click="openGuide(c, x.id)">{{ $t("patient-guide-open") }}</button></p>
      </div>
    </details>
  </li>
</template>
