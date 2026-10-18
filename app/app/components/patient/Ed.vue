<script setup lang="ts">
// A fact a doctor may correct (ed() in the template). An edit never changes the source document or the extracted
// value; it is stored next to it with who and when, and the fact says it was edited, with the original in the
// tooltip. The slot is the original's rich form (linked prose); an edited fact shows the doctor's text instead.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";

const props = defineProps<{ k: string; orig: string | null | undefined }>();
const { $t } = useFluent();
const c = usePatient();
const e = computed(() => c.edOf(props.k));
const tip = computed(() => (e.value ? $t("patient-edit-tag-tooltip", { by: e.value.by, when: e.value.when, orig: props.orig || $t("patient-gap-not-stated") }) : ""));
</script>

<template>
  <span :class="e ? 'edited' : ''" lang="cs"><template v-if="e">{{ e.text }}</template><slot v-else-if="$slots.default" /><template v-else>{{ orig ?? "" }}</template></span>
  <span v-if="e" class="edtag" :title="tip">{{ $t("patient-edit-tag") }}</span>
  <button v-if="c.isDoctor.value" class="edbtn" data-edit :aria-label="$t('patient-edit-button')" :title="$t('patient-edit-button')" @click.stop.prevent="c.openEdit(k, orig)">✎</button>
</template>
