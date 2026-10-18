<script setup lang="ts">
// The "Nový pacient" dialog (renderOverlay() kind "new" in the old page), mounted once in app.vue and opened through
// useNewPatient().open(). Same markup and classes as the old page, so the copied CSS styles it unchanged. The logic
// and the requests are in stores/intake.ts.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import { surnameFirst } from "@codebridge/domain/names";
import { useIntakeStore, type FieldId } from "../../stores/intake";
import { usePhoneStore } from "../../stores/phone";
import { useDialogFocus } from "../../lib/dialog";
import { sizeMsg } from "../../lib/format";
import { useMsg } from "../../lib/msg";
import UploadZone from "../uploads/UploadZone.vue";
import UploadList from "../uploads/UploadList.vue";
import PhoneUploadButton from "../phone/PhoneUploadButton.vue";
import type { UploadListItem } from "../uploads/types";

const { $t } = useFluent();
const fmt = useMsg();
const s = useIntakeStore();
const phone = usePhoneStore();
const lang = () => document.documentElement.lang || "cs";

const modal = ref<HTMLElement | null>(null);
const isOpen = computed(() => s.isOpen);
const { onKeydown } = useDialogFocus(modal, isOpen);
// A step change removes the button that had the focus; the focus goes back to the dialog, so Tab stays inside it.
watch(
  () => s.step,
  async () => {
    await nextTick();
    if (modal.value && !modal.value.contains(document.activeElement)) modal.value.focus();
  },
);

// The FNO form "Konzultace pacienta": only identity and the GDPR consent are required (round 20). The referring
// doctor's fields carry autocomplete tokens; the patient's are "off", so the browser never offers the doctor's own
// name for the patient.
const FIELDS = computed(() => [
  { id: "nf0", label: $t("intake-field-first-name"), type: "text", required: true, hint: "", ac: "off" },
  { id: "nf1", label: $t("intake-field-last-name"), type: "text", required: true, hint: "", ac: "off" },
  { id: "nf2", label: $t("intake-field-birth-number"), type: "text", required: true, hint: $t("intake-field-birth-number-hint"), ac: "off" },
  { id: "nf3", label: $t("intake-field-insurer"), type: "select", required: false, hint: "", ac: "off" },
  { id: "nf4", label: $t("intake-field-owner"), type: "text", required: false, hint: "", ac: "name" },
  { id: "nf5", label: $t("intake-field-dept"), type: "text", required: false, hint: "", ac: "organization" },
  { id: "nf6", label: $t("intake-field-email"), type: "email", required: false, hint: "", ac: "email" },
  { id: "nf7", label: $t("intake-field-phone"), type: "tel", required: false, hint: "", ac: "tel" },
] as const);
// Czech health insurers' codes; the list is Czech only (I18N.md, "What stays Czech-only on purpose").
const INSURERS = ["111", "201", "205", "207", "209", "211", "213"];
// An example of the expected input, not text to translate.
const FHIR_PLACEHOLDER = '{"resourceType": "Bundle", ...}';
const STEPS = computed(() => [$t("intake-step-referral"), $t("intake-step-documents"), $t("intake-step-processing")]);
const STAGES = computed(() => [$t("intake-stage-readability"), $t("intake-stage-pseudonymization"), $t("intake-stage-extraction"), $t("intake-stage-completeness")]);

const errOf = (id: FieldId) => s.errs[id];

async function onNext() {
  const first = await s.next();
  // The first refused field takes the focus, as in the old page.
  if (first) {
    await nextTick();
    document.getElementById(first)?.focus();
  }
}

async function onFhirFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (f) await s.fhirImport(await f.text());
}

const fileItems = computed<UploadListItem[]>(() =>
  s.files.map((f) => ({
    key: f.key,
    name: f.name,
    // The kind of a recognised synthetic document comes from the server (by its hash), never guessed from the name.
    meta: [fmt(sizeMsg(f.size, lang())), f.doc?.type_cs ? ` · ${f.doc.type_cs}` : "", f.doc?.source === "phone" ? ` · ${$t("upload-from-phone")}` : ""].join(""),
    chip: { text: $t("upload-done"), cls: "st-done" },
    removable: true,
    // A document of another patient (by the server's fixture registry) is flagged on its row, never blocked.
    warnings: f.doc?.identity === "conflicts" && f.doc.identity_cs ? [f.doc.identity_cs] : [],
  })),
);

const stageClass = (i: number) => (i < s.progress ? "" : i === s.progress ? "run" : "wait");
const stageMark = (i: number) => (i < s.progress ? "✓" : i === s.progress ? "…" : "○");

// Escape closes the dialog, unless the phone dialog above it took the key.
function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape" || !s.isOpen || e.defaultPrevented || phone.current) return;
  s.close();
}
onMounted(() => document.addEventListener("keydown", onEscape));
onBeforeUnmount(() => document.removeEventListener("keydown", onEscape));
</script>

<template>
  <Teleport defer to="#overlay">
    <template v-if="s.isOpen">
      <div class="scrim" @click="s.close()" />
      <div ref="modal" class="modal" role="dialog" aria-modal="true" :aria-label="$t('intake-title')" tabindex="-1" style="outline:none" @keydown="onKeydown">
        <div class="row spread">
          <h2>{{ $t("intake-title") }}</h2>
          <button class="btn small" @click="s.close()">{{ $t("intake-close") }}</button>
        </div>
        <div class="stepper">
          <span v-for="(t, i) in STEPS" :key="i" :class="{ on: i === s.step }" :aria-current="i === s.step ? 'step' : undefined">{{ $t("intake-step", { n: i + 1, title: t }) }}</span>
        </div>

        <template v-if="s.step === 0">
          <div class="row spread">
            <p class="muted small" style="margin:0">{{ $t("intake-form-intro") }}</p>
            <button v-if="!s.fhirOpen" class="btn" @click="s.setFhirOpen(true)">{{ $t("intake-fhir-open") }}</button>
          </div>
          <div v-if="s.fhirOpen" class="fhirimp">
            <label class="label" for="nffhir">{{ $t("intake-fhir-label") }}</label>
            <textarea id="nffhir" v-model="s.fhirText" class="input" autocomplete="off" spellcheck="false" :placeholder="FHIR_PLACEHOLDER" />
            <div class="row">
              <label class="btn small">{{ $t("intake-fhir-pick-file") }}<input type="file" accept=".json,application/fhir+json,application/json" hidden @change="onFhirFile"></label>
              <button class="linkbtn small" @click="s.fhirSample()">{{ $t("intake-fhir-sample") }}</button><span style="flex:1" />
              <button class="btn small" @click="s.setFhirOpen(false)">{{ $t("intake-fhir-cancel") }}</button>
              <button class="btn small primary" @click="s.fhirImport(s.fhirText)">{{ $t("intake-fhir-load") }}</button>
            </div>
            <p v-if="s.fhirMsg" class="small" style="margin:0" role="status">{{ fmt(s.fhirMsg) }}</p>
          </div>
          <p v-else-if="s.fhirMsg" class="small" style="margin:0" role="status">{{ fmt(s.fhirMsg) }}</p>
          <div class="formgrid">
            <label v-for="f in FIELDS" :key="f.id">
              {{ f.label }}{{ f.required ? " *" : "" }}<template v-if="f.hint">{{ " " }}<span class="fhint">{{ f.hint }}</span></template>
              <select v-if="f.type === 'select'" :id="f.id" v-model="s.form.nf3" class="input" :autocomplete="f.ac">
                <option value="">{{ $t("intake-insurer-none") }}</option>
                <option v-for="v in INSURERS" :key="v">{{ v }}</option>
              </select>
              <input
                v-else
                :id="f.id"
                v-model="s.form[f.id]"
                class="input"
                :type="f.type"
                :autocomplete="f.ac"
                :required="f.required"
                :aria-invalid="errOf(f.id) ? 'true' : undefined"
                :aria-describedby="errOf(f.id) ? `${f.id}-err` : undefined"
              >
              <span v-if="errOf(f.id)" :id="`${f.id}-err`" class="ferr">{{ fmt(errOf(f.id)) }}</span>
              <i18n v-if="f.id === 'nf2' && (s.dupRow || s.dupId)" path="intake-duplicate" tag="span" class="fwarn" role="alert">
                <template #existing>
                  <button v-if="s.dupRow" type="button" class="linkbtn" @click="s.openDuplicate()">{{ surnameFirst(s.dupRow) }}, {{ s.dupRow.id }}</button>
                  <template v-else>{{ s.dupId }}</template>
                </template>
                <template #override>
                  <button type="button" class="btn small" @click="s.confirmDuplicate()">{{ $t("intake-duplicate-override") }}</button>
                </template>
              </i18n>
            </label>
            <label class="full">{{ $t("intake-field-anamnesis") }} <span class="fhint">{{ $t("intake-field-anamnesis-hint") }}</span><textarea id="nfa" v-model="s.form.nfa" class="input" autocomplete="off" /></label>
            <label class="full">{{ $t("intake-field-question") }} <span class="fhint">{{ $t("intake-field-question-hint") }}</span><textarea id="nfq" v-model="s.form.nfq" class="input" autocomplete="off" style="min-height:60px" /></label>
            <div class="full">
              <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input
                id="nfg"
                v-model="s.form.nfg"
                type="checkbox"
                :aria-invalid="errOf('nfg') ? 'true' : undefined"
                :aria-describedby="errOf('nfg') ? 'nfg-err' : undefined"
              > {{ $t("intake-consent") }} *</label>
              <span v-if="errOf('nfg')" id="nfg-err" class="ferr">{{ fmt(errOf("nfg")) }}</span>
            </div>
          </div>
          <div class="row" style="justify-content:flex-end"><button class="btn primary" @click="onNext">{{ $t("intake-continue") }}</button></div>
        </template>

        <template v-else-if="s.step === 1">
          <UploadZone
            :title="$t('intake-docs-zone-title')"
            :hint="$t('intake-docs-zone-hint')"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.odt,.zip,application/pdf"
            zone-style="margin:0"
            @files="s.addFiles"
          />
          <PhoneUploadButton v-if="s.caseId" target="intake" :case-id="s.caseId" />
          <UploadList v-if="fileItems.length" :items="fileItems" @remove="(k) => s.removeFile(Number(k))" />
          <template v-if="s.hint">
            <p v-if="!s.hint.nameOk" class="fwarn" role="alert" style="margin:0">{{ $t("intake-demo-name-mismatch", { name: s.hint.demo.name }) }}</p>
            <p v-else-if="s.hint.exists" class="fwarn" role="alert" style="margin:0">{{ $t("intake-demo-exists", { name: s.hint.demo.name }) }}</p>
            <i18n
              v-else-if="s.hint.missing.length"
              :path="s.hint.have.length ? 'intake-demo-missing' : 'intake-demo-upload'"
              :args="{ missing: s.hint.missing.length, total: s.hint.demo.uploads.length, folder: s.hint.demo.folder }"
              tag="p"
              class="muted small"
              style="margin:0"
            >
              <template #zip><a :href="`/ukazka/${s.hint.demo.zip}-dokumenty.zip`" download>{{ $t("intake-demo-zip") }}</a></template>
            </i18n>
          </template>
          <div class="row" style="justify-content:flex-end">
            <button class="btn" @click="s.back()">{{ $t("intake-back") }}</button>
            <button class="btn primary" :disabled="!s.files.length" @click="onNext">{{ $t("intake-process") }}</button>
          </div>
        </template>

        <template v-else>
          <ul class="pipeline">
            <li v-for="(t, i) in STAGES" :key="i" :class="stageClass(i)">{{ stageMark(i) }} {{ t }}</li>
          </ul>
          <p class="small" style="margin:0">{{ $t("intake-pseudonymization-note") }}</p>
          <template v-if="s.done">
            <p class="small" style="margin:0" role="status">
              <b>{{ $t("intake-done") }}</b> {{ s.prepared && s.hint ? $t("intake-done-prepared", { docs: s.hint.demo.uploads.length, pages: s.hint.demo.pages, gaps: s.hint.demo.gaps }) : $t("intake-done-listed") }}
            </p>
            <div class="row" style="justify-content:flex-end">
              <button class="btn primary" :disabled="s.busy" @click="s.complete()">{{ s.busy ? $t("intake-saving") : $t("intake-add") }}</button>
            </div>
          </template>
        </template>
      </div>
    </template>
  </Teleport>
</template>
