// The clock and ID source are injected, so the rules and their tests are deterministic.
export type Clock = { now(): Date; id(): string };

export const systemClock: Clock = { now: () => new Date(), id: () => crypto.randomUUID() };

export const isoTime = (d: Date) => d.toISOString();

// The hospital's calendar day (Europe/Prague), for due dates counted from an approval.
export function pragueDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const isIsoDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// 31 January plus one month is the last day of February, not 3 March.
export const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
