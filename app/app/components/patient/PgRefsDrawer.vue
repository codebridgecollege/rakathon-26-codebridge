<script setup lang="ts">
// The numbered source list of the Prognóza tab,
// like a paper's reference list: each entry names the values it supports and quotes the passage verbatim. It opens
// scrolled to the number the doctor clicked, which is highlighted.
import { nextTick, onMounted, watch } from "vue";
import { useFluent } from "fluent-vue";
import { pgUrl } from "@codebridge/domain/prognosis";
import { useOverlayStore } from "../../stores/overlay";
import { usePrognosisStore, whatText } from "../../stores/prognosis";

const props = defineProps<{ o: { kind: "pgrefs"; hit: number } }>();
const { $t } = useFluent();
const overlay = useOverlayStore();
const pg = usePrognosisStore();

function scrollToHit() {
  void nextTick(() => document.getElementById(`pgref-${props.o.hit}`)?.scrollIntoView?.({ block: "center" }));
}
onMounted(scrollToHit);
watch(() => props.o.hit, scrollToHit);
</script>

<template>
  <div class="scrim" @click="overlay.close()"></div>
  <aside class="drawer" role="dialog" aria-modal="true" :aria-label="$t('patient-pg-refs-label')" style="grid-template-rows: auto minmax(0, 1fr)">
    <header>
      <div>
        <div class="label">{{ $t("patient-pg-title") }}</div>
        <h2 style="margin-top: 4px">{{ $t("patient-pg-refs-title", { n: pg.refs.length }) }}</h2>
      </div>
      <button class="btn small" @click="overlay.close()">{{ $t("patient-pg-close") }}</button>
    </header>
    <div class="pgpanel">
      <ol class="pgrefs">
        <li v-for="(r, i) in pg.refs" :id="`pgref-${i + 1}`" :key="i" :class="i + 1 === o.hit ? 'hit' : ''">
          <span class="n">[{{ i + 1 }}]</span>
          <div>
            <b lang="en">{{ r.study || $t("patient-pg-untitled") }}</b>
            <div class="muted small">{{ r.what.map((w) => whatText($t, w)).join(" · ") }}</div>
            <blockquote v-if="r.quote" lang="en">{{ r.quote }}</blockquote>
            <p v-else class="muted small">{{ $t("patient-pg-refs-no-quote") }}</p>
            <div v-if="r.locator" class="muted small" lang="en">{{ r.locator }}</div>
            <div v-if="r.url">
              <a v-if="pgUrl(r.url)" :href="pgUrl(r.url)" target="_blank" rel="noopener noreferrer">{{ $t("patient-src-open") }}</a><template v-else>{{ $t("patient-src-open") }}</template>
            </div>
          </div>
        </li>
      </ol>
    </div>
  </aside>
</template>
