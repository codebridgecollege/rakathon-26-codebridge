<script setup lang="ts">
// The guideline side of a past decision: only the edition valid on the
// decision date is quoted, never a later one; its PDF opens online at the page. Without a passage in that edition the
// item says so instead of quoting another edition.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { Item } from "@codebridge/domain/case-data";
import { fmtDate } from "../../lib/dates";
import { pageLabel, pageOf } from "../../lib/guide";

const props = defineProps<{ x: Item }>();
const { $t } = useFluent();
const e = computed(() => props.x.edition as Item | undefined);
const range = computed(() =>
  e.value ? $t("patient-dev-edition-range", { from: fmtDate($t, e.value.valid_from), to: e.value.valid_to ? fmtDate($t, e.value.valid_to) : $t("patient-dev-edition-until-now") }) : "",
);
const more = computed(() => (props.x.additional_passages || []) as Item[]);
const pdfHref = (n?: unknown) => `${e.value?.pdf_url}${n ? `#page=${n}` : ""}`;
const pdfLabel = (n?: unknown, printed?: unknown) =>
  n ? $t("patient-dev-open-pdf-page", { year: String(e.value?.year), page: pageLabel($t, n, printed) }) : $t("patient-dev-open-pdf", { year: String(e.value?.year) });
</script>

<template>
  <template v-if="!e || x.status === 'not_checked'">
    <span class="label">{{ $t("patient-dev-past-label") }}</span><p class="rq muted">{{ $t("patient-dev-past-not-checked") }}</p>
  </template>
  <template v-else>
    <span class="label">{{ $t("patient-dev-past-label") }} · <span lang="cs">{{ e.name }}</span>, {{ $t("patient-dev-past-edition", { year: String(e.year) }) }}</span>
    <template v-if="x.status === 'not_found' || !x.quote">
      <p class="rq">{{ $t("patient-dev-past-not-found") }}</p>
      <span class="cite edition"><span lang="cs">{{ e.society }} · {{ e.version || "" }}</span> · {{ range }}<template v-if="x.decision_date"> · {{ $t("patient-dev-past-chosen-for", { date: fmtDate($t, x.decision_date) }) }}</template></span>
      <a v-if="e.pdf_url" class="linkbtn small" :href="pdfHref()" target="_blank" rel="noopener">{{ pdfLabel() }}</a>
    </template>
    <template v-else>
      <p class="rq"><q class="pastq" lang="cs">{{ x.quote }}</q></p>
      <span class="cite edition"><span lang="cs">{{ e.society }} · {{ e.version || "" }}</span> · {{ range }}<template v-if="x.decision_date"> · {{ $t("patient-dev-past-chosen-for", { date: fmtDate($t, x.decision_date) }) }}</template></span>
      <span class="cite"><span lang="cs">{{ x.section || "" }}</span> · {{ pageOf($t, x) }} · {{ $t("patient-guide-original-grade") }} <span lang="cs">{{ x.evidence || $t("patient-guide-grade-none") }}</span> · <a v-if="e.pdf_url" class="linkbtn small" :href="pdfHref(x.pdf_page)" target="_blank" rel="noopener">{{ pdfLabel(x.pdf_page, x.printed_page) }}</a></span>
      <details v-if="more.length" class="srcs">
        <summary class="small">{{ $t("patient-dev-past-more", { n: more.length }) }}</summary>
        <template v-for="(m, i) in more" :key="i">
          <p class="rq"><q lang="cs">{{ m.quote }}</q></p>
          <span class="cite"><span lang="cs">{{ m.section || "" }}</span> · {{ pageLabel($t, m.pdf_page, m.printed_page) }} · <a v-if="e.pdf_url" class="linkbtn small" :href="pdfHref(m.pdf_page)" target="_blank" rel="noopener">{{ pdfLabel(m.pdf_page, m.printed_page) }}</a></span>
          <span v-if="m.relation_cs" class="cite" lang="cs">{{ m.relation_cs }}</span>
        </template>
      </details>
    </template>
  </template>
</template>
