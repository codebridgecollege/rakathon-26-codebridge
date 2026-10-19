// The fictional default staff of each demo org, the same values as STAFF_DEPTS and STAFF_DEPTS_B in api/seed/seed.py
// (api/test/domain/intake-staff.test.ts checks them against the seed's lists). Shared, so the Worker's staff reset and
// the app's "Jména jsou smyšlená." note read one list.
type DefaultPerson = { id: string; pre: string; sur: string; position: number };
type DefaultDept = { id: string; name: string; sort: number; people: DefaultPerson[] };
type Coordinator = { id: string; pre: string; sur: string; post: string; fn: string };

// Departments of doctors, given as name and surnames; ids are "<prefix>d<n>" and "<prefix>d<n>p<m>".
const deptsOf = (prefix: string, depts: [string, string[]][]): DefaultDept[] =>
  depts.map(([name, surs], i) => ({
    id: `${prefix}d${i + 1}`,
    name,
    sort: i,
    people: surs.map((sur, j) => ({ id: `${prefix}d${i + 1}p${j + 1}`, pre: "MUDr.", sur, position: j })),
  }));

// Demo org A ("Ukázková nemocnice A"): the staff of the hackathon demo.
export const DEFAULT_STAFF = deptsOf("", [
  ["Neurochirurgie", ["Novák", "Dvořák"]],
  ["Klinická onkologie", ["Svobodová", "Malá"]],
  ["Radiační onkologie", ["Černý", "Horáková"]],
  ["Radiologie", ["Šimek", "Veselá"]],
  ["Neurologie", ["Beneš", "Pokorná"]],
  ["Patologie", ["Králová", "Němcová"]],
]);
export const DEFAULT_COORDINATOR: Coordinator = { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" };

// Demo org B ("Ukázková nemocnice B"): two doctors, a coordinator and an administrator. Surnames differ from org A's,
// so a name in the user picker names one person.
export const DEFAULT_STAFF_B = deptsOf("b-", [
  ["Onkologie", ["Vlčková"]],
  ["Radiologie", ["Zeman"]],
]);
export const DEFAULT_COORDINATOR_B: Coordinator = { id: "b-coord", pre: "Bc.", sur: "Holubová", post: "", fn: "koordinátorka MDT" };

// The defaults per demo org; an org without an entry (a hospital) has no default staff to go back to.
export const STAFF_DEFAULTS: Record<string, { depts: DefaultDept[]; coordinator: Coordinator }> = {
  "demo-a": { depts: DEFAULT_STAFF, coordinator: DEFAULT_COORDINATOR },
  "demo-b": { depts: DEFAULT_STAFF_B, coordinator: DEFAULT_COORDINATOR_B },
};

type Person = { id: string; pre: string; sur: string; post?: string; fn?: string };
type Dir = { depts: { id: string; name: string; people: Person[] }[]; coord: Person | null };

// Whether the staff list is still one demo org's fictional default: then the attendance note says the names are made
// up; after any edit it says they come from the staff screen.
export function isDefaultStaff(d: Dir | null | undefined): boolean {
  if (!d) return false;
  const person = (p: Person) => [p.id, p.pre, p.sur, p.post ?? "", p.fn ?? ""];
  const mine = JSON.stringify([d.depts.map((x) => [x.id, x.name, x.people.map(person)]), d.coord ? person(d.coord) : null]);
  return Object.values(STAFF_DEFAULTS).some(
    (o) => mine === JSON.stringify([o.depts.map((x) => [x.id, x.name, x.people.map((p) => person({ ...p, post: "", fn: "" }))]), person(o.coordinator)]),
  );
}
