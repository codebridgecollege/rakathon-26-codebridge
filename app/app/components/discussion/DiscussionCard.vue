<script setup lang="ts">
// "Projednání na MDT" (screen S-5): the discussion record (manual notes, the AI recording,
// documents brought to the meeting), the next steps, who is present and the approval, in the patient view itself.
// Outside a session it is collapsed unless a draft or an approved conclusion exists; in a session it is open and
// outlined. A conclusion is a draft until a named doctor approves it; approval freezes the attendance and the report.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { assignees, attKey, cardChip, cardOpen, inSession, protoEditable, runningSession } from "@codebridge/domain/discussion";
import { isDefaultStaff } from "@codebridge/domain/staff-default";
import { usePatient } from "../../composables/usePatient";
import { useListText } from "../../composables/useListText";
import { useDiscussionStore, type Mode } from "../../stores/discussion";
import { useAttendanceStore } from "../../stores/attendance";
import { useWorkflowStore } from "../../stores/workflow";
import { useStaffStore } from "../../stores/staff";
import { useUploadsStore } from "../../stores/uploads";
import { useOverlayStore } from "../../stores/overlay";
import { useSessionStore } from "../../stores/session";
import { useRecorderStore } from "../../stores/recorder";
import { useApi } from "../../lib/api";
import { caseWrite } from "../../lib/writes";
import { toast } from "../../lib/toast";
import { fmtDate, fmtWhen } from "../../lib/dates";
import { useMsg } from "../../lib/msg";
import CaseUploads from "../uploads/CaseUploads.vue";
import DocPipeline from "../patient/DocPipeline.vue";
import RecorderPanel from "./RecorderPanel.vue";
import SuggestionsBox from "./SuggestionsBox.vue";
import ApprovalMails from "./ApprovalMails.vue";

const { $t } = useFluent();
const c = usePatient();
const text = useListText();
const fmt = useMsg();
const disc = useDiscussionStore();
const att = useAttendanceStore();
const workflow = useWorkflowStore();
const staff = useStaffStore();
const uploads = useUploadsStore();
const overlay = useOverlayStore();
const session = useSessionStore();
const rec = useRecorderStore();

const p = computed(() => c.p.value);
const file = computed(() => p.value.file);
const pr = computed(() => disc.protoOf(file.value));
const key = computed(() => attKey(p.value));
const present = computed(() => att.present(key.value));
const locked = computed(() => pr.value.state === "approved");
const closed = computed(() => p.value.status === "closed");
const ro = computed(() => !protoEditable(c.canSetStatus.value, pr.value.state, p.value.status));
const live = computed(() => inSession(p.value, runningSession(workflow.sessions)));
const hasConcl = computed(() => !!pr.value.concl.trim());
const frozen = computed(() => disc.frozenOf(file.value));
const shown = computed(() => (locked.value ? frozen.value.attSnap : present.value));
const named = computed(() => pr.value.steps.filter((x) => x.text.trim()));
const decisions = computed(() => disc.decisionsOf(file.value).length);
const chip = computed(() => cardChip(pr.value.state, pr.value.concl, decisions.value));
const open = computed(() => cardOpen(disc.choiceOf(file.value), live.value, hasConcl.value, locked.value));
const mode = computed(() => disc.modeOf(file.value));
const approving = computed(() => disc.approving(file.value));
const conflict = computed(() => disc.conflictOf(file.value));
const userName = computed(() => c.userName.value);
const coordName = computed(() => staff.coord?.name ?? "");
const staffNames = computed(() => new Set(staff.nameById.values()));
const who = computed(() => assignees(coordName.value, p.value.owner, present.value, staffNames.value));
// Uploading and removing documents: doctors and the coordinator, on an open case whose conclusion is not approved.
const canUpload = computed(() => c.canSetStatus.value && !closed.value && !locked.value);
const docsCount = computed(() => uploads.docsOf(file.value).length);
const pipelineOn = computed(() => session.me?.features?.pipeline === true);
// The last move to "closed" names who closed the case and when.
const closedBy = computed(() => (c.wf.value.statusHist ?? p.value.statusHist ?? []).filter((h) => h.to === "closed").at(-1));
const staffNote = computed(() => (isDefaultStaff(staff.directory ? { depts: staff.directory.depts, coord: staff.directory.coord } : null) ? $t("discussion-staff-fictional") : $t("discussion-staff-list")));
const presentNote = computed(() => {
  if (locked.value) return $t("discussion-present-locked", { when: fmtWhen(frozen.value.when) });
  if (p.value.slot) return $t("discussion-present-day", { day: text.dayYear(p.value.slot.day), note: staffNote.value });
  return $t("discussion-present-case", { note: staffNote.value });
});

// The tooltip of a name: the person's function, when the staff list gives one.
const fnByName = computed(() => {
  const m = new Map<string, string>();
  for (const d of staff.depts) for (const x of d.people) if (x.fn) m.set(x.name, x.fn);
  if (staff.coord?.fn) m.set(staff.coord.name, staff.coord.fn);
  return m;
});
// A step keeps an assignee who left the list of offered people, so the stored value is never shown as another.
const whoFor = (current: string) => (who.value.includes(current) || !current ? who.value : [current, ...who.value]);

// Only the doctor's own toggles count as a choice; the browser also fires "toggle" when the page opens the card.
function onToggle(e: Event) {
  const el = e.target as HTMLDetailsElement;
  if (el.open !== open.value) disc.setChoice(file.value, el.open);
}
function setMode(m: Mode) {
  disc.setMode(file.value, m);
}
function onNotes(e: Event) {
  if (ro.value) return;
  disc.setText(file.value, "notes", (e.target as HTMLTextAreaElement).value);
}
// Leaving a field stores it at once instead of after the pause.
function flushNow() {
  if (disc.isDirty(file.value)) void disc.flush(file.value);
}
function onStep(i: number, f: "text" | "who" | "due", e: Event, now: boolean) {
  if (ro.value) return;
  disc.setStep(file.value, i, f, (e.target as HTMLInputElement).value, now);
}
function addStep() {
  if (!ro.value) disc.addStep(file.value, coordName.value);
}
function removeStep(i: number) {
  if (!ro.value) disc.removeStep(file.value, i);
}
function editAttendance() {
  overlay.open({ kind: "start", day: key.value, from: null, attOnly: true });
}
async function copyText(s: string, done: string) {
  try {
    await navigator.clipboard.writeText(s);
    toast(done);
  } catch {
    toast($t("discussion-copy-failed"));
  }
}
function copyAttendance() {
  void copyText((locked.value ? frozen.value.attSnap : present.value).join(", ") || $t("discussion-present-none"), $t("discussion-present-copied"));
}
function copySteps() {
  void copyText(named.value.map((x) => $t("discussion-steps-copy-line", { text: x.text, who: x.who, due: fmtDate($t, x.due) })).join("\n"), $t("discussion-steps-copied"));
}
// The conclusion has one field, in the brief above the card; "Zapsat závěr" puts the cursor in it.
function focusConclusion() {
  const el = document.getElementById("concl");
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.focus();
  }
}
function approve() {
  void disc.approve(file.value, { name: userName.value, isDoctor: c.isDoctor.value });
}
function newVersion() {
  void disc.newVersion(file.value, c.isDoctor.value);
}
// "Uzavřít případ" after the tasks are done; closing also ends the case's recording audio (recPurge).
function closeCase() {
  const cp = p.value;
  if (!c.canSetStatus.value || cp.status !== "done") return;
  const was = text.slotText(cp.slot);
  void caseWrite($t, () => useApi().setStatus(cp.id, { to: "closed", expected_status: "done" }), {
    busyKey: `status:${cp.file}`,
    onOk: (r) => {
      rec.purge([cp.file], "closed");
      toast(r.data?.slot_released ? $t("patient-status-closed-slot-freed", { slot: was }) : $t("patient-status-closed-toast"));
    },
  });
}
</script>

<template>
  <details :class="['card', 'mdtcard', live ? 'live' : '']" :open="open" @toggle="onToggle">
    <summary :aria-expanded="open">
      <h2>{{ $t("discussion-title") }}</h2>
      <span style="display:contents">
        <span v-if="chip?.kind === 'approved'" class="chip st-done">{{ $t("discussion-chip-approved") }}</span>
        <span v-else-if="chip?.kind === 'draft'" class="chip st-attention">{{ $t("discussion-chip-draft") }}</span>
        <span v-else-if="chip?.kind === 'valid'" class="chip st-new">{{ $t("discussion-chip-valid", { n: chip.n }) }}</span>
      </span>
      <span v-if="live" class="chip st-scheduled">{{ $t("discussion-chip-live") }}</span>
    </summary>
    <div>
      <div v-if="conflict" class="fwarn" role="alert" style="margin:0 0 10px">{{ fmt(conflict.message) }} <button class="btn small" @click="disc.resolveConflict(file, 'theirs')">{{ $t("discussion-conflict-theirs") }}</button><button class="btn small" @click="disc.resolveConflict(file, 'mine')">{{ $t("discussion-conflict-mine") }}</button></div>
    </div>
    <div class="grid2">
      <div class="stack">
        <div class="sub">
          <div class="head"><h3>{{ $t("discussion-record") }}</h3></div>
          <div class="seg2 three" role="group">
            <button :aria-pressed="mode === 'manual'" @click="setMode('manual')">{{ $t("discussion-mode-manual") }}</button>
            <button :aria-pressed="mode === 'ai'" @click="setMode('ai')"><span v-if="rec.on" class="recdot" />{{ $t("discussion-mode-ai") }}</button>
            <button :aria-pressed="mode === 'docs'" @click="setMode('docs')">{{ docsCount ? $t("discussion-mode-docs-count", { n: docsCount }) : $t("discussion-mode-docs") }}</button>
          </div>
          <CaseUploads
            v-if="mode === 'docs'"
            :case-ref="{ file: p.file, id: p.id }"
            :locked="!canUpload"
            :why="c.canSetStatus.value ? '' : $t('discussion-docs-who')"
            phone-target="discussion"
          >
            <template #pipeline="{ doc }">
              <div v-if="pipelineOn && doc?.content_stored && canUpload && doc.state !== 'prepared'" style="flex-basis:100%"><DocPipeline :file="`${doc.id}.pdf`" /></div>
            </template>
          </CaseUploads>
          <RecorderPanel v-else-if="mode === 'ai'" :file="p.file" />
          <!-- Two elements, not a fragment: a fragment's empty text anchors after the inline-block field add a line gap. -->
          <label v-if="mode === 'manual'" class="label" for="notes" style="display:block;margin:12px 0 6px">{{ $t("discussion-notes-label") }}</label>
          <textarea v-if="mode === 'manual'" id="notes" class="input" :placeholder="$t('discussion-notes-placeholder')" :disabled="ro" :value="pr.notes" @input="onNotes" @change="onNotes" @focusout="flushNow" />
        </div>
        <div class="sub">
          <div class="head">
            <h3>{{ $t("discussion-steps") }}</h3>
            <span class="row"><span class="muted small">{{ $t("discussion-steps-count", { n: named.length }) }}</span><button class="btn small" :disabled="!named.length" @click="copySteps">{{ $t("discussion-steps-copy") }}</button></span>
          </div>
          <div class="tasklist">
            <div v-for="(x, i) in pr.steps" :key="i" class="task">
              <input class="input" maxlength="500" :value="x.text" :placeholder="$t('discussion-step-placeholder')" :disabled="ro" @input="onStep(i, 'text', $event, false)" @change="onStep(i, 'text', $event, true)" @focusout="flushNow">
              <select class="input" :value="x.who" :disabled="ro" @change="onStep(i, 'who', $event, true)">
                <option v-for="a in whoFor(x.who)" :key="a" :value="a">{{ a }}</option>
              </select>
              <input class="input" type="date" :value="x.due" :disabled="ro" @input="onStep(i, 'due', $event, false)" @change="onStep(i, 'due', $event, true)" @focusout="flushNow">
              <button v-if="!ro" class="btn small" :aria-label="$t('discussion-step-remove')" @click="removeStep(i)">✕</button>
            </div>
          </div>
          <button v-if="!ro" class="btn small" style="margin-top:10px" @click="addStep">{{ $t("discussion-step-add") }}</button>
        </div>
      </div>
      <div class="stack">
        <div class="sub">
          <div class="head">
            <h3>{{ $t("discussion-present", { n: shown.length }) }}</h3>
            <span class="row"><button v-if="!locked && c.canSetStatus.value" class="btn small" @click="editAttendance">{{ $t("discussion-present-edit") }}</button><button class="btn small" @click="copyAttendance">{{ $t("discussion-present-copy") }}</button></span>
          </div>
          <p style="margin:0"><template v-if="shown.length"><template v-for="(n, i) in shown" :key="n"><template v-if="i">, </template><span :title="fnByName.get(n)">{{ n }}</span></template></template><template v-else>{{ $t("discussion-present-none") }}</template></p>
          <p class="muted small" style="margin:6px 0 0">{{ presentNote }}</p>
        </div>
        <div class="sub">
          <div class="head"><h3>{{ $t("discussion-approval") }}</h3></div>
          <template v-if="locked">
            <p class="small" style="margin:0">{{ $t("discussion-approved-by") }} <b>{{ frozen.approver }}</b> · {{ fmtWhen(frozen.when) }}</p>
            <div v-if="p.status === 'done' && c.canSetStatus.value" style="margin:10px 0 0">
              <button class="btn primary closecase" @click="closeCase">{{ $t("discussion-close-case") }}</button>
              <p class="muted small" style="margin:6px 0 0">{{ $t("discussion-close-note") }}</p>
            </div>
            <p v-if="closed" class="small" style="margin:8px 0 0"><span class="chip st-closed">{{ $t("patient-status-closed") }}</span> <template v-if="closedBy">{{ closedBy.by }}, {{ fmtWhen(closedBy.when) }}</template></p>
            <p v-if="closed" class="small closedmsg" style="margin:8px 0 0">{{ $t("patient-concl-closed") }}</p>
            <template v-else-if="c.isDoctor.value">
              <p style="margin:10px 0 0"><button class="btn small" @click="newVersion">{{ $t("discussion-new-version") }}</button></p>
              <p class="muted small" style="margin:6px 0 0">{{ $t("discussion-new-version-note") }}</p>
            </template>
          </template>
          <p v-else-if="closed" class="small closedmsg" style="margin:0">{{ $t("patient-concl-closed") }}</p>
          <template v-else>
            <p class="small" style="margin:0 0 6px">
              <template v-if="hasConcl">{{ $t("discussion-hint-has") }}</template>
              <template v-else>{{ $t("discussion-hint-none") }}<template v-if="c.isDoctor.value">{{ " " }}<button class="linkbtn small" @click="focusConclusion">{{ $t("discussion-hint-write") }}</button></template></template>
            </p>
            <button class="btn primary" style="width:100%" :disabled="!(hasConcl && c.isDoctor.value && !approving)" @click="approve">{{ approving ? $t("discussion-approving") : $t("discussion-approve") }}</button>
            <p class="small approver" style="margin:6px 0 0"><template v-if="c.isDoctor.value">{{ $t("discussion-approver") }} <b>{{ userName }}</b></template><template v-else>{{ $t("discussion-approver-doctor") }}</template></p>
            <p class="muted small" style="margin:4px 0 0"><template v-if="c.isDoctor.value && !present.includes(userName)">{{ $t("discussion-approve-join") }}{{ " " }}</template>{{ $t("discussion-approve-note") }}</p>
          </template>
        </div>
        <SuggestionsBox />
        <ApprovalMails v-if="locked" />
      </div>
    </div>
  </details>
</template>
