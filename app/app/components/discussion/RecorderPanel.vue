<script setup lang="ts">
// The "AI záznam" segment of the discussion card: start and stop, the state line, the speaker
// passes and the summary draft, and the transcript. Same markup and classes, so the copied CSS styles
// it. Vue updates only the nodes that change, so live words never steal focus from a doctor typing elsewhere.
import { computed, watch } from "vue";
import { useFluent } from "fluent-vue";
import { inSession, runningSession } from "@codebridge/domain/discussion";
import { recErrMsg } from "@codebridge/domain/recording";
import { useMsg, type Msg } from "../../lib/msg";
import { useRecorderStore } from "../../stores/recorder";
import { useDiscussionStore } from "../../stores/discussion";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import RecorderTranscript from "./RecorderTranscript.vue";

const props = defineProps<{ file: string }>();
const { $t } = useFluent();
const fmt = useMsg();
const rec = useRecorderStore();
const discussion = useDiscussionStore();
const patients = usePatientsStore();
const workflow = useWorkflowStore();

const p = computed(() => patients.byFile(props.file));
const tx = computed(() => rec.tx(props.file));
const summary = computed(() => tx.value.summary);
const summaryDone = computed(() => summary.value?.state === "done");

// In server mode the stored transcript is read once per case, and again after a user switch cleared it. A failed read
// is tried again only when the case is shown again, so a refusal does not repeat in a loop.
watch(
  () => [props.file, rec.serverMode, rec.gen] as const,
  ([file, server]) => {
    if (server && !rec.tx(file).loaded) void rec.load(file);
  },
  { immediate: true },
);

type StateKey = "connecting" | "off" | "recording" | "approved" | "off-agenda" | "running";
const stateKey = computed<StateKey>(() => {
  if (rec.status === "connecting") return "connecting";
  if (!rec.on) return "off";
  if (rec.target === props.file) return "recording";
  if (discussion.isApproved(props.file)) return "approved";
  const s = runningSession(workflow.sessions);
  return s && !inSession(p.value, s) ? "off-agenda" : "running";
});

// A start failure carries the catalog ID of its cause in reasonId; it is formatted into $reason here.
function msgText(m: Msg | null): string {
  if (m && "id" in m && m.args?.reasonId) {
    const { reasonId, ...rest } = m.args;
    return $t(m.id, { ...rest, reason: $t(String(reasonId), rest) });
  }
  return fmt(m);
}
const errText = (code: string | null | undefined) => fmt(recErrMsg(code));

function onStart() {
  // The button is disabled without a speech service; this guard repeats the rule for any other path here.
  if (!rec.stt) return;
  void rec.start();
}
</script>

<template>
  <template v-if="p">
    <div id="recctl">
      <template v-if="!rec.stt && !rec.on">
        <div class="recbar">
          <button class="btn recbtn" disabled>{{ $t("discussion-rec-start") }}</button>
          <span class="small">{{ rec.probed ? $t("discussion-rec-unavailable-manual") : $t("discussion-rec-probing") }}</span>
        </div>
      </template>
      <div v-else class="recbar">
        <button v-if="rec.on || rec.status === 'connecting'" class="btn recbtn on" @click="rec.stop()">{{ $t("discussion-rec-stop") }}</button>
        <button v-else class="btn recbtn" @click="onStart">{{ $t("discussion-rec-start") }}</button>
        <span class="small"><span v-if="stateKey === 'recording'" class="recdot" />{{ $t(`discussion-rec-state-${stateKey}`) }}</span>
      </div>
      <p v-if="rec.msg" class="small" style="margin:8px 0 0">{{ msgText(rec.msg) }}</p>
    </div>
    <div id="recbody" :data-pid="file">
      <div id="recpasses">
        <template v-for="(x, i) in tx.passes" :key="x.id ?? x.jobId ?? i">
          <p v-if="x.state === 'running' && x.phase !== 'summary'" class="muted small" style="margin:10px 0 0">{{ $t("discussion-rec-diarizing") }}</p>
          <p v-else-if="x.state === 'purged'" class="small" style="margin:10px 0 0">{{ x.reason ? $t("discussion-rec-purged-why", { reason: x.reason }) : $t("discussion-rec-purged") }}</p>
          <p v-else-if="x.state === 'error' && x.err === 'start_failed'" class="small" style="margin:10px 0 0">
            {{ $t("discussion-rec-pass-start-failed") }} <button class="linkbtn small" :data-recretry="i" @click="rec.retry(file, i)">{{ $t("discussion-rec-retry") }}</button>
          </p>
          <p v-else-if="x.state === 'error'" class="small" style="margin:10px 0 0">
            {{ $t("discussion-rec-pass-failed", { reason: errText(x.err) }) }}
            <button v-if="x.audioKept" class="linkbtn small" :data-recretry="i" @click="rec.retry(file, i)">{{ $t("discussion-rec-retry") }}</button>
            <template v-else>{{ $t("discussion-rec-audio-gone") }}</template>
          </p>
        </template>
        <p v-if="summary?.state === 'running'" class="muted small" style="margin:10px 0 0">{{ $t("discussion-rec-summarizing") }}</p>
        <p v-else-if="summary?.state === 'error'" class="small" style="margin:10px 0 0">{{ $t("discussion-rec-summary-failed", { reason: errText(summary.err) }) }}</p>
        <div v-else-if="summaryDone" class="recsum">
          <span class="chip plain st-new">{{ $t("discussion-rec-summary-chip") }}</span> {{ summary?.text }}
          <span v-if="summary?.basis === 'live_only'" class="muted small">{{ $t("discussion-rec-summary-live-only") }}</span>
        </div>
      </div>
      <!-- Once the summary exists it leads, and the transcript it came from folds into a closed panel. -->
      <details v-if="summaryDone" class="srcs" style="margin-top:8px">
        <summary>{{ $t("discussion-rec-transcript") }}</summary>
        <RecorderTranscript :file="file" />
      </details>
      <RecorderTranscript v-else :file="file" />
    </div>
  </template>
</template>
