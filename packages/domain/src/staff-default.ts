// The fictional default staff, the same values as STAFF_DEPTS in api/seed/seed.py (api/test/domain/intake-staff.test.ts
// checks it against the seed's list). Shared, so the Worker's reset and the app's "Jména jsou smyšlená." note read one
// list.
const DEPTS: [string, string[]][] = [
  ["Neurochirurgie", ["Novák", "Dvořák"]],
  ["Klinická onkologie", ["Svobodová", "Malá"]],
  ["Radiační onkologie", ["Černý", "Horáková"]],
  ["Radiologie", ["Šimek", "Veselá"]],
  ["Neurologie", ["Beneš", "Pokorná"]],
  ["Patologie", ["Králová", "Němcová"]],
];
export const DEFAULT_STAFF = DEPTS.map(([name, surs], i) => ({
  id: `d${i + 1}`,
  name,
  sort: i,
  people: surs.map((sur, j) => ({ id: `d${i + 1}p${j + 1}`, pre: "MUDr.", sur, position: j })),
}));
export const DEFAULT_COORDINATOR = { id: "coord", pre: "Bc.", sur: "Marková", post: "", fn: "koordinátorka MDT" };

type Person = { id: string; pre: string; sur: string; post?: string; fn?: string };
type Dir = { depts: { id: string; name: string; people: Person[] }[]; coord: Person | null };

// Whether the staff list is still the fictional default: then the attendance note
// says the names are made up; after any edit it says they come from the staff screen.
export function isDefaultStaff(d: Dir | null | undefined): boolean {
  if (!d) return false;
  const person = (p: Person) => [p.id, p.pre, p.sur, p.post ?? "", p.fn ?? ""];
  const mine = JSON.stringify([d.depts.map((x) => [x.id, x.name, x.people.map(person)]), d.coord ? person(d.coord) : null]);
  const def = JSON.stringify([
    DEFAULT_STAFF.map((x) => [x.id, x.name, x.people.map((p) => person({ ...p, post: "", fn: "" }))]),
    person(DEFAULT_COORDINATOR),
  ]);
  return mine === def;
}
