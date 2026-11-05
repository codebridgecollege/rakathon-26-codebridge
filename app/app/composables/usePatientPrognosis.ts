// Start preparation on patient open as well as in the standalone prognosis view.
// Store guards share one request and one automatic attempt per patient and cutoff.
import { computed, watch, type Ref } from "vue";
import { usePatient, type PatientCtx } from "./usePatient";
import { usePrognosisStore } from "../stores/prognosis";

export function usePatientPrognosis(enabled: Ref<boolean> = computed(() => true), context?: PatientCtx) {
  const { p } = context ?? usePatient();
  const pg = usePrognosisStore();
  // A cutoff before booking is explicit; it does not create a calendar slot.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const c = computed(() => ({ file: p.value.file, id: p.value.id, day: p.value.slot?.day || today }));
  watch(() => [enabled.value, c.value.file, c.value.id, c.value.day], () => {
    if (enabled.value) pg.load(c.value);
  }, { immediate: true });
  watch(() => [enabled.value, c.value.file, c.value.id, c.value.day, pg.canSearch(c.value)], () => {
    if (enabled.value && pg.canSearch(c.value)) void pg.autoSearch(c.value);
  }, { immediate: true });
  return c;
}
