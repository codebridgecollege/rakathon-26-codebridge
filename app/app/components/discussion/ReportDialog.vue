<script setup lang="ts">
// The dialog "Záznam z MDT" behind the header's "Stáhnout report (PDF)" (the "report" overlay, refreshReport() and
// downloadReport() in mocks/src/v3-template.html; PRODUCT.md F-31). Before approval the ticks choose what the draft
// prints and the preview follows every tick, the conclusion and the steps. After approval the report is the snapshot
// frozen at approval, and the ticks show what was chosen then, disabled, so the dialog never suggests a change that
// would not print.
import { computed, onMounted, ref } from "vue";
import { useFluent } from "fluent-vue";
import { attKey } from "@codebridge/domain/discussion";
import { fromExtraction, sectionsOf } from "@codebridge/domain/case-data";
import { useOverlayStore } from "../../stores/overlay";
import { usePatientsStore } from "../../stores/patients";
import { useCasesStore } from "../../stores/cases";
import { useDiscussionStore } from "../../stores/discussion";
import { useAttendanceStore } from "../../stores/attendance";
import { useReportStore } from "../../stores/report";
import { useToastStore } from "../../stores/toast";
import { useApi } from "../../lib/api";
import { useDialogFocus } from "../../lib/dialog";
import { fmtWhen } from "../../lib/dates";
import { msgId } from "../../lib/msg";
import { FIND, fillIdent, reportFileName, reportHtmlFor } from "../../lib/report";
import { loadPdfLib, reportPdf } from "../../lib/report-pdf";

const props = defineProps<{ o: { kind: "report"; file: string } }>();
const { $t } = useFluent();
const t = (id: string, args?: Record<string, string | number>) => $t(id, args);
const overlay = useOverlayStore();
const cases = useCasesStore();
const discussion = useDiscussionStore();
const attendance = useAttendanceStore();
const report = useReportStore();

const row = computed(() => usePatientsStore().byFile(props.o.file));
// The dialog draws only while the case is in the list (a user switch can drop it); p is read behind that check.
const p = computed(() => row.value!);
const pr = computed(() => discussion.protoOf(props.o.file));
const locked = computed(() => pr.value.state === "approved");
const frozen = computed(() => discussion.frozenOf(props.o.file));
const sec = computed(() => {
  const d = cases.readyData(props.o.file);
  return sectionsOf(d ? fromExtraction(d.file, d.id, d.extraction) : null);
});
const picks = computed(() => ["summary", ...(sec.value.anamnesis ? ["anamnesis"] : []), ...(sec.value.record ? FIND : [])]);
const picked = computed<ReadonlySet<string>>(() => (locked.value && frozen.value.pickSnap ? new Set(frozen.value.pickSnap) : report.picked));

// The report as the preview shows it and the PDF prints it. An approved report with a stored snapshot is that
// snapshot with the current identity filled in; anything else is built now, so it re-renders when its inputs change.
const html = computed(() =>
  locked.value && frozen.value.reportSnap
    ? fillIdent(frozen.value.reportSnap, p.value, t)
    : reportHtmlFor(t, props.o.file, pr.value, attendance.present(attKey(p.value))),
);

function pick(key: string, e: Event) {
  if (locked.value) return;
  report.setPicked(key, (e.target as HTMLInputElement).checked);
}
function onToggle(e: Event) {
  report.previewOpen = (e.target as HTMLDetailsElement).open;
}

const busy = ref(false);
const error = ref("");
async function download() {
  if (busy.value || !row.value) return;
  // Everything is captured before the first await: patient navigation or edits cannot change this download.
  const snapshot = html.value;
  const pt = p.value;
  const name = reportFileName(pt.id, pt.slot?.day, !locked.value);
  busy.value = true;
  error.value = "";
  try {
    // The library may still be loading from when the dialog opened; a failed load makes reportPdf() say so.
    await loadPdfLib();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bytes = reportPdf(t, snapshot, { id: pt.id }).output("arraybuffer");
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked later: some browsers start reading the file only after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    // The PDF carries the patient's identity, so its creation is logged (fixed code, no free text). A lost audit event
    // must not block the download.
    useApi()
      .auditEvent({ code: "report_downloaded", case_id: pt.id })
      .catch(() => {});
    useToastStore().show(msgId("discussion-report-ready"));
  } catch (err) {
    error.value = $t("discussion-report-error", { message: err instanceof Error ? err.message : String(err) });
    useToastStore().show(msgId("discussion-report-failed"));
  } finally {
    busy.value = false;
  }
}

// Focus moves into the dialog and back to what opened it; Tab stays inside. Escape closes it through OverlayHost.
const box = ref<HTMLElement | null>(null);
const { onKeydown } = useDialogFocus(box, ref(true));
// The PDF library loads when the dialog opens, not with the app.
onMounted(() => void loadPdfLib());
</script>

<template>
  <div v-if="row" class="scrim" @click="overlay.close()" />
  <div v-if="row" ref="box" class="modal" role="dialog" aria-modal="true" :aria-label="$t('discussion-report-dialog-label')" tabindex="-1" @keydown="onKeydown">
    <div class="row spread">
      <h2>{{ $t("discussion-report-dialog-title", { id: p.id }) }}</h2>
      <button class="btn small" @click="overlay.close()">{{ $t("discussion-report-close") }}</button>
    </div>
    <div>
      <span class="label">{{ $t("discussion-report-pick-label") }}</span>
      <div class="row small" style="gap:4px 14px;margin-top:4px">
        <label v-for="k in picks" :key="k" class="row" style="gap:4px"><input type="checkbox" :data-pickrep="k" :checked="picked.has(k)" :disabled="locked" @change="pick(k, $event)"> {{ $t("discussion-report-pick", { key: k }) }}</label>
      </div>
    </div>
    <details class="srcs" style="margin:0" :open="report.previewOpen" @toggle="onToggle">
      <summary>{{ $t("discussion-report-preview") }}</summary>
      <!-- The report is built from escaped values only (lib/report.ts), or is the snapshot the server validated. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div id="report" style="margin-top:8px" lang="cs" v-html="html" />
    </details>
    <p class="muted small" style="margin:0">{{ locked ? $t("discussion-report-locked", { when: fmtWhen(frozen.when) }) : $t("discussion-report-draft-note") }}</p>
    <p id="report-error" class="report-error small" role="alert" :hidden="!error">{{ error }}</p>
    <div class="row" style="justify-content:flex-end">
      <button class="btn primary" data-act="download" :disabled="busy" @click="download">{{ busy ? $t("discussion-report-busy") : $t("discussion-report-download") }}</button>
    </div>
  </div>
</template>
