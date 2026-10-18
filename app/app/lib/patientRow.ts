// Identity as the MDT team reads it (round 3): surname first, then the birth number and age. No FNO document in the
// challenge data states a birth number, so it shows as not stated; never invented.
import type { PatientRow } from "@codebridge/api-client";

// The demo's fixed date (TODAY in the template): ages and the calendar must not move with the real clock while the
// app runs on the demo seed (e2e/README.md, "How the suite gates the port").
export const TODAY = "2026-10-16";

export const surnameFirst = (p: Pick<PatientRow, "name" | "nameAsWritten">) =>
  p.nameAsWritten || (p.name.includes(" ") ? `${p.name.split(" ").slice(-1)[0]} ${p.name.split(" ").slice(0, -1).join(" ")}` : p.name);

// Age as a bare number (round 4): from a stated age ("48 let"), or computed from a stated birth date on the demo date.
export function ageNum(p: Pick<PatientRow, "age" | "birth">): string | null {
  if (p.age) return p.age.replace(/\s*let$/, "");
  if (!p.birth) return null;
  const [d, m, y] = p.birth.split(".").map(Number);
  const t = new Date(`${TODAY}T12:00:00Z`);
  let a = t.getUTCFullYear() - (y ?? 0);
  if (t.getUTCMonth() + 1 < (m ?? 0) || (t.getUTCMonth() + 1 === m && t.getUTCDate() < (d ?? 0))) a--;
  return String(a);
}
