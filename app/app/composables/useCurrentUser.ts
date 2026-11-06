// Who is acting, and what the list screens let that role do (isDoctor(), canSetStatus(),
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
  // The administrator, or a doctor who also administers the org (Me.user.administers): either sees the administration.
  const isAdmin = computed(() => session.me?.user.administers ?? role.value === "admin");
  // Doctors and the coordinator run the cases (status, slots, sessions, attendance, task done); the administrator reads.
  const canRunCases = computed(() => isDoctor.value || isCoordinator.value);
  // The administrator may also start and end an MDT and keep its attendance (Soňa, 2026-11-06), but otherwise only reads.
  const canRunSession = computed(() => canRunCases.value || isAdmin.value);
  // Everyone who works in the app edits the staff list (Soňa, 2026-11-06).
  const canEditStaff = computed(() => isDoctor.value || isCoordinator.value || isAdmin.value);
  // Org B is the team's own test org, where every patient is the team's test data, so the "syntetický pacient" tag on
  // each row says nothing. Org A's demo keeps it: there it tells invented patients from the organizers' data.
  const showsSyntheticTag = computed(() => session.me?.org.id !== "demo-b");
  return { id, name, role, isDoctor, isCoordinator, isAdmin, canRunCases, canRunSession, canEditStaff, showsSyntheticTag };
}
