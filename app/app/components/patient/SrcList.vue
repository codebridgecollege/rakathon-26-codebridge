<script setup lang="ts">
// The card's source list, folded away: every source the card used, in order of first use,
// with its document, page and the start of the quote. Each entry opens the exact passage.
import { useFluent } from "fluent-vue";
import type { SourceRef } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";

withDefaults(defineProps<{ list: SourceRef[]; label?: string }>(), { label: "" });
const { $t } = useFluent();
const c = usePatient();
const short = (q: string | undefined) => {
  const s = String(q || "");
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
};
</script>

<template>
  <details v-if="list.length" class="srcs">
    <summary>{{ $t("patient-src-list", { label: label || $t("patient-src-list-label"), n: list.length }) }}</summary>
    <ol class="refs">
      <li v-for="(r, i) in list" :key="i">
        <button v-if="r.nis" data-src @click="c.openSource(r)">{{ c.docTitle(r) }}</button>
        <button v-else data-src @click="c.openSource(r)"><span lang="cs">{{ c.docTitle(r) }}</span>{{ $t("patient-src-list-page", { page: String(r.page) }) }}<span lang="cs">„{{ short(r.quote) }}“</span></button>
      </li>
    </ol>
  </details>
</template>
