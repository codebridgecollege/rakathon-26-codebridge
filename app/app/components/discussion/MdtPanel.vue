<script setup lang="ts">
// The side panel of a running MDT: the patient at a glance while the radiologist shows images in PACS, so a long meeting
// stays easy to follow. It fits one screen: age, PS with the values to count with, the summary, the question and the
// course, each from the extraction with its source; the rest opens below. A part the extraction does not hold shows "-"
// with the gap wording, never "none".
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useFluent } from "fluent-vue";
import { abbreviateCs } from "@codebridge/domain/abbreviate";
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
import PanelFlags from "./PanelFlags.vue";
import Prose from "../patient/Prose.vue";

// Rows of the course without "Zobrazit vše", and the summary length past which it folds to a few lines, so the panel fits a screen.
const SHORT_COURSE = 4;
const LONG_BRIEF = 380;

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
const prose = computed(() => {
  const p = linkProse(c.cd.value?.brief?.text_cs, c.cd.value?.brief?.refs);
  return { ...p, parts: p.parts.map((x) => ({ ...x, text: abbreviateCs(x.text) })) };
});
const longBrief = computed(() => prose.value.parts.length > 3 && prose.value.parts.reduce((n, x) => n + x.text.length, 0) > LONG_BRIEF);
const wholeBrief = ref(false);
// Folded, the summary keeps what the diagnosis is and where things stand now: its first and last two sentences. The middle
// is the history, which the course below shows; "…" says something is left out.
const shownBrief = computed(() => {
  const parts = prose.value.parts.filter((x) => x.text.trim());
  return longBrief.value && !wholeBrief.value ? [parts[0]!, { text: " … " }, parts.at(-2)!, { text: " " }, parts.at(-1)!] : prose.value.parts;
});
const age = computed(() => ageOf(c.p.value, DEMO_TODAY));
// The alerts for the MDT question first, then the other open ones, so the count below covers every open alert.
const alerts = computed(() => {
  const t = topAlerts(c.cd.value?.alerts ?? null, c.alertHist.value);
  return [...t.top, ...t.open.filter((f) => !f.relevant)];
});
// A page of another patient is never folded away; the other alerts open below, with their count.
const identityAlerts = computed(() => alerts.value.filter((f) => f.kind === "identity"));
const otherAlerts = computed(() => alerts.value.filter((f) => f.kind !== "identity"));

const session = computed(() => runningSession(workflow.sessions));
const agenda = computed(() => (session.value ? dayAgenda(patients.rows, session.value.day) : []));
const at = computed(() => agenda.value.findIndex((a) => a.file === c.p.value.file));
const prev = computed(() => agenda.value[at.value - 1] ?? null);
const next = computed(() => agenda.value[at.value + 1] ?? null);
function go(file: string) {
  disc.clearChoice(file);
  void router.push({ name: "patient", params: { nr: nrOf(file), tab: route.params.tab ? String(route.params.tab) : undefined } });
}

const allCourse = ref(false);
const course = computed(() => (allCourse.value ? panel.value.course : (panel.value.course?.slice(0, SHORT_COURSE) ?? null)));
watch(() => c.p.value.file, async () => {
  allCourse.value = false;
  wholeBrief.value = false;
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
          <button class="btn small" @click="pacsStub">{{ $t("mdt-panel-pacs") }}</button>
          <button class="btn small" @click="store.choose('full')">{{ $t("mdt-panel-whole-window") }}</button>
        </div>
        <h2 class="mdtp-name">{{ surnameFirst(c.p.value) }} <span class="mdtp-age">{{ $t("mdt-panel-age") }}: <b v-if="age">{{ age.n }}</b><Gap v-else /></span></h2>
        <PanelFlags v-if="processed" />
      </div>
      <div ref="bodyEl" class="mdtp-body">
        <!-- The radiologist shows PACS and nobody scrolls here: the summary, question and course fit the screen, the rest is one click away. -->
        <div v-if="identityAlerts.length" role="list"><AlertRow v-for="f in identityAlerts" :key="f.i" :f="f" compact /></div>
        <section v-if="state === 'ready' && prose.parts.length" class="mdtp-sec">
          <h3>{{ $t("mdt-panel-brief") }}</h3>
          <p class="prose mdtp-brief"><Prose :parts="shownBrief" breaks /></p>
          <button v-if="longBrief" class="linkbtn small" @click="wholeBrief = !wholeBrief">{{ wholeBrief ? $t("mdt-panel-brief-less") : $t("mdt-panel-brief-more") }}</button>
        </section>
        <QuestionBox />

        <!-- Not loaded or not processed says so: a "-" here would read as "not in the documentation" (CLAUDE.md). -->
        <p v-if="state === 'error'" class="question missing" role="alert">{{ $t("patient-load-failed") }}</p>
        <p v-else-if="state !== 'ready'" class="muted small" role="status">{{ $t("patient-loading") }}</p>
        <p v-else-if="!processed" class="muted small">{{ $t("mdt-panel-unprocessed") }}</p>
        <template v-else>
          <section class="mdtp-sec">
            <h3>{{ $t("mdt-panel-course") }}</h3>
            <ul v-if="course?.length" class="mdtp-list mdtp-events">
              <li v-for="e in course" :key="e.key" class="mdtp-row" :title="eventText(e)">
                <span class="muted small" lang="cs">{{ e.date || (e.planned ? "" : $t("patient-tl-undated")) }}<template v-if="e.planned">{{ e.date ? $t("patient-tl-planned") : $t("mdt-panel-planned") }}</template></span>
                <span class="mdtp-two"><MdtSource :source="e.source" :text="abbreviateCs(eventText(e))" /></span>
                <span><Marks :f="e.item" /></span>
              </li>
            </ul>
            <Gap v-else />
            <button v-if="(panel.course?.length ?? 0) > SHORT_COURSE" class="linkbtn small" @click="allCourse = !allCourse">
              {{ allCourse ? $t("mdt-panel-show-fewer") : $t("mdt-panel-show-all", { n: panel.course?.length ?? 0 }) }}
            </button>
          </section>

          <details v-if="otherAlerts.length" class="mdtp-more">
            <summary>{{ $t("mdt-panel-alerts") }} ({{ otherAlerts.length }})</summary>
            <div role="list"><AlertRow v-for="f in otherAlerts" :key="f.i" :f="f" compact /></div>
          </details>

          <details class="mdtp-more">
            <summary>{{ $t("mdt-panel-details") }}</summary>
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
            <div class="mdtp-sub">{{ $t("mdt-panel-exams") }}</div>
            <ul v-if="panel.exams?.length" class="mdtp-list mdtp-events">
              <li v-for="e in panel.exams" :key="e.key">
                <span class="muted small" lang="cs">{{ e.date || $t("patient-tl-undated") }}<template v-if="e.planned">{{ $t("patient-tl-planned") }}</template></span>
                <span><MdtSource :source="e.source" :text="eventText(e)" /> <Marks :f="e.item" /></span>
              </li>
            </ul>
            <Gap v-else />
          </details>
        </template>
      </div>
    </aside>
  </Teleport>
</template>
