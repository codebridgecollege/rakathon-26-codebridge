<script setup lang="ts">
// "Návrh úloh ze schváleného závěru". After approval the assistant
// drafts tasks from the conclusion's text; each draft quotes its clause and becomes a task only when a doctor confirms
// it. Everyone else sees the drafts read-only, waiting for a doctor.
import { computed } from "vue";
import { useFluent } from "fluent-vue";
import { usePatient } from "../../composables/usePatient";
import { useListText } from "../../composables/useListText";
import { useStaffStore } from "../../stores/staff";
import { useApi } from "../../lib/api";
import { caseWrite, refused } from "../../lib/writes";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../lib/toast";
import { fmtWhen } from "../../lib/dates";
import type { Suggestion } from "../../lib/lists";

const { $t } = useFluent();
const c = usePatient();
const text = useListText();
const staff = useStaffStore();

// A change of a draft's fields still on its way, per draft: a confirmation right after an edit waits for it and never
// confirms the old values. Shared by every mount of the box.
const pending = PENDING;

const xs = computed(() => (c.wf.value.sugg ?? []) as unknown as Suggestion[]);
const owners = computed(() => [staff.coord?.name ?? "", c.p.value.owner].filter((v, i, a) => !!v && a.indexOf(v) === i));
const can = computed(() => c.isDoctor.value);

// Shown at once; a refusal puts the stored value back.
function edit(x: Suggestion, f: "who" | "due", e: Event) {
  if (x.state !== "draft" || !can.value) return;
  const value = (e.target as HTMLInputElement).value;
  const before = { [f]: x[f], dueSrc: x.dueSrc, dueBy: x.dueBy };
  Object.assign(x, { [f]: value });
  if (f === "due") Object.assign(x, { dueSrc: value ? "manual" : "none", dueBy: c.userName.value });
  const id = x.id;
  pending[id] = (pending[id] ?? Promise.resolve()).then(() =>
    useApi()
      .patchSuggestion(id, { [f]: value })
      .then((r) => useSessionStore().applyState(r.state))
      .catch((err) => {
        Object.assign(x, before);
        refused($t, err);
      }),
  );
}

function decide(x: Suggestion, accept: boolean) {
  // The buttons are rendered only for doctors; this guard repeats the rule for any other path here.
  if (x.state !== "draft" || !can.value) return;
  const id = x.id;
  void (pending[id] ?? Promise.resolve()).then(() => {
    const y = xs.value.find((z) => String(z.id) === String(id));
    if (!y || y.state !== "draft") return;
    return caseWrite($t, () => (accept ? useApi().confirmSuggestion(id) : useApi().dismissSuggestion(id)), {
      busyKey: `sugg:${id}`,
      onOk: () => toast(accept ? $t("tasks-sugg-confirmed") : $t("tasks-sugg-dismissed")),
    });
  });
}
const dueOrNone = (x: Suggestion) => (x.due ? $t("discussion-sugg-due-on", { due: text.dueText(x) }) : $t("tasks-due-none"));
</script>

<script lang="ts">
const PENDING: Record<number, Promise<unknown>> = {};
</script>

<template>
  <div v-if="xs.length" class="sub suggbox">
    <div class="head"><h3>{{ $t("discussion-sugg-title") }}</h3><span class="chip plain k-unclear">{{ $t("discussion-sugg-chip") }}</span></div>
    <ul class="hist">
      <template v-for="x in xs" :key="x.id">
        <li v-if="x.state === 'draft'" class="sugg">
          <span class="chip plain k-unclear">{{ $t("discussion-sugg-draft") }}</span> <b lang="cs">{{ x.text }}</b>
          <span class="note" lang="cs">{{ $t("tasks-from-conclusion", { quote: x.quote ?? "" }) }}</span>
          <template v-if="can">
            <div class="row" style="margin-top:6px">
              <select class="input" style="width:auto" :value="x.who" @change="edit(x, 'who', $event)"><option v-for="o in owners" :key="o" :value="o">{{ o }}</option></select>
              <input class="input" type="date" style="width:auto" :aria-label="$t('discussion-sugg-due')" :value="x.due" @change="edit(x, 'due', $event)">
              <button class="btn small primary" @click="decide(x, true)">{{ $t("tasks-sugg-confirm") }}</button><button class="btn small" @click="decide(x, false)">{{ $t("tasks-sugg-dismiss") }}</button>
            </div>
            <span v-if="x.timing" class="note" lang="cs">{{ $t("discussion-sugg-timing", { timing: x.timing }) }}</span><span v-if="text.dueLabel(x)" class="note">{{ text.dueLabel(x) }}</span>
          </template>
          <template v-else>
            <span class="note">{{ $t("discussion-sugg-who", { who: x.who }) }} · {{ x.due ? $t("discussion-sugg-due-text", { due: text.dueText(x) }) : $t("tasks-due-none") }}<template v-if="x.timing"> · <span lang="cs">{{ $t("tasks-timing-in-conclusion", { timing: x.timing }) }}</span></template></span>
            <span class="note"><b>{{ $t("tasks-wait-doctor") }}</b></span>
          </template>
        </li>
        <li v-else :class="['small', x.state !== 'confirmed' ? 'old' : '']">
          <b lang="cs">{{ x.text }}</b><br>
          <template v-if="x.state === 'confirmed'">{{ $t("discussion-sugg-confirmed", { by: x.by ?? "", when: fmtWhen(x.when), who: x.who, due: dueOrNone(x) }) }}</template>
          <template v-else-if="x.state === 'superseded'">{{ $t("discussion-sugg-superseded") }}</template>
          <template v-else>{{ $t("discussion-sugg-dismissed", { by: x.by ?? "", when: fmtWhen(x.when) }) }}</template>
        </li>
      </template>
    </ul>
    <p class="muted small" style="margin:6px 0 0">{{ $t("discussion-sugg-note") }}<template v-if="!can">{{ " " }}{{ $t("discussion-sugg-note-doctor-only") }}</template></p>
  </div>
</template>
