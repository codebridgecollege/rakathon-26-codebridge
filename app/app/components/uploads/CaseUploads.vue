<script setup lang="ts">
// A case's hand-added documents: the drop zone, "Nahrát z telefonu", the list with
// "Nahráno", and the note on what the demo keeps. Generic: "Projednání na MDT" (S-5) and the documents tab's dialog
// pass the case and whether this user may add documents there (locked, with an optional reason shown above).
// The pipeline's own controls for a stored document (when the server runs it) come through the "pipeline" slot.
import { computed, watch } from "vue";
import { useFluent } from "fluent-vue";
import type { UploadTarget } from "@codebridge/api-client";
import { useUploadsStore, type UploadCase, type UploadRow } from "../../stores/uploads";
import { useSessionStore } from "../../stores/session";
import { clock, sizeMsg } from "../../lib/format";
import { useMsg } from "../../lib/msg";
import UploadZone from "./UploadZone.vue";
import UploadList from "./UploadList.vue";
import PhoneUploadButton from "../phone/PhoneUploadButton.vue";
import type { UploadListItem } from "./types";

const props = withDefaults(defineProps<{ caseRef: UploadCase; locked?: boolean; why?: string; phoneTarget?: UploadTarget }>(), {
  locked: false,
  why: "",
  phoneTarget: "discussion",
});

const { $t } = useFluent();
const fmt = useMsg();
const uploads = useUploadsStore();
const session = useSessionStore();
const lang = () => document.documentElement.lang || "cs";
// The pipeline's states show only while it runs on the server; otherwise every file is "Nahráno", as before the server.
const pipeline = computed(() => session.health?.features.pipeline === true);
const PIPE_STATES = ["queued", "processing", "processed", "failed"];

watch(
  () => props.caseRef.file,
  () => void uploads.load(props.caseRef),
  { immediate: true },
);

const docs = computed(() => uploads.docsOf(props.caseRef.file));

function whenOf(d: UploadRow): string {
  if (d.when) return d.when;
  const t = d.uploaded_at ? Date.parse(d.uploaded_at) : NaN;
  return Number.isNaN(t) ? "" : clock(t, lang());
}

function warningsOf(d: UploadRow): string[] {
  const w: string[] = [];
  if (d.identity === "conflicts" && d.identity_cs) w.push(d.identity_cs);
  if (d.readability === "poor" || d.readability === "empty") {
    const reasons = d.readability_reasons_cs ?? [];
    w.push(reasons.length ? $t("uploads-poor-readability-reasons", { reasons: reasons.join("; ") }) : $t("uploads-poor-readability"));
  }
  return w;
}

const items = computed<UploadListItem[]>(() =>
  docs.value.map((d) => {
    const showState = pipeline.value && !!d.state && PIPE_STATES.includes(d.state);
    const meta = [fmt(sizeMsg(d.size || 0, lang())), " · ", `${d.uploaded_by || ""}, ${whenOf(d)}`, d.source === "phone" ? ` · ${$t("upload-from-phone")}` : ""].join("");
    return {
      key: d.id,
      name: d.name,
      meta,
      chip: showState
        ? { text: d.state_cs || "", cls: d.state === "failed" ? "k-contradiction" : "st-done", title: d.state_detail_cs || "" }
        : { text: $t("upload-done"), cls: "st-done" },
      // A document the pipeline works on, and the case's own seeded documents, are not removed from here.
      removable: !props.locked && (!d.state || d.state === "stored") && (!d.origin || d.origin === "upload"),
      warnings: warningsOf(d),
    };
  }),
);
const byKey = computed(() => new Map(docs.value.map((d) => [d.id, d])));
</script>

<template>
  <p v-if="props.why" class="muted small" style="margin:12px 0 0">{{ props.why }}</p>
  <template v-if="!props.locked">
    <UploadZone :title="$t('uploads-zone-title')" :hint="$t('uploads-zone-hint')" @files="(f) => uploads.add(props.caseRef, f)" />
    <PhoneUploadButton :target="props.phoneTarget" :case-id="props.caseRef.id" :file="props.caseRef.file" row-style="margin-top:8px" />
  </template>
  <UploadList v-if="items.length" :items="items" @remove="(k) => uploads.remove(props.caseRef, String(k))">
    <template #after="{ item }">
      <slot name="pipeline" :doc="byKey.get(String(item.key))" :pipeline="pipeline" />
    </template>
  </UploadList>
  <p v-else-if="props.locked" class="muted small" style="margin:12px 0 0">{{ $t("uploads-none") }}</p>
  <p class="muted small" style="margin:8px 0 0">{{ pipeline ? $t("uploads-note-pipeline") : $t("uploads-note") }}</p>
</template>
