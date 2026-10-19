<script setup lang="ts">
// The Anamnéza tab: one row per history section, each finding as the document
// states it, a drug per line as a doctor writes it, and the sources folded away at the bottom (Soňa, round 2). Every
// fact a doctor may correct goes through Ed, keyed by the fact, so an edit is stored next to the extracted text and
// never replaces it. An empty section says which of three it is: nothing in the documents ("-" with the gap wording),
// not looked for ("nezkontrolováno"), and which pages could not be read.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { refAt, type Item, type SourceRef } from "@codebridge/domain/case-data";
import { refList } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import Ed from "./Ed.vue";
import Gap from "./Gap.vue";
import Marks from "./Marks.vue";
import SrcList from "./SrcList.vue";
import CheckNote from "./CheckNote.vue";

const { $t } = useFluent();
const c = usePatient();

// The sections in the order the Czech anamnesis is written; labels live in the catalog under the same keys.
const ANAM = ["OA", "RA", "PA", "SA", "FA", "AA", "abusus", "EA", "preventive"] as const;

const A = computed<Record<string, Item[]>>(() => c.cd.value?.record?.anamnesis || {});
const list = (k: string): Item[] => A.value[k] || [];
const check = (k: string) => c.cd.value?.run?.sections[k] ?? null;

// One line per drug ("Everolimus Sandoz 5 mg 1-0-0"); the indication or change is a grey comment next to it, because
// "1-1-1 při nevolnosti" is not regular dosing (Soňa, round 5).
const drugLine = (m: Item) => [m.drug_cs, m.strength_cs, m.dosing_cs].filter(Boolean).join(" ");
const drugNote = (m: Item) => m.comment_line_cs || [m.indication_cs, m.change_cs].filter(Boolean).join("; ");
// A finding the documents deny without saying so in its own text carries the negation label.
const term = (f: Item) => (f.negation_label ? $t("patient-fact-negated", { text: String(f.term_cs) }) : f.term_cs);

// The pack years the documents state; a gap when none does (never computed from other facts).
const packYears = computed(() => list("abusus").find((x) => x.pack_years_cs)?.pack_years_cs as string | undefined);

// The card's sources in the order the old registry met them: section by section, the drugs before their warnings.
// Warnings are listed only with a drug list, as they are shown only then.
const sources = computed<SourceRef[]>(() => {
  const reg = refList();
  const addAll = (f: Item) => (f.refs || []).forEach((j: unknown) => reg.add(refAt(c.cd.value, j)));
  for (const k of ANAM) {
    list(k).forEach(addAll);
    if (k === "FA" && list("FA").length) list("FA_warnings").forEach(addAll);
  }
  return reg.list;
});
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ $t("patient-anam-title") }}</h2></div>
    <div class="anam3">
      <template v-for="k in ANAM" :key="k">
        <div>{{ $t("patient-anam-section", { key: k }) }}</div>
        <div>
          <template v-if="k === 'FA' && list('FA').length">
            <ul>
              <li v-for="m in list('FA')" :key="m.key">
                <b><Ed :k="`${m.key}:line`" :orig="drugLine(m)" /></b>
                <template v-if="drugNote(m) || c.isDoctor.value">{{ " " }}<span class="muted"><Ed :k="`${m.key}:note`" :orig="drugNote(m)" /></span></template>
                <Marks :f="m" />
              </li>
            </ul>
            <div v-if="list('FA_warnings').length" style="margin-top:8px">
              <div v-for="f in list('FA_warnings')" :key="f.key" class="small">
                <span class="chip plain k-contradiction">{{ $t("patient-anam-warning") }}</span>{{ " " }}<b v-if="f.term_cs"><Ed :k="`${f.key}:t`" :orig="f.term_cs">{{ term(f) }}</Ed></b><template v-if="f.comment_cs"><template v-if="f.term_cs">, </template><Ed :k="`${f.key}:c`" :orig="f.comment_cs" /></template><Marks :f="f" />
              </div>
            </div>
          </template>
          <template v-else>
            <ul v-if="list(k).length">
              <li v-for="f in list(k)" :key="f.key"><b v-if="f.term_cs"><Ed :k="`${f.key}:t`" :orig="f.term_cs">{{ term(f) }}</Ed></b><template v-if="f.comment_cs"><template v-if="f.term_cs">, </template><Ed :k="`${f.key}:c`" :orig="f.comment_cs" /></template><Marks :f="f" /></li>
            </ul>
            <CheckNote v-else :check="check(k)" />
            <div v-if="k === 'abusus'" class="small" style="margin-top:6px">{{ $t("patient-anam-pack-years") }}<b v-if="packYears" lang="cs">{{ packYears }}</b><Gap v-else /></div>
          </template>
        </div>
      </template>
    </div>
    <SrcList :list="sources" />
    <p class="muted small" style="margin:10px 0 0">{{ $t("patient-anam-legend-label") }} <span class="mk ocr">!</span> {{ $t("patient-anam-legend-ocr") }} · <span class="mk plan">?</span> {{ $t("patient-anam-legend-planned") }} · <span class="mk ocr" style="background:var(--conflict-soft);color:var(--conflict)">≠</span> {{ $t("patient-anam-legend-conflict") }} · <span class="mk obs">i</span> {{ $t("patient-anam-legend-observation") }}. {{ $t("patient-anam-legend-tail") }}</p>
  </section>
</template>
