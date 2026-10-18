<script setup lang="ts">
// The guideline drawer: the guideline's page text with the
// quoted statement marked, the full citation, the original grade and why it applies, and links to the publisher's
// PDF at that page. Without the page text it says so; the quote is marked only where it is found verbatim.
import { computed, nextTick, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import type { Item } from "@codebridge/domain/case-data";
import { markQuote, quoteLang } from "@codebridge/domain/guideline";
import { usePatient } from "../../composables/usePatient";
import { useOverlayStore } from "../../stores/overlay";
import { useGuide } from "../../lib/guide";
import { fmtDate } from "../../lib/dates";

const props = defineProps<{ o: { kind: "guide"; id: string } }>();
const { $t } = useFluent();
const c = usePatient();
const overlay = useOverlayStore();
const { G, GL, anyStmt, citeOf } = useGuide(c, $t);

const st = computed<Item>(() => anyStmt(props.o.id) || {});
const g = computed(() => GL(st.value.guideline_id));
const lang = computed(() => quoteLang(g.value));
const page = computed(() => ((G.value.pages || []) as Item[]).find((x) => x.guideline_id === st.value.guideline_id && x.pdf_page === st.value.pdf_page));
const marked = computed(() => (page.value?.text != null ? markQuote(String(page.value.text), st.value.quote) : null));
const pdfHref = computed(() => {
  const u = String(g.value.pdf_url || "");
  return st.value.pdf_page && /\.pdf($|\?)/i.test(u) ? `${u}#page=${st.value.pdf_page}` : u;
});
const edRange = (e: Item) => $t("patient-dev-edition-range", { from: fmtDate($t, e.valid_from), to: e.valid_to ? fmtDate($t, e.valid_to) : $t("patient-dev-edition-until-now") });

const hit = ref<HTMLElement | null>(null);
onMounted(() => void nextTick(() => hit.value?.scrollIntoView?.({ block: "center" })));
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <aside class="drawer" role="dialog" aria-modal="true" :aria-label="$t('patient-guide-drawer-label')">
    <header>
      <div>
        <div class="label">{{ $t("patient-guide-drawer-label") }} · <span :lang="lang">{{ g.society || "" }} {{ g.year || "" }}</span></div>
        <h2 style="margin-top:4px" :lang="lang">{{ g.name || "" }}</h2>
        <div class="muted small"><span :lang="lang">{{ g.version || "" }} · {{ st.section || "" }}</span> · <template v-if="st.pdf_page">{{ $t("patient-guide-drawer-page", { page: String(st.pdf_page) }) }}<template v-if="st.printed_page && st.printed_page !== st.pdf_page">{{ " " }}{{ $t("patient-guide-drawer-printed", { page: String(st.printed_page) }) }}</template></template><template v-else>{{ $t("patient-guide-drawer-abstract-only") }}</template></div>
      </div>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-guide-drawer-close") }}</button>
    </header>
    <div class="pages"><a v-if="g.pdf_url" class="btn small" :href="pdfHref" target="_blank" rel="noopener">{{ st.pdf_page ? $t("patient-guide-drawer-open-pdf-page", { page: String(st.pdf_page) }) : $t("patient-guide-drawer-open-pdf") }}</a><template v-if="g.url">{{ " " }}<a class="btn small" :href="g.url" target="_blank" rel="noopener">{{ $t("patient-guide-drawer-publisher") }}</a></template></div>
    <div class="synth" style="margin:10px 20px 0;border-style:solid">
      <template v-if="st.evidence">{{ $t("patient-guide-drawer-grade") }} <span :lang="lang">{{ st.evidence }}</span><br></template>
      <template v-if="st.relation_cs">{{ $t("patient-guide-drawer-relation") }} <span lang="cs">{{ st.relation_cs }}</span><template v-if="st.edition"><br>{{ $t("patient-guide-drawer-edition", { year: String(st.edition.year), range: edRange(st.edition) }) }}</template></template>
      <template v-else>{{ $t("patient-guide-drawer-applies") }} <span lang="cs">{{ st.applies_because_cs || "" }}</span></template>
      <br><span style="font-weight:500" :lang="lang">{{ citeOf(st) }}</span>
    </div>
    <div class="text" :lang="lang"><template v-if="marked">{{ marked.before }}<mark v-if="marked.hit" id="hit" ref="hit">{{ marked.hit }}</mark>{{ marked.after }}</template><template v-else>{{ $t("patient-guide-drawer-no-text") }}</template></div>
  </aside>
</template>
