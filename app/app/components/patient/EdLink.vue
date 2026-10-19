<script setup lang="ts">
// A fact whose text itself opens the edit dialog for doctors: used where a numbered
// source marker sits next to the text, so the text and the source are two separate targets.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";

// `shown`: how the original reads on screen when it differs from the stored original (a negation label in the
// interface language); the edit is always stored and compared against `orig`.
const props = defineProps<{ k: string; orig: string | null | undefined; shown?: string }>();
const { $t } = useFluent();
const c = usePatient();
const e = computed(() => c.edOf(props.k));
const text = computed(() => (e.value ? e.value.text : (props.shown ?? props.orig ?? "")));
const tip = computed(() => (e.value ? $t("patient-edit-tag-tooltip", { by: e.value.by, when: e.value.when, orig: props.orig || $t("patient-gap-not-stated") }) : ""));
const open = () => c.openEdit(props.k, props.orig);
// The source text changed since the edit (a new processing reworded the fact): both are shown, as in Ed.
const changed = computed(() => !!e.value && e.value.orig != null && props.orig != null && e.value.orig !== props.orig);
</script>

<template>
  <span
    v-if="c.isDoctor.value"
    :class="['edl', e ? 'edited' : '']"
    role="button"
    tabindex="0"
    data-edit
    :title="$t('patient-edit-button')"
    lang="cs"
    @click.stop="open"
    @keydown.enter.space.prevent="open"
  >{{ text }}</span>
  <span v-else :class="e ? 'edited' : ''" lang="cs">{{ text }}</span>
  <span v-if="e" class="edtag" :title="tip">{{ $t("patient-edit-tag") }}</span>
  <span v-if="changed" class="edtag" :title="$t('patient-edit-source-changed-tip', { then: e!.orig ?? '', now: orig ?? '' })">{{ $t("patient-edit-source-changed") }}</span>
</template>
