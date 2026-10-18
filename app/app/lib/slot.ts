// The MDT grid has 10-minute slots (round 2); a slot's end time follows from its start.
export const SLOT_MIN = 10;
export function slotEnd(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const x = (h ?? 0) * 60 + (m ?? 0) + SLOT_MIN;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}
