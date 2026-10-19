<script setup lang="ts">
// The Dokumenty tab: a full-width table of the case's documents with how readable
// each one is, Excel-style column filters, a search, and the documents the PDF only cites listed as missing
// originals (Soňa and Juro, round 2). The whole row opens the document's first page; "Otevřít" stays for keyboard
// users.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import type { DocumentInfo } from "@codebridge/domain/case-data";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import { useSessionStore } from "../../stores/session";
import { useOverlayStore } from "../../stores/overlay";
import DocColFilter, { type ColValue } from "./DocColFilter.vue";
import DocPipeline from "./DocPipeline.vue";
import Gap from "./Gap.vue";

const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();
const session = useSessionStore();
const overlay = useOverlayStore();

const dd = computed(() => {
  const d = c.cd.value?.documents;
  return { file: c.cd.value?.file ?? c.p.value.file, documents: d?.documents ?? [], pages: d?.pages ?? null, note: d?.note ?? null };
});
const all = computed<DocumentInfo[]>(() => dd.value.documents);

// Readability codes and the chip class each one wears; an unknown code is shown as the data gives it.
const READ_CLASS: Record<string, string> = { good: "st-ready", fair: "st-attention", poor: "k-contradiction" };
const readLabel = (code: string | undefined) => (code && code in READ_CLASS ? $t("patient-docs-readability", { code }) : String(code ?? ""));
const yearOf = (d: DocumentInfo) => (String(d.date || "").match(/\d{4}/) || [""])[0]!;

// The filterable columns. Filters store codes (the readability code, the year, the type as written), never a
// translated label, so a filter survives a language switch; the label is only what the list shows.
type Col = { key: string; title: string; get: (d: DocumentInfo) => string; label: (code: string) => string; content: boolean };
const COLS = computed<Record<string, Col>>(() => ({
  dtype: { key: "dtype", title: $t("patient-docs-col-type"), get: (d) => String(d.type ?? ""), label: (x) => x, content: true },
  dread: { key: "dread", title: $t("patient-docs-col-readability"), get: (d) => String(d.readability ?? ""), label: readLabel, content: false },
  dyear: { key: "dyear", title: $t("patient-docs-col-year"), get: yearOf, label: (x) => x || $t("patient-docs-year-none"), content: false },
}));
const valuesOf = (col: Col): ColValue[] =>
  [...new Set(all.value.map(col.get))]
    .map((code) => ({ code, label: col.label(code), content: col.content }))
    .sort((a, b) => a.label.localeCompare(b.label, "cs"));

const passes = (d: DocumentInfo) => Object.values(COLS.value).every((col) => !view.docFilters[col.key] || view.docFilters[col.key]!.includes(col.get(d)));
const docs = computed(() => {
  const q = view.docQuery.toLowerCase();
  return all.value.filter((d) => passes(d) && (!q || `${d.title_cs} ${d.type} ${d.date || ""}`.toLowerCase().includes(q)));
});
const active = computed(() => Object.keys(COLS.value).filter((k) => view.docFilters[k]).length + (view.docQuery ? 1 : 0));

function setAll(key: string, checked: boolean) {
  const f = { ...view.docFilters };
  if (checked) delete f[key];
  else f[key] = [];
  view.docFilters = f;
}
function setValue(key: string, code: string, checked: boolean) {
  const every = [...new Set(all.value.map(COLS.value[key]!.get))];
  let cur = view.docFilters[key] ? [...view.docFilters[key]!] : every;
  cur = checked ? [...new Set([...cur, code])] : cur.filter((v) => v !== code);
  const f = { ...view.docFilters };
  // Every value ticked is no filter at all, so the header is not shown as filtered.
  if (cur.length === every.length) delete f[key];
  else f[key] = cur;
  view.docFilters = f;
}
function clearFilters() {
  const f = { ...view.docFilters };
  for (const k of Object.keys(COLS.value)) delete f[k];
  view.docFilters = f;
  view.docQuery = "";
}

// Which column's popup is open; one at a time.
const colOpen = ref<string | null>(null);
// An outside click only closes the popup and does nothing else; a
// capture listener stops the click before it reaches the row it landed on.
function onDocClick(e: MouseEvent) {
  if (!colOpen.value) return;
  const t = e.target as Element | null;
  if (t?.closest?.(".fpop,.th-f")) return;
  colOpen.value = null;
  e.stopPropagation();
}
// Escape closes an open dialog first; only without one does it close the filter popup.
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && colOpen.value && !overlay.current) colOpen.value = null;
}
watch(colOpen, (open, was) => {
  if (open && !was) {
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
  } else if (!open && was) {
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick, true);
  document.removeEventListener("keydown", onKey, true);
});

const pipelineOn = computed(() => !!session.me?.features?.pipeline);
const uploaded = computed(() => all.value.some((d) => d.file));
// "citace v ambulantní zprávě, původní popis v PDF není" becomes "citováno v ambulantní zprávě": the row adds
// "originál chybí" itself, so the data's own "original missing" clause would say it twice.
const citedIn = (t: string) => String(t).replace(/,\s*původní popis v PDF není/i, "").replace(/^citace v\b/i, "citováno v");
const firstPage = (d: DocumentInfo) => ({ file: d.file || dd.value.file, page: (d.pages || [1])[0]! });
const openDoc = (d: DocumentInfo) => c.openSource(firstPage(d));
// The "+ Nahrát dokument" dialog (UploadDialog.vue), drawn by the patient screen's overlay host.
const openUpload = () => overlay.open({ kind: "upload", file: c.p.value.file });
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ docs.length === all.length ? $t("patient-docs-title", { n: all.length }) : $t("patient-docs-title-filtered", { shown: docs.length, n: all.length }) }}</h2><span class="row"><span class="muted small">{{ $t("patient-docs-source") }}<template v-if="uploaded">{{ $t("patient-docs-source-uploaded", { n: all.length }) }}</template><span v-else lang="cs">{{ dd.file }}</span><template v-if="dd.pages != null">{{ $t("patient-docs-source-pages", { n: dd.pages }) }}</template><template v-else>{{ $t("patient-docs-source-pages-none") }}<Gap />{{ $t("patient-docs-source-pages-none-unit") }}</template></span><button class="btn primary small" @click="openUpload">{{ $t("patient-docs-upload") }}</button></span></div>
    <div v-if="dd.note" class="question missing" style="margin-bottom:10px"><span class="label">{{ $t("patient-docs-missing-originals") }}</span><p style="font-size:14px" lang="cs">{{ dd.note }}</p></div>
    <div class="toolbar" style="margin-bottom:10px"><input id="dq" v-model="view.docQuery" class="search" :placeholder="$t('patient-docs-search')" :aria-label="$t('patient-docs-search')"><button v-if="active" class="linkbtn small" @click="clearFilters">{{ $t("patient-docs-clear-filters", { n: active }) }}</button></div>
    <div class="scroll" :style="`min-height:${colOpen && colOpen in COLS ? 300 : 0}px`">
      <table class="tbl">
        <thead>
          <tr>
            <th>{{ $t("patient-docs-col-document") }}</th>
            <DocColFilter v-bind="{ title: COLS.dtype!.title, values: valuesOf(COLS.dtype!), filter: view.docFilters.dtype, open: colOpen === 'dtype' }" @toggle="colOpen = colOpen === 'dtype' ? null : 'dtype'" @close="colOpen = null" @all="setAll('dtype', $event)" @value="(v, ch) => setValue('dtype', v, ch)" />
            <th>{{ $t("patient-docs-col-date") }}</th>
            <th>{{ $t("patient-docs-col-pages") }}</th>
            <DocColFilter v-bind="{ title: COLS.dread!.title, values: valuesOf(COLS.dread!), filter: view.docFilters.dread, open: colOpen === 'dread' }" @toggle="colOpen = colOpen === 'dread' ? null : 'dread'" @close="colOpen = null" @all="setAll('dread', $event)" @value="(v, ch) => setValue('dread', v, ch)" />
            <DocColFilter v-bind="{ title: COLS.dyear!.title, values: valuesOf(COLS.dyear!), filter: view.docFilters.dyear, open: colOpen === 'dyear' }" @toggle="colOpen = colOpen === 'dyear' ? null : 'dyear'" @close="colOpen = null" @all="setAll('dyear', $event)" @value="(v, ch) => setValue('dyear', v, ch)" />
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in docs" :key="all.indexOf(d)" class="click" data-src @click="openDoc(d)">
            <td><b lang="cs">{{ d.title_cs }}</b><span v-if="d.embedded_in_cs" class="note"><span lang="cs">{{ citedIn(d.embedded_in_cs) }}</span>{{ $t("patient-docs-original-missing") }}</span><DocPipeline v-if="pipelineOn && d.file" :file="d.file" /></td>
            <td lang="cs">{{ d.type }}</td>
            <td class="num"><span v-if="d.date" lang="cs">{{ d.date }}</span><Gap v-else /></td>
            <td class="num">{{ (d.pages || []).join(", ") }}</td>
            <td><span :class="['chip', READ_CLASS[d.readability || ''] || 'st-new']" :title="d.reason_cs || ''"><span v-if="!(d.readability && d.readability in READ_CLASS)" lang="cs">{{ readLabel(d.readability) }}</span><template v-else>{{ readLabel(d.readability) }}</template></span></td>
            <td class="num">{{ COLS.dyear!.label(yearOf(d)) }}</td>
            <td><button class="btn small" data-src @click.stop="openDoc(d)">{{ $t("patient-docs-open") }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!docs.length" class="muted">{{ $t("patient-docs-none-match") }}</p>
    <p class="muted small" style="margin:10px 0 0">{{ $t("patient-docs-readability-hint") }}</p>
  </section>
</template>
