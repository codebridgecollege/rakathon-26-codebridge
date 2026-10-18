<script setup lang="ts">
// "Onkologický souhrn": the diagnosis headline with the stage at
// diagnosis (never the current stage), then one short line per event in the clinicians' compact style (round 14),
// each opening its first source, with the category pin of the timeline; planned lines get a dashed pin and never
// read as performed. The body scrolls inside the card.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { refAt, type Item } from "@codebridge/domain/case-data";
import { compactKind, refList, rowKind } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import { fmtDate } from "../../lib/dates";
import Ed from "./Ed.vue";
import Marks from "./Marks.vue";
import SrcWrap from "./SrcWrap.vue";
import SrcList from "./SrcList.vue";
import CatIcon from "./CatIcon.vue";

const { $t } = useFluent();
const c = usePatient();

const CAT_ID: Record<string, string> = {
  imaging: "patient-cat-imaging",
  systemic: "patient-cat-systemic",
  medication: "patient-cat-medication",
  mdt: "patient-cat-mdt",
  surgery: "patient-cat-surgery",
  pathology: "patient-cat-pathology",
  radiotherapy: "patient-cat-radiotherapy",
  laboratory: "patient-cat-laboratory",
  clinical: "patient-cat-clinical",
};
const cat = (k: string) => (CAT_ID[k] ? $t(CAT_ID[k]!) : "");

const cd = computed(() => c.cd.value);
const d = computed(() => cd.value?.brief?.dx_headline ?? null);
const compact = computed(() => cd.value?.record?.onco_compact ?? null);
const rows = computed(() => cd.value?.record?.onco_detailed ?? []);
const dxBase = computed(() => (d.value ? [d.value.histology_cs, d.value.grade_cs, d.value.tnm_cs].filter(Boolean).join(", ") : ""));
// "2.6.2022" is shown as "6/2022": the month of the histology that set the stage at diagnosis.
const dxMonth = computed(() => String(d.value?.histology_date_cs || "").replace(/^\d+\./, "").replace(".", "/"));
const first = (x: Item | null | undefined) => refAt(cd.value, (x?.refs || [])[0]);
const pinLabel = (l: Item) => `${cat(compactKind(l))}${l.kind === "plan" ? $t("patient-onco-planned-suffix") : ""}`;

// The card's sources in order of first use, numbered by the source registry while it renders.
const sources = computed(() => {
  const reg = refList();
  const x = cd.value;
  if (!x) return reg.list;
  if (d.value) for (const i of d.value.refs || []) reg.add(refAt(x, i));
  if (compact.value) {
    for (const l of compact.value.lines || []) for (const i of l.refs || []) reg.add(refAt(x, i));
    if (compact.value.other_dx_cs) reg.add(refAt(x, (compact.value.other_dx_refs || [])[0]));
  } else for (const r of rows.value) for (const i of r.refs || []) reg.add(refAt(x, i));
  return reg.list;
});
</script>

<template>
  <section class="card onco">
    <div class="head"><h2>{{ $t("patient-onco-title") }} <button class="info" :title="$t('patient-onco-pin-help')" :aria-label="$t('patient-onco-pin-help')">i</button></h2></div>
    <div class="ocbody" tabindex="0" role="region" :aria-label="$t('patient-onco-region')">
      <template v-if="d">
        <p class="dxh"><SrcWrap :r="first(d)"><Ed k="dx" :orig="dxBase" :with-button="false" /></SrcWrap><Ed k="dx" :orig="dxBase" button-only /><template v-if="d.histology_date_cs">{{ " " }}<span class="muted" style="font-size:13px;font-weight:600" :title="d.tnm_context_cs || ''">{{ $t("patient-onco-ptnm", { month: dxMonth }) }}</span></template><Marks :f="d" /></p>
        <p class="dxs" lang="cs">{{ d.mkn_cs || "" }}</p>
      </template>
      <template v-if="compact">
        <div v-for="(l, i) in compact.lines || []" :key="i" class="orow cpt">
          <span class="dt" :data-tip="l.kind === 'systemic' ? $t('patient-onco-start') : undefined" :tabindex="l.kind === 'systemic' ? 0 : undefined">{{ l.date_sort ? fmtDate($t, l.date_sort) : "" }}<span :class="['lpin', `kind-${compactKind(l)}`, l.kind === 'plan' ? 'planned' : '']" :title="pinLabel(l)" role="img" :aria-label="pinLabel(l)" tabindex="0"><CatIcon :k="compactKind(l)" /></span></span>
          <span><SrcWrap :r="first(l)"><Ed :k="`oc:${i}`" :orig="l.text_cs" :with-button="false" /></SrcWrap><Ed :k="`oc:${i}`" :orig="l.text_cs" button-only /><Marks :f="l" /></span>
        </div>
        <p v-if="compact.other_dx_cs" class="otherdx" style="margin:10px 0 0;font-size:14px;font-style:italic"><SrcWrap :r="refAt(cd, (compact.other_dx_refs || [])[0])"><span lang="cs">{{ compact.other_dx_cs }}</span></SrcWrap></p>
      </template>
      <template v-else>
        <div v-for="(r, i) in rows" :key="i" class="orow" :title="cat(rowKind(r)) || ''">
          <span class="dt" lang="cs">{{ r.date_cs || r.date_label_cs || "" }}</span>
          <span><b><SrcWrap :r="first(r)"><Ed :k="`od:${i}:e`" :orig="r.event_cs" :with-button="false" /></SrcWrap><Ed :k="`od:${i}:e`" :orig="r.event_cs" button-only /></b><template v-if="r.comment_cs"><br><Ed :k="`od:${i}:c`" :orig="r.comment_cs" /></template><Marks :f="r" /></span>
        </div>
      </template>
    </div>
    <SrcList :list="sources" />
  </section>
</template>
