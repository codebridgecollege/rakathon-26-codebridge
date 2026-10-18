// The report dialog's view state: which sections the report
// prints and whether "Náhled reportu" is open. Kept across cases; nothing here is patient
// data or goes to browser storage.
import { defineStore } from "pinia";
import { reactive, ref } from "vue";

// The default ticks: the summary and the three finding groups an MDT reads first.
export const DEFAULT_PICKED = ["summary", "imaging", "histology", "past_treatment"] as const;

export const useReportStore = defineStore("report", () => {
  // Reactive, so the live draft preview re-renders when a tick changes.
  const picked = reactive(new Set<string>(DEFAULT_PICKED));
  const previewOpen = ref(false);

  function setPicked(key: string, on: boolean) {
    if (on) picked.add(key);
    else picked.delete(key);
  }

  return { picked, previewOpen, setPicked };
});
