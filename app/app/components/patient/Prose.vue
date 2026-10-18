<script setup lang="ts">
// Prose with [n] markers: each clause before a marker opens that source; the markers
// themselves are not shown (round 14). A line break in the text is a paragraph gap on screen, as the brief shows it.
import { computed } from "vue";
import type { ProsePart } from "@codebridge/domain/case-view";
import SrcWrap from "./SrcWrap.vue";

const props = withDefaults(defineProps<{ parts: ProsePart[]; breaks?: boolean }>(), { breaks: false });
// Each part split at line breaks, so a break inside a linked clause stays inside its link.
const pieces = computed(() => props.parts.map((p) => ({ ...p, lines: props.breaks ? p.text.split("\n") : [p.text] })));
</script>

<template>
  <template v-for="(p, i) in pieces" :key="i">
    <SrcWrap v-if="p.ref" :r="p.ref"><template v-for="(l, k) in p.lines" :key="k"><template v-if="k"><br><br></template>{{ l }}</template></SrcWrap>
    <template v-else><template v-for="(l, k) in p.lines" :key="k"><template v-if="k"><br><br></template>{{ l }}</template></template>
  </template>
</template>
