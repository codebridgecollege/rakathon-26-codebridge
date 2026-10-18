<script setup lang="ts">
// "Aktuální stav pacienta" (round 2 "status praesens"): the most recent exam, subjective
// first, then the objective line led by TK/P, TT and PS (ECOG) as the clinicians write it (rounds 9 and 14). Regions
// the record marks as not examined are left out. Every finding has a numbered source marker; the text itself opens
// the edit dialog for doctors.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { refAt, type Item, type SourceRef } from "@codebridge/domain/case-data";
import { refList, vitalsOf } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import EdLink from "./EdLink.vue";
import Marks from "./Marks.vue";
import RefMark from "./RefMark.vue";
import SrcList from "./SrcList.vue";
import Gap from "./Gap.vue";

const { $t } = useFluent();
const c = usePatient();

const sp = computed(() => c.cd.value?.record?.status_praesens ?? null);
const items = computed(() => ((sp.value?.items || []) as Item[]).map((it, i): Item & { i: number } => ({ ...it, i })));
const subj = computed(() => items.value.filter((it) => it.group === "subjective"));
const vit = computed(() => items.value.find((it) => it.label_cs === "Vitální funkce"));
const ecog = computed(() => items.value.find((it) => it.label_cs === "ECOG PS"));
const brain = computed(() => items.value.find((it) => it.label_cs === "Mozkové metastázy klinicky"));
const rest = computed(() => items.value.filter((it) => it.group === "objective" && it !== vit.value && !/^nevyšetřen/i.test(String(it.text_cs).trim())));
const vitals = computed(() => vitalsOf(vit.value?.text_cs));
const first = (it: Item | undefined) => (it ? refAt(c.cd.value, (it.refs || [])[0]) : undefined);
const text = (it: Item) => String(it.text_cs).replace(/[.,;]\s*$/, "");
const exam = computed(() => {
  const s = sp.value;
  if (!s) return "";
  return `${s.exam_title_cs || ""} · ${s.exam_date_cs || $t("patient-state-exam-undated")}${s.exam_date_note_cs ? `. ${s.exam_date_note_cs}` : ""}`;
});

// Markers are numbered in reading order, subjective first, as the source registry numbers them.
const reg = computed(() => {
  const r = refList();
  for (const it of subj.value) r.add(first(it));
  r.add(first(vit.value));
  r.add(first(ecog.value));
  if (brain.value) r.add(first(brain.value));
  for (const it of rest.value) r.add(first(it));
  return r;
});
const num = (ref: SourceRef | undefined) => (ref ? reg.value.list.findIndex((x) => `${x.file}|${x.page}|${x.quote}` === `${ref.file}|${ref.page}|${ref.quote}`) + 1 : 0);
// The objective line's findings after the lead: brain metastases first, then the rest.
const objective = computed(() => [...(brain.value ? [brain.value] : []), ...rest.value]);
</script>

<template>
  <section v-if="sp" class="card">
    <div class="head"><h2>{{ $t("patient-state-title") }} <button class="info" :title="exam" :aria-label="exam" lang="cs">i</button></h2></div>
    <div class="stc">
      <p><b>{{ $t("patient-state-subjective") }}</b> <template v-for="(it, k) in subj" :key="it.i"><template v-if="k">, </template><EdLink :k="`sp:${it.i}`" :orig="text(it)" /><Marks :f="it" /><RefMark :r="first(it)" :n="num(first(it))" /></template>.</p>
      <p>
        <b>{{ $t("patient-state-objective") }}</b> {{ $t("patient-state-tkp") }} <span v-if="vitals.tk" lang="cs">{{ vitals.tk }}</span><Gap v-else /> / <span v-if="vitals.pulse" lang="cs">{{ vitals.pulse }}</span><Gap v-else /><RefMark v-if="vit" :r="first(vit)" :n="num(first(vit))" />, {{ $t("patient-state-tt") }} <span v-if="vitals.tt" lang="cs">{{ vitals.tt }}</span><Gap v-else />, {{ $t("patient-state-ps") }} <template v-if="ecog"><EdLink :k="`sp:${ecog.i}`" :orig="ecog.text_cs" /><RefMark :r="first(ecog)" :n="num(first(ecog))" /></template><Gap v-else /><template v-for="it in objective" :key="it.i">; <EdLink :k="`sp:${it.i}`" :orig="text(it)" /><Marks :f="it" /><RefMark :r="first(it)" :n="num(first(it))" /></template>.
      </p>
    </div>
    <SrcList :list="reg.list" />
  </section>
</template>
