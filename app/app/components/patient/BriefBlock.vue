<script setup lang="ts">
// "Stručný souhrn": the extracted summary with every clause linked to its source, the
// MDT question, the disease course, the sources, the conclusion and the discussion card "Projednání na MDT". A case without an extracted
// brief shows the list row's one-line summary, said to be that, with what the assistant processed.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { linkProse, stripMarkers } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { useOverlayStore } from "../../stores/overlay";
import Ed from "./Ed.vue";
import Prose from "./Prose.vue";
import SrcList from "./SrcList.vue";
import AlertSignal from "./AlertSignal.vue";
import GapsBox from "./GapsBox.vue";
import QuestionBox from "./QuestionBox.vue";
import MissingSection from "./MissingSection.vue";
import TimelineCard from "./TimelineCard.vue";
import ConclusionBox from "./ConclusionBox.vue";
import IdentityBanner from "../discussion/IdentityBanner.vue";
import DiscussionCard from "../discussion/DiscussionCard.vue";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();
const overlay = useOverlayStore();
// A case with nothing processed offers the next step instead of an empty page.
const openUpload = () => overlay.open({ kind: "upload", file: c.p.value.file });

const brief = computed(() => c.cd.value?.brief ?? null);
const prose = computed(() => linkProse(brief.value?.text_cs, brief.value?.refs));
// Sources are registered only while the doctor's edit does not replace the brief.
const sources = computed(() => {
  if (c.edOf("brief")) return [];
  const seen = new Set<string>();
  return prose.value.used.filter((r) => {
    const k = `${r.file}|${r.page}|${r.quote}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
});
// What the assistant processed for this case, named from its data; "Nezpracováno" when nothing.
const processed = computed(() => {
  const s = c.sec.value;
  return [
    s.documents && $t("patient-processed-documents"),
    s.alerts && $t("patient-processed-missing"),
    s.labs && $t("patient-processed-labs"),
    s.anamnesis && $t("patient-processed-anamnesis"),
    s.record && $t("patient-processed-findings"),
  ].filter(Boolean) as string[];
});
</script>

<template>
  <IdentityBanner />
  <section class="card blk">
    <div class="head" style="margin:0">
      <h2>{{ $t("patient-brief-title") }}</h2>
      <span class="row">
        <span v-if="!c.sec.value.brief" class="chip plain st-new">{{ processed.length ? $t("patient-processed", { parts: processed.join(", ") }) : $t("patient-unprocessed") }}</span>
        <AlertSignal />
      </span>
    </div>
    <GapsBox v-if="view.gapsOpen && c.sec.value.alerts" />
    <template v-if="c.sec.value.brief">
      <p class="prose"><Ed k="brief" :orig="stripMarkers(brief?.text_cs)"><Prose :parts="prose.parts" breaks /></Ed></p>
      <QuestionBox in-brief />
    </template>
    <template v-else>
      <p v-if="c.p.value.summary" class="prose" lang="cs">{{ c.p.value.summary }}</p>
      <div v-if="!c.cd.value?.record" class="question" role="status">
        <b>{{ $t("patient-empty-title") }}</b>
        <p style="margin:6px 0 10px">{{ $t("patient-empty-text") }}</p>
        <button v-if="c.canSetStatus.value" class="btn" @click="openUpload">{{ $t("patient-empty-upload") }}</button>
      </div>
      <p class="muted small" style="margin:0"><span v-if="c.cd.value?.note_cs" lang="cs">{{ c.cd.value.note_cs }}</span><template v-else>{{ $t("patient-brief-from-list") }}</template> {{ $t("patient-brief-source", { file: c.p.value.file, pages: c.p.value.pages || "?" }) }}</p>
    </template>
    <TimelineCard v-if="c.sec.value.timeline" inline />
    <MissingSection v-else :title="$t('patient-tl-title')" />
    <SrcList :list="sources" />
    <ConclusionBox />
    <DiscussionCard />
  </section>
</template>
