// The task screens (S-6), as myTasks(), viewTasks() and mdtTasksCard() in mocks/src/v3-template.html.

type TaskLike = { pid: string; who: string; done: boolean };
type SuggLike = { pid: string; state: string };

// "Moje úlohy": assigned to the user, or (for anyone but the coordinator) on a case the user owns. The nav badge and
// the list share this rule, so the badge counts exactly what the list shows.
export function myTasks<T extends TaskLike>(tasks: T[], user: string, coordName: string | null, ownerOf: (file: string) => string | undefined): T[] {
  return tasks.filter((t) => t.who === user || (user !== coordName && ownerOf(t.pid) === user));
}

// Drafted tasks a doctor has not confirmed or dismissed yet, of one case or of all.
export const pendingSuggestions = <S extends SuggLike>(sugg: S[], pid?: string) => sugg.filter((x) => x.state === "draft" && (!pid || x.pid === pid));

// What the coordinator's digest counts: open tasks and unconfirmed drafts, never names or diagnoses.
export const waitingCount = (tasks: TaskLike[], sugg: SuggLike[]) => tasks.filter((t) => !t.done).length + pendingSuggestions(sugg).length;

// "Úlohy po MDT": every case with a task or an open draft, ordered by case ID. Cases the user cannot see are left out.
export function mdtTaskGroups<P extends { file: string; id: string }, T extends TaskLike, S extends SuggLike>(
  tasks: T[],
  sugg: S[],
  patientOf: (file: string) => P | undefined,
): { patient: P; tasks: T[]; drafts: S[] }[] {
  const pids = [...new Set([...tasks.map((t) => t.pid), ...pendingSuggestions(sugg).map((x) => x.pid)])];
  return pids
    .map((pid) => patientOf(pid))
    .filter((p): p is P => !!p)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((patient) => ({ patient, tasks: tasks.filter((t) => t.pid === patient.file), drafts: pendingSuggestions(sugg, patient.file) }));
}

// Where a due date came from, as a code the screen labels: typed by a person, computed from the conclusion, or none.
export type DueSource = "manual" | "computed" | "none";
export const dueSourceOf = (t: { dueSrc?: string | null }): DueSource | null =>
  t.dueSrc === "manual" || t.dueSrc === "computed" || t.dueSrc === "none" ? t.dueSrc : null;
