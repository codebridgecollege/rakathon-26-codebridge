<script setup lang="ts">
// Reading an uploaded document without AI (the server side is
// api/src/routes/pipeline.ts): Tesseract with the PDF text layer as a second reading, the readability check and the
// lab parser. The result is the assistant's reading, shown next to the prepared data; it never replaces what the case
// shows. The parent renders this only when the server has the pipeline on and the document is an uploaded file.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import { docIdOf } from "@codebridge/domain/case-data";
import { useApi } from "../../lib/api";
import { errorText } from "../../lib/writes";
import { useSessionStore } from "../../stores/session";
import Gap from "./Gap.vue";

type Run = {
  state?: string;
  error_code?: string;
  stage_cs?: string;
  label_cs?: string;
  readability_cs?: string;
  readability_reasons_cs?: string[];
  readability_alert_cs?: string;
  verify_count?: number;
  lab_points?: number;
  lab_unclear?: number;
  diff?: { same?: number; verify?: number; silent?: number; missing?: number };
};

// The poll interval and the number of polls: about three minutes, each poll a logged read.
const POLL_MS = 2000;
const POLLS = 90;

const props = defineProps<{ file: string }>();
const { $t } = useFluent();
const session = useSessionStore();
const id = computed(() => docIdOf(props.file));

const run = ref<Run | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
// Bumped when the component goes away or the user changes, so a running poll loop sees it is stale and stops.
let gen = 0;

async function load(): Promise<Run | null> {
  const mine = gen;
  try {
    const r = await useApi().pipeline(id.value);
    if (mine !== gen) return null;
    run.value = (r.run as Run | null) ?? null;
  } catch (e) {
    if (mine !== gen) return null;
    error.value = errorText($t, e);
  }
  // A failed poll keeps the last run, so the loop goes on with what it knew.
  return run.value;
}

async function start() {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  const mine = gen;
  try {
    await useApi().processDocument(id.value);
  } catch (e) {
    if (mine !== gen) return;
    busy.value = false;
    error.value = errorText($t, e);
    return;
  }
  await poll(mine);
}

// Polls until the run ends or about three minutes pass; each poll is a logged read.
async function poll(mine: number) {
  for (let i = 0; i < POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (mine !== gen) return;
    const r = await load();
    if (mine !== gen) return;
    if (r) error.value = null;
    if (r && finished(r)) break;
  }
  if (mine === gen) busy.value = false;
}
const finished = (r: Run) => r.state === "done" || r.state === "error";

// The last run is read once per document, so its result and a poor-copy warning survive a reload. A run still in
// progress (started before the doctor left the tab, or by someone else) is followed again, so the button stays
// disabled and a second reading cannot start over it.
async function init() {
  gen++;
  const mine = gen;
  run.value = null;
  busy.value = false;
  error.value = null;
  const r = await load();
  if (mine !== gen || !r || finished(r)) return;
  busy.value = true;
  await poll(mine);
}

onMounted(() => void init());
onBeforeUnmount(() => gen++);
// Another user sees their own reading state, and another document its own: what was shown and any running poll
// belong to the previous one.
watch([() => session.me?.user.id, () => props.file], () => void init());

const btnText = computed(() => (busy.value ? $t("patient-docs-pipe-busy") : run.value ? $t("patient-docs-pipe-rerun") : $t("patient-docs-pipe-run")));
const reasons = computed(() => (run.value?.readability_reasons_cs || []).join("; "));
</script>

<template>
  <span class="note"><button class="btn small" :disabled="busy" @click.stop.prevent="start">{{ btnText }}</button>{{ " " }}<span v-if="error" class="fwarn" role="alert">{{ error }}</span><template v-if="run"><span v-if="run.state === 'error'" class="fwarn">{{ $t("patient-docs-pipe-failed", { code: run.error_code || "other" }) }}</span><span v-else-if="run.state !== 'done'" class="muted">{{ $t("patient-docs-pipe-reading") }}<span v-if="run.stage_cs" lang="cs">{{ run.stage_cs }}</span><template v-else>{{ $t("patient-docs-pipe-queued") }}</template>{{ $t("patient-docs-pipe-reading-end") }}</span><template v-else><span :title="reasons"><span lang="cs">{{ run.label_cs }}</span>{{ $t("patient-docs-pipe-readability") }}<span v-if="run.readability_cs" lang="cs">{{ run.readability_cs }}</span><Gap v-else />{{ $t("patient-docs-pipe-verify", { n: run.verify_count ?? 0 }) }}<template v-if="run.lab_points">{{ $t("patient-docs-pipe-labs", { n: run.lab_points }) }}<template v-if="run.lab_unclear != null">{{ run.lab_unclear }}</template><Gap v-else />{{ $t("patient-docs-pipe-labs-end") }}</template><template v-if="run.diff">{{ $t("patient-docs-pipe-diff") }}<template v-if="run.diff.same != null">{{ run.diff.same }}</template><Gap v-else />{{ $t("patient-docs-pipe-diff-same") }}<template v-if="run.diff.verify != null">{{ run.diff.verify }}</template><Gap v-else />{{ $t("patient-docs-pipe-diff-verify") }}<template v-if="run.diff.silent">, <b>{{ $t("patient-docs-pipe-diff-silent", { n: run.diff.silent }) }}</b></template><template v-if="run.diff.missing">, <b>{{ $t("patient-docs-pipe-diff-missing", { n: run.diff.missing }) }}</b></template></template>.</span><template v-if="run.readability_alert_cs">{{ " " }}<span class="fwarn" role="alert" lang="cs">{{ run.readability_alert_cs }}</span></template></template></template></span>
</template>
