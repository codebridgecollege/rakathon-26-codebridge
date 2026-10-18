<script setup lang="ts">
// Source links named by page ("s. 2"), as in the labs table, so several links in one row are told apart: a second
// link to the same page is "s. 2 (2)" (srcLinks() in the template). Each opens the exact passage.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { SourceRef } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";

const props = defineProps<{ refs: SourceRef[] | null | undefined }>();
const { $t } = useFluent();
const c = usePatient();
const links = computed(() => {
  const xs = props.refs || [];
  const seen: Record<string, number> = {};
  return xs.map((r) => {
    const k = (seen[String(r.page)] = (seen[String(r.page)] || 0) + 1);
    const same = xs.filter((x) => x.page === r.page).length;
    return { r, k, same, q: String(r.quote || "").slice(0, 80) };
  });
});
</script>

<template>
  <template v-for="(l, i) in links" :key="i"><template v-if="i"> </template><button
    class="linkbtn small"
    data-src
    :title="$t('patient-src-quote', { quote: l.q })"
    :aria-label="$t('patient-src-link-label', { page: String(l.r.page), quote: l.q })"
    @click.stop.prevent="c.openSource(l.r)"
  >{{ $t("patient-src-page", { page: String(l.r.page) }) }}<template v-if="l.same > 1"> ({{ l.k }})</template></button></template>
</template>
