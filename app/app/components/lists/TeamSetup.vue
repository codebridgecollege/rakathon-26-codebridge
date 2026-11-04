<script setup lang="ts">
// "Nastavení týmu" in Administrace: what a hospital fills in when it first opens its org. The administrator's own name,
// then its MDT teams: each with a name, a usual day and time, and its members, who are the doctors that read its cases
// (AUTH.md, "Teams"). The name goes through the staff list's rename, one field at a time, so it follows the same checks
// and leaves the same access-log rows as a rename on the staff screen.
import { computed, reactive, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import { ApiError, type Team } from "@codebridge/api-client";
import { useApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useSessionStore } from "../../stores/session";
import { useStaffStore } from "../../stores/staff";
import { usePatientsStore } from "../../stores/patients";

type Person = { id: string; pre: string; sur: string; post: string; fn: string };
type Draft = { name: string; weekday: number | null; time: string; members: string[] };

const { $t } = useFluent();
const session = useSessionStore();
const staff = useStaffStore();
const patients = usePatientsStore();
const api = useApi();

const d = computed(() => staff.directory);
// Everyone who can sit in a team: the org's people with a login, once each, however many departments they are in.
const people = computed<Person[]>(() => {
  const all = [...(d.value?.depts ?? []).flatMap((x) => x.people), d.value?.coord, d.value?.admin].filter(Boolean) as Person[];
  // The list's "staff" entries are listed for attendance and have no login; the wire type names only the app's roles.
  const roles = (d.value?.roles ?? {}) as Record<string, string>;
  return [...new Map(all.filter((p) => roles[p.id] !== "staff").map((p) => [p.id, p])).values()];
});
const nameOf = (p: Person) => [p.pre, p.sur].filter(Boolean).join(" ") + (p.post ? `, ${p.post}` : "");
const person = computed(() => people.value.find((p) => p.id === session.me?.user.id) ?? null);

const pre = ref("");
const sur = ref("");
const post = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

watch(person, (p) => {
  pre.value = p?.pre ?? "";
  sur.value = p?.sur ?? "";
  post.value = p?.post ?? "";
}, { immediate: true });

// A write's answer holds the new staff list; a refusal may follow a part that went through, so the page reads it again.
async function run(send: () => Promise<{ state?: Parameters<typeof session.applyState>[0] }>, okText: string): Promise<boolean> {
  busy.value = true;
  error.value = null;
  try {
    session.applyState((await send()).state);
    toast(okText);
    return true;
  } catch (e) {
    error.value = e instanceof ApiError && e.message_cs ? e.message_cs : $t("setup-failed");
    await session.loadFromApi().catch(() => {});
    return false;
  } finally {
    busy.value = false;
  }
}

function saveName() {
  const p = person.value;
  if (!p || !sur.value.trim()) return;
  void run(async () => {
    for (const [field, value] of [["pre", pre.value], ["sur", sur.value], ["post", post.value]] as const) {
      if (value.trim() !== p[field]) await api.patchPerson(p.id, { field, value: value.trim(), expected: p[field] });
    }
    // The name in the header comes from /me.
    await session.loadFromApi();
    return {};
  }, $t("setup-saved"));
}

const blank = (): Draft => ({ name: "", weekday: null, time: "", members: [] });
const fresh = reactive(blank());
const drafts = reactive<Record<string, Draft>>({});
// A team's form follows the server only when that team changed there, so saving one keeps what is typed in another.
const seen: Record<string, string> = {};
watch(() => d.value?.teams, (teams) => {
  for (const t of teams ?? []) {
    const now = JSON.stringify(t);
    if (seen[t.id] === now) continue;
    seen[t.id] = now;
    drafts[t.id] = { name: t.name, weekday: t.weekday, time: t.time ?? "", members: [...t.members] };
  }
}, { immediate: true });
// Cases from before the hospital had teams stay open to the departments until someone files them under a team.
const unfiled = computed(() => (d.value?.teams.length ? patients.rows.filter((r) => !r.teamId).length : 0));
const bodyOf = (x: Draft) => ({ name: x.name.trim(), weekday: x.weekday, time: x.time || null });

async function addTeam() {
  if (!fresh.name.trim()) return;
  if (await run(() => api.addTeam(bodyOf(fresh)), $t("setup-saved"))) Object.assign(fresh, blank());
}
function saveTeam(t: Team) {
  const x = drafts[t.id];
  if (!x?.name.trim()) return;
  void run(async () => {
    await api.patchTeam(t.id, bodyOf(x));
    return api.setTeamMembers(t.id, x.members);
  }, $t("setup-saved"));
}
const removeTeam = (t: Team) => void run(() => api.deleteTeam(t.id), $t("setup-saved"));
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ $t("setup-title") }}</h2></div>
    <p v-if="error" class="setuperr" role="alert">{{ error }}</p>

    <form v-if="person" class="setupform" @submit.prevent="saveName">
      <label>{{ $t("setup-pre") }}<input v-model="pre" maxlength="40"></label>
      <label>{{ $t("setup-sur") }}<input v-model="sur" maxlength="80" required></label>
      <label>{{ $t("setup-post") }}<input v-model="post" maxlength="40"></label>
      <div class="setupactions"><button class="btn" type="submit" :disabled="busy || !sur.trim()">{{ $t("setup-save-name") }}</button></div>
    </form>

    <h3 class="setuphead">{{ $t("setup-teams") }}</h3>
    <p class="muted small" style="margin:0 0 12px">{{ $t("setup-teams-note") }}</p>

    <p v-if="unfiled" class="question missing" role="status">{{ $t("setup-unfiled", { n: unfiled }) }}</p>

    <details v-for="t in d?.teams ?? []" :key="t.id" class="setupteam">
      <summary><b>{{ t.name }}</b> <span class="muted small">{{ $t("setup-team-members-count", { n: t.members.length }) }}</span></summary>
      <form v-if="drafts[t.id]" class="setupform" @submit.prevent="saveTeam(t)">
        <label>{{ $t("setup-mdt-name") }}<input v-model="drafts[t.id]!.name" maxlength="120" required></label>
        <label>{{ $t("setup-weekday") }}
          <select v-model="drafts[t.id]!.weekday">
            <option :value="null">{{ $t("setup-weekday-none") }}</option>
            <option v-for="n in 7" :key="n" :value="n">{{ $t(`setup-weekday-${n}`) }}</option>
          </select>
        </label>
        <label>{{ $t("setup-time") }}<input v-model="drafts[t.id]!.time" type="time"></label>
        <fieldset class="setupmembers">
          <legend>{{ $t("setup-team-members") }}</legend>
          <label v-for="p in people" :key="p.id"><input v-model="drafts[t.id]!.members" type="checkbox" :value="p.id"> {{ nameOf(p) }}</label>
        </fieldset>
        <div class="setupactions">
          <button class="btn primary" type="submit" :disabled="busy">{{ $t("setup-save") }}</button>
          <button class="btn" type="button" :disabled="busy" @click="removeTeam(t)">{{ $t("setup-team-remove") }}</button>
        </div>
      </form>
    </details>

    <form class="setupform" @submit.prevent="addTeam">
      <label>{{ $t("setup-mdt-name") }}<input v-model="fresh.name" maxlength="120" :placeholder="$t('setup-mdt-name-example')"></label>
      <label>{{ $t("setup-weekday") }}
        <select v-model="fresh.weekday">
          <option :value="null">{{ $t("setup-weekday-none") }}</option>
          <option v-for="n in 7" :key="n" :value="n">{{ $t(`setup-weekday-${n}`) }}</option>
        </select>
      </label>
      <label>{{ $t("setup-time") }}<input v-model="fresh.time" type="time"></label>
      <div class="setupactions">
        <button class="btn primary" type="submit" :disabled="busy || !fresh.name.trim()">{{ $t("setup-team-add") }}</button>
        <span class="muted small">{{ $t("setup-note") }}</span>
      </div>
    </form>
  </section>
</template>
