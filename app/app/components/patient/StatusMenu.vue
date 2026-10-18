<script setup lang="ts">
// The status chip in the case header opens a small menu (statusMenu() in the template): the allowed manual moves for
// doctors and the coordinator, and the status history for everyone. "Naplánován" and "Projednán" are never picked by
// hand: booking and approval set them. Every change waits for the server and is written to the history and the log.
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useFluent } from "fluent-vue";
import { manualMoves, isStatus, type Status } from "@codebridge/domain/status";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { useApi } from "../../lib/api";
import { caseWrite } from "../../lib/writes";
import { toast } from "../../lib/toast";
import { fmtWhen, slotText } from "../../lib/format";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();

const STATUS_ID: Record<Status, string> = {
  new: "patient-status-new",
  scheduled: "patient-status-scheduled",
  attention: "patient-status-attention",
  ready: "patient-status-ready",
  done: "patient-status-done",
  closed: "patient-status-closed",
};
const CHIP: Record<Status, string> = { new: "st-new", scheduled: "st-scheduled", attention: "st-attention", ready: "st-ready", done: "st-done", closed: "st-closed" };
const label = (s: string) => (isStatus(s) ? $t(STATUS_ID[s]) : s);

const status = computed<Status>(() => (isStatus(c.p.value.status) ? c.p.value.status : "new"));
// The history from the stored workflow state (the list row carries none), with times formatted when shown.
const hist = computed(() => (c.wf.value.statusHist ?? c.p.value.statusHist ?? []).map((h) => ({ ...h, when: fmtWhen(h.when) })));
const open = computed(() => view.statusOpen === c.p.value.file);
const moves = computed(() =>
  c.canSetStatus.value ? manualMoves({ status: status.value, hasSlot: !!c.p.value.slot }, hist.value.filter((h) => isStatus(h.from) && isStatus(h.to)) as { from: Status; to: Status }[]) : [],
);
// Closing a case with an unapproved conclusion draft is allowed, but the menu says so.
const hasDraft = computed(() => {
  const pr = (c.wf.value.protocol ?? {}) as { state?: string; concl?: string };
  return pr.state !== "approved" && !!String(pr.concl ?? "").trim();
});
const tip = computed(() => {
  const last = hist.value.at(-1);
  return last ? $t("patient-status-tooltip-last", { by: last.by, when: last.when }) : $t("patient-status-tooltip");
});
function moveLabel(k: Status) {
  if (status.value === "closed") return $t("patient-status-reopen", { status: label(k) });
  if (k === "closed") return $t("patient-status-close");
  if (k === "new" || k === "scheduled") return $t("patient-status-back", { status: label(k) });
  return $t("patient-status-change", { status: label(k) });
}

function toggle() {
  view.statusOpen = open.value ? null : c.p.value.file;
}

function move(to: Status) {
  const p = c.p.value;
  // The menu offers only the allowed moves; this guard repeats the rule for any other path here.
  if (!c.canSetStatus.value || !moves.value.includes(to)) return;
  const reopen = p.status === "closed";
  const was = slotText($t, p.slot);
  view.statusOpen = null;
  void caseWrite($t, () => useApi().setStatus(p.id, { to, expected_status: status.value }), {
    busyKey: `status:${p.file}`,
    onOk: (r) => {
      // PORT(#13): closing a case also stops its AI recording in the template (recPurge); the recorder port adds it.
      if (to === "closed") toast(r.data?.slot_released ? $t("patient-status-closed-slot-freed", { slot: was }) : $t("patient-status-closed-toast"));
      else toast(reopen ? $t("patient-status-reopened-toast") : $t("patient-status-changed-toast", { status: label(to) }));
    },
  });
}

// A click outside the menu closes it, as in the template.
function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Element | null;
  if (t?.closest?.(".stpop, .stwrap > button")) return;
  view.statusOpen = null;
}
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) view.statusOpen = null;
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <span class="stwrap">
    <!-- data-stmenu: the tooltip plugin lets a click on this chip open the menu instead of only showing the tip. -->
    <button :class="['chip', CHIP[status]]" data-stmenu :aria-expanded="open" aria-haspopup="dialog" :title="open ? undefined : tip" @click="toggle">{{ label(status) }} ▾</button>
    <div v-if="open" class="fpop stpop" role="dialog" :aria-label="$t('patient-status-menu')">
      <span class="label">{{ $t("patient-status-menu") }}</span>
      <button v-for="k in moves" :key="k" class="btn small" @click="move(k)">{{ moveLabel(k) }}</button>
      <span v-if="moves.includes('closed') && hasDraft" class="small" style="color:var(--missing)">{{ $t("patient-status-unapproved-draft") }}</span>
      <span class="muted small">{{ c.canSetStatus.value ? $t("patient-status-help") : $t("patient-status-read-only") }}</span>
      <span class="label" style="margin-top:4px">{{ $t("patient-status-history") }}</span>
      <ol v-if="hist.length" reversed>
        <li v-for="(h, i) in hist.slice().reverse()" :key="i">{{ label(h.from) }} -> <b>{{ label(h.to) }}</b> · {{ h.by }}, {{ h.when }} · <span lang="cs">{{ h.how }}</span></li>
      </ol>
      <span v-else class="muted small">{{ $t("patient-status-no-history") }}</span>
      <div class="row" style="justify-content:flex-end"><button class="btn small" @click="view.statusOpen = null">{{ $t("patient-close") }}</button></div>
    </div>
  </span>
</template>
