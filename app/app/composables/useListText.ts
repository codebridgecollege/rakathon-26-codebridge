// Text the list screens build from data: status labels, day and slot labels, dates and due dates, all through the
// catalog and Intl so a language switch changes them together.
import { useFluent } from "fluent-vue";
import { slotEnd } from "@codebridge/domain/calendar";
import { dueSourceOf } from "@codebridge/domain/task-list";
import { fmtDateTime, fmtDay, fmtDayMonth, uiLocale, weekdayIndex } from "../lib/format";
import { STATUS_LABEL_IDS, WEEKDAY_IDS } from "../lib/lists";

type Due = { due?: string | null; dueSrc?: string | null; dueBy?: string | null };

export function useListText() {
  const { $t } = useFluent();
  const loc = () => uiLocale();

  const statusLabel = (code: string) => $t(STATUS_LABEL_IDS[code] ?? "lists-status-unknown", { code });
  // "Čt 22. 10."
  const dayLabel = (iso: string) => $t("lists-day-label", { weekday: $t(WEEKDAY_IDS[weekdayIndex(iso)]!), date: fmtDayMonth(iso, loc()) });
  // "Čt 22. 10. 2026" (the "Příští MDT" filter's values).
  const dayYear = (iso: string) => $t("lists-day-year", { day: dayLabel(iso), year: iso.slice(0, 4) });
  // "Čt 22. 10. 2026 · 14:00-14:10", or "nenaplánováno".
  const slotText = (slot: { day: string; time: string } | null | undefined) =>
    slot ? $t("lists-slot-text", { day: dayLabel(slot.day), year: slot.day.slice(0, 4), from: slot.time, to: slotEnd(slot.time) }) : $t("lists-slot-none");
  // A day as "16. 10. 2026"; a missing one in the fixed gap wording.
  const date = (iso: string | null | undefined) => (iso ? fmtDay(iso, loc()) : $t("lists-gap-not-stated"));
  const dateTime = (ts: string | null | undefined) => fmtDateTime(ts, loc());

  // Where a due date came from (dueLabel() in the template).
  function dueLabel(t: Due): string {
    const src = dueSourceOf(t);
    if (src === "manual") return t.dueBy ? $t("tasks-due-manual", { name: t.dueBy }) : $t("tasks-due-manual-unknown");
    if (src === "computed") return $t("tasks-due-computed");
    if (src === "none") return $t("tasks-due-none");
    return "";
  }
  // "21. 10. 2026 (vypočteno ze závěru)", or "termín doplní člověk" without a date.
  const dueText = (t: Due) => {
    if (!t.due) return $t("tasks-due-none");
    const label = dueLabel(t);
    return label ? $t("tasks-due-with-source", { date: date(t.due), source: label }) : date(t.due);
  };

  return { statusLabel, dayLabel, dayYear, slotText, date, dateTime, dueLabel, dueText };
}
