// The discussion record "Projednání na MDT" (screen S-5) of every case: notes, the conclusion draft and the next steps,
// their autosave with the version conflict bar, approval, a new version and the view state of the card (ensureProto(),
// protoTouched(), flushProto(), applyProto(), approveApi() and the "newversion", "prototheirs" and "protomine" actions
// in mocks/src/v3-template.html).
//
// - Typing never waits for the server: each field is stored 800 ms after the last keystroke, on leaving the field, and
//   before approval; one request per case at a time, in order. The server answers with the new version only, so the
//   fields are never redrawn from the answer (the conclusion field's IME rule).
// - A version conflict shows a bar with both choices; nothing typed is overwritten silently.
// - The server's protocol replaces the page's copy unless this page holds typed text it has not stored yet
//   (mergeProto() in @codebridge/domain/discussion).
// - A draft stays a draft until a named doctor approves it; approval waits for every save, the recording's last words
//   and audio, and any attendance change on its way, and sends one idempotency key per approval.
import { defineStore } from "pinia";
import { reactive, watch } from "vue";
import { ApiError, type CaseState, type PatientRow, type WriteReply } from "@codebridge/api-client";
import {
  approvalAttendance,
  approvalSignature,
  attKey,
  emptyProto,
  mergeProto,
  protoFromServer,
  type Proto,
} from "@codebridge/domain/discussion";
import type { Step } from "@codebridge/domain/protocol";
import { sectionsOf, fromExtraction } from "@codebridge/domain/case-data";
import { useApi } from "../lib/api";
import { errMsg, msgId, type Msg } from "../lib/msg";
import { refused } from "../lib/refused";
import { reportHtmlFor, type ReportProto } from "../lib/report";
import { useAttendanceStore } from "./attendance";
import { useCasesStore } from "./cases";
import { usePatientsStore } from "./patients";
import { usePatientViewStore } from "./patientView";
import { useRecorderStore } from "./recorder";
import { useReportStore } from "./report";
import { useSessionStore } from "./session";
import { useToastStore } from "./toast";
import { useWorkflowStore } from "./workflow";

export type Field = "notes" | "concl" | "steps";
export type Mode = "manual" | "ai" | "docs";
export type Conflict = { current: Record<string, unknown>; message: Msg };
type Save = {
  timer: ReturnType<typeof setTimeout> | null;
  dirty: Set<Field>;
  inflight: Promise<void> | null;
  conflict: Conflict | null;
  approving: boolean;
  approveKey: string | null;
  approveSig: string | null;
};
type T = (id: string, args?: Record<string, string | number>) => string;

const AUTOSAVE_MS = 800;
// A new step starts assigned to the coordinator with the old page's default date.
const NEW_STEP_DUE = "2026-10-30";

export const useDiscussionStore = defineStore("discussion", () => {
  // The page's copy of each case's record, by list file; created from the server's state when first read.
  const protos = reactive<Record<string, Proto>>({});
  // Autosave and approval state per case; reactive so the conflict bar and "Schvaluji…" redraw.
  const saves = reactive<Record<string, Save>>({});
  // View state of this page: the record's segment and the doctor's own open or closed choice of the card.
  const modes = reactive<Record<string, Mode>>({});
  const openChoice = reactive<Record<string, boolean>>({});

  const caseIdOf = (file: string) => usePatientsStore().byFile(file)?.id ?? null;
  const serverCase = (file: string): Partial<CaseState> | undefined => {
    const id = caseIdOf(file);
    return id ? useWorkflowStore().cases[id] : undefined;
  };

  function saveOf(file: string): Save {
    // Read back through the reactive map: the value "??=" returns is the plain object, whose changes would not redraw.
    saves[file] ??= { timer: null, dirty: new Set(), inflight: null, conflict: null, approving: false, approveKey: null, approveSig: null };
    return saves[file]!;
  }

  // The record of a case. Created from the stored state on first read; later answers are merged by sync().
  function protoOf(file: string): Proto {
    if (!protos[file]) protos[file] = mergeProto(null, protoFromServer(serverCase(file)?.protocol), false).proto;
    return protos[file]!;
  }

  // The server's protocol of one case, merged into the page's copy (applyProto()).
  function sync(file: string) {
    const sp = serverCase(file)?.protocol;
    if (!sp || !protos[file]) return;
    const sv = saveOf(file);
    const { proto, keepLocal } = mergeProto(protos[file]!, protoFromServer(sp), !!(sv.dirty.size || sv.inflight));
    Object.assign(protos[file]!, proto);
    if (!keepLocal) {
      sv.dirty.clear();
      sv.conflict = null;
    }
  }

  // Every answer that names a case's protocol (a write's state, /workflow) is merged. Watched by object identity: the
  // workflow store replaces a case's object whenever an answer names it.
  watch(
    () => Object.values(useWorkflowStore().cases).map((cs) => cs.protocol),
    () => {
      for (const file of Object.keys(protos)) sync(file);
    },
  );

  // The valid decisions of a case, oldest first (the append-only history).
  const decisionsOf = (file: string) =>
    ((serverCase(file)?.decisions ?? []) as { id?: string; version?: number; attSnap?: string[]; pickSnap?: string[] | null; reportSnap?: string | null; by?: string; when?: string }[])
      .slice()
      .sort((a, b) => (a.version || 0) - (b.version || 0));
  // An approved record takes its frozen attendance, ticks and report from the latest decision.
  function frozenOf(file: string) {
    const last = decisionsOf(file).at(-1);
    return { attSnap: last?.attSnap ?? [], pickSnap: last?.pickSnap ?? null, reportSnap: last?.reportSnap ?? "", approver: protoOf(file).approver ?? last?.by ?? null, when: protoOf(file).approved_at ?? last?.when ?? null };
  }

  // ---------- typing and autosave ----------
  function setText(file: string, field: "notes" | "concl", value: string) {
    const pr = protoOf(file);
    if (pr[field] === value) return;
    pr[field] = value;
    touched(file, field);
  }
  function setStep(file: string, i: number, f: keyof Step, value: string, now = false) {
    const st = protoOf(file).steps[i];
    if (!st) return;
    st[f] = value;
    touched(file, "steps", now);
  }
  function addStep(file: string, coordName: string) {
    protoOf(file).steps.push({ text: "", who: coordName, due: NEW_STEP_DUE });
    touched(file, "steps", true);
  }
  function removeStep(file: string, i: number) {
    protoOf(file).steps.splice(i, 1);
    touched(file, "steps", true);
  }

  function touched(file: string, field: Field, now = false) {
    const sv = saveOf(file);
    sv.dirty.add(field);
    if (sv.timer) clearTimeout(sv.timer);
    sv.timer = null;
    if (now) void flush(file);
    else sv.timer = setTimeout(() => void flush(file), AUTOSAVE_MS);
  }

  // Resolves true when the server holds everything typed so far, false when a save failed or a conflict waits.
  async function flush(file: string): Promise<boolean> {
    const sv = saveOf(file);
    if (sv.timer) clearTimeout(sv.timer);
    sv.timer = null;
    while (sv.inflight) await sv.inflight;
    if (sv.conflict) return false;
    const id = caseIdOf(file);
    if (!sv.dirty.size || !id) return true;
    const pr = protoOf(file);
    const fields = [...sv.dirty];
    sv.dirty.clear();
    const body: { version: number; notes?: string; concl?: string; steps?: Step[] } = { version: pr.version ?? 0 };
    if (fields.includes("notes")) body.notes = pr.notes;
    if (fields.includes("concl")) body.concl = pr.concl;
    if (fields.includes("steps")) body.steps = pr.steps.map((x) => ({ text: x.text, who: x.who, due: x.due }));
    let ok = true;
    sv.inflight = (async () => {
      try {
        const r = (await useApi().putProtocol(id, body)) as WriteReply<{ version?: number; updated_by?: string; updated_at?: string }>;
        pr.version = r.data?.version ?? (pr.version ?? 0) + 1;
        pr.updated_by = r.data?.updated_by ?? pr.updated_by;
        pr.updated_at = r.data?.updated_at ?? pr.updated_at;
      } catch (e) {
        ok = false;
        // What was not stored stays marked, so it is sent again with the next change, on blur or before approval.
        for (const f of fields) sv.dirty.add(f);
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "protocol_conflict" && err.current) sv.conflict = { current: err.current as Record<string, unknown>, message: errMsg(e) };
        else {
          // An approved or closed record takes no more text, and invalid input would be refused again on every
          // keystroke: the marks are cleared, the field message shown, and a locked record read again.
          const code = err?.code ?? "";
          if (code === "protocol_locked" || code === "case_closed" || code === "invalid_input") sv.dirty.clear();
          if (err?.fields && err.message_cs) useToastStore().show({ text: `${err.message_cs} ${Object.values(err.fields).join(" ")}` });
          else refused(e);
          if (code === "protocol_locked" || code === "case_closed") void reloadWorkflow();
        }
      }
    })();
    await sv.inflight;
    sv.inflight = null;
    return ok && !sv.dirty.size ? true : ok ? flush(file) : false;
  }

  async function reloadWorkflow() {
    try {
      const wf = await useApi().workflow();
      useSessionStore().applyState({ cases: wf.cases, att: wf.att, sessions: wf.sessions, mails: wf.mails });
    } catch {
      // The refusal was shown; the next action tries again.
    }
  }

  // The two answers to a version conflict; the doctor picks, nothing is merged silently.
  function resolveConflict(file: string, keep: "theirs" | "mine") {
    const sv = saveOf(file);
    const c = sv.conflict?.current;
    if (!c) return;
    sv.conflict = null;
    const pr = protoOf(file);
    if (keep === "theirs") {
      const theirs = protoFromServer(c);
      Object.assign(pr, { notes: theirs.notes, concl: theirs.concl, steps: theirs.steps, version: (c.version as number | undefined) ?? pr.version });
      sv.dirty.clear();
    } else {
      pr.version = (c.version as number | undefined) ?? pr.version;
      for (const f of ["notes", "concl", "steps"] as const) sv.dirty.add(f);
      void flush(file);
    }
  }

  // ---------- approval ----------
  // The old page's approve action and approveApi(). Every guard repeats what the disabled button already says, for any
  // other path here (a double click, a key press).
  async function approve(file: string, t: T, user: { name: string; isDoctor: boolean }) {
    const p = usePatientsStore().byFile(file);
    const pr = protoOf(file);
    const sv = saveOf(file);
    if (!p || pr.state === "approved") return;
    if (p.status === "closed" || !pr.concl.trim() || !user.isDoctor) return;
    // The report frozen at approval must not be built from data still on its way; a failed load does not block.
    const ls = useCasesStore().stateOf(file);
    if (ls === "loading" || ls === "absent") {
      useToastStore().show(msgId("discussion-approve-wait-data"));
      return;
    }
    // The same for the guideline layer: the frozen report lists the recorded deviations from it.
    const entry = useCasesStore().entries.get(file);
    const data = useCasesStore().readyData(file);
    const sec = sectionsOf(data ? fromExtraction(data.file, data.id, data.extraction) : null);
    const g = entry?.guide;
    if (usePatientViewStore().guideOn && sec.guidance && (!g || g.loading || !(g.statements || g.error))) {
      useToastStore().show(msgId("discussion-approve-wait-guide"));
      return;
    }
    if (sv.approving) return;
    if (sv.conflict) {
      useToastStore().show(msgId("discussion-approve-conflict-first"));
      return;
    }
    // Set before the first await, so a second click finds the approval running.
    sv.approving = true;
    try {
      // The server approves what it stores, so everything typed is stored first.
      // The state may have changed while the saves were on their way (another doctor approved).
      if (!(await flush(file)) || (pr.state as string) === "approved") return;
      // The last words and audio of the case go first, so the speaker pass covers them. Approval never waits on them for
      // long and never fails because of them (alerts inform, they never block).
      const rec = useRecorderStore();
      if (rec.serverMode && !(await rec.flush(file))) useToastStore().show(msgId("discussion-approve-recording-partial"));
      // An attendance change still on its way would make the server's list differ from the frozen one.
      const key = attKey(p);
      await useAttendanceStore().settled(key);
      const present = approvalAttendance(useAttendanceStore().present(key), user.name);
      const picked = [...useReportStore().picked];
      const snap: ReportProto = { state: "approved", concl: pr.concl, steps: pr.steps, approver: user.name };
      const body = {
        protocol_version: pr.version ?? 0,
        conclusion: pr.concl,
        picked_sections: picked,
        // The server keeps the snapshot without name, birth number and age (it refuses a report holding them).
        report_html: reportHtmlFor(t, file, snap, present, { withIdentity: false }),
        attendance_expected: present,
      };
      const sig = approvalSignature(body);
      if (sv.approveSig !== sig) {
        sv.approveKey = useApi().newKey();
        sv.approveSig = sig;
      }
      const n = pr.steps.filter((x) => x.text.trim()).length;
      let r: WriteReply<{ speaker_pass_job_id?: string | null }>;
      try {
        r = (await useApi().approve(p.id, body, sv.approveKey!)) as WriteReply<{ speaker_pass_job_id?: string | null }>;
      } catch (e) {
        // Status 0: the server may have seen it, so a retry reuses the key and gets the same decision back.
        if (e instanceof ApiError && e.status) {
          sv.approveKey = null;
          sv.approveSig = null;
        }
        // A colleague stored a newer draft: the same bar as for autosave, so the doctor sees both and decides.
        if (e instanceof ApiError && e.code === "protocol_conflict" && e.current) {
          sv.conflict = { current: e.current as Record<string, unknown>, message: errMsg(e) };
          useToastStore().show(errMsg(e));
        } else refused(e);
        return;
      }
      sv.approveKey = null;
      sv.approveSig = null;
      useSessionStore().applyState(r.state);
      rec.afterApprove(file, r.data?.speaker_pass_job_id ?? null);
      useToastStore().show(n ? msgId("discussion-approved-with-tasks", { n }) : msgId("discussion-approved"));
    } finally {
      sv.approving = false;
    }
  }

  // "Nový závěr (nahradí platný)": only an approved conclusion is superseded, never an unapproved draft, and a closed
  // case is reopened from the status menu first. The server names the decision it replaces.
  const nvBusy = new Set<string>();
  async function newVersion(file: string, isDoctor: boolean) {
    const p = usePatientsStore().byFile(file);
    const pr = protoOf(file);
    if (!p || p.status === "closed" || pr.state !== "approved" || !isDoctor || nvBusy.has(file)) return;
    nvBusy.add(file);
    try {
      const last = decisionsOf(file).at(-1);
      const r = await useApi().newVersion(p.id, { expected_decision_id: last?.id ?? null });
      useSessionStore().applyState(r.state);
    } catch (e) {
      refused(e);
    } finally {
      nvBusy.delete(file);
    }
  }

  // ---------- view state ----------
  const modeOf = (file: string): Mode => modes[file] ?? "manual";
  function setMode(file: string, m: Mode) {
    modes[file] = m;
  }
  const choiceOf = (file: string): boolean | undefined => openChoice[file];
  function setChoice(file: string, open: boolean) {
    openChoice[file] = open;
  }
  // Moving to a case from the session bar or the start dialog opens its card again (delete S.mdtOpen[file]).
  function clearChoice(file: string) {
    delete openChoice[file];
  }

  // A user switch: the records were read under the previous user's access; unsaved timers stop.
  function reset() {
    for (const [f, sv] of Object.entries(saves)) {
      if (sv.timer) clearTimeout(sv.timer);
      delete saves[f];
    }
    for (const f of Object.keys(protos)) delete protos[f];
  }

  // Read without creating the page's copy, so a list of cases (the session bar, the recorder) writes nothing.
  // Before a user switch, what was typed is stored under the user who typed it; the records then go, because the next
  // user's access decides what they may read (switchApiUser() in the template).
  useSessionStore().onBeforeUserSwitch(async () => {
    await Promise.all(Object.keys(saves).map((f) => flush(f)));
    reset();
  });

  const isApproved = (file: string) => (protos[file]?.state ?? protoFromServer(serverCase(file)?.protocol).state) === "approved";
  const isDirty = (file: string) => !!saves[file]?.dirty.size;
  const conflictOf = (file: string) => saves[file]?.conflict ?? null;
  const approving = (file: string) => !!saves[file]?.approving;

  return {
    protos,
    protoOf,
    decisionsOf,
    frozenOf,
    setText,
    setStep,
    addStep,
    removeStep,
    touched,
    flush,
    resolveConflict,
    approve,
    newVersion,
    modeOf,
    setMode,
    choiceOf,
    setChoice,
    clearChoice,
    reset,
    isApproved,
    isDirty,
    conflictOf,
    approving,
    emptyProto,
  };
});

export type { PatientRow };
