import { Hono } from "hono";
import type { AppEnv } from "../types";
import { listsAllCases, seesTasks } from "@codebridge/domain/access";
import { modeOf } from "./access-check";

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Tasks and calendar slots hold no findings, so they write no access-log row (design, "Audit on reads").
export const work = new Hono<AppEnv>()
  .get("/tasks", async (c) => {
    const v = c.var.viewer;
    if (!seesTasks(v, modeOf(c))) return c.json({ tasks: [] });
    const rows = await c.var.stores.cases.tasks(v, !listsAllCases(v), c.req.query("scope") === "mine");
    return c.json({
      // The keys of S.tasks in the page.
      tasks: rows.map((t) => ({
        id: t.id,
        pid: t.source_file,
        case_id: t.case_id,
        text: t.text,
        who: t.assignee_name,
        due: t.due,
        done: t.done === 1,
        dueSrc: t.due_source,
        dueBy: t.due_by,
        timing: t.timing,
        fromSugg: t.from_suggestion_id,
        confirmedBy: t.confirmed_by,
      })),
    });
  })
  // Not used by the page yet (it derives the calendar from the patient list); Step 4's booking builds on it.
  .get("/calendar", async (c) => {
    const v = c.var.viewer;
    const w = c.req.query("week");
    const today = new Date().toISOString().slice(0, 10);
    const base = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : today;
    const dow = (new Date(`${base}T12:00:00Z`).getUTCDay() + 6) % 7;
    const week = addDays(base, -dow);
    const slots = await c.var.stores.cases.slots(v, !listsAllCases(v), week, addDays(week, 6));
    return c.json({ week, slots, sessions: [] });
  });
