<script setup lang="ts">
// The account menu's people in a demo org: choose whom to act as, and, while acting as an administrator, rename people,
// add a doctor or remove one. No passwords: a person added here has no login of their own, someone logged in acts as them, and the access
// log records the person logged in (AUTH.md, "Organizations and roles"). Names go through the staff list's own checks.
import { computed, reactive, ref } from "vue";
import { useFluent } from "fluent-vue";
import { ApiError, type RoleSwitchEntry } from "@codebridge/api-client";
import { useApi } from "../lib/api";
import { toast } from "../lib/toast";
import { useSessionStore } from "../stores/session";
import { useStaffStore } from "../stores/staff";

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
const draft = reactive({ pre: "", sur: "", post: "" });
const adding = ref(false);
const fresh = reactive({ pre: "", sur: "", post: "", dept: "" });

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
  editing.value = p.membership_id;
  Object.assign(draft, { pre: p.pre, sur: p.sur, post: p.post });
}
function saveEdit(p: RoleSwitchEntry) {
  if (!draft.sur.trim()) return;
  void save(async () => {
    for (const field of ["pre", "sur", "post"] as const) {
      const value = draft[field].trim();
      if (value !== p[field]) await useApi().patchPerson(p.user_id, { field, value, expected: p[field] });
    }
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
  adding.value = true;
  Object.assign(fresh, { pre: "", sur: "", post: "", dept: depts.value[0]?.id ?? "" });
}
function saveAdd() {
  if (!fresh.sur.trim() || !fresh.dept) return;
  void save(
    () => useApi().addPerson(fresh.dept, { pre: fresh.pre.trim(), sur: fresh.sur.trim(), post: fresh.post.trim(), fn: "", role: "doctor" }),
    () => (adding.value = false),
  );
}
</script>

<template>
  <span class="label">{{ $t("account-switch-role") }}</span>
  <template v-for="p in people" :key="p.membership_id">
    <form v-if="editing === p.membership_id" class="acctform" @submit.prevent="saveEdit(p)">
      <label>{{ $t("account-people-pre") }}<input v-model="draft.pre" maxlength="40"></label>
      <label>{{ $t("account-people-sur") }}<input v-model="draft.sur" maxlength="80" required></label>
      <label>{{ $t("account-people-post") }}<input v-model="draft.post" maxlength="40"></label>
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
        {{ $t("account-role-entry", { name: p.name, role: props.roleText(p) }) }}
      </button>
      <button v-if="canEdit" class="btn small" :disabled="props.busy || saving" :aria-label="$t('account-people-rename', { name: p.name })" @click="startEdit(p)">{{ $t("account-people-edit") }}</button>
      <button v-if="canEdit && canRemove(p)" class="btn small" :disabled="props.busy || saving" :aria-label="$t('account-people-remove', { name: p.name })" @click="remove(p)">{{ $t("account-people-remove-short") }}</button>
    </span>
  </template>
  <template v-if="canEdit">
    <form v-if="adding" class="acctform" @submit.prevent="saveAdd">
      <label>{{ $t("account-people-pre") }}<input v-model="fresh.pre" maxlength="40"></label>
      <label>{{ $t("account-people-sur") }}<input v-model="fresh.sur" maxlength="80" required></label>
      <label>{{ $t("account-people-post") }}<input v-model="fresh.post" maxlength="40"></label>
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
