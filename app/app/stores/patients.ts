// The patient list (GET /patients): the rows the list, the calendar and the case header read. Identity is in these
// rows because the list shows it; nothing here is logged or stored outside memory.
import { defineStore } from "pinia";
import { ref } from "vue";
import type { CaseState, PatientRow } from "@codebridge/api-client";

export const usePatientsStore = defineStore("patients", () => {
  const rows = ref<PatientRow[]>([]);
  const total = ref(0);

  const byFile = (file: string) => rows.value.find((p) => p.file === file);
  const byId = (id: string) => rows.value.find((p) => p.id === id);

  function replace(list: PatientRow[], count: number) {
    rows.value = list;
    total.value = count;
  }

  // A row from a write's state: merged into the existing row, or added.
  function upsert(row: PatientRow) {
    const i = rows.value.findIndex((x) => x.file === row.file || x.id === row.id);
    if (i >= 0) rows.value[i] = { ...rows.value[i]!, ...row };
    else rows.value.push(row);
  }

  // The list fields a case's stored state carries; returns the row's
  // file, or null when the case is not in this user's list.
  function applyCase(cs: Partial<CaseState>): string | null {
    const p = (cs.case_id && byId(cs.case_id)) || (cs.file && byFile(cs.file));
    if (!p) return null;
    if (cs.status) p.status = cs.status;
    if (cs.slot !== undefined) p.slot = cs.slot ? { day: cs.slot.day, time: cs.slot.time } : null;
    if (cs.updated) p.updated = cs.updated;
    if (cs.statusHist) p.statusHist = cs.statusHist;
    return p.file;
  }

  return { rows, total, byFile, byId, replace, upsert, applyCase };
});
