// The one dialog or drawer open over the page (S.overlay in the template). One at a time, as today: opening another
// replaces it, Escape and the scrim close it. Each kind carries its own state; screens that port later add their kinds.
import { defineStore } from "pinia";
import { shallowRef, triggerRef } from "vue";
import type { SourceRef } from "@codebridge/domain/case-data";

export type SourceOverlay = {
  kind: "source";
  cite: SourceRef;
  file: string;
  page: number;
  tab: "image" | "text";
  zoom: "fit" | number;
  redacted: boolean;
  loading: boolean;
};
export type Overlay =
  | SourceOverlay
  | { kind: "guide"; id: string }
  | { kind: "edit"; file: string; key: string; orig: string; isQuestion: boolean }
  | { kind: "fhir"; id: string; bundle: unknown }
  | { kind: "pgrefs"; hit: number }
  | { kind: "pgpanel"; panel: number }
  | { kind: "breakglass"; file: string; msg: string }
  | { kind: "upload"; file: string }
  // PORT(#13): opened from the patient header, drawn by the screens ported next (the MDT start dialog with attendance,
  // steps 8-9; the report dialog, step 12). Until then opening them shows nothing.
  | { kind: "start"; day: string; from: string | null; attOnly: boolean }
  | { kind: "report" };

export const useOverlayStore = defineStore("overlay", () => {
  // Shallow: an overlay's own fields change through update(), so the dialog redraws exactly when they do.
  const current = shallowRef<Overlay | null>(null);

  function open(o: Overlay) {
    current.value = o;
  }
  function close() {
    current.value = null;
  }
  // Changes fields of the open overlay, if it is still the same one: a late reply for a closed viewer is dropped.
  function update<O extends Overlay>(o: O, patch: Partial<O>): boolean {
    if (current.value !== o) return false;
    Object.assign(o, patch);
    triggerRef(current);
    return true;
  }
  const isOpen = (o: Overlay) => current.value === o;

  return { current, open, close, update, isOpen };
});
