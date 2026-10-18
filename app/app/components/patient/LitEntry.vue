<script setup lang="ts">
// A PubMed article: the same entry as a statement, labelled as literature, never as a
// recommendation. Its headline is a verbatim abstract sentence.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { Item } from "@codebridge/domain/case-data";
import { clampable } from "@codebridge/domain/guideline";
import { usePatientViewStore } from "../../stores/patientView";

const props = defineProps<{ a: Item }>();
const { $t } = useFluent();
const view = usePatientViewStore();
const id = computed(() => `lit:${props.a.pmid}`);
const qs = computed(() => (props.a.quotes || []) as string[]);
const head = computed(() => qs.value[0] || props.a.title);
const author = computed(() => String(props.a.first_author || "").replace(/\s*et al\.?$/, ""));
const types = computed(() => ([] as string[]).concat(props.a.pub_type || []).join(", "));
const onToggle = (e: Event) => (view.gleOpen = { ...view.gleOpen, [id.value]: (e.target as HTMLDetailsElement).open });
</script>

<template>
  <li class="gle">
    <details :open="!!view.gleOpen[id]" @toggle="onToggle">
      <summary><q :class="['glq', clampable(head) ? 'clamp' : '']" lang="en">{{ head }}</q><span class="chip plain k-unclear">{{ $t("patient-guide-lit-chip") }}</span><span v-if="clampable(head)" class="clampnote">{{ $t("patient-guide-clamp-note") }}</span></summary>
      <div class="glbody">
        <p class="glwhy"><b>{{ $t("patient-guide-why") }}</b> <span lang="cs">{{ a.why_relevant_cs || "" }}</span></p>
        <ul v-if="qs.length > 1" class="glfacts"><li v-for="(q, i) in qs.slice(1)" :key="i"><q lang="en">{{ q }}</q></li></ul>
        <p class="glmeta"><span lang="en">{{ a.title }}</span> · <span lang="en">{{ $t("patient-guide-lit-author", { author }) }}, {{ a.journal || "" }} {{ a.year || "" }}</span> · <span lang="en">{{ types }}</span> · <a :href="a.url" target="_blank" rel="noopener">{{ $t("patient-guide-pmid", { pmid: String(a.pmid) }) }}</a></p>
      </div>
    </details>
  </li>
</template>
