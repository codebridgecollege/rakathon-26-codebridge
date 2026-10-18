// How other screens open "Nový pacient": the patient list's "+ Nový pacient" calls useNewPatient().open(). The dialog
// itself is mounted once in app.vue. setNavigation() lets the patient screens decide where a finished intake goes
// (the new patient, or the list with its filters cleared); plugins/intake.ts sets a default on the hash routes.
import { computed } from "vue";
import { useIntakeStore, type IntakeNavigation } from "../stores/intake";

export function useNewPatient() {
  const s = useIntakeStore();
  return {
    // Resolves false when this user may not create patients (a note is shown instead of the dialog).
    open: () => s.open(),
    close: () => s.close(),
    isOpen: computed(() => s.isOpen),
    setNavigation: (n: IntakeNavigation) => s.setNavigation(n),
  };
}
