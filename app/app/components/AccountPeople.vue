<script setup lang="ts">
// The account menu's people in a demo org: choose whom to act as, and, while acting as an administrator, rename people,
// add a doctor or remove one. No passwords: a person added here has no login of their own, someone logged in acts as them,
// and the access log records the person logged in (AUTH.md, "Organizations and roles"). Names go through the staff
// list's own checks.
// A person can also have a function and no name ("koordinátorka MDT"): the surname then holds the function and the
// titles are empty, so every list shows only the function. That needs no other change, because a name is just text that
// is unique in the org.
import { computed, reactive, ref } from "vue";
import { useFluent } from "fluent-vue";
import { ApiError, type RoleSwitchEntry } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { toast } from "../lib/toast";
import { useSessionStore } from "../stores/session";
import { useStaffStore } from "../stores/staff";

type Form = { pre: string; sur: string; post: string; fn: string; nameless: boolean };

const props = defineProps<{ busy: boolean; roleText: (e: RoleSwitchEntry) => string }>();
const emit = defineEmits<{ pick: [membershipId: string] }>();
const { $t } = useFluent();
const session = useSessionStore();
const staff = useStaffStore();

const me = computed(() => session.me);
const people = computed(() => me.value?.role_switch ?? []);
const canEdit = computed(() => !!me.value?.user.administers);
const depts = computed(() => staff.directory?.depts ?? []);

const saving = ref(false);
const error = ref<string | null>(null);
const editing = ref<string | null>(null);
const draft = reactive<Form>({ pre: "", sur: "", post: "", fn: "", nameless: false });
const adding = ref(false);
const fresh = reactive<Form & { dept: string }>({ pre: "", sur: "", post: "", fn: "", nameless: false, dept: "" });

// What an entry shows: only the name when that is the function, so "koordinátorka MDT" does not read twice.
const label = (p: RoleSwitchEntry) => (p.fn && p.name === p.fn ? p.name : $t("account-role-entry", { name: p.name, role: props.roleText(p) }));
const isNameless = (p: RoleSwitchEntry) => !!p.fn && p.sur === p.fn && !p.pre && !p.post;

// The name and function to store for a form, or why it cannot be saved. Without a name the function is the name.
function fieldsOf(f: Form): { pre: string; sur: string; post: string; fn: string } | null {
  const fn = f.fn.trim();
  if (f.nameless) return fn ? { pre: "", sur: fn, post: "", fn } : null;
  return f.sur.trim() ? { pre: f.pre.trim(), sur: f.sur.trim(), post: f.post.trim(), fn } : null;
}

// The server's answer may follow a part that went through, so the page reads the people again either way.
async function save(send: () => Promise<unknown>, done: () => void) {
  saving.value = true;
  error.value = null;
  try {
    await send();
    done();
    toast($t("account-people-saved"));
  } catch (e) {
    error.value = e instanceof ApiError && e.message_cs ? e.message_cs : $t("account-people-failed");
  } finally {
    await session.loadFromApi().catch(() => {});
    saving.value = false;
  }
}

function startEdit(p: RoleSwitchEntry) {
  adding.value = false;
  error.value = null;
  editing.value = p.membership_id;
  // A person with no name opens with empty name fields, for the day they get one back.
  const nameless = isNameless(p);
  Object.assign(draft, { pre: nameless ? "" : p.pre, sur: nameless ? "" : p.sur, post: nameless ? "" : p.post, fn: p.fn, nameless });
}
function saveEdit(p: RoleSwitchEntry) {
  const to = fieldsOf(draft);
  if (!to) {
    error.value = $t(draft.nameless ? "account-people-fn-required" : "account-people-sur-required");
    return;
  }
  void save(async () => {
    const api = useApi();
    const patch = (field: "pre" | "sur" | "post" | "fn") => (to[field] !== p[field] ? api.patchPerson(p.user_id, { field, value: to[field], expected: p[field] }) : null);
    // Each change is checked on its own: the name and the function are unique across the list, so they move one at a time.
    for (const field of (draft.nameless ? ["fn", "pre", "post", "sur"] : ["sur", "pre", "post", "fn"]) as ("pre" | "sur" | "post" | "fn")[]) await patch(field);
  }, () => (editing.value = null));
}
// The staff list's rule: the coordinator, the administrator and whoever is acting stay, so the org keeps its roles and
// nobody removes themselves mid-session. Leaving ends the membership; the person's name stays in the case history.
const canRemove = (p: RoleSwitchEntry) => p.role === "doctor" && !p.administers && p.user_id !== me.value?.user.id;
function remove(p: RoleSwitchEntry) {
  if (!window.confirm($t("account-people-remove-confirm", { name: p.name }))) return;
  void save(() => useApi().deletePerson(p.user_id), () => {});
}
function startAdd() {
  editing.value = null;
  error.value = null;
  adding.value = true;
  Object.assign(fresh, { pre: "", sur: "", post: "", fn: "", nameless: false, dept: depts.value[0]?.id ?? "" });
}
function saveAdd() {
  const to = fieldsOf(fresh);
  if (!to || !fresh.dept) {
    error.value = $t(fresh.nameless ? "account-people-fn-required" : "account-people-sur-required");
    return;
  }
  void save(() => useApi().addPerson(fresh.dept, { ...to, role: "doctor" }), () => (adding.value = false));
}
</script>

<template>
  <span class="label">{{ $t("account-switch-role") }}</span>
  <template v-for="p in people" :key="p.membership_id">
    <form v-if="editing === p.membership_id" class="acctform" @submit.prevent="saveEdit(p)">
      <label class="acctcheck"><input v-model="draft.nameless" type="checkbox"> {{ $t("account-people-nameless") }}</label>
      <template v-if="!draft.nameless">
        <label>{{ $t("account-people-pre") }}<input v-model="draft.pre" maxlength="40"></label>
        <label>{{ $t("account-people-sur") }}<input v-model="draft.sur" maxlength="80"></label>
        <label>{{ $t("account-people-post") }}<input v-model="draft.post" maxlength="40"></label>
      </template>
      <label>{{ $t("account-people-fn") }}<input v-model="draft.fn" maxlength="120"></label>
      <span class="row">
        <button class="btn small primary" type="submit" :disabled="saving">{{ $t("account-people-save") }}</button>
        <button class="btn small" type="button" @click="editing = null">{{ $t("account-people-cancel") }}</button>
      </span>
    </form>
    <span v-else class="acctperson">
      <button
        class="btn small"
        :disabled="props.busy || saving"
        :aria-pressed="p.membership_id === me?.membership_id"
        @click="p.membership_id !== me?.membership_id && emit('pick', p.membership_id)"
      >
        {{ label(p) }}
      </button>
      <button v-if="canEdit" class="btn small" :disabled="props.busy || saving" :aria-label="$t('account-people-rename', { name: p.name })" @click="startEdit(p)">{{ $t("account-people-edit") }}</button>
      <button v-if="canEdit && canRemove(p)" class="btn small" :disabled="props.busy || saving" :aria-label="$t('account-people-remove', { name: p.name })" @click="remove(p)">{{ $t("account-people-remove-short") }}</button>
    </span>
  </template>
  <template v-if="canEdit">
    <form v-if="adding" class="acctform" @submit.prevent="saveAdd">
      <label class="acctcheck"><input v-model="fresh.nameless" type="checkbox"> {{ $t("account-people-nameless") }}</label>
      <template v-if="!fresh.nameless">
        <label>{{ $t("account-people-pre") }}<input v-model="fresh.pre" maxlength="40"></label>
        <label>{{ $t("account-people-sur") }}<input v-model="fresh.sur" maxlength="80"></label>
        <label>{{ $t("account-people-post") }}<input v-model="fresh.post" maxlength="40"></label>
      </template>
      <label>{{ $t("account-people-fn") }}<input v-model="fresh.fn" maxlength="120"></label>
      <p class="muted small" style="margin:0">{{ $t("account-people-add-note") }}</p>
      <label>{{ $t("account-people-dept") }}
        <select v-model="fresh.dept" required>
          <option v-for="d in depts" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </label>
      <span class="row">
        <button class="btn small primary" type="submit" :disabled="saving">{{ $t("account-people-save") }}</button>
        <button class="btn small" type="button" @click="adding = false">{{ $t("account-people-cancel") }}</button>
      </span>
    </form>
    <button v-else class="btn small" :disabled="props.busy || saving || !depts.length" @click="startAdd">{{ $t("account-people-add") }}</button>
  </template>
  <p v-if="error" class="setuperr" role="alert">{{ error }}</p>
  <span class="muted small">{{ $t("account-switch-role-help") }}</span>
</template>
