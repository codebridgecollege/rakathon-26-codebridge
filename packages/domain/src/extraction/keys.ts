// Fact keys and IDs for codebridge.extraction/2 (EXTRACTION-FORMAT.md, "Fact identity").
//
// A doctor's confirmation, edit or alert acknowledgement attaches to a fact ID or an alert ID. If an ID changed between
// two runs of the same case, that link would break, so IDs come from deterministic keys built from what identifies a
// fact (its kind and identifying values), never from a page number or a position in a list.
//
// The Python pipeline has the same functions (pipeline/extraction_format/keys.py); both are tested against the shared
// vectors in packages/domain/test/extraction-key-vectors.json, so a key built in Python equals the one built here.
import type { Alert, DraftFact, Fact, FactDate, Source } from "./types";

/** The UTF-8 bytes of a string, written out because the package may not use the TextEncoder global. */
function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** FNV-1a over UTF-8, 32 bits, as 8 hex digits. Pure (no crypto global), identical in Python. */
export function fnv1a32(text: string): string {
  let h = 0x811c9dc5;
  for (const byte of utf8(text.normalize("NFC"))) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Text as a key segment: NFC, invisible format characters removed, lower case, whitespace collapsed, trailing
 * punctuation dropped. Diacritics stay, because in Czech they change the word. A soft hyphen or zero-width space from
 * OCR would otherwise change the key and send the fact to the matcher's weaker similarity step. A "|" would split the
 * key, so it becomes "/".
 */
export function normText(text: string | null | undefined): string {
  if (text == null) return "";
  return text
    .normalize("NFC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.,;:]+$/u, "");
}

/** A code as a key segment: kept as the source gives it (codes are case-sensitive), only trimmed. */
function codeSeg(code: string): string {
  return code.trim().replace(/\|/g, "/");
}

/**
 * The date part of a key. The sort form cut to the precision when the producer normalised the date, so "2.6.2022" and
 * "02.06.2022" give the same key; otherwise the normalised text as written; otherwise "undated".
 */
export function dateSeg(date: FactDate): string {
  if (date.sort && date.precision) {
    const len = { year: 4, month: 7, day: 10, minute: 16 }[date.precision];
    return date.sort.slice(0, len);
  }
  const written = normText(date.as_written);
  return written || "undated";
}

/** "Date as written" for requests and plans: the text exactly as the document gives it, normalised for spacing. */
function writtenDateSeg(date: FactDate): string {
  return normText(date.as_written) || "undated";
}

/** The document a fact comes from, for lab keys: the same analyte in two lab sheets is two results. */
function originSeg(fact: Pick<Fact, "sources">, sources: ReadonlyMap<string, Source>): string {
  const docs = new Set<string>();
  for (const id of fact.sources) {
    const s = sources.get(id);
    if (!s) continue;
    docs.add(s.type === "document" ? `doc:${s.document_id}` : `nis:${s.resource}`);
  }
  // Several sources only when they say the same thing; the key takes them all, sorted, so the order does not matter.
  return docs.size ? [...docs].sort().join("+") : "doc:none";
}

/** The document parts a fact is quoted from (the document when a source names no part, the record for NIS). */
function partSeg(fact: Pick<Fact, "sources">, sources: ReadonlyMap<string, Source>): string {
  const parts = new Set<string>();
  for (const id of fact.sources) {
    const s = sources.get(id);
    if (!s) continue;
    parts.add(s.type === "document" ? `part:${s.part ?? s.document_id}` : `nis:${s.resource}`);
  }
  return parts.size ? [...parts].sort().join("+") : "part:none";
}

function firstCode(fact: Pick<Fact, "codes">): string | null {
  const own = fact.codes.find((c) => c.assigned_by === "source") ?? fact.codes[0];
  return own ? codeSeg(own.code) : null;
}

function join(...parts: string[]): string {
  return parts.join("|");
}

/**
 * The key of a fact, per kind, as in the spec's table. Without the collision suffix (assignKeys adds it).
 *
 * For the "other kinds" row ("kind, normalised text, date") the text is what names the fact, not its measured value:
 * a vital sign is keyed by what was measured ("blood_pressure"), so a corrected reading keeps the fact's ID and the
 * view can show the doctor both values instead of losing the confirmation.
 */
export function buildFactKey(fact: DraftFact | Fact, sources: ReadonlyMap<string, Source>): string {
  const d = fact.date;
  switch (fact.kind) {
    case "lab_result": {
      const v = fact.value;
      const what = firstCode(fact) ?? normText(v.name_as_written);
      const draw = normText(v.draw.as_written) || normText(d.as_written) || "undated";
      const parts = [fact.kind, what, `draw:${draw}`];
      if (v.draw.requisition) parts.push(`req:${normText(v.draw.requisition)}`);
      parts.push(originSeg(fact, sources));
      return join(...parts);
    }
    case "diagnosis":
      return join(fact.kind, firstCode(fact) ?? normText(fact.value.text), fact.value.disease_status ?? "status:none", dateSeg(d));
    case "medication": {
      // A dose change starts a new medication fact with its own start, so the start date is part of the key. Most list
      // entries state no start; the same drug listed undated in two reports is then told apart by the set of document
      // parts it is quoted from, so the two entries neither merge nor depend on a "#2" suffix. A part ID is stable only
      // while the file is split the same way; a re-split or a further source re-keys, and the matcher carries the ID.
      const start = dateSeg(d);
      const parts = [fact.kind, normText(fact.value.drug), `start:${start}`];
      if (start === "undated") parts.push(partSeg(fact, sources));
      return join(...parts);
    }
    case "systemic_therapy": {
      const v = fact.value;
      const start = normText(v.start) || dateSeg(d);
      const parts = [fact.kind, normText(v.regimen), `line:${v.line ?? "none"}`, `start:${start}`];
      // As for medication: an anticancer drug listed undated in two visits' medication lists gives two facts, told
      // apart by the document part, never by a position.
      if (start === "undated") parts.push(partSeg(fact, sources));
      return join(...parts);
    }
    case "stage":
      return join(fact.kind, fact.value.stage_kind, dateSeg(d));
    case "imaging":
      return join(fact.kind, normText(fact.value.modality), normText(fact.value.region), dateSeg(d));
    case "procedure":
      return join(fact.kind, normText(fact.value.name), normText(fact.value.region), dateSeg(d));
    case "histology":
      return join(fact.kind, normText(fact.value.specimen), dateSeg(d));
    case "request":
    case "plan":
      return join(fact.kind, normText(fact.value.what), writtenDateSeg(d));
    case "radiotherapy":
      return join(fact.kind, normText(fact.value.target), dateSeg(d));
    case "metastasis":
      return join(fact.kind, normText(fact.value.site), dateSeg(d));
    case "vital_sign":
      return join(fact.kind, fact.value.what === "other" ? normText(fact.value.label_as_written) : fact.value.what, dateSeg(d));
    case "performance_status":
      return join(fact.kind, normText(fact.value.scale), dateSeg(d));
    case "prognostic_score":
      return join(fact.kind, normText(fact.value.score), dateSeg(d));
    case "risk_factor":
      return join(fact.kind, fact.value.type, dateSeg(d));
    case "allergy":
      return join(fact.kind, normText(fact.value.substance), dateSeg(d));
    case "family_history":
      return join(fact.kind, normText(fact.value.relation), normText(fact.value.condition), dateSeg(d));
    case "decision":
      return join(fact.kind, fact.value.body, dateSeg(d));
    case "contraindication":
      return join(fact.kind, normText(fact.value.what), dateSeg(d));
    case "visit":
      return join(fact.kind, fact.value.type, dateSeg(d));
    case "interval":
      return join(fact.kind, fact.value.from_fact, fact.value.to_fact);
    case "comorbidity":
      return join(fact.kind, firstCode(fact) ?? normText(fact.value.text), dateSeg(d));
    case "exam_finding":
      return join(fact.kind, normText(fact.value.region), normText(fact.value.text), dateSeg(d));
    case "symptom":
    case "adverse_event":
      return join(fact.kind, normText(fact.value.text), dateSeg(d));
  }
}

/** Strip the collision suffix ("#2") from a key. */
export function baseKey(key: string): string {
  return key.replace(/#\d+$/, "");
}

/** All strings in a value, flattened in key order: what the fact says, independent of field order. */
export function valueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(" ");
  return Object.keys(value as object)
    .sort()
    .map((k) => valueText((value as Record<string, unknown>)[k]))
    .join(" ");
}

/**
 * What orders facts that share a key: their content (value, then the quoted passages), never their position, so a
 * producer that lists sources in another order does not swap "#2" and "#3" and with them the IDs.
 */
function contentOrder(fact: DraftFact | Fact, sources: ReadonlyMap<string, Source>): string {
  const quotes = fact.sources
    .map((id) => sources.get(id))
    .map((s) => (!s ? "" : s.type === "document" ? `${s.document_id}|${normText(s.quote)}` : `nis|${s.resource}`))
    .sort();
  return `${valueText(fact.value)}\u0000${quotes.join("\u0000")}`;
}

/**
 * Keys for all facts of a run. Two facts with the same key (two draws of one test on one day without a time) get a
 * suffix in the order of their content: the first keeps the plain key, the next get "#2", "#3".
 */
export function assignKeys<F extends DraftFact | Fact>(facts: readonly F[], sources: readonly Source[]): (F & { key: string })[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const keyed = facts.map((f, i) => ({ f, i, key: buildFactKey(f, byId), order: contentOrder(f, byId) }));
  const groups = new Map<string, typeof keyed>();
  for (const k of keyed) {
    const g = groups.get(k.key);
    if (g) g.push(k);
    else groups.set(k.key, [k]);
  }
  const out: string[] = new Array(facts.length);
  for (const [key, group] of groups) {
    // Compared by UTF-16 code units (Python compares the UTF-16 encoding to match). Identical content falls back to
    // the input order; such facts are indistinguishable, so which one gets "#2" cannot move a confirmation.
    group.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.i - b.i));
    group.forEach((k, n) => (out[k.i] = n === 0 ? key : `${key}#${n + 1}`));
  }
  return facts.map((f, i) => ({ ...f, key: out[i]! }));
}

/** A fresh fact ID derived from the case and the key; salted when it is taken. */
export function mintFactId(caseId: string, key: string, taken: ReadonlySet<string>): string {
  for (let salt = 0; ; salt++) {
    const id = `f-${fnv1a32(salt ? `${caseId}|${key}|${salt}` : `${caseId}|${key}`)}`;
    if (!taken.has(id)) return id;
  }
}

type SourceWithoutId = Source extends infer S ? (S extends Source ? Omit<S, "id"> : never) : never;

/** A source ID derived from where the passage is, so a re-run over the same page gives the same ID. */
export function sourceIdFor(source: SourceWithoutId, taken: ReadonlySet<string> = new Set()): string {
  const base =
    source.type === "document"
      ? `${source.document_id}|${source.part ?? ""}|${source.page}|${source.quote}`
      : `${source.system}|${source.resource}|${source.version ?? ""}`;
  for (let salt = 0; ; salt++) {
    const id = `src-${fnv1a32(salt ? `${base}|${salt}` : base)}`;
    if (!taken.has(id)) return id;
  }
}

/** The subject of an alert about a pair of facts: both IDs, sorted, so the order of comparison does not matter. */
export function pairSubject(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * The alert ID: the rule plus its subject, nothing else. A further fact joining the alert, a reworded note or a
 * different UI language keeps the ID, so an acknowledgement carries over; two subjects under one rule never share one.
 */
export function alertId(alert: Pick<Alert, "rule" | "subject">): string {
  return `al-${fnv1a32(`${alert.rule}|${alert.subject}`)}`;
}

/**
 * The ID of a composed view line (types.ts ViewLine): the view's name and the line's facts, sorted, nothing else. A
 * doctor's edit of the line is keyed by it, so the edit follows the facts, not the line's position; when the line
 * comes to rest on other facts, the edit shows as missing from the new processing instead of moving silently.
 */
export function viewLineId(view: string, facts: readonly string[]): string {
  return `vl-${fnv1a32(`${view}|${[...facts].sort().join("|")}`)}`;
}
