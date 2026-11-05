<script setup lang="ts">
// The side panel of a running MDT: the patient at a glance while the radiologist shows images in PACS, so a long meeting
// stays easy to follow. It shows age, PS, the question, exams, treatment and what may bear on treatment, each from the
// extraction with its source. A part the extraction does not hold shows "-" with the gap wording, never "none".
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useFluent } from "fluent-vue";
import { dayAgenda, DEMO_TODAY } from "@codebridge/domain/calendar";
import { nrOf } from "@codebridge/domain/case-data";
import { linkProse, topAlerts } from "@codebridge/domain/case-view";
import { runningSession } from "@codebridge/domain/discussion";
import { mdtPanelOf, type PanelEvent, type PanelFact } from "@codebridge/domain/mdt-panel";
import { surnameFirst } from "@codebridge/domain/names";
import { ageOf } from "@codebridge/domain/patient-list";
import { usePatient } from "../../composables/usePatient";
import { useDiscussionStore } from "../../stores/discussion";
import { useMdtPanelStore } from "../../stores/mdtPanel";
import { usePatientsStore } from "../../stores/patients";
import { useWorkflowStore } from "../../stores/workflow";
import { toast } from "../../lib/toast";
import AlertRow from "../patient/AlertRow.vue";
import Gap from "../patient/Gap.vue";
import Marks from "../patient/Marks.vue";
import QuestionBox from "../patient/QuestionBox.vue";
import MdtSource from "./MdtSource.vue";
import ModalityChecks from "./ModalityChecks.vue";
import Prose from "../patient/Prose.vue";

const SHORT_LIST = 5;
const SHORT_ALERTS = 3;

const { $t } = useFluent();
const router = useRouter();
const route = useRoute();
const c = usePatient();
const store = useMdtPanelStore();
const patients = usePatientsStore();
const workflow = useWorkflowStore();
const disc = useDiscussionStore();

const state = computed(() => c.entry.value.state);
const processed = computed(() => state.value === "ready" && !!c.cd.value?.record);
const panel = computed(() => mdtPanelOf(c.cd.value));
const factText = (f: PanelFact) => (f.negated ? $t("patient-fact-negated", { text: f.text }) : f.text);
const eventText = (e: PanelEvent) => (e.negated ? $t("patient-fact-negated", { text: e.title }) : e.title);
// The extracted summary leads the panel, then the question (Soňa, 2026-11-05); a case without a brief shows no summary.
const prose = computed(() => linkProse(c.cd.value?.brief?.text_cs, c.cd.value?.brief?.refs));
const age = computed(() => ageOf(c.p.value, DEMO_TODAY));
// The alerts for the MDT question first, then the other open ones, so the count below covers every open alert.
const alerts = computed(() => {
  const t = topAlerts(c.cd.value?.alerts ?? null, c.alertHist.value);
  return [...t.top, ...t.open.filter((f) => !f.relevant)];
});
// The panel is for a glance: the rest of the alerts stay one click away on the patient view's "Upozornění" tab.
const shownAlerts = computed(() => alerts.value.slice(0, SHORT_ALERTS));
const moreAlerts = computed(() => alerts.value.length - shownAlerts.value.length);

const session = computed(() => runningSession(workflow.sessions));
const agenda = computed(() => (session.value ? dayAgenda(patients.rows, session.value.day) : []));
const at = computed(() => agenda.value.findIndex((a) => a.file === c.p.value.file));
const prev = computed(() => agenda.value[at.value - 1] ?? null);
const next = computed(() => agenda.value[at.value + 1] ?? null);
function go(file: string) {
  disc.clearChoice(file);
  void router.push({ name: "patient", params: { nr: nrOf(file), tab: route.params.tab ? String(route.params.tab) : undefined } });
}

const allExams = ref(false);
const allTreatments = ref(false);
const shortList = (list: PanelEvent[] | null, all: boolean) => (list ? (all ? list : list.slice(0, SHORT_LIST)) : null);
const exams = computed(() => shortList(panel.value.exams, allExams.value));
const treatments = computed(() => shortList(panel.value.treatments, allTreatments.value));
watch(() => c.p.value.file, async () => {
  allExams.value = false;
  allTreatments.value = false;
  await nextTick();
  bodyEl.value?.scrollTo(0, 0);
});
const bodyEl = ref<HTMLElement | null>(null);

// No hospital PACS is connected: the button shows where the link goes and says so (CLAUDE.md: stub visibly, do not fake).
const pacsStub = () => toast($t("mdt-panel-pacs-stub"));

// The page makes room for the panel; on a narrow window the panel takes the whole window (base.css).
onMounted(() => document.body.classList.add("mdtp-docked"));
onBeforeUnmount(() => document.body.classList.remove("mdtp-docked"));
</script>

<template>
  <Teleport to="body">
    <aside class="mdtpanel" :aria-label="$t('mdt-panel-label')">
      <div class="mdtp-head">
        <div class="row">
          <button class="btn small" :disabled="!prev" :aria-label="$t('discussion-session-prev')" @click="prev && go(prev.file)">‹</button>
          <span class="muted small">{{ at >= 0 ? $t("mdt-panel-position", { n: at + 1, total: agenda.length }) : "" }}</span>
          <button class="btn small" :disabled="!next" :aria-label="$t('discussion-session-next')" @click="next && go(next.file)">›</button>
          <span class="mdtp-gap" />
          <button class="btn small" @click="store.choose('full')">{{ $t("mdt-panel-whole-window") }}</button>
        </div>
        <h2 class="mdtp-name">{{ surnameFirst(c.p.value) }}</h2>
        <div class="mdtp-meta">
          <span>{{ $t("mdt-panel-age") }}: <b v-if="age">{{ age.n }}</b><Gap v-else /></span>
          <span v-if="processed">{{ $t("mdt-panel-ps") }}:
            <template v-if="panel.ps"><MdtSource :source="panel.ps.source" :text="panel.ps.text" /> <Marks :f="panel.ps.item" /></template>
            <Gap v-else />
          </span>
        </div>
        <button class="btn small" @click="pacsStub">{{ $t("mdt-panel-pacs") }}</button>
      </div>
      <div ref="bodyEl" class="mdtp-body">
        <section v-if="state === 'ready' && prose.parts.length" class="mdtp-sec">
          <h3>{{ $t("mdt-panel-brief") }}</h3>
          <p class="prose" style="margin:0"><Prose :parts="prose.parts" breaks /></p>
        </section>
        <QuestionBox />
        <ModalityChecks v-if="processed" />

        <!-- Not loaded or not processed says so: a "-" here would read as "not in the documentation" (CLAUDE.md). -->
        <p v-if="state === 'error'" class="question missing" role="alert">{{ $t("patient-load-failed") }}</p>
        <p v-else-if="state !== 'ready'" class="muted small" role="status">{{ $t("patient-loading") }}</p>
        <p v-else-if="!processed" class="muted small">{{ $t("mdt-panel-unprocessed") }}</p>
        <template v-else>
          <section class="mdtp-sec">
            <h3>{{ $t("mdt-panel-risks") }}</h3>
            <div class="mdtp-sub">{{ $t("mdt-panel-contraindications") }}</div>
            <ul v-if="panel.contraindications?.length" class="mdtp-list">
              <li v-for="(f, i) in panel.contraindications" :key="i">
                <MdtSource :source="f.source" :text="factText(f)" /> <Marks :f="f.item" />
                <span v-if="f.note" class="muted small" lang="cs"> {{ f.note }}</span>
              </li>
            </ul>
            <Gap v-else />
            <div class="mdtp-sub">{{ $t("mdt-panel-comorbidities") }}</div>
            <ul v-if="panel.comorbidities?.length" class="mdtp-list">
              <li v-for="(f, i) in panel.comorbidities" :key="i">
                <MdtSource :source="f.source" :text="factText(f)" /> <Marks :f="f.item" />
                <span v-if="f.note" class="muted small" lang="cs"> {{ f.note }}</span>
              </li>
            </ul>
            <Gap v-else />
            <div class="mdtp-sub">{{ $t("mdt-panel-allergies") }}</div>
            <ul v-if="panel.allergies?.length" class="mdtp-list">
              <li v-for="(f, i) in panel.allergies" :key="i">
                <MdtSource :source="f.source" :text="factText(f)" /> <Marks :f="f.item" />
                <span v-if="f.note" class="muted small" lang="cs"> {{ f.note }}</span>
              </li>
            </ul>
            <Gap v-else />
          </section>

          <section class="mdtp-sec">
            <h3>{{ $t("mdt-panel-treatment") }}</h3>
            <ul v-if="treatments?.length" class="mdtp-list mdtp-events">
              <li v-for="e in treatments" :key="e.key">
                <span class="muted small" lang="cs">{{ e.date || $t("patient-tl-undated") }}<template v-if="e.planned">{{ $t("patient-tl-planned") }}</template></span>
                <span><MdtSource :source="e.source" :text="eventText(e)" /> <Marks :f="e.item" /></span>
              </li>
            </ul>
            <Gap v-else />
            <button v-if="(panel.treatments?.length ?? 0) > SHORT_LIST" class="linkbtn small" @click="allTreatments = !allTreatments">
              {{ allTreatments ? $t("mdt-panel-show-fewer") : $t("mdt-panel-show-all", { n: panel.treatments?.length ?? 0 }) }}
            </button>
          </section>

          <section class="mdtp-sec">
            <h3>{{ $t("mdt-panel-exams") }}</h3>
            <ul v-if="exams?.length" class="mdtp-list mdtp-events">
              <li v-for="e in exams" :key="e.key">
                <span class="muted small" lang="cs">{{ e.date || $t("patient-tl-undated") }}<template v-if="e.planned">{{ $t("patient-tl-planned") }}</template></span>
                <span><MdtSource :source="e.source" :text="eventText(e)" /> <Marks :f="e.item" /></span>
              </li>
            </ul>
            <Gap v-else />
            <button v-if="(panel.exams?.length ?? 0) > SHORT_LIST" class="linkbtn small" @click="allExams = !allExams">
              {{ allExams ? $t("mdt-panel-show-fewer") : $t("mdt-panel-show-all", { n: panel.exams?.length ?? 0 }) }}
            </button>
          </section>

          <section v-if="alerts.length" class="mdtp-sec">
            <h3>{{ $t("mdt-panel-alerts") }}</h3>
            <div role="list"><AlertRow v-for="f in shownAlerts" :key="f.i" :f="f" compact /></div>
            <p v-if="moreAlerts" class="muted small">{{ $t("mdt-panel-more-alerts", { n: moreAlerts }) }}</p>
          </section>
        </template>
      </div>
    </aside>
  </Teleport>
</template>
