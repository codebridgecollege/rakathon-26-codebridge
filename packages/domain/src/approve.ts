// Approving an MDT conclusion (step-4.md section 3, approve.ts). The decision freezes the conclusion, the slot, the
// attendance and the report the doctor confirmed; alerts never block it (CLAUDE.md: alerts inform, they never block).
import type { Actor } from "./roles";
import { D } from "./errors";
import type { Protocol } from "./protocol";
import type { Slot } from "./slots";
import { autoOnApprove, type Status, type StatusChange } from "./status";
import { suggestTasks, type Suggestion } from "./suggest";
import { pragueDay } from "./time";

export type AttendanceRow = { dept_id: string; position: number; user_id: string; user_name: string };

export type ApproveInput = {
  actor: Actor;
  actorDeptId: string | null; // the approver's first department, for the attendance row
  caseStatus: Status;
  slot: Slot | null;
  protocol: Protocol;
  decisions: { id: string; version: number }[]; // existing, in version order
  attendance: AttendanceRow[]; // the current set the case belongs to
  body: {
    protocol_version: unknown;
    conclusion: unknown;
    picked_sections: unknown;
    report_html: unknown;
    attendance_expected: unknown;
  };
  reportSha256: string;
  staffIdByName: ReadonlyMap<string, string>;
  coordinator: { id: string; name: string } | null;
  now: Date;
  newId: () => string;
};

export type ApprovePlan = {
  conclusion: string;
  decision: {
    id: string;
    version: number;
    supersedes_id: string | null;
    slot: Slot | null;
    attSnap: string[];
    // notes and steps are frozen too: "Nový závěr" empties the protocol row, the decision keeps what was approved.
    report: { html: string; sha256: string; picked_sections: string[]; protocol_version: number; notes: string; steps: { text: string; who: string; due: string }[] };
  };
  attendanceAdd: AttendanceRow | null;
  tasks: { text: string; assignee_user_id: string | null; assignee_name: string; due: string | null }[];
  suggestions: (Suggestion & { who: string })[];
  status: StatusChange | null;
  approvalDay: string;
};

// The Czech reasons the approve button would be disabled for, in the order the doctor should fix them. Open alerts,
// including missing documents, are deliberately not an input here.
export function approvalBlockers(actor: Actor, caseStatus: Status, protocol: Protocol, conclusion: string): Error[] {
  const out: Error[] = [];
  if (actor.role !== "doctor") out.push(D.notDoctorApprove());
  if (caseStatus === "closed") out.push(D.caseClosedApprove());
  if (protocol.state === "approved") out.push(D.alreadyApproved());
  if (!conclusion.trim()) out.push(D.conclusionEmpty());
  return out;
}

const strList = (x: unknown, max: number) =>
  Array.isArray(x) && x.length <= max && x.every((s) => typeof s === "string" && s.length <= 200) ? (x as string[]) : null;

export function approve(i: ApproveInput): ApprovePlan {
  const b = i.body;
  if (typeof b.conclusion !== "string" || b.conclusion.length > 20_000) throw D.invalidInput({ fields: { conclusion: "Závěr chybí nebo je příliš dlouhý." } });
  const blockers = approvalBlockers(i.actor, i.caseStatus, i.protocol, b.conclusion);
  if (blockers.length) throw blockers[0];
  // The doctor approves the text they saw: the version they autosaved last. A parallel edit by someone else makes them
  // look again. The text itself may be newer than the last autosave (typed in the last 800 ms); it is applied here.
  if (b.protocol_version !== i.protocol.version) throw D.protocolConflict(i.protocol.updated_by_name ?? "", i.protocol);
  const picked = strList(b.picked_sections, 20);
  const expected = strList(b.attendance_expected, 200);
  if (!picked || !expected || typeof b.report_html !== "string") throw D.invalidInput();

  // The approving doctor was at the meeting, so approving adds them to the attendance instead of blocking (round 20).
  const present = i.attendance.map((a) => a.user_name);
  let attendanceAdd: AttendanceRow | null = null;
  if (!present.includes(i.actor.name) && i.actorDeptId) {
    const pos = Math.max(-1, ...i.attendance.filter((a) => a.dept_id === i.actorDeptId).map((a) => a.position)) + 1;
    attendanceAdd = { dept_id: i.actorDeptId, position: pos, user_id: i.actor.id, user_name: i.actor.name };
  }
  const attSnap = present.includes(i.actor.name) ? present : [...present, i.actor.name];
  // The frozen report lists the attendance the browser rendered; it must be the list stored with the decision.
  const same = (a: string[], c: string[]) => a.length === c.length && [...a].sort().join("\n") === [...c].sort().join("\n");
  if (!same(attSnap, expected)) throw D.attendanceChanged({ current: { attendance: present } });

  const last = i.decisions.at(-1) ?? null;
  const approvalDay = pragueDay(i.now);
  const coordName = i.coordinator?.name ?? "";
  const tasks = i.protocol.steps
    .filter((s) => s.text.trim())
    .map((s) => {
      const who = s.who || coordName;
      return { text: s.text.trim(), assignee_user_id: i.staffIdByName.get(who) ?? null, assignee_name: who || "neurčeno", due: s.due || null };
    });
  const suggestions = suggestTasks(b.conclusion, approvalDay).map((s) => ({ ...s, who: coordName }));
  return {
    conclusion: b.conclusion,
    decision: {
      id: i.newId(),
      version: (last?.version ?? 0) + 1,
      supersedes_id: last?.id ?? null,
      slot: i.slot,
      attSnap,
      report: { html: b.report_html, sha256: i.reportSha256, picked_sections: picked, protocol_version: i.protocol.version, notes: i.protocol.notes, steps: i.protocol.steps },
    },
    attendanceAdd,
    tasks,
    suggestions,
    status: autoOnApprove(i.caseStatus),
    approvalDay,
  };
}
