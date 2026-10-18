<script setup lang="ts">
// The top bar: the brand button, the main areas and the
// user picker. Same markup and classes, so the copied CSS styles it unchanged.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFluent } from "fluent-vue";
import logo from "../assets/glide-logo.png";
import { useSessionStore } from "../stores/session";
import { useStaffStore } from "../stores/staff";
import { usePatientsStore } from "../stores/patients";
import { useWorkflowStore } from "../stores/workflow";
import { useListViewStore } from "../stores/listView";
import RecorderPill from "./RecorderPill.vue";

const { $t } = useFluent();
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const staff = useStaffStore();
const patients = usePatientsStore();
const workflow = useWorkflowStore();
const listView = useListViewStore();

// The area is the first part of the path (/patients, /calendar/2026-10-19, /patient/10/labs).
const view = computed(() => route.path.split("/")[1] || "patients");
const userName = computed(() => session.me?.user.name ?? "");
const userId = computed(() => session.me?.user.id ?? "");
const isAdmin = computed(() => session.me?.user.role === "admin");
const openTasks = computed(() => workflow.openTaskCount(userName.value, staff.coord?.name ?? null, (f) => patients.byFile(f)?.owner));

// The audit log is for administrators only; the staff list is read-only for doctors but visible to all.
const items = computed(() => [
  { key: "patients", label: $t("nav-patients") },
  { key: "calendar", label: $t("nav-calendar") },
  { key: "tasks", label: $t("nav-tasks"), count: openTasks.value },
  { key: "staff", label: $t("nav-staff") },
  ...(isAdmin.value ? [{ key: "admin", label: $t("nav-admin") }] : []),
]);
// "patient" (one case) belongs to the patients area.
const current = (k: string): "true" | "false" => (view.value === k || (k === "patients" && view.value === "patient") ? "true" : "false");

// By path, so each area's own page (pages/<area>.vue) answers; the calendar keeps its last week (list view store).
function go(k: string) {
  // A patient picked for booking is dropped on any move between areas.
  listView.schedPick = null;
  void router.push(`/${k}`);
}

async function onUser(ev: Event) {
  const sel = ev.target as HTMLSelectElement;
  const ok = await session.switchUser(sel.value || null);
  // A refused switch puts the picker back on the user the server still acts for.
  if (!ok) sel.value = userId.value;
  else if (view.value === "admin" && !isAdmin.value) go("patients");
}
</script>

<template>
  <header class="top">
    <button class="brand" :title="$t('brand-button-title')" :aria-label="$t('brand-button-label')" @click="go('patients')">
      <img :src="logo" :alt="$t('brand-logo-alt')"><span>{{ $t("brand-mark") }}</span>
    </button>
    <nav id="nav" class="nav" :aria-label="$t('nav-label')">
      <button v-for="it in items" :key="it.key" :aria-current="current(it.key)" @click="go(it.key)">
        {{ it.label }}<span v-if="it.count !== undefined" class="count">{{ it.count }}</span>
      </button>
    </nav>
    <span id="recpill"><RecorderPill /></span>
    <span class="who"><span class="lbl">{{ $t("user-picker-label") }}</span>
      <select id="user" :aria-label="$t('user-picker-aria')" :value="userId" @change="onUser">
        <optgroup v-for="d in staff.doctorsByDept" :key="d.id" :label="d.name">
          <option v-for="p in d.people" :key="p.id" :value="p.id" :title="[p.fn, d.name].filter(Boolean).join(', ')">{{ p.name }}</option>
        </optgroup>
        <optgroup :label="$t('user-picker-other-roles')">
          <option v-if="staff.coord" :value="staff.coord.id" :title="staff.coord.fn || $t('user-coordinator-tooltip-default')">
            {{ $t("user-picker-with-function", { name: staff.coord.name, fn: staff.coord.fn || $t("user-coordinator-function-default") }) }}
          </option>
          <option v-if="staff.admin" :value="staff.admin.id" :title="$t('user-admin-function')">
            {{ $t("user-picker-with-function", { name: staff.admin.name, fn: $t("user-admin-function") }) }}
          </option>
        </optgroup>
      </select>
    </span>
  </header>
</template>
