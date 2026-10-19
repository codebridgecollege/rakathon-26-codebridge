<script setup lang="ts">
// "Aktuální stav pacienta" (round 2 "status praesens"): the most recent exam, subjective
// first, then the objective line led by TK/P, TT and PS (ECOG) as the clinicians write it (rounds 9 and 14). The lead is
// read from the exam's vital-sign and performance-status facts by what they measure, never by matching Czech labels.
// Regions the record marks as not examined are left out. Every finding has a numbered source marker; the text itself
// opens the edit dialog for doctors, keyed by the finding's fact.
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
import CheckNote from "./CheckNote.vue";

const { $t } = useFluent();
const c = usePatient();

const sp = computed(() => c.cd.value?.record?.status_praesens ?? null);
// The check behind the card: an exam the documents do not describe, or one not looked for, is said, not left out; the
// pages it could not read are listed either way.
const check = computed(() => (c.cd.value?.record ? (c.cd.value.run?.sections.state ?? null) : null));
const unreadable = computed(() => [...new Set((check.value?.unreadable ?? []).map((u) => u.page))].sort((a, b) => a - b).join(", "));
const items = computed(() => (sp.value?.items || []) as Item[]);
const subj = computed(() => items.value.filter((it) => it.group === "subjective"));
const vitals = computed(() => vitalsOf(items.value));
const vit = computed(() => items.value.filter((it) => it.what === "blood_pressure" || it.what === "pulse" || it.what === "temperature"));
const ecog = computed(() => vitals.value.ecog as Item | null);
const brain = computed(() => items.value.find((it) => it.kind === "metastasis"));
// The other objective findings; the vital signs other than TK, P and TT (weight, height) are not part of this line.
const rest = computed(() => items.value.filter((it) => it.group === "objective" && it.kind !== "vital_sign" && !/^nevyšetřen/i.test(String(it.text_cs).trim())));
const first = (it: Item | undefined | null) => (it ? refAt(c.cd.value, (it.refs || [])[0]) : undefined);
// The finding as the document words it (what an edit is stored against), and as shown: a finding the documents deny
// without saying so in its own text gets the negation label, in the interface language, never in the stored original.
const raw = (it: Item) => String(it.text_cs).replace(/[.,;]\s*$/, "");
const text = (it: Item) => (it.negation_label ? $t("patient-fact-negated", { text: raw(it) }) : raw(it));
const exam = computed(() => {
  const s = sp.value;
  if (!s) return "";
  return `${s.exam_title_cs || ""} · ${s.exam_date_cs || $t("patient-state-exam-undated")}${s.exam_date_note_cs ? `. ${s.exam_date_note_cs}` : ""}`;
});

// Markers are numbered in reading order, subjective first, as the source registry numbers them.
const reg = computed(() => {
  const r = refList();
  for (const it of subj.value) r.add(first(it));
  for (const it of vit.value) r.add(first(it));
  r.add(first(ecog.value));
  if (brain.value) r.add(first(brain.value));
  for (const it of rest.value) r.add(first(it));
  return r;
});
const num = (ref: SourceRef | undefined) => (ref ? reg.value.list.findIndex((x) => `${x.file}|${x.page}|${x.quote}` === `${ref.file}|${ref.page}|${ref.quote}`) + 1 : 0);
const vitOf = (what: string) => vit.value.find((it) => it.what === what);
// The objective line's findings after the lead: brain metastases first, then the rest.
const objective = computed(() => [...(brain.value ? [brain.value] : []), ...rest.value]);
</script>

<template>
  <section v-if="sp" class="card">
    <div class="head"><h2>{{ $t("patient-state-title") }} <button class="info" :title="exam" :aria-label="exam" lang="cs">i</button></h2></div>
    <div class="stc">
      <p><b>{{ $t("patient-state-subjective") }}</b> <template v-for="(it, k) in subj" :key="it.key"><template v-if="k">, </template><EdLink :k="it.key" :orig="raw(it)" :shown="text(it)" /><Marks :f="it" /><RefMark :r="first(it)" :n="num(first(it))" /></template>.</p>
      <p>
        <b>{{ $t("patient-state-objective") }}</b> {{ $t("patient-state-tkp") }} <span v-if="vitals.tk" lang="cs">{{ vitals.tk }}</span><Gap v-else /><RefMark v-if="vitOf('blood_pressure')" :r="first(vitOf('blood_pressure'))" :n="num(first(vitOf('blood_pressure')))" /> / <span v-if="vitals.pulse" lang="cs">{{ vitals.pulse }}</span><Gap v-else /><RefMark v-if="vitOf('pulse')" :r="first(vitOf('pulse'))" :n="num(first(vitOf('pulse')))" />, {{ $t("patient-state-tt") }} <span v-if="vitals.tt" lang="cs">{{ vitals.tt }}</span><Gap v-else />, {{ $t("patient-state-ps") }} <template v-if="ecog"><EdLink :k="ecog.key" :orig="ecog.text_cs" /><RefMark :r="first(ecog)" :n="num(first(ecog))" /></template><Gap v-else /><template v-for="it in objective" :key="it.key">; <EdLink :k="it.key" :orig="raw(it)" :shown="text(it)" /><Marks :f="it" /><RefMark :r="first(it)" :n="num(first(it))" /></template>.
      </p>
    </div>
    <p v-if="unreadable" class="muted small">{{ $t("patient-check-unreadable", { pages: unreadable }) }}</p>
    <SrcList :list="reg.list" />
  </section>
  <section v-else-if="check" class="card">
    <div class="head"><h2>{{ $t("patient-state-title") }}</h2></div>
    <p><CheckNote :check="check" /></p>
  </section>
</template>
