<script setup lang="ts">
// What the referring doctor proposes for this MDT. The assistant never proposes the
// management (CLAUDE.md): without the doctor's text the box says so, and a doctor's text is labelled as a proposal,
// not as the MDT's decision.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";
import Gap from "./Gap.vue";

const { $t } = useFluent();
const c = usePatient();
const e = computed(() => c.edOf("proposal"));
// Once the proposal is written its button shows only the pencil, so it gets a name for screen readers.
</script>

<template>
  <div class="concl"><span class="bh">{{ $t("patient-proposal-heading") }}</span>
    <p style="font-size:14px"><template v-if="e"><span lang="cs">{{ e.text }}</span><span class="edtag" :title="$t('patient-proposal-tag-tooltip', { by: e.by, when: e.when })">{{ $t("patient-proposal-tag") }}</span></template><template v-else><Gap /> <span class="muted small">{{ $t("patient-proposal-empty") }}</span></template><template v-if="c.isDoctor.value">{{ " " }}<button class="edbtn" style="opacity:1" data-edit data-orig="" :aria-label="e ? $t('patient-edit-button') : undefined" @click.stop.prevent="c.openEdit('proposal', '')">✎ {{ e ? "" : $t("patient-proposal-add") }}</button></template></p>
  </div>
</template>
