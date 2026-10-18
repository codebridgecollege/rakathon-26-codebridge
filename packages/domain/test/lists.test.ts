// The list screens' rules (patients, calendar, tasks, staff), against the old page's behaviour. Synthetic values only.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEK,
  GRID_TIMES,
  dayAgenda,
  inSeminar,
  miniMonthCells,
  mondayOf,
  monthOfWeek,
  outOfHours,
  seminarOn,
  slotEnd,
  stepMonth,
  stepWeek,
  unscheduledOf,
  visibleTimes,
  weekDays,
} from "../src/calendar";
import {
  PAGE_SIZE,
  activeFilterCount,
  ageOf,
  columnValues,
  filterPatients,
  pageRange,
  toggleFilterAll,
  toggleFilterValue,
  type ListRow,
} from "../src/patient-list";
import { mdtTaskGroups, myTasks, pendingSuggestions, waitingCount } from "../src/task-list";
import { checkFieldEdit, deptNameTaken, findPerson, nameTaken, roleGuess } from "../src/staff-edit";
import type { StaffDirectory } from "../src/wire";

const row = (n: number, x: Partial<ListRow> = {}): ListRow => ({
  id: `NO-${String(n).padStart(3, "0")}`,
  name: `Jan Pacient${n}`,
  diagnosis: "meningeom",
  mkn10: null,
  owner: "MUDr. Novák",
  dept: null,
  slot: null,
  status: "new",
  submitted: `2026-10-${String(n).padStart(2, "0")}`,
  ...x,
});

describe("calendar grid", () => {
  it("has 10-minute slots from 8:00 to 17:50 and the Thursday seminar", () => {
    expect(GRID_TIMES[0]).toBe("08:00");
    expect(GRID_TIMES.at(-1)).toBe("17:50");
    expect(GRID_TIMES).toHaveLength(60);
    expect(slotEnd("14:50")).toBe("15:00");
    expect(seminarOn("2026-10-22")).toEqual({ from: "14:00", to: "16:00", kind: "neuro" });
    expect(seminarOn("2026-10-21")).toBeNull();
    expect(inSeminar("2026-10-22", "15:50")).toBe(true);
    expect(inSeminar("2026-10-22", "16:00")).toBe(false);
    expect(outOfHours("2026-10-22", "16:00")).toBe(true);
    // A day without a seminar has no out-of-hours slots: nothing is offered there.
    expect(outOfHours("2026-10-21", "16:00")).toBe(false);
  });

  it("finds the Monday and the five working days of a week", () => {
    expect(mondayOf("2026-10-22")).toBe(DEFAULT_WEEK);
    expect(mondayOf("2026-10-25")).toBe(DEFAULT_WEEK);
    expect(mondayOf("2026-10-19")).toBe(DEFAULT_WEEK);
    expect(weekDays(DEFAULT_WEEK)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(monthOfWeek("2026-10-26")).toBe("2026-10");
    expect(monthOfWeek("2026-10-29")).toBe("2026-11");
  });

  it("stops the arrows at the calendar's range", () => {
    expect(stepWeek(DEFAULT_WEEK, 1)).toBe("2026-10-26");
    expect(stepWeek("2024-01-01", -1)).toBeNull();
    expect(stepWeek("2028-12-25", 1)).toBeNull();
    expect(stepMonth("2026-12", 1)).toBe("2027-01");
    expect(stepMonth("2024-01", -1)).toBeNull();
    expect(stepMonth("2028-12", 1)).toBeNull();
  });

  it("trims the grid around the seminar unless a booking lies outside", () => {
    const days = weekDays(DEFAULT_WEEK);
    const none = visibleTimes(days, () => false, false);
    expect(none.canTrim).toBe(true);
    expect([none.from, none.to, none.times[0], none.times.at(-1)]).toEqual(["13:30", "17:00", "13:30", "16:50"]);
    expect(visibleTimes(days, () => false, true).times).toHaveLength(60);
    const early = visibleTimes(days, (d, t) => d === "2026-10-20" && t === "09:00", false);
    expect(early.canTrim).toBe(false);
    expect(early.times).toHaveLength(60);
    // A week without a seminar (none in this example schedule exists, so a weekend-only list stands in) shows the day.
    expect(visibleTimes(["2026-10-24"], () => false, false)).toMatchObject({ canTrim: false, from: null });
  });

  it("builds the mini month with the week, the seminars and today", () => {
    const cells = miniMonthCells("2026-10", DEFAULT_WEEK, "2026-10-16");
    expect(cells[0]).toMatchObject({ iso: "2026-09-28", out: true });
    expect(cells.find((c) => c.iso === "2026-10-16")).toMatchObject({ today: true, inWeek: false });
    expect(cells.filter((c) => c.inWeek).map((c) => c.iso)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(cells.find((c) => c.iso === "2026-10-22")!.seminar).toBe(true);
    // October 2026 needs five rows; the sixth row would hold only November days and is left out.
    expect(cells).toHaveLength(35);
    // August 2026 ends on a Monday in the sixth row: the row stops after the month's last day, as in the old page.
    expect(miniMonthCells("2026-08", "2026-08-03")).toHaveLength(36);
  });

  it("lists unscheduled patients without closed ones, plus the patient being moved", () => {
    const rows = [
      { file: "a", status: "new", slot: null },
      { file: "b", status: "closed", slot: null },
      { file: "c", status: "scheduled", slot: { day: "2026-10-22", time: "14:10" } },
      { file: "d", status: "ready", slot: { day: "2026-10-22", time: "14:00" } },
    ];
    expect(unscheduledOf(rows, null).map((p) => p.file)).toEqual(["a"]);
    expect(unscheduledOf(rows, "c").map((p) => p.file)).toEqual(["a", "c"]);
    expect(dayAgenda(rows, "2026-10-22").map((p) => p.file)).toEqual(["d", "c"]);
  });
});

describe("patient list", () => {
  const rows = [
    row(1, { owner: "MUDr. Dvořák", status: "ready", slot: { day: "2026-10-22", time: "14:00" } }),
    row(3, { name: "Eva Kotěrová", diagnosis: "glioblastom", mkn10: "C71.9", dept: "Neurologie" }),
    row(2, { status: "closed" }),
  ];
  const q = { q: "", filters: {}, from: "", to: "" };

  it("sorts the newest referral first and searches ID, name, diagnosis and code", () => {
    expect(filterPatients(rows, q).map((p) => p.id)).toEqual(["NO-003", "NO-002", "NO-001"]);
    expect(filterPatients(rows, { ...q, q: "kotěr" }).map((p) => p.id)).toEqual(["NO-003"]);
    expect(filterPatients(rows, { ...q, q: "no-001" }).map((p) => p.id)).toEqual(["NO-001"]);
    expect(filterPatients(rows, { ...q, q: "c71" }).map((p) => p.id)).toEqual(["NO-003"]);
    expect(filterPatients(rows, { ...q, q: "meningeom" })).toHaveLength(2);
  });

  it("filters by the submitted range, both ends inclusive", () => {
    expect(filterPatients(rows, { ...q, from: "2026-10-02" }).map((p) => p.id)).toEqual(["NO-003", "NO-002"]);
    expect(filterPatients(rows, { ...q, from: "2026-10-02", to: "2026-10-02" }).map((p) => p.id)).toEqual(["NO-002"]);
    // A row without a date never passes a date filter.
    expect(filterPatients([row(9, { submitted: null })], { ...q, from: "2026-01-01" })).toHaveLength(0);
  });

  it("column filters hold codes and drop themselves when every value is ticked again", () => {
    expect(columnValues("dept", rows).sort()).toEqual(["", "Neurologie"]);
    expect(columnValues("slot", rows).sort()).toEqual(["", "2026-10-22"]);
    const all = columnValues("status", rows);
    let f = toggleFilterValue({}, "status", all, "new", false);
    expect(f.status!.sort()).toEqual(["closed", "ready"]);
    expect(filterPatients(rows, { ...q, filters: f }).map((p) => p.id)).toEqual(["NO-002", "NO-001"]);
    expect(activeFilterCount(f)).toBe(1);
    f = toggleFilterValue(f, "status", all, "new", true);
    expect(f.status).toBeUndefined();
    f = toggleFilterAll({}, "owner", false);
    expect(filterPatients(rows, { ...q, filters: f })).toHaveLength(0);
    f = toggleFilterValue(f, "owner", columnValues("owner", rows), "MUDr. Dvořák", true);
    expect(filterPatients(rows, { ...q, filters: f }).map((p) => p.id)).toEqual(["NO-001"]);
    expect(toggleFilterAll(f, "owner", true).owner).toBeUndefined();
  });

  it("pages by 20 and falls back to the last page", () => {
    expect(PAGE_SIZE).toBe(20);
    expect(pageRange(11, 0, false)).toEqual({ page: 0, pages: 1, start: 0, end: 11 });
    expect(pageRange(45, 2, false)).toEqual({ page: 2, pages: 3, start: 40, end: 45 });
    expect(pageRange(45, 7, false).page).toBe(2);
    expect(pageRange(0, 0, false)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
    expect(pageRange(45, 1, true)).toMatchObject({ start: 0, end: 45 });
  });

  it("shows the age as a number", () => {
    expect(ageOf({ age: "57 let", birth: null }, "2026-10-16")).toEqual({ n: "57", computed: false });
    expect(ageOf({ age: null, birth: "17.10.1960" }, "2026-10-16")).toEqual({ n: "65", computed: true });
    expect(ageOf({ age: null, birth: "16.10.1960" }, "2026-10-16")).toEqual({ n: "66", computed: true });
    // Never an invented age: an unreadable birth date gives none.
    expect(ageOf({ age: null, birth: "1960" }, "2026-10-16")).toBeNull();
    expect(ageOf({ age: null, birth: null }, "2026-10-16")).toBeNull();
  });
});

describe("tasks", () => {
  const tasks = [
    { pid: "a", who: "Bc. Marková", done: false },
    { pid: "b", who: "MUDr. Novák", done: true },
    { pid: "c", who: "Bc. Marková", done: false },
  ];
  const owner = (f: string) => ({ a: "MUDr. Svobodová", b: "MUDr. Novák", c: "MUDr. Novák" })[f];

  it("counts a doctor's own and owned cases' tasks, the coordinator's own only", () => {
    expect(myTasks(tasks, "MUDr. Novák", "Bc. Marková", owner).map((t) => t.pid)).toEqual(["b", "c"]);
    expect(myTasks(tasks, "Bc. Marková", "Bc. Marková", () => "Bc. Marková").map((t) => t.pid)).toEqual(["a", "c"]);
  });

  it("counts open tasks and open drafts for the digest", () => {
    const sugg = [{ pid: "a", state: "draft" }, { pid: "a", state: "confirmed" }, { pid: "d", state: "draft" }];
    expect(pendingSuggestions(sugg, "a")).toHaveLength(1);
    expect(waitingCount(tasks, sugg)).toBe(4);
    const groups = mdtTaskGroups(tasks, sugg, (f) => (f === "d" ? undefined : { file: f, id: `NO-${f}` }));
    // A case the user cannot see ("d") is left out; groups go by case ID.
    expect(groups.map((g) => [g.patient.id, g.tasks.length, g.drafts.length])).toEqual([["NO-a", 1, 1], ["NO-b", 1, 0], ["NO-c", 1, 0]]);
  });
});

describe("staff edits", () => {
  const dir: StaffDirectory = {
    depts: [{ id: "d4", name: "Radiologie", people: [{ id: "d4p1", pre: "MUDr.", sur: "Šimek", post: "", fn: "" }, { id: "d4p2", pre: "MUDr.", sur: "Veselá", post: "", fn: "" }] }],
    coord: { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" },
    admin: { id: "admin", pre: "Ing.", sur: "Kovář", post: "", fn: "" },
    roles: {},
  };
  const vesela = dir.depts[0]!.people[1]!;

  it("refuses an empty surname, a taken name and an unchanged value", () => {
    expect(checkFieldEdit(dir, vesela, "sur", " ")).toEqual({ ok: false, reason: "surname_required" });
    expect(checkFieldEdit(dir, vesela, "sur", "Šimek")).toEqual({ ok: false, reason: "name_taken", name: "MUDr. Šimek" });
    expect(checkFieldEdit(dir, vesela, "sur", "Veselá")).toEqual({ ok: false, reason: "unchanged" });
    expect(checkFieldEdit(dir, vesela, "post", "Ph.D.")).toEqual({ ok: true });
    expect(checkFieldEdit(dir, vesela, "fn", "primářka")).toEqual({ ok: true });
  });

  it("treats the administrator's name as taken and finds people", () => {
    expect(nameTaken(dir, "Ing. Kovář")).toBe(true);
    expect(nameTaken(dir, "MUDr. Veselá", "d4p2")).toBe(false);
    expect(findPerson(dir, "coord")).toMatchObject({ dept: null });
    expect(findPerson(dir, "d4p1")?.dept?.name).toBe("Radiologie");
    expect(findPerson(dir, "x")).toBeNull();
    expect(deptNameTaken(dir, "radiologie")).toBe(true);
  });

  it("makes a doctor from MUDr. in a title", () => {
    expect(roleGuess("doc. MUDr.", "Ph.D.")).toBe("doctor");
    expect(roleGuess("Bc.", "")).toBe("staff");
  });
});
