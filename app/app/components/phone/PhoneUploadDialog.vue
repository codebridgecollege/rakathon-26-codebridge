<script setup lang="ts">
// The "Nahrát z telefonu" dialog, in its own layer (#phoneup) above the other dialogs,
// so it opens over "Nový pacient" without closing it; Escape and "Zavřít" close only it. The QR library
// (qrcode-generator, pinned) is loaded only when a code is shown. The token is only inside the QR image, never text.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useFluent } from "fluent-vue";
import { usePhoneStore } from "../../stores/phone";
import { useDialogFocus } from "../../lib/dialog";
import { clock, sizeMsg } from "../../lib/format";
import { useMsg } from "../../lib/msg";
import UploadList from "../uploads/UploadList.vue";
import type { UploadListItem } from "../uploads/types";

const { $t } = useFluent();
const fmt = useMsg();
const phone = usePhoneStore();
const ph = computed(() => phone.current);
const lang = () => document.documentElement.lang || "cs";

const modal = ref<HTMLElement | null>(null);
const isOpen = computed(() => !!ph.value);
const { onKeydown } = useDialogFocus(modal, isOpen);

// The SVG markup from the QR library for the session's link; built in the browser, never sent anywhere.
const qrSvg = shallowRef("");
watch(
  () => (ph.value?.state === "open" ? ph.value.url : null),
  async (url) => {
    qrSvg.value = "";
    if (!url) return;
    const { default: qrcode } = await import("qrcode-generator");
    if (ph.value?.url !== url) return;
    // Error correction M keeps the code small enough for a quick scan at arm's length; the URL is about 70 characters.
    // The white border is four modules wide, as the QR standard asks, so phone cameras find it on a busy screen.
    const q = qrcode(0, "M");
    q.addData(url);
    q.make();
    // alt names the image (role="img" with a description); the library supports it, its type declaration omits it.
    const opts = { cellSize: 4, margin: 16, scalable: true, alt: $t("phone-qr-alt") };
    qrSvg.value = q.createSvgTag(opts as { cellSize: number; margin: number; scalable: boolean });
  },
  { immediate: true },
);

const items = computed<UploadListItem[]>(() =>
  (ph.value?.docs ?? []).map((d) => ({ key: d.id, name: d.name, meta: fmt(sizeMsg(d.size || 0, lang())), chip: { text: $t("upload-done"), cls: "st-done" } })),
);

// Escape closes this layer first; the dialog under it ignores an Escape that was handled here.
function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || !ph.value) return;
  e.preventDefault();
  phone.close();
}
onMounted(() => document.addEventListener("keydown", onEscape));
onBeforeUnmount(() => document.removeEventListener("keydown", onEscape));
</script>

<template>
  <Teleport defer to="#phoneup">
    <template v-if="ph">
      <div class="scrim" @click="phone.close()" />
      <div ref="modal" class="modal" role="dialog" aria-modal="true" :aria-label="$t('phone-title')" tabindex="-1" style="outline:none" @keydown="onKeydown">
        <div class="row spread">
          <h2>{{ $t("phone-heading", { caseId: ph.caseId }) }}</h2>
          <button class="btn small" @click="phone.close()">{{ $t("phone-close") }}</button>
        </div>
        <p v-if="ph.state === 'loading'" class="muted" role="status" style="margin:0">{{ $t("phone-preparing") }}</p>
        <template v-else-if="ph.state === 'open'">
          <!-- eslint-disable-next-line vue/no-v-html -- the QR library's SVG; the URL in it is escaped by the library -->
          <div class="phoneqr" v-html="qrSvg" />
          <p style="margin:0">{{ $t("phone-scan") }}</p>
          <p class="muted small" style="margin:0">{{ $t("phone-validity", { time: clock(ph.expires ?? 0, lang()), caseId: ph.caseId }) }}</p>
        </template>
        <template v-else>
          <p style="margin:0">{{ ph.state === "full" ? $t("phone-full") : $t("phone-expired") }}</p>
          <div class="row"><button class="btn" @click="phone.renew()">{{ $t("phone-new-code") }}</button></div>
        </template>
        <div v-if="ph.docs.length">
          <span class="label">{{ $t("phone-received", { n: ph.docs.length }) }}</span>
          <UploadList :items="items" />
        </div>
        <p v-else-if="ph.state === 'open'" class="muted small" style="margin:0" role="status">{{ $t("phone-waiting") }}</p>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" @click="phone.close()">{{ $t("phone-done") }}</button></div>
      </div>
    </template>
  </Teleport>
</template>
