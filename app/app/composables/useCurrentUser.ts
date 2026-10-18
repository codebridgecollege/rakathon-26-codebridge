// Who is acting, and what the list screens let that role do (the old page's isDoctor(), canSetStatus(),
// canEditStaff() and canConfirmSugg()). The server checks every write again; these only decide which controls show.
import { computed } from "vue";
import { useSessionStore } from "../stores/session";
import { useStaffStore } from "../stores/staff";

export function useCurrentUser() {
  const session = useSessionStore();
  const staff = useStaffStore();
  const id = computed(() => session.me?.user.id ?? "");
  // The staff list's current spelling wins, so a rename of the acting user shows at once.
  const name = computed(() => staff.nameById.get(id.value) ?? session.me?.user.name ?? "");
  const role = computed(() => session.me?.user.role ?? null);
  const isDoctor = computed(() => role.value === "doctor");
  const isCoordinator = computed(() => role.value === "coordinator");
  const isAdmin = computed(() => role.value === "admin");
  // Doctors and the coordinator run the cases (status, slots, sessions, attendance, task done); the administrator reads.
  const canRunCases = computed(() => isDoctor.value || isCoordinator.value);
  // The coordinator and the administrator edit the staff list; doctors read it.
  const canEditStaff = computed(() => isCoordinator.value || isAdmin.value);
  return { id, name, role, isDoctor, isCoordinator, isAdmin, canRunCases, canEditStaff };
}
