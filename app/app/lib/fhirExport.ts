// "Export FHIR" for the case on screen (the "fhirdlg" action in mocks/src/v3-template.html): builds the FHIR R4
// Bundle from the same data the screens show, opens the dialog with it and records the export in the audit log.
// The builder is pure (packages/domain/src/fhir-export.ts); the clock, the ids and the catalog are supplied here.
import { fhirBundle } from "@codebridge/domain/fhir-export";
import { qState } from "@codebridge/domain/case-view";
import type { PatientCtx } from "../composables/usePatient";
import { useOverlayStore } from "../stores/overlay";
import { useApi } from "./api";
import { fmtWhen } from "./format";

export function openFhirExport(ctx: PatientCtx, t: (id: string, args?: Record<string, string | number>) => string): void {
  const p = ctx.p.value;
  const cd = ctx.cd.value;
  // The button exists only for a case with finding groups; a case still loading has nothing to export.
  if (!cd) return;
  // The confirmation's time is read in the export as on screen: the server sends ISO, the text names a local time.
  const c = ctx.wf.value.qConfirm;
  const q = qState(p, ctx.edOf("q"), c ? { ...c, when: fmtWhen(c.when) } : c);
  const bundle = fhirBundle({ p, cd, q }, { now: new Date().toISOString(), uuid: () => crypto.randomUUID(), t });
  useOverlayStore().open({ kind: "fhir", id: p.id, bundle });
  // The export carries the patient's identity, so it is logged (fixed code, no free text). A lost audit event must not
  // block the export; the case read itself is in the server's log already.
  useApi()
    .auditEvent({ code: "fhir_exported", case_id: p.id })
    .catch(() => {});
}
