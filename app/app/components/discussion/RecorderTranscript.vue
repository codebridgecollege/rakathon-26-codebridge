<script setup lang="ts">
// The transcript of one case in the "AI záznam" segment (recTxHtml() and recLinesHtml() in
// mocks/src/v3-template.html): stored and live lines with their clock time, numbered speakers after the speaker pass,
// and the words not committed yet. Its own component, so the scroll position is kept across its own updates only.
import { computed, onBeforeUpdate, onUpdated, ref } from "vue";
import { clock, uiLocale } from "../../lib/format";
import { useRecorderStore } from "../../stores/recorder";

const props = defineProps<{ file: string }>();
const rec = useRecorderStore();
const lines = computed(() => rec.tx(props.file).lines);
// The words not committed yet show only in the case that takes them.
const showPartial = computed(() => rec.on && rec.target === props.file && !!rec.partial);
const hhmm = (ms: number) => clock(ms, uiLocale());

// The transcript scrolls with new words while the doctor is at its end, and stays put when they scrolled back.
const el = ref<HTMLElement | null>(null);
let atEnd = true;
onBeforeUpdate(() => {
  const e = el.value;
  atEnd = !e || e.scrollTop + e.clientHeight >= e.scrollHeight - 30;
});
onUpdated(() => {
  const e = el.value;
  if (e && atEnd) e.scrollTop = e.scrollHeight;
});
</script>

<template>
  <div id="rectx" ref="el" class="rectx" :data-pid="file" aria-live="polite">
    <div v-for="(l, i) in lines" :key="l.cid ?? `${l.wall}-${i}`" class="ln">
      <span class="tm">{{ hhmm(l.wall) }}</span>
      <span><span v-if="l.spk != null" :class="`spk sp${l.spk % 5}`">{{ $t("discussion-rec-speaker", { n: l.spk + 1 }) }}</span>{{ l.text.join(" ") }}</span>
    </div>
    <div v-if="showPartial" class="ln">
      <span class="tm">{{ hhmm(Date.now()) }}</span>
      <span class="partial">{{ $t("discussion-rec-partial", { text: rec.partial }) }}</span>
    </div>
  </div>
</template>
