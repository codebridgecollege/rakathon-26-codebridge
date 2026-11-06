// The patients of the teams chosen in the top bar, all of them when none is. Every view of a day's agenda reads this one
// list, so the start button, the start dialog, the session bar and the side panel agree on who is on it.
import { computed } from "vue";
import { useListViewStore } from "../stores/listView";
import { usePatientsStore } from "../stores/patients";

export function useTeamRows() {
  const v = useListViewStore();
  const patients = usePatientsStore();
  return computed(() => (v.teamFilter.length ? patients.rows.filter((p) => !!p.teamId && v.teamFilter.includes(p.teamId)) : patients.rows));
}
