// The model's answer (schema.ts) -> codebridge.extraction/2 sources, facts, checks and identity alerts for one
// document, after the server-side checks (issue #20 phase 2; EXTRACTION-FORMAT.md, "Sources" and "Facts").
//
// What a fact must pass to be kept, and what makes it "verify" instead of "clear" (CLAUDE.md, "Clinical trust": a
// confident wrong statement is worse than an empty field, so every doubt lands on "verify" or drops the fact):
// - its quote is found verbatim in the part the model names (placeholders and all), and maps back to the original page
//   text, where it is anchored (character range, word boxes, the page text's hash); a quote that is not there drops
//   the fact;
// - a date it carries is in the page text as written, and keeps its precision;
// - a code it carries is in the page text; a code the page does not print is dropped (never invented);
// - the numbers of a TNM, a score, a dose or a grade are in the quote;
// - negation agrees with the quote's wording (a negation word in the quote of a positive finding, or none in the quote
//   of a negated one, is "verify");
// - a "done" fact whose quote reads like a request or a plan is "verify" (a sent request is not a done exam);
// - "confirmed by histology" needs histology or a biopsy in the document;
// - the page's readability and the reading's own "ověřit" marks carry over;
// - a page that names another patient quarantines its facts and raises an identity alert.
import type { Alert, Check, CertaintyReason, DocumentSource, DraftFact, IdentityResult, QuoteText, Source } from "@codebridge/domain/extraction/types";
import { alertId, sourceIdFor, valueText } from "@codebridge/domain/extraction/keys";
import { assignFactIds } from "@codebridge/domain/extraction/match";
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

// The quote in the pseudonymized part: verbatim up to whitespace (a line break in the page is a space in a quote).
// The first occurrence is taken; two identical passages on one page say the same thing.
export function findQuote(haystack: string, quote: string): [number, number] | null {
  const q = ws(quote);
  if (!q) return null;
  const re = new RegExp(q.split(" ").map(escape).join("\\s+"));
  const m = re.exec(haystack);
  return m ? [m.index, m.index + m[0].length] : null;
}

const contains = (text: string, needle: string) => !!needle && new RegExp(ws(needle).split(" ").map(escape).join("\\s+")).test(text);
const digitRuns = (s: string | null | undefined) => (s ?? "").match(/\d+/g) ?? [];

// Negation words, on folded text (no diacritics, lower case).
// "neguje" is the doctor's recorded negative; "0/14" lymph nodes is a count of none.
const NEG = /(?<![\p{L}])(bez|neg\.?|neguje|negovan\w*|negativ\w*|neprokaz\w*|nepotvrz\w*|nebyl\w*|nejsou|neni|zadn\w*|vyloucen\w*|nezjist\w*|nenalez\w*|nezastizen\w*|nezachycen\w*|nepritomn\w*|ne)(?![\p{L}])|(?<!\d)0\s*\/\s*\d+/u;
// Wording of a request or a plan, on folded text.
const NOT_DONE = /(objedn|zadan|zadost|planovan|indikovan|doporuc|k vysetreni|odeslan|bude provedeno|naplanovan)/;
const HISTOLOGY = /(histolog|biops|bioptick|cytolog|patolog)/;

type Doubt = CertaintyReason;

// The content words of a fact's text, cut to five letters so Czech endings do not matter ("metastázy" ~ "metastáz").
const significant = (s: string) => [...new Set(fold(s).split(/[^\p{L}\d]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)))];

function stageKindOf(tnm: string): "clinical" | "pathological" | "post_neoadjuvant" | null {
  const t = tnm.trim();
  if (/^y\s*p/i.test(t)) return "post_neoadjuvant";
  if (/^p/i.test(t)) return "pathological";
  if (/^c/i.test(t)) return "clinical";
  return null;
}

// "cT3b cN1 cM0 (MR pánve 16.3.2026)" -> "cT3b cN1 cM0"; "ypT2 ypN0 (0/14), R0" -> "ypT2 ypN0". The T, N and M
// categories as written (prefixes, suffixes, "is", "X", "mi"), in their order; null when none is recognised, so a
// stage is never normalised into something the document did not write.
export function normalizeTnm(asWritten: string | null): string | null {
  if (!asWritten) return null;
  const toks = asWritten.match(/(?<![\p{L}\d])(?:y|r|a)?(?:y)?[cp]?[TNM](?:is|[0-4]|X)[a-d]?(?:mi|\(sn\)|\(i[+-]\))?(?![\p{L}\d])/gu);
  return toks?.length ? toks.join(" ") : null;
}

// The value of a draft fact per kind, from the flat model fact.
function valueOf(f: ModelFact): DraftFact["value"] {
  switch (f.kind) {
    case "diagnosis":
      return { text: f.text, disease_status: f.disease_status, primary: f.primary ?? false };
    case "histology":
      return { specimen: f.specimen, result_text: f.text, tumour_type: f.tumour_type, grade: f.grade };
    case "stage":
      return { tnm_as_written: f.tnm_as_written ?? f.text, tnm: normalizeTnm(f.tnm_as_written ?? f.text), stage_kind: f.stage_kind ?? "clinical", edition: null, as_of: f.date_as_written, at_diagnosis: f.at_diagnosis };
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
    case "performance_status":
      return { scale: f.scale ?? "", value_as_written: f.value_as_written ?? "", value_numeric: Number.isFinite(Number(f.value_as_written)) ? Number(f.value_as_written) : null };
    case "comorbidity":
      return { text: f.text };
    case "allergy":
      return { substance: f.text, reaction: f.reaction };
    case "risk_factor":
      return { type: f.risk_type ?? "social", text: f.text, pack_years: f.pack_years };
    case "exam_finding":
      return { region: f.region, text: f.text };
  }
}

// What a request asked for, as words to look for in a later result ("CT hrudníku, břicha a pánve" -> ct, hrudniku...).
// Words that say what was requested, without the generic ones ("doplnit výsledek", "projednání", "vyšetření").
const GENERIC = new Set(["na", "pro", "za", "ve", "do", "a", "s", "k", "doplnit", "vysledek", "vysledku", "projednani", "vysetreni", "zadost", "pozadavek", "zadanka", "odeslan", "odeslana", "pripadu"]);
const words = (s: string) => new Set(fold(s).split(/[^\p{L}\d]+/u).filter((w) => w.length >= 2 && !GENERIC.has(w)));
const share = (a: Set<string>, b: Set<string>) => [...a].some((w) => b.has(w));
const RESULT_KINDS = new Set(["imaging", "procedure", "histology", "decision"]);

// A request with no later result in the run (CLAUDE.md failure case: "a referral with no result"; a sent request is not
// a done exam). A result is a done imaging, procedure, histology or decision fact dated on or after the request that
// shares a word with what was requested (the modality or the body: "CT", "PET", "seminář"). Doubtful pairs stay unlinked,
// so the alert errs toward "the result is missing", which a doctor can dismiss; a wrong link would hide a gap.
export function requestsWithoutResult(facts: Fact[]): Alert[] {
  const out: Alert[] = [];
  for (const r of facts) {
    if (r.kind !== "request" || r.status !== "requested" || r.quarantined || r.value.result_fact) continue;
    // The referral to an MDT, or its question, is what the case view is being prepared for; its result is the
    // coming meeting. A seminar or a consultation elsewhere is not, and keeps its alert.
    if (r.value.request_kind === "mdt") continue;
    const asked = words(r.value.what);
    const since = r.date.sort;
    const result = facts.find(
      (f) => RESULT_KINDS.has(f.kind) && f.status === "done" && !f.quarantined && f.date.sort && since && f.date.sort >= since && share(asked, words(valueText(f.value))),
    );
    if (result) continue;
    // The same request mentioned twice ("odeslána žádanka na CT" and "doplnit výsledek CT (žádanka 7.10.)") is one
    // alert resting on both facts, not two warnings.
    const twin = out.find((a) => a.facts.some((id) => {
      const o = facts.find((f) => f.id === id);
      return o?.kind === "request" && o.date.sort === r.date.sort && share(words(o.value.what), asked);
    }));
    if (twin) {
      twin.facts.push(r.id);
      continue;
    }
    out.push({ id: alertId({ rule: "request_without_result", subject: r.id }), rule: "request_without_result", subject: r.id, kind: "missing", facts: [r.id], message: { id: "alert-request-without-result", args: { fact: r.id } }, note: null });
  }
  return out;
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
};

export async function buildFromAnswer(o: {
  caseId: string;
  doc: DocumentInput;
  calls: CallAnswer[];
  /** Pages the model would not read (content filter, budget): listed as not read, never as "nothing found". */
  unreadPages?: number[];
  previous?: Pick<ExtractionRun, "facts" | "sources"> | null;
  issuedIds?: Iterable<string>;
}): Promise<BuildResult> {
  const { doc } = o;
  const report: BuildReport = { kept: 0, verify: 0, quarantined: 0, dropped: {}, reasons: {} };
  const drop = (r: DropReason) => (report.dropped[r] = (report.dropped[r] ?? 0) + 1);
  const hashes = await Promise.all(doc.pages.map((p) => sha256Hex(p.text)));
  const sources = new Map<string, DocumentSource>();
  const drafts: (DraftFact & { draft_id: string })[] = [];

  for (const call of o.calls) for (const f of call.answer.facts) {
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
    const at = findQuote(pseudo.text, f.quote);
    if (!at) {
      drop("quote_not_found");
      continue;
    }
    const [os, oe] = pseudo.originalRange(at[0], at[1]);
    const quote = page.text.slice(os, oe);
    const fq = fold(quote);
    const doubts: Doubt[] = [];
    const doubt = (code: string, text: string) => doubts.push({ code, text });

    // The date must be on the page as written; otherwise it is not kept (never a guessed date).
    let date = parseDate(null);
    if (f.date_as_written) {
      if (contains(page.text, f.date_as_written) || contains(pseudo.text, f.date_as_written)) {
        date = parseDate(f.date_as_written);
        // A date from the page but not from the quote may belong to a neighbouring clause (a stop date taken for a
        // start, the date of the exam that recommended a plan); the fact keeps it, marked for checking.
        if (!contains(quote, f.date_as_written)) doubt("date_outside_quote", `Datum „${f.date_as_written}“ není v citaci; ověřte, že patří k tomuto faktu.`);
      } else doubt("date_not_in_text", `Datum „${f.date_as_written}“ v textu strany není; neuvedeno.`);
    }
    if (f.kind === "systemic_therapy" && f.stop_as_written && f.date_as_written && ws(f.stop_as_written) === ws(f.date_as_written)) {
      doubt("start_equals_stop", "Začátek a konec léčby mají stejné datum; ověřte.");
    }
    // A code is kept only when the page prints it.
    const codes: DraftFact["codes"] = [];
    if (f.code) {
      if (page.text.replace(/\s/g, "").includes(f.code.replace(/\s/g, ""))) {
        codes.push({ system: /^[A-Z]\d{2}(\.\d{1,2})?$/.test(f.code.trim()) ? "mkn-10" : "other", code: f.code.trim(), assigned_by: "source" });
      } else doubt("code_not_in_text", `Kód ${f.code} v textu strany není; vynechán.`);
    }
    // Numbers the fact states must be in its quote.
    const qd = new Set(digitRuns(quote));
    const stated = [f.tnm_as_written, f.value_as_written, f.grade, f.dose, f.line != null ? String(f.line) : null];
    if (stated.flatMap(digitRuns).some((d) => !qd.has(d))) doubt("number_not_in_quote", "Číslo uvedené ve faktu není v citaci.");
    if (f.tnm_as_written && !contains(quote, f.tnm_as_written)) doubt("tnm_not_in_quote", "TNM není v citaci doslova.");
    // Negation agrees with the wording.
    const negWord = NEG.test(fq);
    const negated = f.negated || f.metastasis_status === "excluded";
    if (negated && !negWord) doubt("negation_unclear", "Fakt je zápor, ale citace zápor neobsahuje.");
    // "Bez plicní embolie; drobná cysta vpravo": a negated fact whose own text has a clause without a negation holds a
    // positive finding too, and a view that shows "no ..." would hide it.
    const clauses = fold(f.text).split(/[;,]|\s(?:ale|avsak|vsak|jen|pouze)\s/).filter((c) => c.trim().length > 3);
    if (negated && clauses.length > 1 && clauses.some((c) => NEG.test(c)) && clauses.some((c) => !NEG.test(c)))
      doubt("mixed_negation", "Zápor platí jen pro část textu faktu; ověřte pozitivní nález.");
    if (!negated && negWord && ["metastasis", "imaging", "symptom", "diagnosis", "histology", "comorbidity"].includes(f.kind))
      doubt("negation_unclear", "Citace obsahuje zápor; ověřte, zda se týká tohoto nálezu.");
    if (f.status === "done" && NOT_DONE.test(fq)) doubt("status_unclear", "Citace zní jako žádost nebo plán, ne jako provedené vyšetření.");
    if (f.disease_status === "confirmed_histology" && !HISTOLOGY.test(fold(page.text)) && !doc.pages.some((p) => HISTOLOGY.test(fold(p.text))))
      doubt("histology_not_in_document", "Potvrzení histologií dokument neuvádí.");
    if (f.kind === "stage" && f.tnm_as_written) {
      const k = stageKindOf(f.tnm_as_written);
      if (k && f.stage_kind && k !== f.stage_kind) doubt("stage_kind_unclear", "Druh stádia neodpovídá předponě TNM.");
    }
    const said = significant(f.text);
    if (said.length >= 2 && said.filter((w) => fq.includes(w)).length / said.length < 0.5)
      doubt("text_not_in_quote", "Citace neobsahuje to, co fakt tvrdí; ověřte ve zdroji.");
    if (page.readability === "poor" || page.readability === "empty") doubt("poor_copy", "Strana je špatně čitelná.");
    if (page.verify.some(([s, e]) => s < oe && e > os)) doubt("ocr_check", "Čtení stránky se v citaci liší (ověřit).");
    if (f.certainty === "verify") doubt("model_unsure", f.uncertainty?.trim() || "Model si čtením nebo významem nebyl jistý.");

    const box = page.words ? matchImage(quote, page.words) : null;
    const srcBody: Omit<DocumentSource, "id"> = {
      type: "document",
      document_id: doc.documentId,
      part: doc.part,
      page: page.page,
      quote,
      quote_text: page.quoteText,
      anchor: { page_text_sha256: hashes[pi]!, engine: page.engine, char_range: [os, oe], boxes: box?.boxes ?? [] },
      reported_as: f.reported_as,
      identity: page.identity,
      reading_check: null,
    };
    const sid = sourceIdFor(srcBody, new Set(sources.keys()));
    const existing = [...sources.values()].find((s) => s.page === srcBody.page && s.anchor?.char_range[0] === os && s.anchor?.char_range[1] === oe);
    const sourceId = existing?.id ?? sid;
    if (!existing) sources.set(sid, { id: sid, ...srcBody });

    const quarantined = page.identity === "conflicts";
    for (const d of doubts) report.reasons[d.code] = (report.reasons[d.code] ?? 0) + 1;
    drafts.push({
      draft_id: `d${drafts.length}`,
      kind: f.kind,
      subject: f.kind === "family_history" ? "relative" : f.subject,
      value: valueOf(f),
      date,
      status: f.status,
      negated,
      not_stated: [],
      origin: "document",
      certainty: doubts.length ? "verify" : "clear",
      certainty_reason: doubts.length ? { code: doubts[0]!.code, text: doubts.map((d) => d.text).join(" ") } : null,
      codes,
      note: null,
      quarantined,
      sources: [sourceId],
    } as DraftFact & { draft_id: string });
  }

  // The same statement read twice (two pages, or the model listing it twice) is one fact with both sources.
  const merged: typeof drafts = [];
  for (const d of drafts) {
    const same = merged.find(
      (m) => m.kind === d.kind && JSON.stringify(m.value) === JSON.stringify(d.value) && m.negated === d.negated && m.status === d.status && m.subject === d.subject && m.date.as_written === d.date.as_written,
    );
    if (!same) merged.push(d);
    else {
      same.sources = [...new Set([...same.sources, ...d.sources])];
      same.quarantined = same.quarantined || d.quarantined;
      if (d.certainty === "verify" && same.certainty === "clear") Object.assign(same, { certainty: "verify", certainty_reason: d.certainty_reason });
    }
  }

  const sourceList: Source[] = [...sources.values()];
  const { facts } = assignFactIds(o.caseId, merged, sourceList, o.previous ?? null, { issuedIds: o.issuedIds ?? [] });
  report.kept = facts.length;
  report.verify = facts.filter((f) => f.certainty === "verify").length;
  report.quarantined = facts.filter((f) => f.quarantined).length;

  const covered = [{ document_id: doc.documentId, part: doc.part }];
  const unread = new Set(o.unreadPages ?? []);
  const unreadable = doc.pages
    .filter((p, i) => p.readability === "empty" || unread.has(i))
    .map((p) => ({ document_id: doc.documentId, part: doc.part, page: p.page }));
  const checks: Check[] = [
    ...EXTRACT_KINDS.map((k) => ({ id: `chk-${k}`, looks_for: k, expected: null, covered, unreadable, result: facts.some((f) => f.kind === k) ? ("found" as const) : ("nothing_found" as const) })),
    { id: "chk-identity", looks_for: "identity", expected: null, covered, unreadable, result: doc.pages.some((p) => p.identity === "conflicts") ? "found" : "nothing_found" },
  ];
  const alerts: Alert[] = [...requestsWithoutResult(facts), ...identityAlerts()];
  function identityAlerts(): Alert[] {
    return doc.pages
    .filter((p) => p.identity === "conflicts")
    .map((p) => {
      const subject = `${doc.documentId}/p${p.page}`;
      const onPage = facts.filter((f: Fact) => f.sources.some((sid) => sources.get(sid)?.page === p.page)).map((f) => f.id);
      return { id: alertId({ rule: "identity_page_conflict", subject }), rule: "identity_page_conflict", subject, kind: "identity", facts: onPage, message: { id: "alert-identity-page", args: { document: doc.documentId, page: p.page } }, note: null };
    });
  }
  return { sources: sourceList, facts, checks, alerts, report };
}
