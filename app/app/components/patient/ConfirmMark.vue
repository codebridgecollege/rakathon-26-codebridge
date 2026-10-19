<script setup lang="ts">
// A doctor's confirmation of the facts behind one line (EXTRACTION-FORMAT.md, "Doctor confirmations and edits").
// PRODUCT.md names no subset of critical facts, so every line of the oncology summary can be confirmed. The line is
// confirmed when each of its facts is; a fact confirmed with another value than it has now shows both values and asks
// again, so confirmed content never changes silently. Doctors act; everyone else sees the state.
import { computed, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import type { Fact } from "@codebridge/domain/extraction/types";
import { factDisplay } from "@codebridge/domain/run-view";
import { usePatient } from "../../composables/usePatient";
import { confirmFacts } from "../../lib/confirm";
import { useApi } from "../../lib/api";

const props = defineProps<{ factIds: string[]; text: string }>();
const { $t } = useFluent();
const c = usePatient();

const states = computed(() => props.factIds.map((id) => ({ id, st: c.confirmOf(id) })).filter((x) => x.st));
const changed = computed(() => states.value.filter((x) => x.st!.state === "changed"));
const all = computed(() => states.value.length > 0 && states.value.length === props.factIds.length && states.value.every((x) => x.st!.state === "confirmed"));
// The latest confirmation of the line, for "potvrzeno: who, when".
const last = computed(() => states.value.map((x) => x.st!.last).filter(Boolean).sort((a, b) => String(a!.when).localeCompare(String(b!.when))).at(-1));
const busy = ref(false);

// The earlier value of each changed fact, fetched from the run the doctor confirmed (an access-log row on the server).
const earlier = ref<Record<string, Fact | "loading" | "failed">>({});
watch(
  changed,
  (xs) => {
    for (const x of xs) {
      const run = x.st!.last?.run_id;
      if (!run || earlier.value[x.id]) continue;
      earlier.value = { ...earlier.value, [x.id]: "loading" };
      useApi()
        .earlierFact(c.p.value.id, run, x.id)
        .then((r) => (earlier.value = { ...earlier.value, [x.id]: r.fact }))
        .catch(() => (earlier.value = { ...earlier.value, [x.id]: "failed" }));
    }
  },
  { immediate: true },
);
const t = (id: string, args?: Record<string, string | number>) => $t(id, args);
const thenText = (id: string) => {
  const e = earlier.value[id];
  return e === "loading" || !e ? $t("patient-confirm-then-loading") : e === "failed" ? $t("patient-confirm-then-unavailable") : factDisplay(e, t);
};
const nowText = (id: string) => {
  const f = c.cd.value?.run?.facts[id];
  return f ? factDisplay(f, t) : "";
};

async function act(action: "confirm" | "withdraw") {
  busy.value = true;
  try {
    await confirmFacts(c, $t, props.factIds, action);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <template v-if="states.length">
    <span v-if="changed.length" class="confirm changed" role="note">
      <span class="chip plain k-contradiction">{{ $t("patient-confirm-changed", { who: changed[0]!.st!.last?.who ?? "", when: changed[0]!.st!.last?.when ?? "" }) }}</span>
      <template v-for="x in changed" :key="x.id">
        <span class="small">{{ " " }}{{ $t("patient-confirm-then", { text: thenText(x.id) }) }}; {{ $t("patient-confirm-now", { text: nowText(x.id) }) }}</span>
      </template>
      <button v-if="c.isDoctor.value" class="btn small" :disabled="busy" @click="act('confirm')">{{ $t("patient-confirm-again") }}</button>
    </span>
    <template v-else-if="all">
      {{ " " }}<span class="chip plain st-ready" :title="$t('patient-confirmed', { who: last?.who ?? '', when: last?.when ?? '' })">{{ $t("patient-confirmed", { who: last?.who ?? "", when: last?.when ?? "" }) }}</span>
      <button v-if="c.isDoctor.value" class="linkbtn small" :disabled="busy" :aria-label="$t('patient-confirm-withdraw-label', { text })" @click="act('withdraw')">{{ $t("patient-confirm-withdraw") }}</button>
    </template>
    <button v-else-if="c.isDoctor.value" class="linkbtn small cfbtn" :disabled="busy" :title="$t('patient-confirm-label', { text })" :aria-label="$t('patient-confirm-label', { text })" @click="act('confirm')">{{ $t("patient-confirm") }}</button>
  </template>
</template>
