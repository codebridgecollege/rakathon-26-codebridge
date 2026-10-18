<script setup lang="ts">
// The "Export FHIR" dialog (fhirHtml() and the "fhirdl" / "fhircopy" actions in mocks/src/v3-template.html): the
// case's FHIR R4 Bundle with its counts, the identity warning, download and copy. Copying is offered next to the
// download because downloads can be blocked inside an embedded page.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { fhirJson } from "@codebridge/domain/fhir-export";
import { useOverlayStore } from "../../stores/overlay";
import { toast } from "../../lib/toast";

type Bundle = { entry: { resource: { resourceType: string } }[] };
const props = defineProps<{ o: { kind: "fhir"; id: string; bundle: unknown } }>();
const { $t } = useFluent();
const overlay = useOverlayStore();

const bundle = computed(() => props.o.bundle as Bundle);
const json = computed(() => fhirJson(props.o.bundle));
// Resource types in the order they first appear, as the old dialog listed them.
const counts = computed(() => {
  const m = new Map<string, number>();
  for (const e of bundle.value.entry) m.set(e.resource.resourceType, (m.get(e.resource.resourceType) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k} ${v}`).join(", ");
});

function download() {
  const u = URL.createObjectURL(new Blob([json.value], { type: "application/fhir+json" }));
  const l = document.createElement("a");
  l.href = u;
  l.download = `${props.o.id}-fhir-r4.json`;
  document.body.appendChild(l);
  l.click();
  l.remove();
  // Revoked a moment later: some browsers start reading the file only after the click returns.
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function copy() {
  const done = () => toast($t("patient-fhir-copied"));
  const failed = () => toast($t("patient-fhir-copy-failed"));
  if (!navigator.clipboard) return failed();
  navigator.clipboard.writeText(json.value).then(done, failed);
}
</script>

<template>
  <div class="scrim" @click="overlay.close()" />
  <div class="modal" role="dialog" :aria-label="$t('patient-fhir-dialog-label')">
    <div class="row spread">
      <h2>{{ $t("patient-fhir-dialog-title", { id: o.id }) }}</h2>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-fhir-close") }}</button>
    </div>
    <p class="muted small" style="margin:0">{{ $t("patient-fhir-dialog-counts", { n: bundle.entry.length, counts }) }}</p>
    <p class="synth" style="margin:0;border-style:solid">{{ $t("patient-fhir-dialog-identity") }}</p>
    <div class="row">
      <button class="btn primary" @click="download">{{ $t("patient-fhir-download") }}</button>
      <button class="btn" @click="copy">{{ $t("patient-fhir-copy") }}</button>
    </div>
    <pre style="margin:0;max-height:46vh;overflow:auto;background:var(--sunk);border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere">{{ json }}</pre>
  </div>
</template>
