// The clinical-trust rules of the patient view (screen S-3): alert states, the missing-document signal, the MDT
// question, certainty marks and the timeline. Pure and free of interface text: they return codes, and the app picks
// the catalog message. Ports of alertState(), warningEntries(), topAlerts(), hasMissing(), missingState(), qState(),
import type { CaseData, Flag, Item, SourceRef, TimelineEvent } from "./case-data";
import { LEGACY_KEY_RE } from "./edits";

// ---------- alerts ----------

// An alert's key on the wire and in the history: its ID ("al-" and 8 hex digits), which follows from the alert's rule
// and subject, so an acknowledgement carries over to the next run that raises the same alert.
export type AlertKey = string;
export type AlertAction = "ack" | "resolved" | "reopen";
export type AlertEvent = { i: AlertKey; action: AlertAction; who: string; when: string };
export type AlertStateCode = "open" | "ack" | "resolved";

// An alert's state is its latest event; nothing is edited or removed, and "reopen" returns it to open.
export function alertState(hist: AlertEvent[], i: AlertKey): { state: AlertStateCode; last: AlertEvent | undefined; hist: AlertEvent[] } {
  const h = hist.filter((x) => x.i === i);
  const last = h[h.length - 1];
  const state: AlertStateCode = !last || last.action === "reopen" ? "open" : last.action;
  return { state, last, hist: h };
}

// One entry per alert of the run, keyed by its ID.
export type AlertEntry = Flag & { i: AlertKey; relevant?: boolean; based_on: SourceRef[] };
export function warningEntries(alerts: CaseData["alerts"]): AlertEntry[] {
  if (!alerts) return [];
  return alerts.flags.map((f) => ({ ...f, i: f.id, based_on: f.based_on || [] }));
}

// The alerts for the MDT question first (CLAUDE.md), then the rest; resolved and acknowledged ones go to the archive.
export function topAlerts(alerts: CaseData["alerts"], hist: AlertEvent[]) {
  const all = warningEntries(alerts).map((f) => ({ ...f, st: alertState(hist, f.i).state }));
  const open = all.filter((f) => f.st === "open");
  return { top: open.filter((f) => f.relevant), all, open, resolved: all.filter((f) => f.st === "resolved"), archived: all.filter((f) => f.st !== "open") };
}

// true or false for a processed case; null when the missing-document check has not run. A resolved missing-document
// alert no longer counts.
export function hasMissing(alerts: CaseData["alerts"], hist: AlertEvent[]): boolean | null {
  if (!alerts) return null;
  return alerts.flags.some((f) => f.kind === "missing" && alertState(hist, f.id).state !== "resolved");
}

// What the missing-document signal says. "loading" and "failed" are never "nothing missing" and never "not processed":
// missing-document alerts are always on (CLAUDE.md), so every state has its own signal.
export type MissingState = "loading" | "failed" | "unchecked" | "yes" | "no";
export function missingState(entry: "absent" | "loading" | "ready" | "error", alerts: CaseData["alerts"] | undefined, hist: AlertEvent[]): MissingState {
  if (entry === "absent" || entry === "loading") return "loading";
  if (entry === "error") return "failed";
  const m = hasMissing(alerts ?? null, hist);
  return m === null ? "unchecked" : m ? "yes" : "no";
}

// The note under an alert drops its own "Pozorování asistenta." prefix: every alert list already sits under a header
// that says so. The rest of the note stays, with its first letter capitalized.
export const alertNote = (note: unknown) =>
  String(note || "")
    .replace(/^Pozorování asistenta[.:;,]?\s*/i, "")
    .replace(/^./, (c) => c.toUpperCase());

// ---------- the MDT question ----------

export type QuestionRow = { explicit: boolean; question: string | null; draft: string | null; qkind: string | null; basis: unknown };
export type Edit = { id?: number | null; text: string; by: string; when: string; orig?: string | null };
export type QConfirm = { text?: string | null; by: string; when: string } | null | undefined;

// The MDT question (team decision 2026-10-17): the referral's explicit question as written; otherwise the assistant's
// draft, labelled as a draft until a named doctor confirms or edits it; the gap wording only when there is neither.
// A confirmation holds for the text it confirmed: a re-extracted draft shows as a draft again.
export type QState =
  | { mode: "edited"; text: string; explicit: boolean; by: string; when: string }
  | { mode: "explicit"; text: string }
  | { mode: "confirmed"; text: string; by: string; when: string; basis: unknown }
  | { mode: "draft"; text: string; kind: "document_purpose" | "assistant_inference"; basis: unknown }
  | { mode: "none"; text: null };

export function qState(p: QuestionRow, edit: Edit | undefined, confirm: QConfirm): QState {
  if (edit) return { mode: "edited", text: edit.text, explicit: p.explicit, by: edit.by, when: edit.when };
  if (p.explicit && p.question) return { mode: "explicit", text: p.question };
  if (p.draft && confirm && (confirm.text == null || confirm.text === p.draft)) return { mode: "confirmed", text: p.draft, by: confirm.by, when: confirm.when, basis: p.basis };
  if (p.draft) return { mode: "draft", text: p.draft, kind: p.qkind === "document_purpose" ? "document_purpose" : "assistant_inference", basis: p.basis };
  return { mode: "none", text: null };
}

// ---------- certainty marks ----------

// An OCR note whose word both readings agree on needs no "!" (round 25): ocr_check.mark === false clears it. The note
// stays in the data as the record of the old text layer's misreading.
export const ocrCleared = (f: Item | null | undefined) => !!(f && f.ocr_check && f.ocr_check.mark === false);

// The quiet certainty markers next to a fact, in display order: "!" verify the reading, "i" the assistant's inference
// or note, "?" planned, "≠" a contradiction between documents. Each carries the text its tooltip shows.
export type Mark =
  | { kind: "ocr"; note: string | null }
  | { kind: "inferred" }
  | { kind: "planned"; note: string | null }
  | { kind: "note"; note: string }
  | { kind: "conflict"; note: string | null };

export function marksOf(f: Item): Mark[] {
  const out: Mark[] = [];
  if ((f.certainty === "unclear_ocr" || f.ocr_note_cs) && !ocrCleared(f)) out.push({ kind: "ocr", note: f.ocr_note_cs || f.note || null });
  if (f.certainty === "inferred") out.push({ kind: "inferred" });
  if (f.certainty === "planned" || f.change_status === "planned_unconfirmed" || /plánováno/i.test(f.change_cs || "")) out.push({ kind: "planned", note: f.note_cs || null });
  // Any other assistant note (source discrepancy, unclear exam) stays reachable as an icon, not as row text.
  if (f.note_cs && f.certainty !== "conflicting" && f.change_status !== "planned_unconfirmed" && f.certainty !== "planned") out.push({ kind: "note", note: f.note_cs });
  if (f.certainty === "conflicting") out.push({ kind: "conflict", note: f.note_cs || null });
  return out;
}

// The certainty tags of a lab point: a recorded negative, a value the OCR may have misread, an assistant inference.
export type TagCode = "negated" | "ocr" | "inferred";
export const tagsOf = (f: Item): TagCode[] =>
  [f.negated ? "negated" : null, f.certainty === "unclear_ocr" ? "ocr" : null, f.certainty === "inferred" ? "inferred" : null].filter(Boolean) as TagCode[];

// ---------- timeline ----------

// The event categories in their fixed order; labels and icons live in the app.
export const EVENT_CATEGORIES = ["imaging", "systemic", "medication", "mdt", "surgery", "pathology", "radiotherapy", "laboratory", "clinical"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
const isCategory = (x: unknown): x is EventCategory => typeof x === "string" && (EVENT_CATEGORIES as readonly string[]).includes(x);

// Explicit category metadata wins. Old kinds remain readable without guessing from clinical prose.
export function categoryOf(e: Item): EventCategory {
  const key = e.category || e.kind || e.type;
  const alias: Record<string, EventCategory> = { histology: "pathology", diagnosis: "clinical", visit: "clinical", other: "clinical" };
  return isCategory(key) ? key : alias[key] || "clinical";
}

// Events with a date first, in date order; undated ones last. The index i is the event's position in the case data,
// so a filter never shifts which source an event opens.
export function timelineSorted(events: TimelineEvent[]) {
  return events
    .map((c, i) => ({ ...c, i, category: categoryOf(c) }))
    .sort((a, b) => (a.date_sort ? 0 : 1) - (b.date_sort ? 0 : 1) || String(a.date_sort || "").localeCompare(String(b.date_sort || "")));
}

// The note icon of an event: its own note and, unless both OCR readings agree, its OCR note.
export const timelineNote = (c: Item) => [c.note_cs, c.ocr_check?.mark === false ? "" : c.ocr_note_cs].filter(Boolean).join(" ");

// A line of the oncology summary is filed under its category (the composed line's, or its fact's kind's). A planned
// line keeps its category too, and its pin says it is planned; it never becomes a performed event.
export const compactKind = (l: Item): EventCategory => categoryOf(l);

// ---------- current state ----------

// The objective line of "Aktuální stav pacienta" leads with TK/P, TT and PS (ECOG): read from the exam's vital-sign and
// performance-status facts by what they measure, never by matching Czech labels. A value the exam does not state is
// null (shown as a gap).
export function vitalsOf(items: Item[]) {
  const val = (what: string) => {
    const it = items.find((i) => i.what === what);
    return it ? String(it.text_cs) : null;
  };
  return { tk: val("blood_pressure"), pulse: val("pulse"), tt: val("temperature"), ecog: items.find((i) => i.what === "ecog") ?? null };
}

// ---------- prose with [n] markers ----------

// Prose with [n] markers: each clause before a marker becomes a link to that source; markers themselves are not shown
// (round 14). Returns the parts in order: plain text, or a linked clause with its source.
export type ProsePart = { text: string; ref?: SourceRef };
export function linkProse(text: string | null | undefined, refs: SourceRef[] | undefined): { parts: ProsePart[]; used: SourceRef[] } {
  const raw = String(text || "").split(/\s*\[(\d+)\]/);
  const parts: ProsePart[] = [];
  const used: SourceRef[] = [];
  let carry = "";
  for (let i = 0; i < raw.length; i++) {
    if (i % 2 === 0) {
      carry += raw[i];
      continue;
    }
    const r = (refs || [])[Number(raw[i]) - 1];
    if (r) used.push(r);
    if (carry.trim()) {
      const lead = carry.match(/^[\s;,.:]*/)![0];
      if (lead) parts.push({ text: lead });
      parts.push({ text: carry.slice(lead.length), ref: r });
      carry = "";
    }
  }
  if (carry) parts.push({ text: carry });
  return { parts, used };
}

// The prose without its [n] markers: the plain text a doctor's edit replaces.
export const stripMarkers = (text: string | null | undefined) => String(text || "").replace(/\s*\[\d+\]/g, "");

// ---------- references ----------

// Paper-style references: each card numbers its sources in order of first use; the same file, page and quote is one
// source.
export function refList() {
  const list: SourceRef[] = [];
  const key = (r: SourceRef) => `${r.file}|${r.page}|${r.quote}`;
  return {
    list,
    add(r: SourceRef | undefined | null): number {
      if (!r) return 0;
      let i = list.findIndex((x) => key(x) === key(r));
      if (i < 0) i = list.push(r) - 1;
      return i + 1;
    },
  };
}

// ---------- confirmations and edits that lost their fact ----------

/** A doctor's confirmation or edit that the current run cannot show where it was made. */
export type Orphan =
  | { kind: "edit"; key: string; reason: "position" | "missing" | "not_shown"; text: string; orig: string | null; by: string; when: string }
  | { kind: "confirmation"; fact_id: string; run_id: string | null; by: string; when: string };

type ConfirmRow = { fact_id: string; action: "confirm" | "withdraw"; who: string; when: string; run_id?: string | null };

/**
 * "potvrzeno dříve, v novém zpracování chybí" (EXTRACTION-FORMAT.md, "Doctor confirmations and edits"): every edit
 * under an old positional key, every edit of a fact or a composed line the current run does not have, every edit the
 * view no longer renders (a drug now stopped, a line now composed), and every fact whose latest confirmation stands but
 * which the run does not have. Listed, never dropped. Field edits (the brief,
 * the question, the diagnosis line) are not tied to a fact and never orphaned.
 */
export function orphansOf(cd: CaseData | null | undefined, edits: Record<string, Edit>, confirmations: ConfirmRow[]): Orphan[] {
  const facts = cd?.run?.facts ?? {};
  const lines = new Set(cd?.run?.view_line_ids ?? []);
  const shown = cd?.run?.shown_keys ? new Set(cd.run.shown_keys) : null;
  const out: Orphan[] = [];
  for (const [key, e] of Object.entries(edits)) {
    const fact = /^f:(f-[0-9a-f]{6,8})(?::|$)/.exec(key)?.[1];
    const line = /^v:(vl-[0-9a-f]{8})(?::|$)/.exec(key)?.[1];
    const positional = LEGACY_KEY_RE.test(key);
    const gone = (fact && !facts[fact]) || (line && !lines.has(line));
    // The key without its part (":t", ":line") is what the view renders.
    const hidden = !gone && (fact || line) && shown && !shown.has(key.split(":").slice(0, 2).join(":"));
    if (positional || gone || hidden) {
      out.push({ kind: "edit", key, reason: positional ? "position" : gone ? "missing" : "not_shown", text: e.text, orig: e.orig ?? null, by: e.by, when: e.when });
    }
  }
  const last = new Map<string, ConfirmRow>();
  for (const r of confirmations) last.set(r.fact_id, r);
  for (const r of last.values()) if (r.action === "confirm" && !facts[r.fact_id]) out.push({ kind: "confirmation", fact_id: r.fact_id, run_id: r.run_id ?? null, by: r.who, when: r.when });
  return out;
}
