// A team's colour, for telling teams apart at a glance. The team's name is always shown too, so colour is never the only
// signal. Assigned by the teams' order of ID, so a team keeps its colour whatever is filtered.
const COLORS = 10;
export function teamColor(teams: readonly { id: string }[], id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const i = teams.map((t) => t.id).sort().indexOf(id);
  return i < 0 ? undefined : `var(--team-${i % COLORS})`;
}
