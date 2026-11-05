/// <reference path="../txt.d.ts" />
// One bounded OpenRouter call with web search, and the checks that decide which answers a doctor may see. A port of
// prognosis/service.py (all of it except profile_for, which lives in packages/domain/src/prognosis-profile.ts).
//
// The checks are the safety of the feature: every value needs a source URL that the provider cited, an exact quote that
// appears in that citation's excerpt, the same dated publication, and a number that occurs in its quote; similarity
// comes only from verbatim patient and study quotes. The result stays "model_extracted_unverified". No retries on any
// error (one requested model call), and nothing from a request or a response is ever logged or put in an error.
import type { Profile } from "@codebridge/domain/prognosis-profile";
import { dateEnd } from "@codebridge/domain/prognosis-profile";
import PROMPT from "../prompts/prognosis.txt";

export type SearchOptions = {
  profile: Profile;
  apiKey: string;
  model: string;
  modelLabel?: string;
  reasoningEffort?: string;
  fetchFn?: typeof fetch;
  now?: Date;
};

export class PrognosisProblem extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Python's ValueError, KeyError, TypeError and AttributeError, which its run() reports as "the model did not return the
// required structure". A JsonScanError is a JSON syntax problem (Python's JSONDecodeError).
class ValueErr extends Error {}
class JsonScanError extends ValueErr {
  pos: number;
  msg: string;
  constructor(pos: number, msg: string) {
    super("json");
    this.pos = pos;
    this.msg = msg;
  }
}

// Response bodies are model output and provider JSON: untyped on purpose, every access below is checked.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;

export const PROGNOSIS_PROMPT: string = PROMPT;
export const ENDPOINTS = ["os_6", "os_12", "os_36", "os_60", "pfs", "orr", "dor", "toxicity_grade3", "discontinuation_toxicity", "burden"] as const;
export const WEIGHTS: Record<string, number> = { histology: 25, stage: 15, biomarkers: 15, treatment_line: 15, prior_treatment: 10, performance_status: 10, brain_metastases: 5, age: 5 };
export const MAX_RESPONSE = 2_000_000;
const CHAT_BUDGET_MS = 240_000;
const CATALOG_BUDGET_MS = 30_000;
const CATALOG_TTL_MS = 3_600_000;
const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const EFFORTS = ["low", "medium", "high", "xhigh", "max", "minimal"];

// ---- small helpers that keep Python's meaning ----

const isObj = (v: unknown): v is Record<string, J> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number";
// Python truthiness: an empty list or dict is false, unlike in JavaScript.
const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0));
// Python's `x.get(...)` on something that must be a dict; anything else is a schema error (Python's AttributeError).
const obj = (v: unknown): Record<string, J> => {
  if (!isObj(v)) throw new ValueErr("not_object");
  return v;
};
const has = (o: Record<string, J>, k: string) => Object.hasOwn(o, k);
const codePoints = (s: string) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) i++;
    n++;
  }
  return n;
};
// Python slices count code points, not UTF-16 units.
const cut = (s: string, n: number) => (s.length <= n ? s : Array.from(s).slice(0, n).join(""));
// Python's str() for the values the rows keep (a confidence interval, a DOI): same text for strings and integers.
const pyStr = (v: unknown): string => {
  if (isStr(v)) return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (isNum(v)) return String(v);
  return JSON.stringify(v);
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
// Python's round() takes a half to the even neighbour; Math.round takes it up.
const roundHalfEven = (x: number) => {
  const f = Math.floor(x);
  const d = x - f;
  return d === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
};
const WORD = "[\\p{L}\\p{N}_]";
const SORT = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---- URLs ----

// Only HTTPS, no credentials, port 443, a dotted DNS name (never an address or localhost). Returns the value unchanged.
export function safeUrl(value: unknown): string | null {
  if (!isStr(value) || value.length > 2000) return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(value);
  if (!m || m[1]!.toLowerCase() !== "https") return null;
  const authority = m[2]!;
  if (authority.includes("@")) return null;
  const colon = authority.lastIndexOf(":");
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  const port = colon >= 0 ? authority.slice(colon + 1) : "";
  if (port !== "" && (!/^\d+$/.test(port) || Number(port) !== 443)) return null;
  if (!/^[A-Za-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  if (host === "localhost" || host === "127.0.0.1" || /^[\d.]+$/.test(host)) return null;
  return value;
}

// quote_plus: letters, digits and _.-~ stay, a space is "+", everything else is %XX.
const quotePlus = (s: string) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
const unquotePlus = (s: string) => {
  const t = s.replace(/\+/g, " ");
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
};

// The identity of a source: lower-case host, path without a trailing slash, and the query without tracking
// parameters, sorted. Semantic query parameters stay part of the identity. Takes only a value safeUrl accepted.
export function urlKey(value: string): string {
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/.exec(value);
  if (!m) return "";
  const authority = m[1]!;
  const colon = authority.lastIndexOf(":");
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  const pairs: [string, string][] = [];
  for (const part of (m[3] ?? "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = unquotePlus(eq >= 0 ? part.slice(0, eq) : part);
    const v = eq >= 0 ? unquotePlus(part.slice(eq + 1)) : "";
    const lk = k.toLowerCase();
    if (lk.startsWith("utm_") || lk === "gclid" || lk === "fbclid") continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => SORT(a[0], b[0]) || SORT(a[1], b[1]));
  const query = pairs.map(([k, v]) => quotePlus(k) + "=" + quotePlus(v)).join("&");
  return host + m[2]!.replace(/\/+$/, "") + (query ? "?" + query : "");
}

// ---- citations ----

// The search excerpts the provider reports, per source. A quote must sit inside ONE excerpt: the excerpts of a source
// are split at "[...]" so a quote is never assembled across separate passages.
export function excerptCitations(message: Record<string, J>): Record<string, string[]> {
  const citations: Record<string, string[]> = Object.create(null);
  const annotations = has(message, "annotations") ? message.annotations : [];
  if (!Array.isArray(annotations)) return citations;
  for (const annotation of annotations) {
    if (!isObj(annotation) || annotation.type !== "url_citation") continue;
    const citation = annotation.url_citation;
    if (!isObj(citation) || !safeUrl(citation.url)) continue;
    const content = citation.content;
    if (!isStr(content) || !content.trim()) continue;
    const chunks = content.split("[...]").map(squash);
    const key = urlKey(citation.url);
    (citations[key] ??= []).push(...chunks.filter((x) => x));
  }
  return citations;
}

export function quoted(quote: unknown, chunks: string[]): boolean {
  return isStr(quote) && !!quote.trim() && chunks.some((chunk) => chunk.includes(squash(quote)));
}

// ---- rows ----

const isoDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  return y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
};

// Profile as the checks need it: the facts and the evidence cutoff the run adds.
export type CheckedProfile = Pick<Profile, "facts"> & { evidence_cutoff: string };

// Checks one model row against its source and the profile; null drops the row, a null endpoint drops that value.
// `citations` undefined means "do not check against excerpts" (only the tests call it that way).
export function normalizeRow(raw: unknown, model: string, profile: CheckedProfile, citations?: Record<string, string[]>): J | null {
  if (!isObj(raw)) return null;
  const source = raw.source;
  if (!isObj(source) || !safeUrl(source.url)) return null;
  const sourceKey = urlKey(source.url);
  const cited = citations === undefined ? undefined : Object.hasOwn(citations, sourceKey) ? citations[sourceKey]! : null;
  if (citations !== undefined && cited === null) return null;
  const title = raw.study_title, arm = raw.arm, population = raw.population;
  if (![title, arm, population].every((x) => isStr(x) && x.trim())) return null;
  const year = source.year;
  const published = source.published_date ?? null;
  const cutoff: string = profile.evidence_cutoff;
  const cutoffYear = Number(cutoff.slice(0, 4));
  if (!isNum(year) || !Number.isInteger(year) || year < 1900 || year > cutoffYear) return null;
  if (!truthy(published) && `${year}-12-31` > cutoff) return null;
  if (truthy(published)) {
    // A publication date must be a real day on or before the cutoff; anything else drops the row.
    if (!isStr(published) || !isoDate(published) || published > cutoff) return null;
  }
  const endpointsRaw = truthy(raw.endpoints) ? obj(raw.endpoints) : {};
  const endpoints: Record<string, J> = {};
  for (const key of ENDPOINTS) {
    const e = endpointsRaw[key];
    if (!isObj(e) || !isStr(e.quote) || codePoints(e.quote.trim()) < 12 || !safeUrl(e.source_url)) {
      endpoints[key] = null;
      continue;
    }
    // Every endpoint must reference this dated publication; later follow-ups need their own row and cutoff check.
    if (urlKey(e.source_url) !== sourceKey) { endpoints[key] = null; continue; }
    if (cited !== undefined && !quoted(e.quote, cited ?? [])) { endpoints[key] = null; continue; }
    const value = e.value, unit = e.unit;
    if (typeof value === "boolean" || !(isNum(value) || isStr(value)) || (isStr(value) && !value.trim())) { endpoints[key] = null; continue; }
    const expected = key === "burden" ? "text" : key.startsWith("os_") || key === "orr" || key === "toxicity_grade3" || key === "discontinuation_toxicity" ? "%" : "months";
    if (unit !== expected) { endpoints[key] = null; continue; }
    if (expected === "%" && !isNum(value)) { endpoints[key] = null; continue; }
    if (expected === "months" && isStr(value) && !["not reached", "nedosažen", "nedosaženo", "nr"].includes(value.toLowerCase())) { endpoints[key] = null; continue; }
    if (isNum(value) && (value < 0 || !Number.isFinite(value) || (expected === "%" && value > 100))) { endpoints[key] = null; continue; }
    if (isNum(value)) {
      const numbers = e.quote.match(new RegExp(`(?<!${WORD})\\d+(?:[.,]\\d+)?(?!${WORD})`, "gu")) ?? [];
      if (!numbers.some((n) => Math.abs(Number(n.replace(",", ".")) - value) < 1e-9)) { endpoints[key] = null; continue; }
    }
    if (key.startsWith("os_") && !truthy(raw.time_origin)) { endpoints[key] = null; continue; }
    endpoints[key] = {
      value: isNum(value) ? value : cut(value, 1500),
      unit,
      ci: truthy(e.ci) ? cut(pyStr(e.ci), 300) : null,
      quote: cut(e.quote, 1500),
      source_url: e.source_url,
      verification: "model_extracted_unverified",
      found_by: [model],
      quote_matched_search_excerpt: citations !== undefined,
    };
  }
  // A model's match claim needs exact supplied fact evidence on both sides; no evidence means unknown.
  const dimensions: J[] = [];
  let numerator = 0, known = 0;
  const critical: string[] = [];
  const factText = profile.facts.map((f) => f.text);
  const matching = truthy(raw.matching) ? obj(raw.matching) : {};
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const c = isObj(matching[key]) ? (matching[key] as Record<string, J>) : {};
    let status: unknown = c.status;
    const pq = c.patient_quote, sq = c.study_quote;
    if (key === "performance_status") {
      // Only the newest dated ECOG/KPS fact counts as the patient's current state.
      const performance = new RegExp(`(?<!${WORD})(?:ECOG|KPS|Karnofsky)(?!${WORD})`, "iu");
      const candidates = profile.facts.filter((f) => performance.test(f.text));
      if (candidates.length) {
        const latest = candidates.map((f) => dateEnd(f.date) ?? "").reduce((a, b) => (a >= b ? a : b));
        const current = candidates.filter((f) => (dateEnd(f.date) ?? "") === latest).map((f) => f.text);
        if (!isStr(pq) || !current.some((t) => t.includes(pq))) status = "unknown";
      }
    }
    if (cited !== undefined && !quoted(sq, cited ?? [])) status = "unknown";
    if ((status !== "match" && status !== "mismatch") || !isStr(pq) || codePoints(pq) < 8 || !factText.some((t) => t.includes(pq)) || !isStr(sq) || codePoints(sq) < 8) status = "unknown";
    if (status !== "unknown") {
      known += weight;
      if (status === "match") numerator += weight;
      else if (key === "histology" || key === "biomarkers" || key === "treatment_line") critical.push(key);
    }
    dimensions.push({
      key,
      weight,
      status,
      patient_quote: isStr(pq) ? cut(pq, 500) : null,
      study_quote: isStr(sq) ? cut(sq, 500) : null,
      explanation: cut(pyStr(has(c, "explanation") ? c.explanation : ""), 600),
    });
  }
  return {
    cohort_id: isStr(raw.cohort_id) ? raw.cohort_id : null,
    arm_id: isStr(raw.arm_id) ? raw.arm_id : null,
    analysis_id: isStr(raw.analysis_id) ? raw.analysis_id : null,
    study_title: cut(title as string, 500),
    arm: cut(arm as string, 700),
    population: cut(population as string, 1500),
    sample_size: isNum(raw.sample_size) && Number.isInteger(raw.sample_size) && raw.sample_size > 0 ? raw.sample_size : null,
    source: {
      url: source.url,
      doi: truthy(source.doi) ? cut(pyStr(source.doi), 200) : null,
      pmid: truthy(source.pmid) ? cut(pyStr(source.pmid), 40) : null,
      year,
      published_date: published,
    },
    time_origin: truthy(raw.time_origin) ? cut(pyStr(raw.time_origin), 600) : null,
    endpoints,
    found_by: [model],
    similarity: {
      found_by: [model],
      score: known ? roundHalfEven((numerator / known) * 100) : null,
      coverage: known,
      dimensions,
      critical_mismatches: critical,
      method: "Heuristická shoda mezi známými údaji; není pravděpodobnost přežití. Porovnání provedl model, výpočet server.",
    },
    verification: "model_extracted_unverified",
    conflicts: [],
  };
}

// Rows merge only when the canonical publication ID, the time origin and the cohort/arm description agree. Conflicting
// endpoint values are kept in `conflicts` and the shown endpoint is null (never averaged).
export function deduplicate(rows: J[]): J[] {
  const merged = new Map<string, J>();
  const sorted = (xs: string[]) => [...new Set(xs)].sort(SORT);
  for (const row of rows) {
    const source = row.source;
    let doi = pyStr(truthy(source.doi) ? source.doi : "").trim().toLowerCase();
    doi = doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/, "").replace(/\/+$/, "");
    let pmid = pyStr(truthy(source.pmid) ? source.pmid : "").trim().toLowerCase();
    pmid = pmid.replace(/^(?:https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/|pmid:\s*)/, "").replace(/\/+$/, "");
    const url: string = source.url;
    const urlDoi = /doi\.org\/(10\.[^?#]+)/i.exec(url);
    const urlPmid = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i.exec(url);
    const identity = doi || urlDoi ? "doi:" + (doi || urlDoi![1]!.toLowerCase().replace(/\/+$/, "")) : pmid || urlPmid ? "pmid:" + (pmid || urlPmid![1]!) : urlKey(url);
    const stable = ["cohort_id", "arm_id", "analysis_id"].map((x) => row[x]);
    const dimensions = stable.every((x) => isStr(x) && x.trim())
      ? stable.map((x) => (x as string).trim().toLowerCase())
      : [row.arm.trim().toLowerCase(), row.population.trim().toLowerCase(), row.time_origin];
    const key = JSON.stringify([identity, dimensions, row.time_origin]);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, structuredClone(row));
      continue;
    }
    existing.found_by = sorted([...existing.found_by, ...row.found_by]);
    for (const field of ENDPOINTS) {
      const old = existing.endpoints[field], next = row.endpoints[field];
      const prior = existing.conflicts.find((c: J) => c.field === field);
      if (prior) {
        if (next !== null) prior.values.push(next);
        continue;
      }
      if (old === null) existing.endpoints[field] = next;
      else if (next !== null && !(old.value === next.value && old.unit === next.unit && old.ci === next.ci)) {
        existing.conflicts.push({ field, values: [old, next], found_by: sorted([...(old.found_by ?? []), ...row.found_by]) });
        existing.endpoints[field] = null;
      } else if (next !== null) old.found_by = sorted([...(old.found_by ?? []), ...(next.found_by ?? [])]);
    }
    const semantic = (s: J) => JSON.stringify([s.score, s.coverage, s.dimensions.map((x: J) => [x.key, x.status]), s.critical_mismatches]);
    if (semantic(existing.similarity) !== semantic(row.similarity)) {
      existing.similarity_variants = [...(existing.similarity_variants ?? [existing.similarity]), row.similarity];
      existing.similarity = {
        score: null,
        coverage: 0,
        dimensions: [],
        critical_mismatches: sorted([...existing.similarity.critical_mismatches, ...row.similarity.critical_mismatches]),
        method: "Modely se liší v posouzení podobnosti; ověřte podklady.",
      };
    } else existing.similarity.found_by = sorted([...(existing.similarity.found_by ?? []), ...(row.similarity.found_by ?? [])]);
  }
  return [...merged.values()];
}

// ---- recovery of a truncated answer ----

// A JSON scanner that finds where a value ends and fails exactly where Python's raw_decode fails (error position and
// the "Unterminated string" message decide whether a cut-off row is recoverable). It does not build the value.
const wsJson = (t: string, i: number) => {
  while (i < t.length && (t[i] === " " || t[i] === "\t" || t[i] === "\n" || t[i] === "\r")) i++;
  return i;
};
function scanString(t: string, begin: number): number {
  let i = begin + 1;
  for (;;) {
    if (i >= t.length) throw new JsonScanError(begin, "Unterminated string starting at");
    const c = t.charCodeAt(i);
    if (c === 34) return i + 1;
    if (c === 92) {
      if (i + 1 >= t.length) throw new JsonScanError(begin, "Unterminated string starting at");
      const n = t[i + 1]!;
      if (n === "u") {
        if (!/^[0-9a-fA-F]{4}$/.test(t.slice(i + 2, i + 6))) throw new JsonScanError(i, "Invalid \\uXXXX escape");
        i += 6;
      } else if ('"\\/bfnrt'.includes(n)) i += 2;
      else throw new JsonScanError(i, "Invalid \\escape");
      continue;
    }
    if (c < 32) throw new JsonScanError(i, "Invalid control character at");
    i++;
  }
}
function scanValue(t: string, pos: number, depth: number): number {
  if (depth > 200) throw new JsonScanError(pos, "Too deep");
  const ch = t[pos];
  if (ch === undefined) throw new JsonScanError(pos, "Expecting value");
  if (ch === '"') return scanString(t, pos);
  if (ch === "{") {
    let i = wsJson(t, pos + 1);
    if (t[i] === "}") return i + 1;
    for (;;) {
      if (t[i] !== '"') throw new JsonScanError(i, "Expecting property name enclosed in double quotes");
      i = wsJson(t, scanString(t, i));
      if (t[i] !== ":") throw new JsonScanError(i, "Expecting ':' delimiter");
      i = wsJson(t, scanValue(t, wsJson(t, i + 1), depth + 1));
      if (t[i] === "}") return i + 1;
      if (t[i] !== ",") throw new JsonScanError(i, "Expecting ',' delimiter");
      i = wsJson(t, i + 1);
    }
  }
  if (ch === "[") {
    let i = wsJson(t, pos + 1);
    if (t[i] === "]") return i + 1;
    for (;;) {
      i = wsJson(t, scanValue(t, i, depth + 1));
      if (t[i] === "]") return i + 1;
      if (t[i] !== ",") throw new JsonScanError(i, "Expecting ',' delimiter");
      i = wsJson(t, i + 1);
    }
  }
  for (const lit of ["null", "true", "false"]) if (t.startsWith(lit, pos)) return pos + lit.length;
  const num = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
  num.lastIndex = pos;
  if (num.test(t)) return num.lastIndex;
  throw new JsonScanError(pos, "Expecting value");
}

// Complete rows only, from the root `rows` array of an answer cut off by the output limit. Never a half row, never an
// invented closing; junk anywhere rejects the whole recovery.
export function recoverCompleteRows(text: string): Record<string, J>[] {
  const space = (i: number) => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    return i;
  };
  let pos = space(0);
  if (pos >= text.length || text[pos] !== "{") throw new ValueErr("invalid_root");
  pos++;
  for (;;) {
    pos = space(pos);
    const keyEnd = scanValue(text, pos, 0);
    const key: unknown = JSON.parse(text.slice(pos, keyEnd));
    pos = keyEnd;
    if (!isStr(key)) throw new ValueErr("invalid_key");
    pos = space(pos);
    if (pos >= text.length || text[pos] !== ":") throw new ValueErr("invalid_header");
    pos = space(pos + 1);
    if (key === "rows") break;
    pos = space(scanValue(text, pos, 0));
    if (pos >= text.length || text[pos] !== ",") throw new ValueErr("no_rows_array");
    pos++;
  }
  if (pos >= text.length || text[pos] !== "[") throw new ValueErr("invalid_rows");
  pos++;
  const rows: Record<string, J>[] = [];
  let afterComma = false;
  for (;;) {
    pos = space(pos);
    if (pos === text.length) return rows;
    if (text[pos] === "]") {
      if (afterComma && rows.length) throw new ValueErr("trailing_comma");
      if (!["", "}"].includes(text.slice(pos + 1).trim())) throw new ValueErr("invalid_array_suffix");
      return rows;
    }
    if (text[pos] !== "{") throw new ValueErr("invalid_row_prefix");
    let end: number;
    try {
      end = scanValue(text, pos, 0);
    } catch (error) {
      // Only a genuine unfinished JSON suffix is recoverable; invalid tokens, escapes and junk reject everything.
      if (error instanceof JsonScanError && (error.pos >= text.length || error.msg.startsWith("Unterminated string"))) return rows;
      throw new ValueErr("malformed_row_suffix");
    }
    rows.push(JSON.parse(text.slice(pos, end)));
    afterComma = false;
    if (rows.length > 40) throw new ValueErr("too_many_rows");
    pos = space(end);
    if (pos === text.length) return rows;
    if (text[pos] === "]") {
      if (!["", "}"].includes(text.slice(pos + 1).trim())) throw new ValueErr("invalid_array_suffix");
      return rows;
    }
    if (text[pos] !== ",") throw new ValueErr("invalid_row_separator");
    pos++;
    afterComma = true;
  }
}

// ---- provider errors ----

// Provider messages may echo the input, so only an allowlisted category and a numeric code ever leave this function.
export function checkProviderError(response: unknown): void {
  if (!isObj(response) || !truthy(response.error)) return;
  const error = response.error;
  const code = isObj(error) ? error.code : null;
  const message = isObj(error) ? pyStr(has(error, "message") ? error.message : "").toLowerCase() : "";
  let category = "Služba vrátila chybu v odpovědi.";
  const table: [string[], string][] = [
    [["credit", "balance", "insufficient funds"], "Nedostatečný kredit nebo omezení účtování."],
    [["unauthorized", "authentication", "invalid api key"], "Služba odmítla ověření klíče."],
    [["rate limit", "too many requests"], "Služba omezila počet požadavků."],
    [["data collection", "privacy", "no endpoints"], "Není dostupný poskytovatel odpovídající nastavení soukromí."],
    [["unsupported", "not supported", "tool"], "Služba odmítla nástroj nebo parametr požadavku."],
    [["context", "maximum tokens"], "Požadavek překročil limit kontextu nebo tokenů."],
  ];
  for (const [tokens, description] of table) {
    if (tokens.some((t) => message.includes(t))) {
      category = description;
      break;
    }
  }
  const label = isNum(code) && Number.isInteger(code) && code >= 100 && code <= 599 ? String(code) : "neznámý kód";
  throw new PrognosisProblem("provider_error", "OpenRouter (" + label + "): " + category, 502);
}

// ---- transport ----

// One request with a total time budget, a body cap and no redirects. Errors carry only allowlisted messages.
async function remoteJson(fetchFn: typeof fetch, url: string, payload: unknown, key: string | null): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "CodeBridge-Prognosis/1.0" };
  if (key) headers.Authorization = "Bearer " + key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), payload !== undefined ? CHAT_BUDGET_MS : CATALOG_BUDGET_MS);
  let bytes: Uint8Array;
  try {
    const response = await fetchFn(url, {
      method: payload !== undefined ? "POST" : "GET",
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
    if ((response.type as string) === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new PrognosisProblem("redirect", "Neočekávané přesměrování služby.", 502);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PrognosisProblem("provider_http", "OpenRouter vrátil HTTP " + response.status + ". Bez automatického opakování.", 502);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE) {
          await reader.cancel().catch(() => undefined);
          throw new PrognosisProblem("response_too_large", "Odpověď překročila povolenou velikost.", 502);
        }
        chunks.push(value);
      }
    }
    bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
  } catch (error) {
    if (error instanceof PrognosisProblem) throw error;
    throw new PrognosisProblem("provider_network", "OpenRouter není dostupný nebo vypršel časový limit.", 502);
  } finally {
    clearTimeout(timer);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new PrognosisProblem("provider_json", "OpenRouter vrátil neplatnou odpověď.", 502);
  }
}

// The model catalog, per isolate for an hour: a model that is not in it is never called.
let catalogCache: { at: number; models: Map<string, Record<string, J>> } | null = null;
export function resetCatalogCache(): void {
  catalogCache = null;
}
async function catalogModel(fetchFn: typeof fetch, id: string): Promise<Record<string, J>> {
  if (!catalogCache || catalogCache.models.size === 0 || Date.now() - catalogCache.at > CATALOG_TTL_MS) {
    const catalog = await remoteJson(fetchFn, CATALOG_URL, undefined, null);
    if (!isObj(catalog) || !Array.isArray(catalog.data)) throw new PrognosisProblem("provider_json", "OpenRouter vrátil neplatnou odpověď.", 502);
    const models = new Map<string, Record<string, J>>();
    for (const x of catalog.data) if (isObj(x) && isStr(x.id)) models.set(x.id, x);
    catalogCache = { at: Date.now(), models };
  }
  const entry = catalogCache.models.get(id);
  if (!entry) throw new PrognosisProblem("model_unavailable", "Nakonfigurovaný model není v katalogu OpenRouter: " + id, 503);
  return entry;
}

// ---- the search ----

// Python's datetime.isoformat() for UTC: microseconds only when not zero, "+00:00" for the zone.
const isoUtc = (d: Date) => {
  const ms = d.getUTCMilliseconds();
  return d.toISOString().slice(0, 19) + (ms ? "." + String(ms).padStart(3, "0") + "000" : "") + "+00:00";
};

export async function searchStudies(o: SearchOptions): Promise<Record<string, unknown>> {
  const fetchFn: typeof fetch = o.fetchFn ?? fetch;
  const now = o.now ?? new Date();
  const scheduled = o.profile.scheduled_date;
  if (!isStr(scheduled) || !isoDate(scheduled)) throw new PrognosisProblem("invalid_date", "Datum MDT není platné.");
  const today = now.toISOString().slice(0, 10);
  // Evidence published after the earlier of the MDT date and today is never used.
  const profile: CheckedProfile & Profile = { ...o.profile, evidence_cutoff: today < scheduled ? today : scheduled };
  if (!o.apiKey) throw new PrognosisProblem("missing_key", "Na serveru chybí klíč OpenRouter.", 503);
  const label = o.modelLabel ?? "GPT Astra";
  if (!o.model) throw new PrognosisProblem("models_not_configured", "Doplňte přesné ID modelu GPT Astra do serverového .env.", 503);
  const entry = await catalogModel(fetchFn, o.model);
  const model = { id: o.model, label, catalog_name: isStr(entry.name) ? entry.name : o.model };
  const effort = o.reasoningEffort ?? "";
  if (effort && !EFFORTS.includes(effort)) throw new PrognosisProblem("invalid_reasoning_effort", "Neplatná konfigurace reasoning effort.", 503);

  const payload: Record<string, J> = {
    model: model.id,
    messages: [
      { role: "system", content: PROMPT },
      { role: "user", content: JSON.stringify(profile) },
    ],
    tools: [{ type: "openrouter:web_search", parameters: { engine: "exa", max_uses: 4, max_results: 5, max_total_results: 20 } }],
    max_tokens: 14000,
    max_tool_calls: 4,
    response_format: { type: "json_object" },
    provider: { allow_fallbacks: false, data_collection: "deny" },
  };
  const supported: unknown[] = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  if (supported.includes("temperature")) payload.temperature = 0;
  const reasoning = isObj(entry.reasoning) ? entry.reasoning : {};
  const efforts: unknown[] = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : [];
  if (effort && supported.includes("reasoning") && efforts.includes(effort)) payload.reasoning = { effort, exclude: true };

  let finishReason: string | null = null;
  let outputChars = 0;
  let status: J;
  let rows: J[] = [];
  try {
    const response = await remoteJson(fetchFn, CHAT_URL, payload, o.apiKey);
    checkProviderError(response);
    const r = obj(response);
    const usage = obj(has(r, "usage") ? r.usage : {});
    const searchUsage = obj(truthy(usage.server_tool_use_details) ? usage.server_tool_use_details : truthy(usage.server_tool_use) ? usage.server_tool_use : {});
    const searches = searchUsage.web_search_requests;
    if (typeof searches === "boolean" || !isNum(searches) || !(searches >= 1)) {
      throw new PrognosisProblem("ungrounded_response", "Model nepotvrdil provedení webového hledání; výsledky jsou skryty.", 502);
    }
    if (!Array.isArray(r.choices) || r.choices.length === 0) throw new ValueErr("choices");
    const choice = obj(r.choices[0]);
    const fr = choice.finish_reason;
    finishReason = isStr(fr) && ["stop", "length", "tool_calls", "content_filter", "error"].includes(fr) ? fr : "unknown";
    if (!has(choice, "message")) throw new ValueErr("message");
    const message = obj(choice.message);
    if (!has(message, "content")) throw new ValueErr("content");
    let content = message.content;
    const citations = excerptCitations(message);
    if (!isStr(content)) throw new ValueErr("content_type");
    outputChars = codePoints(content);
    content = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    let truncated = false;
    let parsed: J;
    try {
      parsed = JSON.parse(content as string);
    } catch (error) {
      if (finishReason !== "length") throw error;
      parsed = { rows: recoverCompleteRows(content as string) };
      truncated = true;
      if (parsed.rows.length === 0) throw new ValueErr("no_complete_rows");
    }
    if (!isObj(parsed) || !Array.isArray(parsed.rows) || parsed.rows.length > 40) throw new ValueErr("rows");
    const kept = (parsed.rows as J[]).map((row) => normalizeRow(row, model.id, profile, citations)).filter((x) => x !== null);
    const limitations = has(parsed, "limitations") ? parsed.limitations : [];
    const warnings: string[] = Array.isArray(limitations) ? limitations.slice(0, 8).filter(isStr).map((x) => cut(x, 700)) : [];
    if (truncated) warnings.push("Odpověď dosáhla limitu výstupu. Zobrazeny jsou pouze celé dokončené řádky; zbytek byl vynechán.");
    if (Object.keys(citations).length === 0) warnings.push("Služba neposkytla zdrojové úryvky. Nepodložené řádky a hodnoty byly skryty.");
    if (kept.length < parsed.rows.length) warnings.push("Některé řádky nemají dohledaný zdroj nebo datum publikace před MDT a byly skryty.");
    rows = kept;
    status = { ...model, status: truncated ? "partial" : "success", error: null, error_code: null, finish_reason: finishReason, output_chars: outputChars, parse_error: null, row_count: kept.length, web_search_requests: searches, warnings };
  } catch (error) {
    if (error instanceof PrognosisProblem) {
      status = { ...model, status: "error", error: error.message, error_code: error.code, finish_reason: finishReason, output_chars: outputChars, parse_error: null };
    } else {
      // Never the error's own text: it could quote model output.
      const category = error instanceof JsonScanError || error instanceof SyntaxError ? "invalid_json" : "invalid_schema";
      status = { ...model, status: "error", error: "Model nevrátil požadovaná strukturovaná data.", error_code: "model_" + category, finish_reason: finishReason, output_chars: outputChars, parse_error: category };
    }
    rows = [];
  }
  return {
    profile,
    models: [status],
    rows: deduplicate(rows),
    searched_at: isoUtc(now),
    scheduled_date: scheduled,
    cache_hit: false,
    warnings: [
      ...profile.warnings,
      "Výběr studií není vyčerpávající. Výsledky extrahoval model; citace a čísla vyžadují kontrolu v originálu.",
      "Statistiky skupin nejsou individuální prognózou. Chybějící hodnoty nebyly dopočítány.",
    ],
  };
}

export function prognosisConfig(env: { OPENROUTER_API_KEY?: string; OPENROUTER_MODEL_ASTRA?: string }): { configured: boolean; available: boolean; models: { id: string; label: string }[] } {
  return {
    configured: !!env.OPENROUTER_API_KEY && !!env.OPENROUTER_MODEL_ASTRA,
    available: !!env.OPENROUTER_API_KEY,
    models: [{ id: env.OPENROUTER_MODEL_ASTRA ?? "", label: "GPT Astra" }],
  };
}
