<script setup lang="ts">
// "Retrospektivní odchylky". A read-only comparison of
// documented decisions with guideline passages; listing a row does not establish a deviation. Severity and assessment
// are set by doctors, never by the assistant: earlier doctor assessments stay readable, nothing here takes input
// (user decision 2026-10-17). Nothing fills those assessments here, so every severity
// shows as not stated, as today. The protocol's own deviations table (devTable()) needs recorded deviations that the
// server does not send, so it is left out.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import type { Item, SourceRef } from "@codebridge/domain/case-data";
import { quoteLang } from "@codebridge/domain/guideline";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { useCasesStore } from "../../stores/cases";
import { pageOf, useGuide } from "../../lib/guide";
import { openGuide } from "../../lib/guideDrawer";
import { fmtDate } from "../../lib/dates";
import Gap from "./Gap.vue";
import PastPassage from "./PastPassage.vue";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();
const { G, GL, past, anyStmt, sourcesOf } = useGuide(c, $t);

const errText = computed(() => {
  const e = G.value.error;
  return e ? (e.message_cs ?? $t(e.message_id ?? "patient-guide-load-failed")) : "";
});
const retry = () => useCasesStore().retryGuidance(c.p.value.file);

// Findings belong to the case they were made for; another case shows none.
const findings = computed(() => (G.value.deviation_case_file === c.p.value.file ? ((G.value.deviation_findings || []) as Item[]) : []));
const rowOf = (x: Item) => {
  const statements = ((x.statement_ids || []) as string[]).map(anyStmt).filter(Boolean) as Item[];
  const pastSt = x.past_statement_id ? past.value.find((st) => st.id === x.past_statement_id) : undefined;
  const all = pastSt ? [pastSt, ...statements] : statements;
  const guidelines = [...new Map(all.map((st) => [st.guideline_id, GL(st.guideline_id)])).values()];
  // The documentation's own passages, by the facts the finding rests on; a fact the current run does not show is
  // flagged in the row.
  const src = sourcesOf(x.source_fact_ids);
  return { x, all, guidelines, quotes: src.refs, unresolved: src.unresolved };
};
const rows = computed(() => findings.value.map(rowOf));

const GROUPS: Record<string, string> = {
  "past-nephrectomy": "patient-dev-group-surgery",
  "past-lymphadenectomy": "patient-dev-group-surgery",
  "past-metastasectomy-node": "patient-dev-group-surgery",
  "past-skin-metastasectomy": "patient-dev-group-surgery",
  "past-1l-intermediate": "patient-dev-group-systemic",
  "past-nivo-ipi-regimen": "patient-dev-group-systemic",
  "past-2l-after-io": "patient-dev-group-systemic",
  "past-3l-after-io-tki": "patient-dev-group-systemic",
};
// The decision's own words: the first passage of the facts the statement names as the decision, else of its row's
// fact.
const decisionSrc = (x: Item) => {
  const d = sourcesOf(x.decision_fact_ids);
  return d.refs.length ? d : sourcesOf(x.row_fact_id ? [x.row_fact_id] : []);
};
const decisionRef = (x: Item): SourceRef | undefined => decisionSrc(x).refs[0];
const decisionUnresolved = (x: Item) => sourcesOf([...((x.decision_fact_ids || []) as string[]), ...(x.row_fact_id ? [x.row_fact_id] : [])]).unresolved.length > 0;
const edRange = (e: Item) => $t("patient-dev-edition-range", { from: fmtDate($t, e.valid_from), to: e.valid_to ? fmtDate($t, e.valid_to) : $t("patient-dev-edition-until-now") });
const COLS = ["patient-dev-col-finding", "patient-dev-col-area", "patient-dev-col-severity", "patient-dev-col-guideline", "patient-dev-col-year", "patient-dev-col-passage", "patient-dev-col-quote", "patient-dev-col-consequence"];
</script>

<template>
  <section v-if="!view.guideOn" class="card"><p class="muted">{{ $t("patient-dev-layer-off") }}</p></section>
  <section v-else-if="G.loading" class="card"><p class="muted" role="status">{{ $t("patient-dev-loading") }}</p></section>
  <section v-else-if="G.error" class="card"><p class="muted" role="alert">{{ errText }} <button class="linkbtn small" @click="retry">{{ $t("patient-guide-retry") }}</button></p></section>
  <template v-else>
    <section v-if="!rows.length" class="card"><h2>{{ $t("patient-dev-findings-heading") }}</h2><p class="muted small">{{ $t("patient-dev-findings-none") }}</p></section>
    <section v-else class="card">
      <div class="head"><h2>{{ $t("patient-dev-findings-heading") }}</h2><span class="muted small">{{ $t("patient-dev-findings-count", { n: rows.length }) }}</span></div>
      <p class="muted small">{{ $t("patient-dev-findings-intro") }}</p>
      <div class="scroll" role="region" :aria-label="$t('patient-dev-findings-region')" tabindex="0">
        <table class="tbl deviation-table findings-table">
          <colgroup><col style="width:19%"><col style="width:7%"><col style="width:6%"><col style="width:10%"><col style="width:4%"><col style="width:22%"><col style="width:18%"><col style="width:14%"></colgroup>
          <thead><tr><th v-for="col in COLS" :key="col">{{ $t(col) }}</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.x.id">
              <td><b lang="cs">{{ r.x.title_cs }}</b><span class="note" lang="cs">{{ r.x.status_cs }}</span><p class="dev-context" lang="cs">{{ r.x.interpretation_cs }}</p></td>
              <td lang="cs">{{ r.x.group_cs }}</td>
              <td><Gap /></td>
              <td><template v-if="r.guidelines.length"><template v-for="(g, i) in r.guidelines" :key="i"><b :lang="quoteLang(g)">{{ g.name }}</b><span class="note" :lang="quoteLang(g)">{{ g.society || "" }} · {{ g.version || "" }}</span></template></template><Gap v-else /></td>
              <td><template v-if="r.guidelines.length"><template v-for="(g, i) in r.guidelines" :key="i"><br v-if="i">{{ g.year }}</template></template><Gap v-else /></td>
              <td>
                <template v-if="r.all.length">
                  <template v-for="(st, i) in r.all" :key="st.id"><hr v-if="i"><PastPassage v-if="st.edition" :x="st" /><template v-else><q :lang="quoteLang(GL(st.guideline_id))">{{ st.quote }}</q><span class="note"><span :lang="quoteLang(GL(st.guideline_id))">{{ st.section || "" }}</span> · {{ pageOf($t, st) }} · <span :lang="quoteLang(GL(st.guideline_id))">{{ st.evidence || "" }}</span> · <button class="linkbtn small" @click="openGuide(c, st.id)">{{ $t("patient-dev-open-guideline") }}</button></span></template></template>
                </template>
                <Gap v-else />
                <p v-if="r.x.risk_basis_cs" class="note"><span lang="cs">{{ r.x.risk_basis_cs }}</span> <a class="linkbtn small" :href="r.x.risk_basis_url" target="_blank" rel="noopener">{{ $t("patient-dev-risk-basis-link") }}</a></p>
              </td>
              <td><template v-if="r.quotes.length"><p v-for="(ref, i) in r.quotes" :key="i" class="dev-context"><q lang="cs">{{ ref.quote }}</q> <button class="linkbtn small" data-src @click="c.openSource(ref)">{{ ref.nis ? $t("patient-src-nis") : $t("patient-src-page-button", { n: String(ref.page) }) }}</button></p></template><Gap v-else /><p v-if="r.unresolved.length" class="muted small">{{ $t("patient-guide-fact-unresolved") }}</p></td>
              <td><span lang="cs">{{ r.x.clinical_consequence_cs }}</span><span class="note">{{ $t("patient-dev-consequence-note") }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted dev-footnote">{{ $t("patient-dev-findings-footnote") }}</p>
    </section>
    <details class="card deviation-context">
      <summary>{{ $t("patient-dev-more", { n: past.length }) }}</summary>
      <section v-if="past.length" class="card">
        <div class="head"><h2>{{ $t("patient-dev-retro-heading") }}</h2><span class="muted small">{{ $t("patient-dev-retro-sub") }}</span></div>
        <p class="muted small">{{ $t("patient-dev-retro-intro") }}</p>
        <div class="scroll" role="region" :aria-label="$t('patient-dev-retro-region')" tabindex="0">
          <table class="tbl deviation-table">
            <colgroup><col style="width:16%"><col style="width:7%"><col style="width:7%"><col style="width:11%"><col style="width:7%"><col style="width:24%"><col style="width:19%"><col style="width:9%"></colgroup>
            <thead><tr><th v-for="col in COLS" :key="col">{{ $t(col) }}</th></tr></thead>
            <tbody>
              <tr v-for="x in past" :key="x.id">
                <td><b lang="cs">{{ x.decision_cs || "" }}</b><span v-if="x.decision_date" class="note">{{ fmtDate($t, x.decision_date) }}</span><p v-if="x.relation_cs" class="dev-context" lang="cs">{{ x.relation_cs }}</p></td>
                <td><template v-if="GROUPS[x.id]">{{ $t(GROUPS[x.id]!) }}</template><Gap v-else /></td>
                <td><Gap /></td>
                <td><template v-if="x.edition"><b lang="cs">{{ x.edition.name }}</b><span class="note" lang="cs">{{ x.edition.society || "" }} · {{ x.edition.version || "" }}</span></template><Gap v-else /></td>
                <td><template v-if="x.edition">{{ x.edition.year }}<span class="note">{{ edRange(x.edition) }}</span></template><Gap v-else /></td>
                <td><PastPassage :x="x" /></td>
                <td><template v-if="decisionRef(x)"><q lang="cs">{{ decisionRef(x)!.quote }}</q><span class="note"><button class="linkbtn small" data-src @click="c.openSource(decisionRef(x))"><span lang="cs">{{ c.docTitle(decisionRef(x)!) }}</span><template v-if="!decisionRef(x)!.nis">{{ $t("patient-dev-doc-page", { page: String(decisionRef(x)!.page) }) }}</template></button></span></template><Gap v-else /><span v-if="decisionUnresolved(x)" class="muted small"> {{ $t("patient-guide-fact-unresolved") }}</span></td>
                <td><Gap /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="muted dev-footnote">{{ $t("patient-dev-retro-footnote") }}</p>
      </section>
      <p v-else class="muted">{{ $t("patient-dev-no-past") }}</p>
    </details>
  </template>
</template>
