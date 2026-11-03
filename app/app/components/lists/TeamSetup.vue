<script setup lang="ts">
// "Nastavení týmu" in Administrace: what a team fills in when it first opens its org. The administrator's own name, the
// MDT's name and when it usually meets. The name goes through the staff list's rename, one field at a time, so it
// follows the same checks and leaves the same access-log rows as a rename on the staff screen.
import { computed, ref, watch } from "vue";
import { useFluent } from "fluent-vue";
import { ApiError } from "@codebridge/api-client";
import { useApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useSessionStore } from "../../stores/session";
import { useStaffStore } from "../../stores/staff";

type Person = { id: string; pre: string; sur: string; post: string; fn: string };

const { $t } = useFluent();
const session = useSessionStore();
const staff = useStaffStore();

// The acting person as the server's staff list holds them, split into the parts of a name.
const person = computed<Person | null>(() => {
  const id = session.me?.user.id;
  const d = staff.directory;
  const all: (Person | null | undefined)[] = [d?.admin, d?.coord, ...(d?.depts ?? []).flatMap((x) => x.people)];
  return all.find((p) => p?.id === id) ?? null;
});

const pre = ref("");
const sur = ref("");
const post = ref("");
const mdtName = ref("");
const weekday = ref<number | null>(null);
const time = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

function fill() {
  pre.value = person.value?.pre ?? "";
  sur.value = person.value?.sur ?? "";
  post.value = person.value?.post ?? "";
  mdtName.value = session.me?.mdt?.name ?? "";
  weekday.value = session.me?.mdt?.weekday ?? null;
  time.value = session.me?.mdt?.time ?? "";
}
watch(() => [person.value, session.me?.mdt] as const, fill, { immediate: true });

// A person the staff list has no slot for (a second administrator) still sets the team's MDT.
const canSave = computed(() => !busy.value && (!person.value || !!sur.value.trim()) && !!mdtName.value.trim());

async function save() {
  const p = person.value;
  if (!canSave.value) return;
  busy.value = true;
  error.value = null;
  const api = useApi();
  try {
    if (p) {
      for (const [field, value] of [["pre", pre.value], ["sur", sur.value], ["post", post.value]] as const) {
        if (value.trim() !== p[field]) await api.patchPerson(p.id, { field, value: value.trim(), expected: p[field] });
      }
    }
    await api.patchMdt({ name: mdtName.value.trim(), weekday: weekday.value, time: time.value || null });
    // The name in the header and the MDT's name come from /me; the staff list holds the name too.
    await session.loadFromApi();
    toast($t("setup-saved"));
  } catch (e) {
    error.value = e instanceof ApiError && e.message_cs ? e.message_cs : $t("setup-failed");
    // Part of it may be stored: what the server holds now, so a second try does not send values it no longer expects.
    await session.loadFromApi().catch(() => {});
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card">
    <div class="head"><h2>{{ $t("setup-title") }}</h2></div>
    <p class="muted small" style="margin:0 0 12px">{{ $t("setup-intro") }}</p>
    <form class="setupform" @submit.prevent="save">
      <template v-if="person">
        <label>{{ $t("setup-pre") }}<input v-model="pre" maxlength="40"></label>
        <label>{{ $t("setup-sur") }}<input v-model="sur" maxlength="80" required></label>
        <label>{{ $t("setup-post") }}<input v-model="post" maxlength="40"></label>
      </template>
      <label>{{ $t("setup-mdt-name") }}<input v-model="mdtName" maxlength="120" required></label>
      <label>{{ $t("setup-weekday") }}
        <select v-model="weekday">
          <option :value="null">{{ $t("setup-weekday-none") }}</option>
          <option v-for="d in 7" :key="d" :value="d">{{ $t(`setup-weekday-${d}`) }}</option>
        </select>
      </label>
      <label>{{ $t("setup-time") }}<input v-model="time" type="time"></label>
      <div class="setupactions">
        <button class="btn primary" type="submit" :disabled="!canSave">{{ $t("setup-save") }}</button>
        <span class="muted small">{{ $t("setup-note") }}</span>
      </div>
      <p v-if="error" class="setuperr" role="alert">{{ error }}</p>
    </form>
  </section>
</template>
