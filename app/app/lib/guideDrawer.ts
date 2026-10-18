// "otevřít v doporučení": opens the guideline drawer at the quoted statement and records the view in the access log
// (the old page's "otevřel(a) doporučení", sent as a fixed code with the case id, never free text).
import type { PatientCtx } from "../composables/usePatient";
import { useOverlayStore } from "../stores/overlay";
import { useApi } from "./api";

export function openGuide(c: PatientCtx, id: string): void {
  useOverlayStore().open({ kind: "guide", id });
  // A lost view event must not break the view; the guidance load itself is in the server's log already.
  useApi()
    .auditEvent({ code: "guide_opened", case_id: c.p.value.id })
    .catch(() => {});
}
