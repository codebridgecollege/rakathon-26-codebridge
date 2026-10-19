<script setup lang="ts">
// The patient screen's dialogs and drawers, drawn into the #overlay layer.
// One at a time; Escape closes it, as the scrim and the "Zavřít" buttons do. The start and attendance dialog is the
// lists' StartMdtDialog, which teleports itself.
import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import { useOverlayStore } from "../../stores/overlay";
import EditDialog from "./EditDialog.vue";
import BreakGlassDialog from "./BreakGlassDialog.vue";
import SourceViewer from "./SourceViewer.vue";
import GuideDrawer from "./GuideDrawer.vue";
import FhirDialog from "./FhirDialog.vue";
import NisDialog from "./NisDialog.vue";
import PgRefsDrawer from "./PgRefsDrawer.vue";
import PgPanelDrawer from "./PgPanelDrawer.vue";
import UploadDialog from "./UploadDialog.vue";
import StartMdtDialog from "../lists/StartMdtDialog.vue";
import ReportDialog from "../discussion/ReportDialog.vue";
import { trapTab } from "../../lib/dialog";

const overlay = useOverlayStore();

function onKey(e: KeyboardEvent) {
  // The phone dialog (#phoneup) can open above an overlay and handles its own keys; the overlay below must not close
  // on its Escape or pull its Tab back down.
  if (document.querySelector('#phoneup [role="dialog"]')) return;
  if (e.key === "Escape" && overlay.current && !e.defaultPrevented) overlay.close();
  // Tab stays inside the open dialog or drawer (each has a scrim, so the page behind is out of reach for the mouse
  // too). A dialog that handles Tab itself has already prevented the default.
  else if (e.key === "Tab" && overlay.current && !e.defaultPrevented) {
    const dlg = layerDialog();
    if (dlg) trapTab(e, dlg);
  }
}

// The dialog or drawer drawn into the layer; the start dialog teleports itself there too.
const layerDialog = () => document.querySelector<HTMLElement>('#overlay [role="dialog"]');

// Focus handling for every kind at once, as lib/dialog.ts does for the dialogs mounted in app.vue: focus moves into
// the dialog when one opens over the page, and back to the control that opened it when the last one closes. A kind
// replacing another (a reference inside the guideline drawer) keeps the first opener. Nothing visible changes.
let opener: HTMLElement | null = null;

// Puts focus on the open dialog's container unless it is already inside (the report moves it in itself). Also run when
// the layer's content is swapped under an open overlay (the source viewer replaces its loading drawer), which would
// otherwise drop focus on the page behind.
function focusIntoDialog() {
  const dlg = layerDialog();
  if (!overlay.current || !dlg || dlg.contains(document.activeElement)) return;
  if (!dlg.hasAttribute("tabindex")) dlg.setAttribute("tabindex", "-1");
  dlg.focus({ preventScroll: true });
}

watch(
  () => overlay.current,
  async (now, before) => {
    if (now && !before) {
      opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    }
    if (now) {
      await nextTick();
      focusIntoDialog();
    } else if (before) {
      const back = opener;
      opener = null;
      // Only when focus is lost with the dialog (on the body); a click elsewhere that closed it keeps its own focus.
      await nextTick();
      if (back?.isConnected && (document.activeElement === document.body || document.activeElement === null)) back.focus({ preventScroll: true });
    }
  },
);

let layerObserver: MutationObserver | null = null;
onMounted(() => {
  document.addEventListener("keydown", onKey);
  const layer = document.getElementById("overlay");
  if (layer) {
    layerObserver = new MutationObserver(() => focusIntoDialog());
    layerObserver.observe(layer, { childList: true });
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  layerObserver?.disconnect();
  // Leaving the case closes what was open over it, as a route change does.
  overlay.close();
});
</script>

<template>
  <Teleport defer to="#overlay">
    <template v-if="overlay.current">
      <EditDialog v-if="overlay.current.kind === 'edit'" :key="overlay.current.key" :o="overlay.current" />
      <BreakGlassDialog v-else-if="overlay.current.kind === 'breakglass'" :o="overlay.current" />
      <SourceViewer v-else-if="overlay.current.kind === 'source'" :o="overlay.current" />
      <GuideDrawer v-else-if="overlay.current.kind === 'guide'" :o="overlay.current" />
      <FhirDialog v-else-if="overlay.current.kind === 'fhir'" :o="overlay.current" />
      <NisDialog v-else-if="overlay.current.kind === 'nis'" :o="overlay.current" />
      <PgRefsDrawer v-else-if="overlay.current.kind === 'pgrefs'" :o="overlay.current" />
      <PgPanelDrawer v-else-if="overlay.current.kind === 'pgpanel'" :o="overlay.current" />
      <UploadDialog v-else-if="overlay.current.kind === 'upload'" :o="overlay.current" />
      <ReportDialog v-else-if="overlay.current.kind === 'report'" :o="overlay.current" />
    </template>
  </Teleport>
  <!-- The lists' start dialog teleports itself into #overlay. -->
  <StartMdtDialog v-if="overlay.current?.kind === 'start'" :day="overlay.current.day" :from="overlay.current.from" :att-only="overlay.current.attOnly" @close="overlay.close()" />
</template>
