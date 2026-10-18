// The staff list from GET /staff and the name lists the screens derive from it. The
// server names each person's role, so doctors are the people with role "doctor", never guessed from a title.
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { staffName } from "@codebridge/domain/names";
import type { StaffDirectory } from "@codebridge/api-client";

export const useStaffStore = defineStore("staff", () => {
  const directory = ref<StaffDirectory | null>(null);

  const depts = computed(() => (directory.value?.depts ?? []).map((d) => ({ id: d.id, name: d.name, people: d.people.map((p) => ({ id: p.id, name: staffName(p), fn: p.fn })) })));
  const coord = computed(() => (directory.value?.coord ? { id: directory.value.coord.id, name: staffName(directory.value.coord), fn: directory.value.coord.fn } : null));
  const admin = computed(() => (directory.value?.admin ? { id: directory.value.admin.id, name: staffName(directory.value.admin), fn: directory.value.admin.fn } : null));
  const isDoctor = (id: string) => directory.value?.roles[id] === "doctor";
  // Doctors per department, for the user picker; a department without doctors is left out there.
  const doctorsByDept = computed(() => depts.value.map((d) => ({ ...d, people: d.people.filter((p) => isDoctor(p.id)) })).filter((d) => d.people.length));
  // id -> display name of everyone the server knows, to send the right X-Demo-User for a picked name.
  const nameById = computed(() => {
    const m = new Map<string, string>();
    for (const d of depts.value) for (const p of d.people) m.set(p.id, p.name);
    if (coord.value) m.set(coord.value.id, coord.value.name);
    if (admin.value) m.set(admin.value.id, admin.value.name);
    return m;
  });
  const idOfName = (name: string) => [...nameById.value].find(([, n]) => n === name)?.[0] ?? null;

  function apply(s: StaffDirectory) {
    directory.value = s;
  }

  return { directory, depts, coord, admin, doctorsByDept, nameById, isDoctor, idOfName, apply };
});
