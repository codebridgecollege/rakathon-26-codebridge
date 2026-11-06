<script setup lang="ts">
// PS and the red chips beside it: the documented values to count with when the meeting talks about a treatment. A chip
// names the value and opens its source; which modality it bears on and why is in the tooltip, as the assistant's
// observation (modality-checks.ts). A value the check needs and the documents lack is a grey chip, never left silent.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { hasMissing, missingState } from "@codebridge/domain/case-view";
import { panelFlagsOf, type PanelFlag } from "@codebridge/domain/modality-checks";
import { usePatient } from "../../composables/usePatient";
import Gap from "../patient/Gap.vue";
import Marks from "../patient/Marks.vue";

const { $t } = useFluent();
const c = usePatient();
const result = computed(() => panelFlagsOf(c.cd.value));
const tip = (f: PanelFlag) =>
  [
    f.date ? `${f.text} (${f.date})` : f.text,
    f.why_cs,
    f.modalities.length ? `${$t("mdt-panel-flag-bears")}: ${f.modalities.map((m) => $t(`mdt-panel-mod-${m}`)).join(", ")}` : "",
    f.more ? $t("mdt-panel-flag-more", { n: f.more }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
const docs = computed(() => missingState(c.entry.value.state, c.cd.value?.alerts, c.alertHist.value));
const docsMissing = computed(() => !!hasMissing(c.cd.value?.alerts ?? null, c.alertHist.value));
const open = (f: PanelFlag) => f.source && c.openSource(f.source);
</script>

<template>
  <div class="mdtp-flags">
    <span v-if="result.performance" class="mdtp-ps" :class="{ low: result.performance.low }">
      <button class="linkbtn" lang="cs" @click="result.performance?.source && c.openSource(result.performance.source)">{{ result.performance.label }}</button>
      <Marks :f="result.performance.item" />
    </span>
    <span v-else class="mdtp-ps">{{ $t("mdt-panel-ps") }} <Gap /></span>
    <button v-for="f in result.flags" :key="f.rule" class="mdtp-flag" lang="cs" :title="tip(f)" @click="open(f)">{{ f.label }}<template v-if="f.dated && f.date"> · {{ f.date }}</template><Marks :f="f.item" /></button>
    <span v-for="m in result.missing" :key="m" class="mdtp-flag gap" :title="$t('mdt-panel-missing-title')">{{ $t(`mdt-panel-missing-${m}`) }} -</span>
    <!-- Missing-document alerts are always signalled (CLAUDE.md), whatever is folded below; never as "nothing missing". -->
    <span v-if="docs === 'failed'" class="mdtp-flag gap" role="status">{{ $t("patient-missing-failed") }}</span>
    <span v-else-if="docs === 'unchecked'" class="mdtp-flag gap" role="status">{{ $t("patient-missing-unchecked") }}</span>
    <span v-else-if="docsMissing" class="mdtp-flag docs" role="status">{{ $t("patient-gaps-toggle-missing") }}</span>
  </div>
  <p class="muted mdtp-flags-note">{{ $t("mdt-panel-flags-note") }}</p>
</template>
