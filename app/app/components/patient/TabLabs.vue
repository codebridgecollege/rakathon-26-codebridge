<script setup lang="ts">
// The Laboratoř tab (Soňa, round 2). With a series of at least two dated
// draws: rows are tests, columns are draws, and clicking a test draws its trend. Without one (case 10's single undated
// panel) only the document's values are shown: a series is never invented to fill the chart (product owner, round
// 24). Every value is the document's own text, with its unit, range and code as written, and opens its own line in
// the source. High and low follow the sheet's flag.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { LabDraw, LabSeries, LabTest, LabValue, SourceRef } from "@codebridge/domain/case-data";
import { tagsOf } from "@codebridge/domain/case-view";
import { pointAt } from "@codebridge/domain/labs";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { fmtDate } from "../../lib/dates";
import Gap from "./Gap.vue";
import LabChart from "./LabChart.vue";
import Marks from "./Marks.vue";
import SrcWrap from "./SrcWrap.vue";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();

// The adapter (run-view.ts) builds a series only from at least two draws dated to the day, so this is a plain read.
const ser = computed<LabSeries | null>(() => c.cd.value?.labs?.series || null);
// The lab sheets' pages the processing could not read: said, so a value never looks complete when a page was lost.
const unreadable = computed(() => [...new Set((c.cd.value?.run?.sections.labs?.unreadable ?? []).map((u) => u.page))].sort((a, b) => a - b).join(", "));
const sel = computed<LabTest | undefined>(() => ser.value?.tests.find((t) => t.code === view.labSel) || ser.value?.tests[0]);

const flag = (o: string | null | undefined) => (o === "high" ? "hi" : o === "low" ? "lo" : "");
const arrow = (o: string | null | undefined) => (o === "high" ? " ↑" : o === "low" ? " ↓" : "");
const quoteTip = (r: SourceRef | undefined) => $t("patient-labs-src-tip", { quote: String(r?.quote ?? "") });
const valueLabel = (t: LabTest, d: LabDraw, value: string) => $t("patient-labs-value-label", { name: t.name_cs, date: fmtDate($t, d.date), value, unit: t.unit ?? "" });
const pick = (t: LabTest) => (view.labSel = t.code);

// The values table: a column with the same value in every row (case 10: no draw date, all from page 3) is said once
// in the sources note instead; the parameter name then opens its own quoted line, so each value keeps its exact source.
const labs = computed<LabValue[]>(() => c.cd.value?.labs?.values || []);
const same = (get: (l: LabValue) => string) => labs.value.length > 1 && labs.value.every((l) => get(l) === get(labs.value[0]!));
const oneDate = computed(() => same((l) => l.date || ""));
// NIS values each rest on their own record: they never share one source line.
const oneSrc = computed(() => same((l) => (l.source.nis ? `nis|${l.source.nis.resource}` : `${l.source.file}|${l.source.page}`)));
const valueStyle = (l: LabValue) => (l.out_of_range ? `color:var(--${l.out_of_range === "high" ? "conflict" : "change"});font-weight:700` : "");
const first = computed(() => labs.value[0]);
const firstPage = computed<SourceRef | null>(() => (first.value ? (first.value.source.nis ? first.value.source : { file: first.value.source.file, page: first.value.source.page }) : null));
</script>

<template>
  <section v-if="ser" class="card">
    <div class="head"><h2>{{ $t("patient-labs-title-trend") }}</h2><span class="muted small">{{ $t("patient-labs-draws", { n: ser.draws.length }) }}</span></div>
    <p v-if="unreadable" class="muted small">{{ $t("patient-check-unreadable", { pages: unreadable }) }}</p>
    <p class="small" style="margin:0 0 10px"><span v-if="ser.note_cs" lang="cs">{{ ser.note_cs }}</span> {{ $t("patient-labs-trend-hint") }}</p>
    <div class="scroll">
      <table class="tbl lm">
        <thead>
          <tr>
            <th>{{ $t("patient-labs-col-test") }}</th>
            <th>{{ $t("patient-labs-col-unit") }}</th>
            <th>{{ $t("patient-labs-col-range-short") }}</th>
            <th v-for="(d, j) in ser.draws" :key="j" class="dtc"><button class="linkbtn small" data-src :title="quoteTip(d.source)" @click="c.openSource(d.source)">{{ fmtDate($t, d.date) }}<br><span style="font-weight:500">{{ d.time || "" }}</span></button></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(t, ti) in ser.tests" :key="`${ti}|${t.code}`" :class="['click', t === sel ? 'sel' : '']" @click="pick(t)">
            <td><b lang="cs">{{ t.name_cs }}</b> <span class="muted small" lang="cs">{{ t.code }}</span></td>
            <td lang="cs">{{ t.unit }}</td>
            <td class="num" lang="cs">{{ t.reference_range }}</td>
            <template v-for="(d, j) in ser.draws" :key="j">
              <td v-if="pointAt(t, d)?.value != null" class="v"><button data-src :class="['linkbtn', 'labv', flag(pointAt(t, d)!.out_of_range)]" :title="quoteTip(pointAt(t, d)!.source)" :aria-label="valueLabel(t, d, pointAt(t, d)!.value!)" @click.stop="c.openSource(pointAt(t, d)!.source)"><span lang="cs">{{ pointAt(t, d)!.value }}</span>{{ arrow(pointAt(t, d)!.out_of_range) }}</button><template v-if="pointAt(t, d)!.certainty && pointAt(t, d)!.certainty !== 'documented'"><template v-for="tag in tagsOf(pointAt(t, d)!)" :key="tag"><span v-if="tag === 'negated'" class="tag neg">{{ $t("patient-tag-negated") }}</span><span v-else-if="tag === 'ocr'" class="tag ocr">{{ $t("patient-tag-ocr") }}</span><span v-else class="tag obs">{{ $t("patient-tag-inferred") }}</span></template></template></td>
              <td v-else class="v"><Gap /></td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="sel" style="margin-top:14px">
      <div class="row spread"><h3><span lang="cs">{{ sel.name_cs }}</span> <span class="muted small">(<span lang="cs">{{ sel.unit }}</span>)</span></h3><span class="muted small">{{ $t("patient-labs-pick-hint") }}</span></div>
      <LabChart :t="sel" :draws="ser.draws" />
    </div>
  </section>
  <section v-else class="card">
    <div class="head"><h2>{{ $t("patient-labs-title-values") }}</h2></div>
    <p v-if="unreadable" class="muted small">{{ $t("patient-check-unreadable", { pages: unreadable }) }}</p>
    <div class="scroll labscroll">
      <table class="tbl">
        <thead>
          <tr>
            <th>{{ $t("patient-labs-col-test") }}</th>
            <th>{{ $t("patient-labs-col-value") }}</th>
            <th>{{ $t("patient-labs-col-unit") }}</th>
            <th>{{ $t("patient-labs-col-range") }}</th>
            <th v-if="!oneDate">{{ $t("patient-labs-col-date") }}</th>
            <th v-if="!oneSrc">{{ $t("patient-labs-col-source") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in labs" :key="i">
            <td><SrcWrap v-if="oneSrc" :r="l.source"><span lang="cs">{{ l.name_cs }}</span> <span class="muted small" lang="cs">{{ l.code || "" }}</span></SrcWrap><template v-else><span lang="cs">{{ l.name_cs }}</span> <span class="muted small" lang="cs">{{ l.code || "" }}</span></template><Marks :f="l" /></td>
            <td class="num" :style="valueStyle(l)"><span lang="cs">{{ l.value }}</span> {{ l.out_of_range === "high" ? "↑" : l.out_of_range === "low" ? "↓" : "" }}</td>
            <td lang="cs">{{ l.unit }}</td>
            <td class="num" lang="cs">{{ l.reference_range }}</td>
            <td v-if="!oneDate" class="muted"><span v-if="l.date" lang="cs">{{ l.date }}</span><Gap v-else /></td>
            <td v-if="!oneSrc"><button class="linkbtn small" data-src @click="c.openSource(l.source)">{{ l.source.nis ? $t("patient-src-nis") : $t("patient-labs-row-source", { page: String(l.source.page) }) }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <details class="srcs labsrcs">
      <summary>{{ $t("patient-labs-sources") }}</summary>
      <p class="small" style="margin:6px 0" lang="cs">{{ c.cd.value?.labs?.note_cs }}</p>
      <p v-if="first && (oneDate || oneSrc)" class="small muted" style="margin:0 0 6px">{{ $t("patient-labs-all-values") }}<span v-if="oneDate">{{ $t("patient-labs-head-date") }}<span v-if="first.date" lang="cs">{{ first.date }}</span><Gap v-else /></span><template v-if="oneDate && oneSrc"> · </template><span v-if="oneSrc">{{ $t("patient-labs-head-source") }}<button class="linkbtn small" data-src @click="c.openSource(firstPage)"><span lang="cs">{{ c.docTitle(first.source) }}</span><template v-if="!first.source.nis">{{ $t("patient-labs-head-source-page", { page: String(first.source.page) }) }}</template></button></span><template v-if="oneSrc">{{ $t("patient-labs-head-click-name") }}</template></p>
      <p class="muted small" style="margin:0">{{ $t("patient-labs-no-trend") }}</p>
    </details>
  </section>
</template>
