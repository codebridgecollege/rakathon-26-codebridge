// Role and membership assumptions the team has not decided yet (docs/agent/OPEN_QUESTIONS.md, "Backend roles,
// assumed in the designs"). Each is one constant, so a decision is a one-line change; the tests read them too.

// May the coordinator edit notes, the conclusion draft and the "Další kroky" steps before approval? INTEGRATION.md
// gives the coordinator no clinical edits, so the assumption is no.
export const COORDINATOR_EDITS_PROTOCOL = false;

// May the coordinator acknowledge or resolve alerts (for example a missing report she has requested)? Assumed yes.
export const COORDINATOR_ACTS_ON_ALERTS = true;

// May a closed case be booked on the calendar? Assumed no: it is reopened first (a closed case needs no slot).
export const CLOSED_CASE_BOOKABLE = false;

// Who becomes a member of a case created through POST /cases: every MDT department (as the seed does, so every
// doctor works on every case) or only the creator and the named owner. Assumed: every MDT department.
export const NEW_CASE_MEMBERS: "all_mdt_departments" | "creator_and_owner" = "all_mdt_departments";

// Break-the-glass grants last this long (INTEGRATION.md: access outside the team, with a reason, reviewed later).
export const BREAK_GLASS_HOURS = 12;

// One audit row per user, case and window for protocol autosaves, so typing does not flood the access log.
export const PROTOCOL_AUDIT_WINDOW_MIN = 10;

// One coordinator digest per user per this many seconds.
export const DIGEST_MIN_INTERVAL_S = 60;
