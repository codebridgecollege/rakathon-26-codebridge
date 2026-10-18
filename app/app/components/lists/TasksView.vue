<script setup lang="ts">
// Screen S-6, Moje úlohy: the user's tasks, all tasks,
// and the coordinator's "Úlohy po MDT" across all cases with the drafts the assistant made from approved conclusions.
// A drafted task becomes a task only when a doctor confirms it; everyone else sees it read-only. The digest e-mail
// carries a count and a link, never patient data.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import type { Task } from "@codebridge/api-client";
import { mdtTaskGroups, myTasks, waitingCount } from "@codebridge/domain/task-list";
import { surnameOf } from "@codebridge/domain/patient-list";
import { useApi } from "../../lib/api";
import { caseRoute, suggestionsOf, type Suggestion } from "../../lib/lists";
import { toast } from "../../lib/toast";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useListText } from "../../composables/useListText";
import { useWrite } from "../../composables/useWrite";
import { usePatientsStore } from "../../stores/patients";
import { useSessionStore } from "../../stores/session";
import { useStaffStore } from "../../stores/staff";
import { useWorkflowStore } from "../../stores/workflow";
import { useListViewStore, type TaskScope } from "../../stores/listView";
import MailCard from "./MailCard.vue";

const { $t } = useFluent();
const router = useRouter();
const me = useCurrentUser();
const text = useListText();
const { run, refused } = useWrite();
const patients = usePatientsStore();
const session = useSessionStore();
const staff = useStaffStore();
const workflow = useWorkflowStore();
const v = useListViewStore();

const sugg = computed(() => suggestionsOf(workflow.cases));
const list = computed(() =>
  v.taskScope === "all" ? workflow.tasks : myTasks(workflow.tasks, me.name.value, staff.coord?.name ?? null, (f) => patients.byFile(f)?.owner),
);
const open = computed(() => list.value.filter((t) => !t.done));
const done = computed(() => list.value.filter((t) => t.done));
const groups = computed(() => mdtTaskGroups(workflow.tasks, sugg.value, (f) => patients.byFile(f)));
const waiting = computed(() => waitingCount(workflow.tasks, sugg.value));

const scopes: { key: TaskScope; id: string }[] = [
  { key: "mine", id: "tasks-scope-mine" },
  { key: "all", id: "tasks-scope-all" },
  { key: "mdt", id: "tasks-scope-mdt" },
];

const caseIdOf = (t: Task) => patients.byFile(t.pid)?.id ?? t.case_id;
function openCase(file: string) {
  void router.push(caseRoute(file));
}

// Done is shown at once and put back when the server refuses.
async function toggleDone(t: Task, ev: Event) {
  const box = ev.target as HTMLInputElement;
  if (!me.canRunCases.value) {
    box.checked = t.done;
    return;
  }
  const was = t.done;
  t.done = box.checked;
  try {
    const r = await useApi().patchTask(t.id, { done: t.done, expected_done: was });
    session.applyState(r.state);
  } catch (e) {
    const cur = workflow.tasks.find((x) => String(x.id) === String(t.id));
    if (cur) cur.done = was;
    refused(e);
  }
}

// Only a doctor confirms or dismisses a draft; the buttons show for doctors only and this repeats the rule.
async function decide(x: Suggestion, accept: boolean) {
  if (x.state !== "draft" || !me.isDoctor.value) return;
  const api = useApi();
  await run(() => (accept ? api.confirmSuggestion(x.id) : api.dismissSuggestion(x.id)), {
    busy: `sugg:${x.id}`,
    onOk: () => toast(accept ? $t("tasks-sugg-confirmed") : $t("tasks-sugg-dismissed")),
  });
}

async function sendDigest() {
  if (!me.canRunCases.value) return;
  await run(() => useApi().sendDigest({}), { busy: "digest", onOk: () => toast($t("tasks-digest-sent")) });
}

function onDoneToggle(ev: Event) {
  v.doneOpen = (ev.target as HTMLDetailsElement).open;
}
</script>

<template>
  <div class="page">
    <div class="pagehead">
      <div><h1>{{ $t("tasks-title") }}</h1><div class="muted small">{{ $t("tasks-subtitle", { user: me.name.value }) }}</div></div>
      <span class="seg" role="group" :aria-label="$t('tasks-scope-label')">
        <button v-for="s in scopes" :key="s.key" :aria-pressed="v.taskScope === s.key" @click="v.taskScope = s.key">{{ $t(s.id) }}</button>
      </span>
    </div>
    <div class="grid2">
      <section v-if="v.taskScope === 'mdt'" class="card">
        <div class="head">
          <h2>{{ $t("tasks-mdt-title") }}</h2>
          <span class="row"><span class="muted small">{{ $t("tasks-mdt-by-patient") }}</span><button class="btn small primary" @click="sendDigest">{{ $t("tasks-digest-send") }}</button></span>
        </div>
        <div v-for="g in groups" :key="g.patient.file" class="tgrp">
          <div class="row spread" style="padding:10px 0 4px;border-bottom:1px solid var(--line-strong)"><b>{{ $t("tasks-group-title", { id: g.patient.id, surname: surnameOf(g.patient) }) }}</b><button class="btn small" @click="openCase(g.patient.file)">{{ $t("tasks-open-case") }}</button></div>
          <div class="scroll">
            <table class="tbl dense">
              <thead><tr><th>{{ $t("tasks-col-task") }}</th><th>{{ $t("tasks-col-state") }}</th><th>{{ $t("tasks-col-who") }}</th><th>{{ $t("tasks-col-due") }}</th></tr></thead>
              <tbody>
                <tr v-for="t in g.tasks" :key="`t${t.id}`">
                  <td>{{ t.text }}<span v-if="t.confirmedBy" class="note">{{ $t("tasks-from-draft", { name: t.confirmedBy }) }}</span></td>
                  <td><span v-if="t.done" class="chip st-done">{{ $t("tasks-state-done") }}</span><span v-else class="chip st-scheduled">{{ $t("tasks-state-open") }}</span></td>
                  <td>{{ t.who }}</td>
                  <td class="nw">{{ t.due ? text.date(t.due) : $t("tasks-due-none") }}<span v-if="t.due && text.dueLabel(t)" class="note">{{ text.dueLabel(t) }}</span></td>
                </tr>
                <tr v-for="x in g.drafts" :key="`s${x.id}`">
                  <td>{{ x.text }}<span class="note">{{ $t("tasks-from-conclusion", { quote: x.quote ?? "" }) }}</span></td>
                  <td><span class="chip plain k-unclear">{{ $t("tasks-draft-chip") }}</span></td>
                  <td>{{ x.who }}</td>
                  <td class="nw">
                    {{ x.due ? text.date(x.due) : $t("tasks-due-none") }}<span v-if="x.due && text.dueLabel(x)" class="note">{{ text.dueLabel(x) }}</span><span v-if="x.timing" class="note">{{ $t("tasks-timing-in-conclusion", { timing: x.timing }) }}</span>
                    <div v-if="me.isDoctor.value" class="row" style="gap:4px;margin-top:4px"><button class="btn small primary" @click="decide(x, true)">{{ $t("tasks-sugg-confirm") }}</button><button class="btn small" @click="decide(x, false)">{{ $t("tasks-sugg-dismiss") }}</button></div>
                    <span v-else class="note"><b>{{ $t("tasks-wait-doctor") }}</b></span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-if="!groups.length" class="muted">{{ $t("tasks-mdt-none") }}</p>
        <p class="muted small" style="margin:10px 0 0">{{ $t("tasks-mdt-mail-note", { sentence: $t("tasks-waiting", { n: waiting }) }) }}</p>
      </section>
      <section v-else class="card">
        <div class="head"><h2>{{ $t("tasks-list-title") }}</h2><span class="muted small">{{ $t("tasks-open-count", { n: open.length }) }}</span></div>
        <template v-if="list.length">
          <div v-for="t in open" :key="t.id" class="trow">
            <input type="checkbox" :checked="t.done" :aria-label="$t('tasks-done')" @change="toggleDone(t, $event)">
            <div><div class="tt"><b>{{ t.text }}</b></div><div class="muted small">{{ $t("tasks-row-meta", { id: caseIdOf(t), who: t.who, due: t.due ? $t("tasks-due-until", { due: text.dueText(t) }) : $t("tasks-due-none") }) }}</div></div>
            <button class="btn small" @click="openCase(t.pid)">{{ $t("tasks-open-case") }}</button>
          </div>
          <p v-if="!open.length" class="muted small" style="margin:0">{{ $t("tasks-no-open") }}</p>
        </template>
        <p v-else class="muted">{{ v.taskScope === "mine" ? $t("tasks-empty-mine", { user: me.name.value }) : $t("tasks-empty-all") }}</p>
        <details v-if="done.length" class="donegrp" :open="v.doneOpen" @toggle="onDoneToggle">
          <summary>{{ $t("tasks-done-group", { n: done.length }) }}</summary>
          <div v-for="t in done" :key="t.id" class="trow done">
            <input type="checkbox" :checked="t.done" :aria-label="$t('tasks-done')" @change="toggleDone(t, $event)">
            <div><div class="tt"><b>{{ t.text }}</b></div><div class="muted small">{{ $t("tasks-row-meta", { id: caseIdOf(t), who: t.who, due: t.due ? $t("tasks-due-until", { due: text.dueText(t) }) : $t("tasks-due-none") }) }}</div></div>
            <button class="btn small" @click="openCase(t.pid)">{{ $t("tasks-open-case") }}</button>
          </div>
        </details>
      </section>
      <MailCard />
    </div>
  </div>
</template>
