<script setup lang="ts">
// The disease course (timelineCard() in the template): events in date order with their category icon and name, a
// filter per category (several at once, "Vše" for all), and one click straight to the event's source (round 13).
// Partial dates stay as the document writes them ("4/2022"); a planned event has a dashed pin and says "plán".
import { computed, nextTick, ref, watchEffect } from "vue";
import { useFluent } from "fluent-vue";
import { EVENT_CATEGORIES, timelineNote, timelineSorted } from "@codebridge/domain/case-view";
import { usePatient } from "../../composables/usePatient";
import { usePatientViewStore } from "../../stores/patientView";
import CatIcon from "./CatIcon.vue";

const props = withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });
const { $t } = useFluent();
const c = usePatient();
const view = usePatientViewStore();

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
const catLabel = (k: string) => $t(CAT_ID[k] ?? "patient-cat-clinical");

// Rendering and source navigation share the same unsorted array (index i), so filters cannot shift sources.
const all = computed(() => timelineSorted(c.cd.value?.record?.timeline ?? []));
const cards = computed(() => all.value.filter((e) => !view.tlExcluded.has(e.category)));
const total = EVENT_CATEGORIES.length;
const shownCats = computed(() => total - view.tlExcluded.size);
const allChecked = computed(() => view.tlExcluded.size === 0);
const someHidden = computed(() => view.tlExcluded.size > 0 && view.tlExcluded.size < total);
const filters = computed(() => EVENT_CATEGORIES.map((id) => ({ id, checked: !view.tlExcluded.has(id), count: all.value.filter((e) => e.category === id).length })));
// A year heading before the first event of each year; undated events go under "Bez data".
const rows = computed(() => {
  let last: string | null = null;
  return cards.value.map((e) => {
    const y = e.date_sort ? String(e.date_sort).slice(0, 4) : null;
    const key = y ?? "";
    const head = key !== last;
    last = key;
    return { e, year: head ? y : undefined, note: timelineNote(e) };
  });
});

const bar = ref<HTMLElement | null>(null);
const allBox = ref<HTMLInputElement | null>(null);
// "Vše" shows a dash when only some categories are hidden.
watchEffect(() => {
  if (allBox.value) allBox.value.indeterminate = someHidden.value;
});

// Exclusions make the initial view complete; changing one category never clears other choices. The track scrolls
// back to the start, as the template does after a filter change.
function setCategory(id: string, include: boolean) {
  const next = new Set(view.tlExcluded);
  if (id === "all") {
    next.clear();
    if (!include) EVENT_CATEGORIES.forEach((k) => next.add(k));
  } else if ((EVENT_CATEGORIES as readonly string[]).includes(id)) {
    if (include) next.delete(id);
    else next.add(id);
  } else return;
  view.tlExcluded = next;
  view.selTl = null;
  void nextTick(() => {
    if (bar.value) bar.value.scrollLeft = 0;
  });
}

function openEvent(i: number) {
  view.selTl = i;
  const ev = (c.cd.value?.record?.timeline ?? [])[i];
  if (ev?.source) c.openSource(ev.source);
}
</script>

<template>
  <section :class="props.inline ? undefined : 'card'">
    <div class="head">
      <h2 :style="props.inline ? 'font-size:14px' : undefined">{{ $t("patient-tl-title") }} <button class="info" :title="$t('patient-tl-help')" :aria-label="$t('patient-tl-help')">i</button></h2>
    </div>
    <div class="tlfilters" role="group" :aria-label="$t('patient-tl-categories')">
      <label :class="['tlfilter', allChecked ? 'on' : '']"><input ref="allBox" type="checkbox" :checked="allChecked" @change="setCategory('all', ($event.target as HTMLInputElement).checked)"><span>{{ $t("patient-tl-all") }}</span><span class="tlcount">{{ all.length }}</span></label>
      <label v-for="f in filters" :key="f.id" :class="['tlfilter', f.checked ? 'on' : '']"><input type="checkbox" :checked="f.checked" @change="setCategory(f.id, ($event.target as HTMLInputElement).checked)"><CatIcon :k="f.id" /><span>{{ catLabel(f.id) }}</span><span class="tlcount">{{ f.count }}</span></label>
    </div>
    <div class="tlstatus" role="status">{{ $t("patient-tl-status", { shown: cards.length, all: all.length, cats: shownCats, total }) }}</div>
    <div v-if="cards.length" ref="bar" class="tlbar" tabindex="0" role="region" :aria-label="$t('patient-tl-region')">
      <div class="tltrack">
        <template v-for="r in rows" :key="r.e.i">
          <div v-if="r.year !== undefined" class="tlyear"><span>{{ r.year ?? $t("patient-tl-undated") }}</span></div>
          <button type="button" :class="['ev', `kind-${r.e.category}`, r.e.status === 'planned' ? 'planned' : '']" :aria-pressed="view.selTl === r.e.i" @click="openEvent(r.e.i)">
            <span class="date"><span lang="cs">{{ r.e.date || $t("patient-tl-undated") }}</span><template v-if="r.e.status === 'planned'">{{ $t("patient-tl-planned") }}</template></span><span class="pin"><CatIcon :k="r.e.category" /></span> <span class="category">{{ catLabel(r.e.category) }}</span><span class="t"><span lang="cs">{{ r.e.title_cs }}</span><template v-if="r.note">{{ " " }}<span class="mk obs" :title="r.note" :aria-label="r.note" lang="cs">i</span></template></span><span class="d" lang="cs">{{ r.e.text_cs }}</span>
          </button>
        </template>
      </div>
    </div>
    <p v-else class="muted small">{{ view.tlExcluded.size === total ? $t("patient-tl-all-hidden") : $t("patient-tl-none-in-selection") }}</p>
  </section>
</template>
