<script setup lang="ts">
// A fact a doctor may correct. An edit never changes the source document or the extracted
// value; it is stored next to it with who and when, and the fact says it was edited, with the original in the
// tooltip. The slot is the original's rich form (linked prose); an edited fact shows the doctor's text instead.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";

// withButton false leaves the pencil out, for a fact inside a source link: a button inside the link's role="button"
// would be a control nested in a control, which screen readers cannot reach. The caller then puts <Ed button-only>
// right after the link, so the pencil sits where it sat before.
const props = withDefaults(defineProps<{ k: string; orig: string | null | undefined; withButton?: boolean; buttonOnly?: boolean }>(), {
  withButton: true,
  buttonOnly: false,
});
const { $t } = useFluent();
const c = usePatient();
const e = computed(() => c.edOf(props.k));
const tip = computed(() => (e.value ? $t("patient-edit-tag-tooltip", { by: e.value.by, when: e.value.when, orig: props.orig || $t("patient-gap-not-stated") }) : ""));
// The source text changed since the doctor edited it (a new processing reworded the fact or line): both are shown, and
// the doctor decides whether the edit still holds. Confirmed or edited content never changes silently.
const changed = computed(() => !!e.value && e.value.orig != null && props.orig != null && e.value.orig !== props.orig);
const changedTip = computed(() => (changed.value ? $t("patient-edit-source-changed-tip", { then: e.value!.orig ?? "", now: props.orig ?? "" }) : ""));
</script>

<template>
  <template v-if="!buttonOnly">
    <span :class="e ? 'edited' : ''" lang="cs"><template v-if="e">{{ e.text }}</template><slot v-else-if="$slots.default" /><template v-else>{{ orig ?? "" }}</template></span>
    <span v-if="e" class="edtag" :title="tip">{{ $t("patient-edit-tag") }}</span>
    <span v-if="changed" class="edtag" :title="changedTip">{{ $t("patient-edit-source-changed") }}</span>
  </template>
  <button v-if="c.isDoctor.value && (withButton || buttonOnly)" class="edbtn" data-edit :aria-label="$t('patient-edit-button')" :title="$t('patient-edit-button')" @click.stop.prevent="c.openEdit(k, orig)">✎</button>
</template>
