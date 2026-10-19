<script setup lang="ts">
// One alert: its kind, its message in the interface language (a Fluent message whose fact arguments show as the
// facts' lines), links to the passages it rests on, the assistant's note in the documents' language, who last acted
// on it and when, its history (in the full list), and the actions. A fact the alert names that the current processing
// does not show is said, never hidden. Every alert list sits under a
// header saying the alerts are the assistant's observations and never block the discussion.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { alertNote, alertState, type AlertEntry } from "@codebridge/domain/case-view";
import { alertArgs } from "@codebridge/domain/run-view";
import { usePatient } from "../../composables/usePatient";
import { alertAct } from "../../lib/alerts";
import SrcLinks from "./SrcLinks.vue";

const props = defineProps<{ f: AlertEntry; compact?: boolean }>();
const { $t } = useFluent();
const c = usePatient();

const KIND: Record<string, [string, string]> = {
  missing: ["patient-alert-kind-missing", "k-missing"],
  contradiction: ["patient-alert-kind-contradiction", "k-contradiction"],
  chronology: ["patient-alert-kind-chronology", "k-change"],
  unclear: ["patient-alert-kind-unclear", "k-unclear"],
  poor_copy: ["patient-alert-kind-poor-copy", "k-unclear"],
  identity: ["patient-alert-kind-identity", "k-contradiction"],
};
const kind = computed(() => KIND[props.f.kind] ?? KIND.unclear!);
const st = computed(() => alertState(c.alertHist.value, props.f.i));
const note = computed(() => alertNote(props.f.note));
const msg = computed(() => (c.cd.value ? alertArgs(c.cd.value, props.f, (id, args) => $t(id, args)) : { args: {}, unresolved: [] }));
const text = computed(() => $t(props.f.message.id, msg.value.args));
const ACT: Record<string, string> = { ack: "patient-alert-acked-by", resolved: "patient-alert-resolved-by", reopen: "patient-alert-reopened-by" };
const ACT_LOWER: Record<string, string> = { ack: "patient-alert-hist-ack", resolved: "patient-alert-hist-resolved", reopen: "patient-alert-hist-reopen" };
const act = (a: "ack" | "resolved" | "reopen") => void alertAct(c, $t, props.f.i, a);
</script>

<template>
  <div :class="['alert', st.state !== 'open' ? 'ack' : '']" role="listitem">
    <span :class="['chip', 'plain', kind[1]]">{{ $t(kind[0]) }}</span>
    <span>
      <span>{{ text }}</span> <SrcLinks :refs="f.based_on" />
      <span v-if="msg.unresolved.length" class="why">{{ $t("patient-alert-unresolved") }}</span>
      <span v-if="!compact && note" class="why" lang="cs">{{ note }}</span>
      <span v-if="st.last && st.last.action !== 'reopen'" class="why">{{ $t(ACT[st.last.action]!, { who: st.last.who, when: st.last.when }) }}</span>
      <details v-if="!compact && st.hist.length" class="alhist">
        <summary>{{ $t("patient-alert-history", { n: st.hist.length }) }}</summary>
        <ul style="margin:4px 0 0;padding-left:18px">
          <li v-for="(x, k) in st.hist" :key="k">{{ x.when }} · {{ x.who }} · {{ $t(ACT_LOWER[x.action]!) }}</li>
        </ul>
      </details>
    </span>
    <span class="albtns">
      <template v-if="c.canSetStatus.value">
        <button v-if="st.state === 'resolved'" class="btn small" @click="act('reopen')">{{ $t("patient-alert-reopen") }}</button>
        <template v-else>
          <button v-if="st.state === 'ack'" class="btn small" @click="act('reopen')">{{ $t("patient-alert-reopen") }}</button>
          <button v-else class="btn small ackbtn" @click="act('ack')">{{ $t("patient-alert-ack") }}</button>
          <button class="btn small ackbtn" @click="act('resolved')">{{ $t("patient-alert-resolve") }}</button>
        </template>
      </template>
    </span>
  </div>
</template>
