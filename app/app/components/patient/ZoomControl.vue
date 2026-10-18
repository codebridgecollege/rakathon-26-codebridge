<script lang="ts">
// "fit" follows the drawer width; a number is a percentage of the page image's native size (zoomCtl() in the template).
export const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;

// The next step up or down from the current percentage; null at either end. The 1 % margin keeps a fit width that
// happens to sit just above a step from landing on that same step.
export function nextZoom(cur: number, dir: number): number | null {
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 1) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 1);
  return next ?? null;
}
</script>

<script setup lang="ts">
import { useFluent } from "fluent-vue";

const props = defineProps<{ zoom: "fit" | number }>();
const emit = defineEmits<{ step: [dir: number]; fit: [] }>();
const { $t } = useFluent();
const isFit = () => typeof props.zoom !== "number";
</script>

<template>
  <div class="zoomctl" role="group" :aria-label="$t('patient-src-zoom')">
    <button :title="$t('patient-src-zoom-out-tooltip')" :aria-label="$t('patient-src-zoom-out')" :disabled="!isFit() && (zoom as number) <= ZOOM_STEPS[0]" @click="emit('step', -1)">−</button>
    <span class="zlvl" aria-live="polite">{{ isFit() ? $t("patient-src-zoom-fit") : $t("patient-src-zoom-pct", { z: zoom }) }}</span>
    <button :title="$t('patient-src-zoom-in-tooltip')" :aria-label="$t('patient-src-zoom-in')" :disabled="!isFit() && (zoom as number) >= ZOOM_STEPS[ZOOM_STEPS.length - 1]!" @click="emit('step', 1)">+</button>
    <button :title="$t('patient-src-zoom-reset-tooltip')" :aria-label="$t('patient-src-zoom-reset')" :disabled="isFit()" @click="emit('fit')">⟲</button>
  </div>
</template>
