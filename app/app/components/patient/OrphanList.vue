<script setup lang="ts">
// "Potvrzeno dříve, v novém zpracování chybí" (EXTRACTION-FORMAT.md, "Doctor confirmations and edits"): a doctor's
// confirmation or edit whose fact the current processing does not have (its document was withdrawn, a re-reading
// worded it differently) or no longer shows, and every edit saved under a list position of the earlier view. Shown
// with who and when, never dropped. A doctor may clear an orphaned edit (the server allows reverting an old key, not
// saving under one). A confirmed fact is named by its text from the run the doctor confirmed; the server refuses it
// when the current run holds it back (a page of another patient), and the list then says the text cannot be shown.
import { ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import type { Orphan } from "@codebridge/domain/case-view";
import { factDisplay } from "@codebridge/domain/run-view";
import { usePatient } from "../../composables/usePatient";
import { useApi } from "../../lib/api";
import { refused } from "../../lib/writes";
import { useSessionStore } from "../../stores/session";

const { $t } = useFluent();
const c = usePatient();

// The confirmed facts' earlier texts, by fact ID: fetched once each (an access-log row on the server).
const texts = ref<Record<string, string>>({});
watch(
  () => c.orphans.value,
  (os) => {
    for (const o of os) {
      if (o.kind !== "confirmation" || texts.value[o.fact_id] !== undefined) continue;
      if (!o.run_id) {
        texts.value = { ...texts.value, [o.fact_id]: $t("patient-confirm-then-unavailable") };
        continue;
      }
      texts.value = { ...texts.value, [o.fact_id]: $t("patient-confirm-then-loading") };
      useApi()
        .earlierFact(c.p.value.id, o.run_id, o.fact_id)
        .then((r) => (texts.value = { ...texts.value, [o.fact_id]: factDisplay(r.fact, (id, args) => $t(id, args)) }))
        .catch(() => (texts.value = { ...texts.value, [o.fact_id]: $t("patient-confirm-then-unavailable") }));
    }
  },
  { immediate: true },
);

const REASON: Record<string, string> = { position: "patient-orphan-position", missing: "patient-orphan-missing", not_shown: "patient-orphan-not-shown" };

async function revert(o: Orphan) {
  if (o.kind !== "edit") return;
  const e = c.edOf(o.key);
  try {
    const r = await useApi().deleteEdit(c.p.value.id, o.key, { expected_edit_id: e?.id ?? null });
    useSessionStore().applyState(r.state);
  } catch (x) {
    refused($t, x);
  }
}
</script>

<template>
  <section v-if="c.orphans.value.length" class="card" role="region" :aria-label="$t('patient-orphans-title')">
    <div class="head"><h2>{{ $t("patient-orphans-title") }}</h2></div>
    <p class="muted small">{{ $t("patient-orphans-hint") }}</p>
    <ul>
      <li v-for="o in c.orphans.value" :key="o.kind === 'edit' ? `e:${o.key}` : `c:${o.fact_id}`">
        <template v-if="o.kind === 'edit'">
          <span>{{ $t("patient-orphan-edit", { text: o.text, who: o.by, when: o.when }) }}</span>
          <span v-if="o.orig" class="muted small"> · {{ $t("patient-orphan-edit-orig", { orig: o.orig }) }}</span>
          <span class="muted small"> · {{ $t(REASON[o.reason]!) }}</span>
          <button v-if="c.isDoctor.value" class="linkbtn small" @click="revert(o)">{{ $t("patient-orphan-revert") }}</button>
        </template>
        <template v-else>{{ $t("patient-orphan-confirmation", { text: texts[o.fact_id] ?? "", who: o.by, when: o.when }) }}</template>
      </li>
    </ul>
  </section>
</template>
