// View state of the list screens that outlives a visit to another screen, as the old page's global S did: the
// search and filters of the patient list, its page and column widths, the calendar's week, month and picked patient,
// and the task screen's scope. Held in memory only; nothing goes to browser storage.
import { defineStore } from "pinia";
import { ref } from "vue";
import type { ColumnFilters } from "@codebridge/domain/patient-list";
import { DEFAULT_WEEK, monthOfWeek } from "@codebridge/domain/calendar";

export type TaskScope = "mine" | "all" | "mdt";

export const useListViewStore = defineStore("listView", () => {
  // Patient list (S-1).
  const q = ref("");
  const filters = ref<ColumnFilters>({});
  const subFrom = ref("");
  const subTo = ref("");
  const page = ref(0);
  const showAll = ref(false);
  // Column widths in px after the first resize; null keeps the browser's automatic layout.
  const colWidths = ref<number[] | null>(null);

  // Calendar (S-2).
  const week = ref(DEFAULT_WEEK);
  const miniMonth = ref(monthOfWeek(DEFAULT_WEEK));
  const fullDay = ref(false);
  // The patient picked for booking ("Naplánovat"), and the patient whose card is open.
  const schedPick = ref<string | null>(null);
  const calPop = ref<string | null>(null);

  // Tasks (S-6).
  const taskScope = ref<TaskScope>("mine");
  const doneOpen = ref(false);

  return { q, filters, subFrom, subTo, page, showAll, colWidths, week, miniMonth, fullDay, schedPick, calPop, taskScope, doneOpen };
});
