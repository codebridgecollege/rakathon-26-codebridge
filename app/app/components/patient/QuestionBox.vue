<script setup lang="ts">
// The question for the MDT (questionBox() and reasonQuestionBox() in the template; team decision 2026-10-17): the
// referral's explicit question as written; otherwise the assistant's draft until a named doctor confirms or edits it;
// the gap wording only when there is neither. A doctor edits it by clicking the text; a draft gets "Potvrdit otázku".
// The server confirms only the draft this page showed (its hash), so a re-extracted draft is never confirmed unread.
// A draft carries the label "Návrh asistenta" (CLAUDE.md: a draft is never shown as approved), outside the edit button
// so the button keeps the question as its name, and the button's description, so a screen reader hears it there too.
// The label takes keyboard focus and shows its tip (plugins/tooltips.ts), which quotes the passages the draft rests on.
// A confirmation or a doctor's edit removes the label.
import { computed, useId } from "vue";
import { useFluent } from "fluent-vue";
import { qState } from "@codebridge/domain/case-view";
import { basisPlain } from "@codebridge/domain/fhir-export";
import { usePatient } from "../../composables/usePatient";
import { useApi } from "../../lib/api";
import { caseWrite } from "../../lib/writes";
import { toast } from "../../lib/toast";

// inBrief: the box under the brief uses the brief's paragraph class (rq1); the header's box a plain paragraph.
const props = withDefaults(defineProps<{ inBrief?: boolean }>(), { inBrief: false });
const { $t } = useFluent();
const c = usePatient();

const q = computed(() => qState(c.p.value, c.edOf("q"), c.wf.value.qConfirm));
const original = computed(() => (c.p.value.explicit ? c.p.value.question : c.p.value.draft) || "");
const canConfirm = computed(() => q.value.mode === "draft" && c.isDoctor.value);
const labelId = useId();
const draftTip = computed(() => (q.value.mode === "draft" ? $t("patient-question-draft-tip", { basis: basisPlain($t, q.value.basis) }).trim() : ""));

function edit() {
  c.openEdit("q", original.value);
}

function confirm() {
  const p = c.p.value;
  if (!p.draft || !c.isDoctor.value) return;
  void caseWrite($t, () => useApi().confirmQuestion(p.id, { draft_sha: c.wf.value.draft_sha ?? null }), {
    busyKey: `q:${p.file}`,
    onOk: () => toast($t("patient-question-confirmed")),
  });
}
</script>

<template>
  <div :class="['question', q.mode === 'none' ? 'missing' : '']">
    <span class="bh">{{ $t("patient-question-title") }}</span>
    <p :class="props.inBrief ? 'rq1' : undefined">
      <span
        v-if="c.isDoctor.value"
        class="edl"
        role="button"
        tabindex="0"
        data-edit
        :title="$t('patient-question-edit')"
        :aria-describedby="q.mode === 'draft' ? labelId : undefined"
        @click="edit"
        @keydown.enter.space.prevent="edit"
      ><b v-if="q.mode === 'none'">{{ $t("patient-question-none") }}</b><span v-else lang="cs">{{ q.text }}</span></span>
      <template v-else><b v-if="q.mode === 'none'">{{ $t("patient-question-none") }}</b><span v-else lang="cs">{{ q.text }}</span></template>
      <template v-if="q.mode === 'draft'">{{ " " }}<span :id="labelId" class="qlbl draft" tabindex="0" :title="draftTip">{{ $t("patient-question-draft") }}</span></template>
    </p>
    <button v-if="canConfirm" class="btn small" style="margin-top:6px" @click="confirm">{{ $t("patient-question-confirm") }}</button>
  </div>
</template>
