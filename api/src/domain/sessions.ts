// An MDT seminar day being run: started when at least one case is booked that day, one open session per day.
import { D } from "@codebridge/domain/errors";
import { isIsoDay } from "@codebridge/domain/time";

export function startSession(day: unknown, bookedCases: number, open: { ended_at: string | null } | null): string {
  if (typeof day !== "string" || !isIsoDay(day)) throw D.invalidInput();
  if (open && !open.ended_at) throw D.sessionRunning();
  if (bookedCases < 1) throw D.noCasesThatDay();
  return day;
}

export function endSession(open: { ended_at: string | null } | null): void {
  if (!open || open.ended_at) throw D.sessionNotFound();
}
