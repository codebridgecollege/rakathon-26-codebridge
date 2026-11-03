// How a running MDT is shown on this computer: beside the patient view or as the whole window. A per-computer choice,
// so it stays in the browser and holds no patient data.
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type PanelMode = "panel" | "full";
const KEY = "glide-mdt-view";
// The width at which a panel beside the patient view still leaves the view usable. Below it, a panel the doctor did not
// ask for stays closed, so a phone or a small window opens on the patient view.
const DOCK_MIN_WIDTH = 1100;

function stored(): PanelMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "panel" || v === "full" ? v : null;
  } catch {
    return null;
  }
}

export const useMdtPanelStore = defineStore("mdtPanel", () => {
  const chosen = ref<PanelMode | null>(stored());
  const open = computed(() => (chosen.value ?? (typeof innerWidth !== "undefined" && innerWidth >= DOCK_MIN_WIDTH ? "panel" : "full")) === "panel");

  function choose(mode: PanelMode) {
    chosen.value = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Storage blocked: the choice holds until the page reloads.
    }
  }
  return { chosen, open, choose };
});
