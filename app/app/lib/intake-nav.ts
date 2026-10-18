// Where a finished "Nový pacient" goes by default: the new patient at its hash route (#/patient/<id>, the old page's
// #patient/<id>) or the patient list. The patient screens may replace it with useNewPatient().setNavigation().
import type { Router } from "vue-router";
import type { IntakeNavigation } from "../stores/intake";

// The case's part of the hash route, as the old page wrote it ("S02_pacient.pdf" -> "S02").
const routeIdOf = (file: string) => String(file).replace("_pacient.pdf", "");

export function defaultIntakeNavigation(router: Router): IntakeNavigation {
  return {
    openPatient: (file) => void router.push(`/patient/${encodeURIComponent(routeIdOf(file))}`),
    showList: () => void router.push({ name: "view", params: { view: "patients" } }),
  };
}
