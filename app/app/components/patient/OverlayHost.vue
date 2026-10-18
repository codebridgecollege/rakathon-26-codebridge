<script setup lang="ts">
// The patient screen's dialogs and drawers, drawn into the page's #overlay layer (renderOverlay() in the template).
// One at a time; Escape closes it, as the scrim and the "Zavřít" buttons do. Kinds of screens ported later (the
// report, the upload, the MDT start dialog) are drawn by those screens.
import { onBeforeUnmount, onMounted } from "vue";
import { useOverlayStore } from "../../stores/overlay";
import EditDialog from "./EditDialog.vue";
import BreakGlassDialog from "./BreakGlassDialog.vue";
import SourceViewer from "./SourceViewer.vue";
import GuideDrawer from "./GuideDrawer.vue";
import FhirDialog from "./FhirDialog.vue";
import PgRefsDrawer from "./PgRefsDrawer.vue";
import PgPanelDrawer from "./PgPanelDrawer.vue";

const overlay = useOverlayStore();

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && overlay.current) overlay.close();
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  // Leaving the case closes what was open over it, as a route change does in the template (readHash).
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
      <PgRefsDrawer v-else-if="overlay.current.kind === 'pgrefs'" :o="overlay.current" />
      <PgPanelDrawer v-else-if="overlay.current.kind === 'pgpanel'" :o="overlay.current" />
    </template>
  </Teleport>
</template>
