// View state of the patient screen that outlives a tab switch: which toggles are
// open, the timeline's hidden categories, the picked lab test, the document filters and the guideline layer switch.
// Nothing here is patient data or goes to browser storage.
import { defineStore } from "pinia";
import { ref } from "vue";

export const usePatientViewStore = defineStore("patientView", () => {
  // The case these per-case choices belong to; opening another case clears them.
  const forFile = ref<string | null>(null);
  // The brief's "⚠ Upozornění" toggle (S.gapsOpen) and the resolved-alert list (S.resolvedOpen).
  const gapsOpen = ref(false);
  const resolvedOpen = ref(false);
  // The status menu is open for this case (S.stOpen).
  const statusOpen = ref<string | null>(null);
  // Timeline categories the doctor hid, and the event last opened (S.tlExcluded, S.selTl).
  const tlExcluded = ref<Set<string>>(new Set());
  const selTl = ref<number | null>(null);
  // The lab test whose trend is drawn (S.labSel).
  const labSel = ref<string | null>(null);
  // The guideline layer on or off, and which entries are open (S.guideOn, S.gleOpen); kept across cases, as today.
  const guideOn = ref(true);
  const gleOpen = ref<Record<string, boolean>>({});
  // Document list: search text and column filters (S.dq, S.colf for the document columns).
  const docQuery = ref("");
  const docFilters = ref<Record<string, string[]>>({});
  // The source viewer's last tab, remembered for the next source (S.srcTab).
  const srcTab = ref<"image" | "text">("image");

  // A different case: its own timeline filter and selection, as openPatient() resets them.
  function enterCase(file: string) {
    if (forFile.value === file) return;
    forFile.value = file;
    tlExcluded.value = new Set();
    selTl.value = null;
    statusOpen.value = null;
  }

  return { forFile, gapsOpen, resolvedOpen, statusOpen, tlExcluded, selTl, labSel, guideOn, gleOpen, docQuery, docFilters, srcTab, enterCase };
});
