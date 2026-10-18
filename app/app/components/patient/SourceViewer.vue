<script setup lang="ts">
// The source viewer (PRODUCT.md F-18; openSource(), sourceHtml() and zoomCtl() in the template). A reference opens
// the original page image with the quoted passage boxed in yellow; the transcription sits in a second tab (team
// decision 2026-10-16), so the doctor reaches the exact original passage either way. The page image is the source of
// truth: the legend says that unmarked text is not verified. The quote is matched here, in the browser, on the page
// the Worker sent, so the quote never reaches the server.
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useFluent } from "fluent-vue";
import { matchImage, matchText, verifyOf, type Box, type ImageMatch, type TextMatch, type Verify, type Word } from "@codebridge/domain/quote-match";
import { segmentPage } from "@codebridge/domain/page-text";
import { useOverlayStore, type SourceOverlay } from "../../stores/overlay";
import { useSourceStore } from "../../stores/source";
import { usePatientViewStore } from "../../stores/patientView";
import { PATIENT_KEY } from "../../composables/usePatient";
import PageText from "./PageText.vue";
import ZoomControl, { nextZoom } from "./ZoomControl.vue";

const props = defineProps<{ o: SourceOverlay }>();
const { $t } = useFluent();
const t = (id: string, args?: Record<string, string | number>) => $t(id, args);
const ov = useOverlayStore();
const source = useSourceStore();
const view = usePatientViewStore();
// The open case, when the viewer sits in the patient view: it names the document of a page the server gives no title.
const patient = inject(PATIENT_KEY, null);

// The overlay object keeps its identity while update() changes its fields, so a copy taken on every change of the
// store's current overlay is what lets this component redraw.
const o = computed<SourceOverlay>(() => {
  void ov.current;
  return { ...props.o };
});
const d = computed(() => source.pageOf(o.value.file, o.value.page));
const doc = computed(() => source.docOf(o.value.file));

// The loading drawer shows only until this viewer has shown a page; switching pages keeps the current page on screen
// until the next one arrives, as the template did.
// Shallow: a deep ref would hold a reactive proxy, which never equals the overlay object itself.
const shownFor = shallowRef<SourceOverlay | null>(null);
watch(
  () => [props.o, o.value.loading, d.value] as const,
  ([cur, loading, page]) => {
    if (!loading && page) shownFor.value = cur;
  },
  { immediate: true },
);
const showLoading = computed(() => o.value.loading && shownFor.value !== props.o);

const size = computed<[number, number]>(() => (d.value?.size as [number, number]) || [1, 1]);
const verify = computed<Verify[]>(() => verifyOf(d.value?.verify));

// The quote belongs to the cited page; on another page of the same document nothing is highlighted.
type Match = { quote: string; image: ImageMatch | null; text: TextMatch | null };
// It depends on the page and the citation only, so a zoom step or a tab switch does not match again.
const cite = computed(() => props.o.cite);
const page = computed(() => o.value.page);
const match = computed<Match | null>(() => {
  const pg = d.value;
  const q = cite.value.quote;
  if (!pg || !q || Number(cite.value.page) !== page.value) return null;
  return { quote: q, image: matchImage(q, (pg.words as Word[]) || []), text: matchText(q, String(pg.text || "")) };
});

const red = computed(() => !!(o.value.redacted && d.value?.redacted));
const tab = computed(() => (red.value ? "image" : o.value.tab));
const imgHit = computed(() => match.value?.image ?? null);
const vis = computed(() => verify.value.filter((v) => v.box));
const nv = computed(() => verify.value.length);
const blocks = computed(() => (tab.value === "text" && d.value && !d.value.empty ? segmentPage(String(d.value.text || ""), match.value?.text?.range ?? null, verify.value) : []));

// What the doctor needs to know about the highlight: found exactly, found approximately, or not at all.
const note = computed<{ text: string; warn: boolean } | null>(() => {
  const m = match.value;
  if (red.value || !m) return null;
  if (!m.image && !m.text) return { text: t("patient-src-note-not-found"), warn: true };
  const hit = tab.value === "text" ? m.text : m.image;
  if (!hit) return { text: t(tab.value === "text" ? "patient-src-note-image-only" : "patient-src-note-text-only"), warn: true };
  const parts: string[] = [];
  if (hit.method !== "exact") parts.push(hit.score >= 0.995 ? t("patient-src-note-spread") : t("patient-src-note-approx", { pct: Math.round(hit.score * 100) }));
  if (hit.ambiguous) parts.push(t(hit.method === "exact" ? "patient-src-note-repeated" : "patient-src-note-similar"));
  return parts.length ? { text: parts.join(" "), warn: hit.ambiguous } : null;
});

// How the page was read is technical detail, so it sits behind an info icon instead of in the bar.
const engineTip = computed(() => {
  const engine = t(d.value?.engine === "vision" ? "patient-src-engine-vision" : "patient-src-engine-tesseract");
  return d.value?.mean_conf != null ? t("patient-src-engine-conf", { engine, conf: Number(d.value.mean_conf) }) : engine;
});

// A page read without AI has Tesseract as its text and the PDF text layer as the second reading; its items carry
// "layer" instead of "vision".
function verifyTitle(v: Verify): string {
  const conf = v.conf ?? "";
  if ("layer" in v) {
    if (v.reason === "only_tesseract") return t("patient-src-verify-only-tesseract");
    if (v.reason === "only_layer") return t("patient-src-verify-only-layer", { layer: v.layer ?? "" });
    if (v.reason === "low_conf") return t("patient-src-verify-layer-low", { conf });
    return t("patient-src-verify-layer", { layer: v.layer ?? "" });
  }
  if (v.reason === "only_vision") return t("patient-src-verify-only-vision");
  return v.reason === "low_conf" ? t("patient-src-verify-tess-low", { tess: v.tess ?? "", conf }) : t("patient-src-verify-tess", { tess: v.tess ?? "" });
}
const vboxTitle = (v: Verify) => t("patient-src-vbox", { why: verifyTitle(v), reading: v.vision ?? v.tess ?? "" });

const pct = (b: Box) => {
  const [W, H] = size.value;
  return `left:${((b[0] / W) * 100).toFixed(3)}%;top:${((b[1] / H) * 100).toFixed(3)}%;width:${((b[2] / W) * 100).toFixed(3)}%;height:${((b[3] / H) * 100).toFixed(3)}%`;
};
const vboxStyle = (b: Box) => pct([b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4]);
const frameStyle = computed(() => {
  const [W, H] = size.value;
  const z = o.value.zoom;
  return `aspect-ratio:${W} / ${H};${typeof z === "number" ? `width:${Math.round((W * z) / 100)}px;max-width:none` : ""}`;
});
const title = computed(() => d.value?.doc_title || (patient ? patient.docTitle({ file: o.value.file, page: o.value.page }) : null) || d.value?.file);
const quoteShown = computed(() => {
  const q = match.value?.quote ?? "";
  return q.length > 160 ? q.slice(0, 160) + "…" : q;
});
const reasons = computed(() => ((d.value?.redacted?.reasons as string[]) || []).join(", "));

// A page image that fails to load says so, instead of leaving an empty frame.
const failed = ref(new Set<string>());
const onImgError = (src: string) => {
  failed.value = new Set(failed.value).add(src);
};

const imgEl = ref<HTMLImageElement | null>(null);
// At fit width the effective percentage depends on the drawer, so it is read from the rendered image.
function currentZoomPct(): number {
  const z = o.value.zoom;
  if (typeof z === "number") return z;
  const img = imgEl.value;
  return img && img.naturalWidth ? Math.round((img.clientWidth / img.naturalWidth) * 100) : 100;
}
function zoomStep(dir: number) {
  const next = nextZoom(currentZoomPct(), dir);
  if (next) ov.update(props.o, { zoom: next });
}
const setZoom = (zoom: SourceOverlay["zoom"]) => ov.update(props.o, { zoom });
// The chosen tab is remembered for the next source the doctor opens.
function setTab(tabName: "image" | "text") {
  view.srcTab = tabName;
  ov.update(props.o, { tab: tabName });
}
const gotoPage = (n: number) => void source.gotoPage(t, props.o, n);
const close = () => ov.close();

// Zoom keys as in common PDF viewers; only on the page image, and never while typing.
function onKey(e: KeyboardEvent) {
  // Nothing drawn (no page held, as after a user switch): the keys belong to the page underneath.
  if (!ov.isOpen(props.o) || showLoading.value || !d.value || o.value.tab === "text") return;
  const el = e.target as HTMLElement | null;
  if (/INPUT|TEXTAREA|SELECT/.test(el?.tagName ?? "") || e.ctrlKey || e.metaKey) return;
  if (e.key === "+" || e.key === "=") zoomStep(1);
  else if (e.key === "-") zoomStep(-1);
  else if (e.key === "0") setZoom("fit");
  else return;
  e.preventDefault();
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));

// After each redraw the highlighted passage is scrolled to the middle (renderOverlay() scrolled to #hit), which is
// also what "Přiblížit na citaci" relies on.
const root = ref<HTMLElement | null>(null);
async function scrollToHit() {
  await nextTick();
  root.value?.querySelector<HTMLElement>("#hit")?.scrollIntoView?.({ block: "center", inline: "center" });
}
watch(() => [d.value, o.value.page, o.value.tab, o.value.zoom, o.value.redacted, showLoading.value], scrollToHit, { immediate: true, flush: "post" });
// Zoom to the passage: the page at full size, scrolled so the highlight is in the middle, also when it is at 100 % already.
function zoomToHit() {
  setZoom(100);
  void scrollToHit();
}
</script>

<template>
  <template v-if="showLoading">
    <div class="scrim" @click="close"></div>
    <aside class="drawer" role="dialog" :aria-label="$t('patient-src-loading-dialog')">
      <header>
        <div><div class="label">{{ $t("patient-src-loading-label") }}</div></div>
        <button class="btn small" @click="close">{{ $t("patient-src-close") }}</button>
      </header>
      <p class="muted" role="status" style="padding: 16px">{{ $t("patient-src-loading") }}</p>
    </aside>
  </template>
  <template v-else-if="d">
    <div class="scrim" @click="close"></div>
    <aside ref="root" class="drawer wide" role="dialog" :aria-label="$t('patient-src-dialog')">
      <header>
        <div style="min-width: 0">
          <div class="label vlabel">{{ $t("patient-src-kind") }}</div>
          <h2 style="margin-top: 4px" lang="cs">{{ title }}</h2>
          <div class="muted small"><span lang="cs">{{ d.file }}</span><template v-if="doc?.case_id">{{ " · " }}<span lang="cs">{{ doc.case_id }}</span></template>{{ " · " + $t("patient-src-page-of", { n: d.n, of: d.of }) }}</div>
          <i18n v-if="match && !red" path="patient-src-sought" tag="div" class="vquote" :args="{ page: String(o.cite.page) }">
            <template #quote><span lang="cs">{{ quoteShown }}</span></template>
          </i18n>
        </div>
        <button class="btn small" @click="close">{{ $t("patient-src-close") }}</button>
      </header>
      <div class="pages">
        <button v-for="p in doc?.pages || []" :key="p.n" :aria-pressed="p.n === d.n" :title="p.empty ? $t('patient-src-page-empty-tooltip') : ''" @click="gotoPage(p.n)">{{ $t("patient-src-page-button", { n: p.n }) }}{{ p.empty ? $t("patient-src-page-empty") : "" }}</button>
      </div>
      <div class="vbar">
        <span v-if="!red" class="seg" role="tablist" :aria-label="$t('patient-src-tabs')"><button role="tab" :aria-pressed="tab !== 'text'" :aria-selected="tab !== 'text'" @click="setTab('image')">{{ $t("patient-src-tab-image") }}</button><button role="tab" :aria-pressed="tab === 'text'" :aria-selected="tab === 'text'" @click="setTab('text')">{{ $t("patient-src-tab-text") }}</button></span>
        <label v-if="tab !== 'text' && d.redacted" class="small" style="display: inline-flex; gap: 6px; align-items: center"><input type="checkbox" :checked="red" @change="ov.update(props.o, { redacted: ($event.target as HTMLInputElement).checked })" /> {{ $t("patient-src-redact") }}</label>
        <button v-if="tab !== 'text' && !red && imgHit" class="btn small" @click="zoomToHit">{{ $t("patient-src-zoom-hit") }}</button>
        <span class="muted small vengine row" style="gap: 6px">{{ nv ? $t("patient-src-verify-count", { n: nv }) : "" }}<button class="info" :title="engineTip" :aria-label="engineTip">i</button></span>
      </div>
      <div v-if="note" :class="note.warn ? 'vnote warn' : 'vnote'">{{ note.text }}</div>
      <div class="vwrap">
        <ZoomControl v-if="tab !== 'text'" :zoom="o.zoom" @step="zoomStep" @fit="setZoom('fit')" />
        <div id="vbody" class="vbody">
          <template v-if="red">
            <p class="synth" style="margin: 0 0 12px; border-style: solid">
              {{ $t("patient-src-redact-intro") + " " }}<i18n v-if="d.redacted.count" path="patient-src-redact-count" :tag="false" :args="{ n: Number(d.redacted.count) }"><template #reasons><span lang="cs">{{ reasons }}</span></template></i18n><template v-else>{{ $t("patient-src-redact-none") }}</template>{{ " " + $t("patient-src-redact-outro") }}
            </p>
            <div class="pgimg" :style="frameStyle">
              <p v-if="failed.has(d.redacted.image)" class="synth">{{ $t("patient-src-img-failed") }}</p>
              <img v-else ref="imgEl" :src="d.redacted.image" :alt="$t('patient-src-img-alt-redacted', { n: d.n })" :width="size[0]" :height="size[1]" @error="onImgError(d.redacted.image)" />
            </div>
          </template>
          <template v-else-if="tab === 'text'">
            <p v-if="d.empty" class="synth" style="margin: 0 0 12px">{{ $t("patient-src-empty-page") }}</p>
            <PageText v-else :blocks="blocks" :verify-title="verifyTitle" />
            <p v-if="nv" class="muted small" style="margin: 14px 0 0">{{ $t("patient-src-legend-text") }}</p>
          </template>
          <template v-else>
            <p v-if="d.empty" class="synth" style="margin: 0 0 12px">{{ $t("patient-src-empty-page") }}</p>
            <div class="pgimg" :style="frameStyle">
              <p v-if="failed.has(d.image)" class="synth">{{ $t("patient-src-img-failed") }}</p>
              <img v-else ref="imgEl" :src="d.image" :alt="$t('patient-src-img-alt', { n: d.n, file: d.file })" :width="size[0]" :height="size[1]" @error="onImgError(d.image)" />
              <span v-for="(b, i) in imgHit?.boxes || []" :id="i === 0 ? 'hit' : undefined" :key="'h' + i" class="hbox" :style="pct(b)"></span>
              <span v-for="(v, i) in vis" :key="'v' + i" class="vbox" :title="vboxTitle(v)" :style="vboxStyle(v.box!)"></span>
            </div>
            <p v-if="nv" class="muted small" style="margin: 10px 0 0">{{ $t("patient-src-legend-image") }}</p>
          </template>
        </div>
      </div>
    </aside>
  </template>
</template>
