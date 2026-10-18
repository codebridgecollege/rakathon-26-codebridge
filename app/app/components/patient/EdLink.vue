<script setup lang="ts">
// A fact whose text itself opens the edit dialog for doctors (edLink() in the template): used where a numbered
// source marker sits next to the text, so the text and the source are two separate targets.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";

const props = defineProps<{ k: string; orig: string | null | undefined }>();
const { $t } = useFluent();
const c = usePatient();
const e = computed(() => c.edOf(props.k));
const text = computed(() => (e.value ? e.value.text : (props.orig ?? "")));
const tip = computed(() => (e.value ? $t("patient-edit-tag-tooltip", { by: e.value.by, when: e.value.when, orig: props.orig || $t("patient-gap-not-stated") }) : ""));
const open = () => c.openEdit(props.k, props.orig);
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
</template>
