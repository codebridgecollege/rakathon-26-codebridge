// Marking a task done or open again: the caller names the state it saw, so two people do not undo each other.
import { D } from "./errors";

export function setDone(current: boolean, done: unknown, expected: unknown): boolean {
  if (typeof done !== "boolean" || typeof expected !== "boolean") throw D.invalidInput();
  if (expected !== current) throw D.taskChanged();
  return done;
}
