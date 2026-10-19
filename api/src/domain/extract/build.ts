// The model's answer (schema.ts) -> codebridge.extraction/2 sources, facts, checks and alerts for one document, after
// the server-side checks (issue #20 phase 2; EXTRACTION-FORMAT.md, "Sources" and "Facts").
//
// What a fact must pass to be kept, and what makes it "verify" instead of "clear" (CLAUDE.md, "Clinical trust": a
// confident wrong statement is worse than an empty field, so every doubt lands on "verify" or drops the fact):
// - its quote is found verbatim in the part the model names (placeholders and all), maps back to the original page
//   text and is anchored there (character range, word boxes, the page text's hash); a quote that is not there drops
//   the fact, and one that is there more than once is anchored where the fact's date or words are, or marked;
// - a date it carries is in the page text as written and keeps its precision; a date that is neither in the quote,
//   on the quote's lines nor in the page header is marked (it may belong to a neighbouring clause);
// - a code it carries is printed on the page (never invented), and in the quote when the page prints several;
// - the numbers of a TNM, a score, a dose or a grade are in the quote; a TNM is normalised only from what is written;
// - negation agrees with the wording of the clause the fact is in, and a negated fact holds no positive finding;
// - a "done" fact whose quote reads like a request or a plan is marked (a sent request is not a done exam), and a plan
//   for something the documents show as done is marked;
// - "confirmed by histology" needs histology or a biopsy in the document;
// - the page's readability and the reading's own "ověřit" marks carry over;
// - a page that names another patient quarantines its facts and raises an identity alert.
import type { Alert, Check, CertaintyReason, DocumentSource, DraftFact, IdentityResult, QuoteText, Source } from "@codebridge/domain/extraction/types";
import { alertId, sourceIdFor, valueText } from "@codebridge/domain/extraction/keys";
import { assignFactIds } from "@codebridge/domain/extraction/match";
// The same rule the case merge applies over all documents (rules.ts); here it sees one document's facts.
import { requestsWithoutResult } from "@codebridge/domain/extraction/rules";
import type { ExtractionRun, Fact } from "@codebridge/domain/extraction/types";
import { matchImage, type Word } from "@codebridge/domain/quote-match";
import { fold, type Pseudonymized } from "../pseudonymize";
import { parseDate } from "./dates";
import { EXTRACT_KINDS, type ModelAnswer, type ModelFact } from "./schema";

export type PageReading = {
  page: number;
  /** The reading the model read and quotes are verbatim against. */
  text: string;
  quoteText: QuoteText;
  /** The engine of that reading, for the anchor ("tesseract 5.3.0 ces", "vision gpt-6-luna-dz-eu read-page-cs@1"). */
  engine: string;
  /** Tesseract's word boxes of the page, for highlighting; null when none are stored. */
  words: Word[] | null;
  readability: "good" | "fair" | "poor" | "empty" | null;
  /** Ranges of `text` the readings disagree on ("ověřit"). */
  verify: [number, number][];
  identity: IdentityResult;
};

export type DocumentInput = { documentId: string; part: string | null; pages: PageReading[] };

export type DropReason = "bad_part" | "quote_not_found" | "empty_quote" | "kind_not_looked_for";
export type BuildReport = { kept: number; verify: number; quarantined: number; dropped: Partial<Record<DropReason, number>>; reasons: Partial<Record<string, number>> };

export type BuildResult = Pick<ExtractionRun, "sources" | "facts" | "checks" | "alerts"> & { report: BuildReport };

const ws = (s: string) => s.replace(/\s+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (s: string) => ws(s).split(" ").map(escape).join("\\s+");

/** Every place the quote is in the text, verbatim up to whitespace (a line break in the page is a space in a quote). */
export function findQuotes(haystack: string, quote: string): [number, number][] {
  if (!ws(quote)) return [];
  const re = new RegExp(pattern(quote), "g");
  const out: [number, number][] = [];
  for (let m = re.exec(haystack); m; m = re.exec(haystack)) out.push([m.index, m.index + m[0].length]);
  return out;
}

export const findQuote = (haystack: string, quote: string): [number, number] | null => findQuotes(haystack, quote)[0] ?? null;

const contains = (text: string, needle: string) => !!ws(needle) && new RegExp(pattern(needle)).test(text);
const digitRuns = (s: string | null | undefined) => (s ?? "").match(/\d+/g) ?? [];

// Negation words, on folded text (no diacritics, lower case). "neguje" is the doctor's recorded negative; "0/14" lymph
// nodes is a count of none; "cM0" says no distant metastases.
export const NEG =
  /(?<![\p{L}])(bez|neg\.?|neguje|negovan\w*|negativ\w*|neprokaz\w*|nepotvrz\w*|nebyl\w*|nejsou|neni|zadn\w*|vyloucen\w*|nezjist\w*|nenalez\w*|nenachaz\w*|nezobraz\w*|nevid\w*|nema\w*|absenc\w*|nezvets\w*|chybi\w*|nezastizen\w*|nezachycen\w*|nepritomn\w*|ne)(?![\p{L}])|(?<!\d)0\s*\/\s*\d+|(?<![\p{L}\d])[cpy]{0,2}m0(?![\d])/u;
// Wording of a request or a plan, on folded text.
const NOT_DONE = /(objedn|zadan|zadost|planovan|indikovan|doporuc|k vysetreni|odeslan|bude provedeno|naplanovan)/;
// "Histol. 9.12.2025" is the usual abbreviation, so the stem is "histol".
const HISTOLOGY = /(histol|biops|bioptick|cytolog|patolog)/;
const CONTRAINDICATION = /(kontraindik|nevhodn|nepodav|nekombin|nesmi|zakazan|vyvarovat|interakc|nedoporuc)/;
// A number written with a decimal comma or point, and spaces around a unit, compare alike ("1,25 mg" ~ "1.25mg").
const numberForm = (s: string) => s.replace(/(\d)\.(\d)/g, "$1,$2").replace(/(\d)\s+(?=\p{L})/gu, "$1");
// The entry of a medication list that names the drug: the clause (between commas, semicolons or line breaks) holding
// its name, through the next drug-like clause. Null when the quote does not name it.
function drugEntry(quote: string, drug: string): string | null {
  const clauses = quote.split(/[;\n]|,(?!\d)/);
  const i = clauses.findIndex((c) => fold(c).includes(drug));
  if (i < 0) return null;
  // The strength or dosing may follow in the next clause ("Bisoprolol, 1,25 mg 1-0-0"), unless that clause names
  // another drug (starts with a capitalised word that is not a unit).
  const next = clauses[i + 1];
  const own = next && !/^\s*\p{Lu}\p{Ll}{3,}/u.test(next) ? `${clauses[i]},${next}` : clauses[i]!;
  return own;
}
const MKN = /(?<![A-Z\d])[A-Z]\d{2}(?:\.\d{1,2})?(?![\d])/g;

type Doubt = CertaintyReason;

// The content words of a text, cut to five letters so Czech endings do not matter ("metastázy" ~ "metastáz").
const significant = (s: string) => [...new Set(fold(s).split(/[^\p{L}\d]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)))];

function stageKindOf(tnm: string): "clinical" | "pathological" | "post_neoadjuvant" | null {
  const t = tnm.trim();
  if (/^y\s*p/i.test(t)) return "post_neoadjuvant";
  if (/^p/i.test(t)) return "pathological";
  if (/^c/i.test(t)) return "clinical";
  return null;
}

const TNM_TOKEN = /(?<![\p{L}\d])(?:y|r|a)?(?:y)?[cp]?[TNM](?:is|[0-4]|X)[a-d]?(?:mi|\(sn\)|\(i[+-]\))?(?![\p{L}\d])/gu;
// Something written like a TNM category, including OCR misreads ("MO", "NŮ"), to count against what was recognised.
const TNM_LIKE = /(?<![\p{L}\d])(?:y|r|a)?(?:y)?[cp]?[TNM](?:is|[0-4X]|[OoŮI])/gu;

// "cT3bN1M0" -> "cT3b N1M0" -> "cT3b N1 M0": a space before an N or M category that follows a T or N category's digit
// (with its letter suffix) or closing bracket.
const joinedApart = (s: string) => s.replace(/(?<=(?:\d|X)[a-d]?|\))(?=(?:y|r|a)?[cp]?[NM](?:[0-4]|X|O))/g, " ");

// "cT3b cN1 cM0 (MR pánve 16.3.2026)" -> "cT3b cN1 cM0"; "ypT2 ypN0 (0/14), R0" -> "ypT2 ypN0"; "cT3bN1M0" -> "cT3b
// N1 M0". The T, N and M categories as written, in their order; null when none is recognised, so a stage is never
// normalised into something the document did not write.
export function normalizeTnm(asWritten: string | null): string | null {
  if (!asWritten) return null;
  const split = joinedApart(asWritten);
  const toks = split.match(TNM_TOKEN);
  return toks?.length ? toks.join(" ") : null;
}

// Whether the written TNM holds a category the normaliser did not recognise ("cT2 N0 MO": the OCR "MO" for M0).
export function tnmIncomplete(asWritten: string): boolean {
  const split = joinedApart(asWritten);
  return (split.match(TNM_LIKE)?.length ?? 0) > (split.match(TNM_TOKEN)?.length ?? 0);
}

// The value of a draft fact per kind, from the flat model fact.
function valueOf(f: ModelFact, stageKind: "clinical" | "pathological" | "post_neoadjuvant"): DraftFact["value"] {
  switch (f.kind) {
    case "diagnosis":
      return { text: f.text, disease_status: f.disease_status, primary: f.primary ?? false };
    case "histology":
      // A tumour type belongs to a positive finding: "DCIS nezastižen" must not show DCIS as the tumour.
      return { specimen: f.specimen, result_text: f.text, tumour_type: f.negated ? null : f.tumour_type, grade: f.grade };
    case "stage":
      return { tnm_as_written: f.tnm_as_written ?? f.text, tnm: normalizeTnm(f.tnm_as_written ?? f.text), stage_kind: stageKind, edition: null, as_of: f.date_as_written, at_diagnosis: f.at_diagnosis };
    case "metastasis":
      return { site: f.site ?? f.text, status: f.metastasis_status ?? (f.negated ? "excluded" : "suspected"), basis: f.modality, text: f.text };
    case "imaging":
      return { modality: f.modality ?? "", region: f.region, finding_text: f.text, response: null };
    case "procedure":
      return { name: f.text, region: f.region, text: null };
    case "systemic_therapy":
      return { regimen: f.text, line: f.line, start: f.date_as_written, stop: f.stop_as_written, reason_stopped: f.reason_stopped, text: null };
    case "radiotherapy":
      return { target: f.text, dose: f.dose, fractions: null, text: null };
    case "request":
      return { what: f.text, request_kind: f.request_kind, result_fact: null };
    case "plan":
      return { what: f.text, when_as_written: f.date_as_written };
    case "decision":
      return { body: f.decision_body ?? "other", body_as_written: null, text: f.text };
    case "family_history":
      return { relation: f.relation ?? "", condition: f.text };
    case "symptom":
      return { text: f.text };
    case "performance_status": {
      // A missing value is null, never 0 (Number(null) is 0, which would read as ECOG 0).
      const v = f.value_as_written?.trim() ?? "";
      return { scale: f.scale ?? "", value_as_written: v, value_numeric: /^\d+$/.test(v) ? Number(v) : null };
    }
    case "comorbidity":
      return { text: f.text };
    case "allergy":
      return { substance: f.text, reaction: f.reaction };
    case "risk_factor":
      return { type: f.risk_type ?? "social", text: f.text, pack_years: f.pack_years };
    case "exam_finding":
      return { region: f.region, text: f.text };
    case "medication":
      return { drug: f.text, strength: f.strength, dosing: f.dosing, change: f.change, indication: f.indication, text: null };
    case "contraindication":
      return { what: f.text, stated_by: "document" };
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** One model call over some pages of the document: which pages it sent, their pseudonymized text, and the answer. */
export type CallAnswer = {
  /** Indexes into doc.pages, in the order the parts were sent ([Část 1] = the first). */
  pages: number[];
  parts: Pseudonymized[];
  answer: ModelAnswer;
  /** The document part these pages are (document_parts "<doc>/p<ordinal>"), for source.part; default the document's. */
  part?: string | null;
};

type Draft = DraftFact & { draft_id: string; _doubts: Doubt[] };

// The lines of a page around a range: the date line of a short entry often sits just above or below it.
function linesAround(text: string, s: number, e: number): string {
  const lineStart = (i: number) => (i <= 0 ? 0 : text.lastIndexOf("\n", i - 1) + 1);
  const lineEnd = (i: number) => {
    const n = text.indexOf("\n", i);
    return n < 0 ? text.length : n;
  };
  const from = lineStart(Math.max(0, lineStart(s) - 1));
  const to = lineEnd(Math.min(text.length, lineEnd(e) + 1));
  return text.slice(from, to);
}
const HEADER_LINES = 8;
const header = (text: string) => text.split("\n").slice(0, HEADER_LINES).join("\n");

/** draft_ids of a fragment (docs/research/2026-10-20-case-merge-contract.md): "ai:<doc>:<n>". */
export type FragmentIds = { draft: (n: number) => string };
export const aiFragmentIds = (docId: string): FragmentIds => ({ draft: (n) => `ai:${docId}:${n}` });

export type DraftedDocument = {
  sources: DocumentSource[];
  /** Facts without key or ID, each with its draft_id; prepareRun (store/runs.ts) assigns keys and IDs. */
  facts: (DraftFact & { draft_id: string })[];
  checks: Check[];
  report: BuildReport;
};

/**
 * The checked facts of one document as a fragment's content: drafted facts, their sources and the checks of the kinds
 * this step looks for. No IDs, no alerts: the case merge (ProcessCase) composes fragments, prepareRun assigns IDs, and
 * the case rules raise the alerts on the final IDs. Without `ids`, draft_ids are "d<n>".
 */
export async function draftDocument(o: {
  doc: DocumentInput;
  calls: CallAnswer[];
  /** Pages the model would not read (content filter, budget): listed as not read, never as "nothing found". */
  unreadPages?: number[];
  ids?: FragmentIds;
  /** The part of a page index, for the unread pages of a document split into parts. */
  partOf?: (pageIndex: number) => string | null;
}): Promise<DraftedDocument> {
  const { doc } = o;
  const report: BuildReport = { kept: 0, verify: 0, quarantined: 0, dropped: {}, reasons: {} };
  const drop = (r: DropReason) => (report.dropped[r] = (report.dropped[r] ?? 0) + 1);
  const hashes = await Promise.all(doc.pages.map((p) => sha256Hex(p.text)));
  const sources = new Map<string, DocumentSource>();
  const drafts: Draft[] = [];

  for (const call of o.calls)
    for (const f of call.answer.facts) {
      if (!(EXTRACT_KINDS as readonly string[]).includes(f.kind)) {
        drop("kind_not_looked_for");
        continue;
      }
      const pi = call.pages[f.part - 1] ?? -1;
      const page = doc.pages[pi];
      const pseudo = call.parts[f.part - 1];
      if (!page || !pseudo) {
        drop("bad_part");
        continue;
      }
      if (!ws(f.quote)) {
        drop("empty_quote");
        continue;
      }
      const doubts: Doubt[] = [];
      const doubt = (code: string, text: string) => doubts.push({ code, text });

      // Where the quote is. Twice on the page: the occurrence whose lines carry the fact's date or most of its words;
      // still undecided, the first one, marked, because the doctor would jump to a passage that may not be this one.
      const found = findQuotes(pseudo.text, f.quote);
      if (!found.length) {
        drop("quote_not_found");
        continue;
      }
      let at = found[0]!;
      if (found.length > 1) {
        const said = significant(f.text);
        const score = ([s, e]: [number, number]) => {
          const around = fold(linesAround(pseudo.text, s, e));
          return (f.date_as_written && contains(around, fold(f.date_as_written)) ? 10 : 0) + said.filter((w) => around.includes(w)).length;
        };
        const ranked = found.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
        at = ranked[0]!.r;
        if (ranked[0]!.s === ranked[1]!.s) doubt("quote_ambiguous", "Citace je na straně vícekrát; ověřte, že zvýrazněné místo je to správné.");
      }
      const [os, oe] = pseudo.originalRange(at[0], at[1]);
      const quote = page.text.slice(os, oe);
      const fq = fold(quote);

      // The date must be on the page as written; otherwise it is not kept (never a guessed date). On the page but not
      // in the quote, its lines or the page header, it may belong to a neighbouring clause: kept, marked.
      let date = parseDate(null);
      if (f.date_as_written) {
        if (contains(page.text, f.date_as_written) || contains(pseudo.text, f.date_as_written)) {
          date = parseDate(f.date_as_written);
          // The header date is the date of the report and of its findings, not of a plan the report makes.
          const inHeader = f.kind !== "plan" && f.kind !== "request" && contains(header(page.text), f.date_as_written);
          const near = contains(linesAround(page.text, os, oe), f.date_as_written) || inHeader;
          if (!near) doubt("date_outside_quote", `Datum „${f.date_as_written}“ není u citace; ověřte, že patří k tomuto faktu.`);
        } else doubt("date_not_in_text", `Datum „${f.date_as_written}“ v textu strany není; neuvedeno.`);
      }
      if (f.kind === "systemic_therapy" && f.stop_as_written && f.date_as_written && ws(f.stop_as_written) === ws(f.date_as_written))
        doubt("start_equals_stop", "Začátek a konec léčby mají stejné datum; ověřte.");

      // A code is kept only when the page prints it; when the page prints several, it must be in the quote, or the
      // code of a neighbouring diagnosis (I10 next to C50.9) could attach to this one.
      const codes: DraftFact["codes"] = [];
      if (f.code) {
        const code = f.code.trim();
        const flat = (s: string) => s.replace(/\s/g, "");
        if (flat(page.text).includes(flat(code))) {
          codes.push({ system: /^[A-Z]\d{2}(\.\d{1,2})?$/.test(code) ? "mkn-10" : "other", code, assigned_by: "source" });
          if (!flat(quote).includes(flat(code)) && new Set(page.text.match(MKN) ?? []).size > 1)
            doubt("code_outside_quote", `Kód ${code} není v citaci a strana uvádí více kódů; ověřte přiřazení.`);
        } else doubt("code_not_in_text", `Kód ${code} v textu strany není; vynechán.`);
      }

      // Numbers the fact states must be in its quote; a TNM only as written.
      const qd = new Set(digitRuns(quote));
      const stated = [f.tnm_as_written, f.value_as_written, f.grade, f.dose, f.strength, f.dosing, f.line != null ? String(f.line) : null];
      if (stated.flatMap(digitRuns).some((d) => !qd.has(d))) doubt("number_not_in_quote", "Číslo uvedené ve faktu není v citaci.");
      // A medication's strength and dosing must be written in the quote as stated (unit included: "75 µg" is not
      // "75 mg"), next to the drug: a list line holds several drugs, and a strength or a "1-0-1" from the neighbouring
      // entry would otherwise pass. The drug itself must be named in the quote.
      if (f.kind === "medication") {
        const drug = significant(f.text)[0] ?? fold(f.text).slice(0, 5);
        const entry = drugEntry(quote, drug);
        if (!entry) doubt("drug_not_in_quote", "Lék není v citaci jmenován; ověřte.");
        for (const [what, v] of [["Síla", f.strength], ["Dávkování", f.dosing]] as const) {
          if (v && !(entry && contains(numberForm(entry), numberForm(v))))
            doubt("dose_not_with_drug", `${what} „${v}“ není v citaci u tohoto léku doslova; ověřte.`);
        }
      }
      // A contraindication is kept as the document's only when the quote says so; one the model derived (from an
      // allergy, say) is marked.
      if (f.kind === "contraindication" && !CONTRAINDICATION.test(fq))
        doubt("not_stated_as_contraindication", "Citace neuvádí kontraindikaci výslovně; ověřte.");
      let stageKind = f.stage_kind ?? "clinical";
      if (f.kind === "stage") {
        const written = f.tnm_as_written ?? f.text;
        if (f.tnm_as_written && !contains(quote, f.tnm_as_written)) doubt("tnm_not_in_quote", "TNM není v citaci doslova.");
        if (tnmIncomplete(written)) doubt("tnm_unrecognised", "Část TNM nelze přečíst (např. „MO“ místo M0); ověřte.");
        // The kind comes from the prefix the document writes; without one, and without the model's kind, it is a
        // guess, marked, so a contradiction rule never compares a guessed kind.
        const k = stageKindOf(written);
        if (k && f.stage_kind && k !== f.stage_kind) doubt("stage_kind_unclear", "Druh stádia neodpovídá předponě TNM.");
        if (k) stageKind = k;
        else if (!f.stage_kind) doubt("stage_kind_unclear", "Druh stádia (klinické, patologické) dokument neuvádí.");
      }

      // Negation, judged on the clauses of the quote that hold the fact's words ("CT: tumor 38 mm, bez zvětšených
      // uzlin": the tumour clause has no negation), or on the whole quote when no clause does.
      const said = significant(f.text);
      const clauses = fq.split(/[,;:]|\.\s/).filter((c) => c.trim());
      const own = clauses.filter((c) => said.some((w) => c.includes(w)));
      const negWord = (own.length ? own : [fq]).some((c) => NEG.test(c));
      const negated = f.negated || f.metastasis_status === "excluded";
      if (negated && !negWord) doubt("negation_unclear", "Fakt je zápor, ale citace zápor neobsahuje.");
      if (!negated && negWord && ["metastasis", "imaging", "symptom", "diagnosis", "histology", "comorbidity", "exam_finding"].includes(f.kind))
        doubt("negation_unclear", "Citace obsahuje u tohoto nálezu zápor; ověřte.");
      if (f.negated && f.kind === "metastasis" && (f.metastasis_status === "confirmed" || f.metastasis_status === "suspected"))
        doubt("negation_unclear", "Metastáza je zároveň popřena a potvrzena; ověřte.");
      // "Bez plicní embolie; drobná cysta vpravo": a negated fact whose own text has a clause with content and no
      // negation holds a positive finding too, and a view that shows "no ..." would hide it.
      const parts = fold(f.text).split(/[;,]|\s(?:ale|avsak|vsak|jen|pouze)\s/).filter((c) => significant(c).length >= 2);
      if (negated && parts.length > 1 && parts.some((c) => NEG.test(c)) && parts.some((c) => !NEG.test(c)))
        doubt("mixed_negation", "Zápor platí jen pro část textu faktu; ověřte pozitivní nález.");

      if (f.status === "done" && NOT_DONE.test(fq)) doubt("status_unclear", "Citace zní jako žádost nebo plán, ne jako provedené vyšetření.");
      if (f.disease_status === "confirmed_histology" && !doc.pages.some((p) => HISTOLOGY.test(fold(p.text))))
        doubt("histology_not_in_document", "Potvrzení histologií dokument neuvádí.");
      if (said.length >= 2 && said.filter((w) => fq.includes(w)).length / said.length < 0.5)
        doubt("text_not_in_quote", "Citace neobsahuje to, co fakt tvrdí; ověřte ve zdroji.");
      if (page.readability === "poor" || page.readability === "empty") doubt("poor_copy", "Strana je špatně čitelná.");
      if (page.verify.some(([s, e]) => s < oe && e > os)) doubt("ocr_check", "Čtení stránky se v citaci liší (ověřit).");
      if (f.certainty === "verify") doubt("model_unsure", f.uncertainty?.trim() || "Model si čtením nebo významem nebyl jistý.");

      const box = page.words ? matchImage(quote, page.words) : null;
      const srcBody: Omit<DocumentSource, "id"> = {
        type: "document",
        document_id: doc.documentId,
        part: call.part ?? doc.part,
        page: page.page,
        quote,
        quote_text: page.quoteText,
        anchor: { page_text_sha256: hashes[pi]!, engine: page.engine, char_range: [os, oe], boxes: box?.boxes ?? [] },
        reported_as: f.reported_as,
        identity: page.identity,
        reading_check: null,
      };
      // One source per passage and way of reporting it.
      const existing = [...sources.values()].find((s) => s.page === srcBody.page && s.anchor?.char_range[0] === os && s.anchor?.char_range[1] === oe && s.reported_as === srcBody.reported_as);
      // Derived from the passage (document, part, page, quote), so the same passage gets the same ID across producers and
      // reruns and a fact's sources stay stable.
      const sourceId = existing?.id ?? sourceIdFor(srcBody, new Set(sources.keys()));
      if (!existing) sources.set(sourceId, { id: sourceId, ...srcBody });

      drafts.push({
        draft_id: o.ids ? o.ids.draft(drafts.length + 1) : `d${drafts.length}`,
        _doubts: doubts,
        kind: f.kind,
        subject: f.kind === "family_history" ? "relative" : f.subject,
        value: valueOf(f, stageKind),
        date,
        status: f.status,
        negated,
        not_stated: [],
        origin: "document",
        certainty: "clear",
        certainty_reason: null,
        codes,
        note: null,
        quarantined: page.identity === "conflicts",
        sources: [sourceId],
      } as Draft);
    }

  // Across facts: a plan or a planned therapy for something the documents show as done ("indikován sunitinib" next to
  // "sunitinib od 27.1.2026"), and an undated performance status next to a dated one of the same scale.
  for (const d of drafts) {
    if ((d.kind === "plan" || ((d.kind === "systemic_therapy" || d.kind === "procedure") && d.status === "planned")) && !d.quarantined) {
      const own = significant(valueText(d.value)).filter((w) => w.length >= 5);
      const done = drafts.find((x) => x !== d && !x.quarantined && x.status === "done" && (x.kind === "systemic_therapy" || x.kind === "procedure" || x.kind === "imaging") && significant(valueText(x.value)).some((w) => own.includes(w)) && (!d.date.sort || !x.date.sort || x.date.sort >= d.date.sort));
      if (done) d._doubts.push({ code: "done_elsewhere", text: "Dokumentace uvádí, že to již proběhlo; ověřte, zda plán platí." });
    }
    if (d.kind === "performance_status" && !d.date.sort) {
      const scale = fold(d.value.scale);
      if (drafts.some((x) => x !== d && x.kind === "performance_status" && fold(x.value.scale) === scale && !!x.date.sort))
        d._doubts.push({ code: "undated", text: "Údaj nemá datum a dokumentace uvádí i datovaný údaj téže škály; ověřte, který je aktuální." });
    }
  }
  // Within one report: metastases stated and denied for the same date ("Metastatické postižení jater prokázáno" next to
  // "bez známek vzdálených metastáz" in the conclusion of the same CT). Like with like (same kind, same time), so both
  // are marked; which one holds is the doctor's reading of the source. On S03 the first is a misread the image itself
  // carries, which no reading can catch.
  for (const d of drafts) {
    if (d.kind !== "metastasis" || d.quarantined || d.negated || d.value.status === "excluded" || !d.date.sort) continue;
    // A positive metastasis without a date is not compared: "the same time" cannot be told.
    const site = fold(d.value.site).trim();
    // Regional nodes are not distant metastases: "metastatické postižení uzlin" and "bez vzdálených metastáz" is N1 M0.
    const regional = /uzl|lymf/.test(site);
    const denied = drafts.filter((x) => {
      if (x === d || x.quarantined || x.date.sort !== d.date.sort || (x.kind !== "metastasis" && x.kind !== "imaging")) return false;
      if (!(x.negated || (x.kind === "metastasis" && x.value.status === "excluded"))) return false;
      const said = fold(valueText(x.value));
      if (!/metast/.test(said)) return false;
      const distant = /vzdalen|vsech|zadn/.test(said);
      return (distant && !regional) || (site.length >= 4 && said.includes(site.slice(0, 4)));
    });
    if (!denied.length) continue;
    const doubt = { code: "contradicts_same_date", text: "Tentýž den dokumentace metastázy jednou uvádí a jednou vylučuje; ověřte ve zdroji." };
    d._doubts.push(doubt);
    for (const x of denied) x._doubts.push(doubt);
  }
  for (const d of drafts) {
    for (const x of d._doubts) report.reasons[x.code] = (report.reasons[x.code] ?? 0) + 1;
    if (d._doubts.length) Object.assign(d, { certainty: "verify", certainty_reason: { code: d._doubts[0]!.code, text: d._doubts.map((x) => x.text).join(" ") } });
  }

  // The same statement read twice (two pages, or the model listing it twice) is one fact with both sources. Never
  // across quarantine: the patient's own fact must not vanish into another patient's page.
  const merged: Draft[] = [];
  for (const d of drafts) {
    const same = merged.find(
      (m) =>
        m.kind === d.kind &&
        JSON.stringify(m.value) === JSON.stringify(d.value) &&
        JSON.stringify(m.codes) === JSON.stringify(d.codes) &&
        m.negated === d.negated &&
        m.status === d.status &&
        m.subject === d.subject &&
        m.quarantined === d.quarantined &&
        m.date.as_written === d.date.as_written,
    );
    if (!same) merged.push(d);
    else {
      same.sources = [...new Set([...same.sources, ...d.sources])];
      if (d.certainty === "verify") {
        const reasons = [...same._doubts, ...d._doubts];
        Object.assign(same, { certainty: "verify", _doubts: reasons, certainty_reason: { code: reasons[0]!.code, text: [...new Set(reasons.map((x) => x.text))].join(" ") } });
      }
    }
  }

  const facts = merged.map(({ _doubts, ...rest }) => rest);
  report.kept = facts.length;
  report.verify = facts.filter((f) => f.certainty === "verify").length;
  report.quarantined = facts.filter((f) => f.quarantined).length;

  // A page no call sent, or the model would not read, is listed as not read: its absence of facts is not "nothing found".
  const sent = new Set(o.calls.flatMap((c) => c.pages));
  const unread = new Set(o.unreadPages ?? []);
  // The parts the calls read (each call one part in the Worker), or the document as a whole.
  const parts = [...new Set(o.calls.map((c) => c.part ?? doc.part))];
  const covered = (parts.length ? parts : [doc.part]).map((part) => ({ document_id: doc.documentId, part }));
  const unreadable = doc.pages
    .map((p, i) => ({ p, i }))
    .filter(({ p, i }) => p.readability === "empty" || unread.has(i) || !sent.has(i))
    .map(({ p, i }) => ({ document_id: doc.documentId, part: o.partOf?.(i) ?? doc.part, page: p.page }));
  const checks: Check[] = EXTRACT_KINDS.map((k) => ({ id: `chk-${k}`, looks_for: k, expected: null, covered, unreadable, result: facts.some((f) => f.kind === k) ? ("found" as const) : ("nothing_found" as const) }));
  return { sources: [...sources.values()], facts, checks, report };
}

/**
 * The offline harness's whole run for one document: the drafted document with IDs (assignFactIds), an identity check
 * and identity alert of its own, and the request rule. In the Worker these come from the case merge instead: identity
 * from the pipeline's fragment, the rules from the case rules.
 */
export async function buildFromAnswer(o: {
  caseId: string;
  doc: DocumentInput;
  calls: CallAnswer[];
  unreadPages?: number[];
  previous?: Pick<ExtractionRun, "facts" | "sources"> | null;
  issuedIds?: Iterable<string>;
}): Promise<BuildResult> {
  const { doc } = o;
  const d = await draftDocument(o);
  const sources = new Map(d.sources.map((x) => [x.id, x]));
  const { facts } = assignFactIds(o.caseId, d.facts, d.sources, o.previous ?? null, { issuedIds: o.issuedIds ?? [] });
  const first = d.checks[0]!;
  const checks: Check[] = [
    ...d.checks,
    { id: "chk-identity", looks_for: "identity", expected: null, covered: first.covered, unreadable: first.unreadable, result: doc.pages.some((p) => p.identity === "conflicts") ? "found" : "nothing_found" },
  ];
  // One identity alert per document, as the case merge raises it (packages/domain fragments.ts: rule
  // "identity_conflict", subject the document, the Fluent message "alert-identity-conflict" with the pages), so the
  // offline runs and the Worker's runs carry the same alert.
  const conflicting = doc.pages.filter((p) => p.identity === "conflicts").map((p) => p.page);
  const held = facts.filter((f: Fact) => f.quarantined && f.sources.some((sid) => conflicting.includes(sources.get(sid)?.page ?? -1))).map((f) => f.id);
  const identityAlerts: Alert[] = conflicting.length
    ? [{ id: alertId({ rule: "identity_conflict", subject: doc.documentId }), rule: "identity_conflict", subject: doc.documentId, kind: "identity", facts: held, message: { id: "alert-identity-conflict", args: { document: doc.documentId, page: conflicting.join(", ") } }, note: null }]
    : [];
  return { sources: d.sources as Source[], facts, checks, alerts: [...requestsWithoutResult(facts), ...identityAlerts], report: d.report };
}
