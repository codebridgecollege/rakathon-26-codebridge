// "Export FHIR" for the case on screen: builds the FHIR R4
// Bundle from the same data the screens show, opens the dialog with it and records the export in the audit log.
// The builder is pure (packages/domain/src/fhir-export.ts); the clock, the ids and the catalog are supplied here.
import type { PatientRow } from "@codebridge/api-client";
import { fhirBundle } from "@codebridge/domain/fhir-export";
import { qState } from "@codebridge/domain/case-view";
import type { PatientCtx } from "../composables/usePatient";
import { useOverlayStore } from "../stores/overlay";
import { useApi } from "./api";
import { fmtWhen } from "./dates";

export async function openFhirExport(ctx: PatientCtx, t: (id: string, args?: Record<string, string | number>) => string): Promise<void> {
  // Everything the Bundle is built from is read at the click, so a case change during the wait below can never mix
  // one patient's identity with another's findings.
  const p = ctx.p.value;
  const cd = ctx.cd.value;
  // The button exists only for a case with finding groups; a case still loading has nothing to export.
  if (!cd) return;
  // The confirmation's time is read in the export as on screen: the server sends ISO, the text names a local time.
  const c = ctx.wf.value.qConfirm;
  const q = qState(p, ctx.edOf("q"), c ? { ...c, when: fmtWhen(c.when) } : c);
  // Where the document names the patient (the Patient's Provenance) comes with the case header, which may still be on
  // its way right after the case opens: it is read then, so a quick click does not export the Patient without its
  // source. A failed read exports without that Provenance, never with a made-up one.
  if (p.identitySource === undefined) {
    try {
      const h = await useApi().caseHeader(p.id);
      p.identitySource = (h.identitySource as PatientRow["identitySource"]) ?? null;
    } catch {
      p.identitySource = null;
    }
    // The doctor moved to another case meanwhile: the dialog would open over the wrong patient.
    if (ctx.p.value !== p) return;
  }
  const bundle = fhirBundle({ p, cd, q }, { now: new Date().toISOString(), uuid: () => crypto.randomUUID(), t });
  useOverlayStore().open({ kind: "fhir", id: p.id, bundle });
  // The export carries the patient's identity, so it is logged (fixed code, no free text). A lost audit event must not
  // block the export; the case read itself is in the server's log already.
  useApi()
    .auditEvent({ code: "fhir_exported", case_id: p.id })
    .catch(() => {});
}
