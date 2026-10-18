// Where a finished "Nový pacient" goes by default: the new patient at its route (/patient/<id>, the old page's
// #patient/<id>) or the patient list. The patient screens may replace it with useNewPatient().setNavigation().
import type { Router } from "vue-router";
import type { IntakeNavigation } from "../stores/intake";

// The case's part of the route, as the old page wrote it ("S02_pacient.pdf" -> "S02").
const routeIdOf = (file: string) => String(file).replace("_pacient.pdf", "");

export function defaultIntakeNavigation(router: Router): IntakeNavigation {
  return {
    openPatient: (file) => void router.push(`/patient/${encodeURIComponent(routeIdOf(file))}`),
    // By path: the list has its own page (pages/patients.vue), which a push by the "view" route's name would skip.
    showList: () => void router.push("/patients"),
  };
}
