// The case on screen, for every part of the patient view: the list row, the case data in the view's shape, the
// stored workflow state (edits, the question confirmation, alert history, decisions), the guideline layer and what
// the current user may do. PatientView provides it once; the cards inject it, so no card picks a case on its own.
import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { CaseState, FactConfirmation, PatientRow } from "@codebridge/api-client";
import { fromExtraction, sectionsOf, docTitle as docTitleOf, type CaseData, type Sections, type SourceRef } from "@codebridge/domain/case-data";
import { orphansOf, type AlertEvent, type Edit, type Orphan } from "@codebridge/domain/case-view";
import { confirmationState, type ConfirmState } from "@codebridge/domain/confirmations";
import { useFactHashes } from "../lib/confirm";
import { useCasesStore, type CaseEntry, type Guidance } from "../stores/cases";
import { useSessionStore } from "../stores/session";
import { useWorkflowStore } from "../stores/workflow";
import { usePatientsStore } from "../stores/patients";
import { useOverlayStore } from "../stores/overlay";
import { useSourceStore } from "../stores/source";
import { fmtWhen, type T } from "../lib/dates";

export type PatientCtx = {
  p: ComputedRef<PatientRow>;
  entry: ComputedRef<CaseEntry>;
  cd: ComputedRef<CaseData | null>;
  sec: ComputedRef<Sections>;
  wf: ComputedRef<Partial<CaseState>>;
  // Edits by key, with their time formatted for display (the server sends ISO).
  edits: ComputedRef<Record<string, Edit>>;
  alertHist: ComputedRef<AlertEvent[]>;
  // A fact's confirmation: its state against the current value (confirmations.ts) and the latest confirming row.
  confirmOf: (factId: string) => { state: ConfirmState; last: (FactConfirmation & { when: string }) | undefined } | null;
  // Confirmations and edits the current run cannot show where they were made ("potvrzeno dříve, v novém zpracování
  // chybí"), with their time formatted.
  orphans: ComputedRef<Orphan[]>;
  guide: ComputedRef<Guidance>;
  userName: ComputedRef<string>;
  isDoctor: ComputedRef<boolean>;
  // Doctors and the coordinator run the cases; the administrator only reads.
  canSetStatus: ComputedRef<boolean>;
  edOf: (key: string) => Edit | undefined;
  openSource: (r: SourceRef | null | undefined) => void;
  openEdit: (key: string, orig: string | null | undefined) => void;
  docTitle: (r: SourceRef) => string;
};

const KEY: InjectionKey<PatientCtx> = Symbol("patient");

export function providePatient(file: ComputedRef<string>, t: T): PatientCtx {
  const cases = useCasesStore();
  const session = useSessionStore();
  const workflow = useWorkflowStore();
  const patients = usePatientsStore();
  const overlay = useOverlayStore();
  const source = useSourceStore();

  const p = computed(() => patients.byFile(file.value)!);
  const entry = computed(() => cases.entries.get(file.value) ?? { state: "absent" as const, data: null, error: null, gen: 0, loadedAt: 0 });
  const cd = computed(() => {
    const e = entry.value;
    return e.state === "ready" && e.data ? fromExtraction(e.data.file, e.data.id, e.data.extraction, e.data.documents) : null;
  });
  const sec = computed(() => sectionsOf(cd.value));
  const wf = computed<Partial<CaseState>>(() => workflow.cases[p.value?.id ?? ""] ?? {});
  const edits = computed(() => {
    const out: Record<string, Edit> = {};
    for (const [k, e] of Object.entries((wf.value.edits ?? {}) as Record<string, Edit>)) out[k] = { ...e, when: fmtWhen(e.when) };
    return out;
  });
  // The server keys alert events by alert ID; the view's rules call the key "i".
  const alertHist = computed<AlertEvent[]>(() => (wf.value.alertHist ?? []).map((x) => ({ i: x.alert_id, action: x.action, who: x.who, when: fmtWhen(x.when) })));
  // The hash of each current fact's confirmed content, computed in the browser as the server does, so a confirmation of
  // another value shows as "changed" instead of standing.
  const hashes = useFactHashes(cd);
  const confirmOf = (factId: string) => {
    const sha = hashes.value[factId];
    if (!sha) return null;
    const rows = (wf.value.confirmations ?? []).filter((r) => r.fact_id === factId);
    const last = [...rows].reverse().find((r) => r.action === "confirm");
    return { state: confirmationState(rows, sha), last: last ? { ...last, when: fmtWhen(last.when) } : undefined };
  };
  const orphans = computed(() =>
    orphansOf(cd.value, edits.value, (wf.value.confirmations ?? []).map((r) => ({ ...r, when: fmtWhen(r.when) }))),
  );
  const guide = computed<Guidance>(() => entry.value.guide ?? {});
  const role = computed(() => session.me?.user.role);
  const ctx: PatientCtx = {
    p,
    entry,
    cd,
    sec,
    wf,
    edits,
    alertHist,
    confirmOf,
    orphans,
    guide,
    userName: computed(() => session.me?.user.name ?? ""),
    isDoctor: computed(() => role.value === "doctor"),
    canSetStatus: computed(() => role.value === "doctor" || role.value === "coordinator"),
    edOf: (key) => edits.value[key],
    openSource: (r) => {
      // A NIS record has no page to open: its own panel shows it.
      if (r?.nis) overlay.open({ kind: "nisrecord", caseId: p.value.id, ref: r.nis });
      else if (r) void source.openSource(t, r, file.value);
    },
    openEdit: (key, orig) => overlay.open({ kind: "edit", file: file.value, key, orig: orig ?? "", isQuestion: key === "q" }),
    docTitle: (r) =>
      docTitleOf(
        r,
        (f) => {
          const c = cases.caseFileOfDoc(f);
          const e = c ? cases.entries.get(c) : undefined;
          return e?.state === "ready" && e.data ? fromExtraction(e.data.file, e.data.id, e.data.extraction, e.data.documents).documents : null;
        },
        file.value,
      ),
  };
  provide(KEY, ctx);
  return ctx;
}

export function usePatient(): PatientCtx {
  const c = inject(KEY);
  if (!c) throw new Error("usePatient() outside the patient view");
  return c;
}

// For component tests: a context made from plain values.
export { KEY as PATIENT_KEY };
