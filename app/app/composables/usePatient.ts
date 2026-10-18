// The case on screen, for every part of the patient view: the list row, the case data in the view's shape, the
// stored workflow state (edits, the question confirmation, alert history, decisions), the guideline layer and what
// the current user may do. PatientView provides it once; the cards inject it, so no card picks a case on its own.
import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { CaseState, PatientRow } from "@codebridge/api-client";
import { fromExtraction, sectionsOf, docTitle as docTitleOf, type CaseData, type Sections, type SourceRef } from "@codebridge/domain/case-data";
import { alertKeyIn, type AlertEvent, type Edit } from "@codebridge/domain/case-view";
import { useCasesStore, type CaseEntry, type Guidance } from "../stores/cases";
import { useSessionStore } from "../stores/session";
import { useWorkflowStore } from "../stores/workflow";
import { usePatientsStore } from "../stores/patients";
import { useOverlayStore } from "../stores/overlay";
import { useSourceStore } from "../stores/source";
import { fmtWhen, type T } from "../lib/format";

export type PatientCtx = {
  p: ComputedRef<PatientRow>;
  entry: ComputedRef<CaseEntry>;
  cd: ComputedRef<CaseData | null>;
  sec: ComputedRef<Sections>;
  wf: ComputedRef<Partial<CaseState>>;
  // Edits by key, with their time formatted for display (the server sends ISO).
  edits: ComputedRef<Record<string, Edit>>;
  alertHist: ComputedRef<AlertEvent[]>;
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
    return e.state === "ready" && e.data ? fromExtraction(e.data.file, e.data.id, e.data.extraction) : null;
  });
  const sec = computed(() => sectionsOf(cd.value));
  const wf = computed<Partial<CaseState>>(() => workflow.cases[p.value?.id ?? ""] ?? {});
  const edits = computed(() => {
    const out: Record<string, Edit> = {};
    for (const [k, e] of Object.entries((wf.value.edits ?? {}) as Record<string, Edit>)) out[k] = { ...e, when: fmtWhen(e.when) };
    return out;
  });
  const alertHist = computed<AlertEvent[]>(() =>
    ((wf.value.alertHist ?? []) as AlertEvent[]).map((x) => ({ i: alertKeyIn(x.i), action: x.action, who: x.who, when: fmtWhen(x.when) })),
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
    guide,
    userName: computed(() => session.me?.user.name ?? ""),
    isDoctor: computed(() => role.value === "doctor"),
    canSetStatus: computed(() => role.value === "doctor" || role.value === "coordinator"),
    edOf: (key) => edits.value[key],
    openSource: (r) => {
      if (r) void source.openSource(t, r, file.value);
    },
    openEdit: (key, orig) => overlay.open({ kind: "edit", file: file.value, key, orig: orig ?? "", isQuestion: key === "q" }),
    docTitle: (r) =>
      docTitleOf(
        r,
        (f) => {
          const c = cases.caseFileOfDoc(f);
          const e = c ? cases.entries.get(c) : undefined;
          return e?.state === "ready" && e.data ? fromExtraction(e.data.file, e.data.id, e.data.extraction).documents : null;
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
