<script setup lang="ts">
// Screen S-8, Personál pracoviště (viewStaff() in the old page): departments and their people for attendance and the
// user picker. The coordinator and the administrator edit the list, doctors read it. Each change goes to the server,
// whose answer (the whole list) replaces the page's copy; a rename or removal also changes draft steps and attendance
// there, so the stored workflow is read again afterwards. A removed person stays in history under the stored name.
import { computed, reactive, ref } from "vue";
import { useFluent } from "fluent-vue";
import type { StaffPerson } from "@codebridge/api-client";
import { staffName } from "@codebridge/domain/names";
import { STAFF_FIELDS, checkFieldEdit, deptNameTaken, findPerson, nameTaken, roleGuess, type StaffField } from "@codebridge/domain/staff-edit";
import { useApi } from "../../lib/api";
import { toast } from "../../lib/toast";
import { useCurrentUser } from "../../composables/useCurrentUser";
import { useWrite } from "../../composables/useWrite";
import { useStaffStore } from "../../stores/staff";

const { $t } = useFluent();
const me = useCurrentUser();
const staff = useStaffStore();
const { run, reloadWorkflow } = useWrite();

const edit = computed(() => me.canEditStaff.value);
const dir = computed(() => staff.directory);
const fields = computed<{ f: StaffField; label: string; ph: string }[]>(() => [
  { f: "pre", label: $t("staff-field-pre"), ph: $t("staff-field-pre-placeholder") },
  { f: "sur", label: $t("staff-field-sur"), ph: $t("staff-field-sur-placeholder") },
  { f: "post", label: $t("staff-field-post"), ph: $t("staff-field-post-placeholder") },
  { f: "fn", label: $t("staff-field-fn"), ph: $t("staff-field-fn-placeholder") },
]);

// The typed values of each department's "Nová osoba" row and of the new department's name.
const draft = reactive<Record<string, Record<StaffField, string>>>({});
const newRow = (deptId: string) => (draft[deptId] ??= { pre: "", sur: "", post: "", fn: "" });
const newDept = ref("");

async function write(send: () => ReturnType<ReturnType<typeof useApi>["resetStaff"]>, onOk?: () => void): Promise<boolean> {
  const r = await run(send, { onOk });
  if (r) void reloadWorkflow();
  return !!r;
}

// A field commits when it changes (on leaving it). A refused value is put back into the field itself.
async function onField(x: StaffPerson, f: StaffField, ev: Event) {
  const input = ev.target as HTMLInputElement;
  if (!edit.value || !dir.value) return;
  const found = findPerson(dir.value, x.id);
  if (!found) return;
  const p = found.person;
  const old = p[f] || "";
  const c = checkFieldEdit(dir.value, p, f, input.value);
  if (!c.ok) {
    if (c.reason === "surname_required") {
      input.value = p.sur;
      toast($t("staff-surname-required"));
    } else if (c.reason === "name_taken") {
      input.value = old;
      toast($t("staff-name-taken", { name: c.name }));
    }
    return;
  }
  const ok = await write(() => useApi().patchPerson(p.id, { field: f, value: input.value.trim(), expected: old }));
  if (!ok) input.value = old;
}

async function addPerson(deptId: string, focusSurname?: () => void) {
  if (!edit.value || !dir.value) return;
  const row = newRow(deptId);
  const x = { pre: row.pre.trim(), sur: row.sur.trim(), post: row.post.trim(), fn: row.fn.trim() };
  if (!x.sur) {
    toast($t("staff-fill-surname"));
    focusSurname?.();
    return;
  }
  const name = staffName(x);
  if (nameTaken(dir.value, name)) {
    toast($t("staff-name-taken", { name }));
    return;
  }
  await write(
    () => useApi().addPerson(deptId, { ...x, role: roleGuess(x.pre, x.post) }),
    () => {
      draft[deptId] = { pre: "", sur: "", post: "", fn: "" };
      toast($t("staff-added", { name }));
    },
  );
}

async function removePerson(x: StaffPerson) {
  if (!edit.value) return;
  const name = staffName(x);
  await write(() => useApi().deletePerson(x.id), () => toast($t("staff-removed", { name })));
}

async function removeDept(id: string) {
  if (!edit.value) return;
  await write(() => useApi().deleteDepartment(id));
}

async function addDept(focus?: () => void) {
  if (!edit.value || !dir.value) return;
  const name = newDept.value.trim();
  if (!name) {
    toast($t("staff-fill-dept"));
    focus?.();
    return;
  }
  if (deptNameTaken(dir.value, name)) {
    toast($t("staff-dept-taken", { name }));
    return;
  }
  await write(() => useApi().addDepartment({ name }), () => (newDept.value = ""));
}

async function resetStaff() {
  if (!edit.value) return;
  await write(() => useApi().resetStaff(), () => toast($t("staff-reset-done")));
}

const surInput = (deptId: string) => () => (document.querySelector(`[data-newsur="${CSS.escape(deptId)}"]`) as HTMLInputElement | null)?.focus();
const deptInput = () => document.getElementById("newdept")?.focus();
</script>

<template>
  <div class="page">
    <div class="pagehead">
      <div><h1>{{ $t("staff-title") }}</h1><div class="muted small">{{ $t("staff-subtitle") }}</div></div>
      <button v-if="edit" class="btn" @click="resetStaff">{{ $t("staff-reset") }}</button>
    </div>
    <p v-if="edit" class="muted small">{{ $t("staff-edit-note") }}</p>
    <p v-else class="muted small">{{ $t("staff-read-note") }}</p>
    <section class="card staffdept">
      <div class="head"><h2>{{ $t("staff-coordinator-title") }}</h2></div>
      <template v-if="dir?.coord">
        <template v-if="edit">
          <div class="srow shead" aria-hidden="true"><span>{{ $t("staff-col-shown") }}</span><span v-for="c in fields" :key="c.f">{{ c.label }}</span><span /></div>
          <div class="srow nodel">
            <span class="sname" :title="dir.coord.fn || undefined">{{ staffName(dir.coord) }}</span>
            <input v-for="c in fields" :key="c.f" class="input" :value="dir.coord[c.f] || ''" :placeholder="c.ph" :aria-label="$t('staff-field-of', { field: c.label, name: staffName(dir.coord) })" @change="onField(dir.coord, c.f, $event)">
            <span />
          </div>
        </template>
        <ul v-else class="slist"><li><b>{{ staffName(dir.coord) }}</b><template v-if="dir.coord.fn">{{ " " }}<span class="muted small">{{ $t("staff-fn-suffix", { fn: dir.coord.fn }) }}</span></template></li></ul>
      </template>
    </section>
    <section v-for="d in dir?.depts ?? []" :key="d.id" class="card staffdept">
      <div class="head">
        <h2>{{ d.name }}</h2>
        <span class="row"><span class="muted small">{{ $t("staff-people-count", { n: d.people.length }) }}</span>
          <button v-if="edit && !d.people.length" class="btn small" :aria-label="$t('staff-remove-dept-label', { name: d.name })" @click="removeDept(d.id)">{{ $t("staff-remove-dept") }}</button>
        </span>
      </div>
      <template v-if="edit">
        <template v-if="d.people.length">
          <div class="srow shead" aria-hidden="true"><span>{{ $t("staff-col-shown") }}</span><span v-for="c in fields" :key="c.f">{{ c.label }}</span><span /></div>
          <div v-for="x in d.people" :key="x.id" class="srow">
            <span class="sname" :title="x.fn || undefined">{{ staffName(x) }}</span>
            <input v-for="c in fields" :key="c.f" class="input" :value="x[c.f] || ''" :placeholder="c.ph" :aria-label="$t('staff-field-of', { field: c.label, name: staffName(x) })" @change="onField(x, c.f, $event)">
            <button class="btn small" :aria-label="$t('staff-remove-label', { name: staffName(x) })" :title="$t('staff-remove-title')" @click="removePerson(x)">✕</button>
          </div>
        </template>
        <p v-else class="muted small">{{ $t("staff-nobody") }}</p>
        <div class="srow sadd">
          <span class="label">{{ $t("staff-new-person") }}</span>
          <input
            v-for="c in fields"
            :key="c.f"
            v-model="newRow(d.id)[c.f]"
            class="input"
            :data-newsur="c.f === 'sur' ? d.id : undefined"
            :placeholder="c.ph"
            :aria-label="$t('staff-new-field', { field: c.label, dept: d.name })"
            @keydown.enter.prevent="addPerson(d.id, surInput(d.id))"
          >
          <button class="btn small primary" @click="addPerson(d.id, surInput(d.id))">{{ $t("staff-add") }}</button>
        </div>
      </template>
      <ul v-else class="slist">
        <li v-for="x in d.people" :key="x.id"><b>{{ staffName(x) }}</b><template v-if="x.fn">{{ " " }}<span class="muted small">{{ $t("staff-fn-suffix", { fn: x.fn }) }}</span></template></li>
        <li v-if="!d.people.length" class="muted small">{{ $t("staff-nobody") }}</li>
      </ul>
    </section>
    <section v-if="edit" class="card">
      <div class="head"><h2>{{ $t("staff-add-dept-title") }}</h2></div>
      <div class="row">
        <input id="newdept" v-model="newDept" class="input" :placeholder="$t('staff-dept-placeholder')" :aria-label="$t('staff-dept-label')" style="flex:1;min-width:0" @keydown.enter.prevent="addDept(deptInput)">
        <button class="btn small primary" @click="addDept(deptInput)">{{ $t("staff-add-dept") }}</button>
      </div>
    </section>
    <p class="muted small">{{ $t("staff-audit-note") }}</p>
  </div>
</template>
