// What the document pipeline without an LLM records about one uploaded document beyond its pages (issue #18): the
// clinical documents inside the file (document_parts, from the page reader's /v1/parts), and the document's alerts
// (document_alerts: a poor copy, another patient's identity on its pages). Pure: the Workflow reads and writes.
import { alertId } from "@codebridge/domain/extraction/keys";

// The page reader's part types, as the documents tab names them. The Czech words match the prepared fixtures'
// `type` values, so a split by the pipeline and a prepared one read the same. "neurčeno" asks the doctor to set it.
export const PART_TYPE_CS: Record<string, string> = {
  outpatient_report: "ambulantní zpráva",
  discharge_report: "propouštěcí zpráva",
  lab_results: "laboratorní výsledky",
  histology: "histologie",
  radiology: "radiologie",
  operation_protocol: "operační protokol",
  request: "žádanka",
  mdt_referral: "žádost o konzultaci MDT",
  other: "jiné",
  unknown: "neurčeno",
};

// The page reader's reasons for an unsure split (page_reader/parts.py), in the doctor's words. A damaged date is named,
// so an empty date reads as "printed but unreadable", not as "not printed".
const VERIFY_CS: Record<string, string> = {
  date_unreadable: "datum je v dokumentu uvedeno, ale nečitelné",
  date_separator: "datum zapsané neobvykle (čárky místo teček)",
  no_header: "dokument bez hlavičky",
  title_approximate: "název přečten jen přibližně",
  type_unknown: "typ dokumentu neurčen",
  start_by_type_change: "začátek dokumentu odhadnut podle změny obsahu",
};
const reasonCs = (codes: string[]) => {
  const words = codes.map((c) => VERIFY_CS[c]).filter(Boolean);
  return `${words.length ? words.join("; ") : "hranice, typ nebo datum dokumentu určeny nejistě"}; ověřte v originálu.`.replace(/^./, (c) => c.toUpperCase());
};

export type PagePart = {
  ordinal: number;
  pages: number[];
  type: string;
  title_cs: string | null;
  date_as_written: string | null;
  date: string | null;
  certainty: "documented" | "verify";
  verify_reasons?: string[];
};

const LEVELS = ["good", "fair", "poor", "empty"] as const;

// One document_parts row per part. The title is the one printed on the page; without one the row carries the type's
// name, which is our label, not the document's (title_cs is NOT NULL). Readability is the worst page of the part,
// with "empty" stored as the parts table's "unreadable". A split the page reader is unsure of says so in reason_cs.
export function partRows(parts: PagePart[], levelOf: (n: number) => string | undefined) {
  return parts.map((p, i) => {
    const levels = p.pages.map(levelOf).filter((l): l is (typeof LEVELS)[number] => !!l && (LEVELS as readonly string[]).includes(l));
    const worst = levels.length === p.pages.length && levels.length ? levels.reduce((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a)) : null;
    const type = PART_TYPE_CS[p.type] ?? PART_TYPE_CS.unknown!;
    return {
      // The page reader's order; its own ordinal only when it is a sane number.
      ordinal: Number.isInteger(p.ordinal) && p.ordinal >= 0 ? p.ordinal : i,
      title_cs: p.title_cs?.trim() || type,
      type,
      // Only a date the page prints with its precision; "neuvedeno" is the view's job, never a guess here.
      date: /^\d{4}(-\d{2}(-\d{2})?)?$/.test(p.date ?? "") ? p.date : null,
      date_as_written: typeof p.date_as_written === "string" ? p.date_as_written : null,
      pages_json: JSON.stringify(p.pages),
      readability: worst === "empty" ? "unreadable" : worst,
      reason_cs: p.certainty === "verify" ? reasonCs(p.verify_reasons ?? []) : null,
      certainty: p.certainty === "documented" ? "documented" : "verify",
    };
  });
}

export type DocumentAlert = { id: string; rule: "poor_copy" | "identity_conflict"; subject: string; kind: "poor_copy" | "identity"; message_id: string; args: Record<string, string> };

// The document's alerts after a run: a poor or empty copy asks for a better one (CLAUDE.md, readability), and pages
// that name another patient raise the identity alert (never a silent merge). Arguments are page numbers only.
export function documentAlerts(docId: string, poorPages: number[], conflictPages: number[]): DocumentAlert[] {
  const out: DocumentAlert[] = [];
  const pages = (ns: number[]) => [...new Set(ns)].sort((a, b) => a - b).join(", ");
  if (poorPages.length)
    out.push({ id: alertId({ rule: "poor_copy", subject: docId }), rule: "poor_copy", subject: docId, kind: "poor_copy", message_id: "alert-poor-copy", args: { pages: pages(poorPages) } });
  if (conflictPages.length)
    out.push({ id: alertId({ rule: "identity_conflict", subject: docId }), rule: "identity_conflict", subject: docId, kind: "identity", message_id: "alert-identity-conflict", args: { pages: pages(conflictPages) } });
  return out;
}
