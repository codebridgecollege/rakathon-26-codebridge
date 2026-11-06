// The prognosis search (src/services/prognosis-search.ts), a port of prognosis/service.py: every check that decides which
// model answers a doctor may see. The network is never touched; each test injects its own fetch.
import { beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "@codebridge/domain/prognosis-profile";
import { dateEnd } from "@codebridge/domain/prognosis-profile";
import PROMPT_PY from "../../prognosis/prompt.txt";
import {
  PROGNOSIS_PROMPT,
  PrognosisProblem,
  deduplicate,
  excerptCitations,
  normalizeRow,
  prognosisConfig,
  recoverCompleteRows,
  resetCatalogCache,
  safeUrl,
  searchStudies,
  urlKey,
  type CheckedProfile,
} from "../src/services/prognosis-search";

const PUBMED = "https://pubmed.ncbi.nlm.nih.gov/12345678/";
const KEY = "pubmed.ncbi.nlm.nih.gov/12345678";
const NOW = new Date("2026-10-17T10:00:00Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const row = (value: number = 80): any => ({
  study_title: "Controlled synthetic fixture, not medical evidence",
  arm: "Arm A",
  population: "Cohort X",
  source: { url: PUBMED, pmid: "12345678", year: 2020 },
  time_origin: "Randomization",
  endpoints: { os_12: { value, unit: "%", quote: `Twelve month overall survival was ${value}% in Arm A.`, source_url: PUBMED } },
  matching: {},
});

const fact = (text: string, date: string) => ({ text, date, source: { page: 1, quote: text }, kind: "clinical", status: "documented", certainty: "documented" });
const PROFILE: Profile = {
  available: true,
  included_count: 3,
  synthetic: true,
  scheduled_date: "2026-10-17",
  facts: [fact("Histologie: adenokarcinom plic, EGFR negativní", "2023-01-05"), fact("KPS 80 %, ECOG 1", "2026-01-08"), fact("KPS 70 %, ECOG 2", "2026-10-06")],
  excluded_undated: 1,
  excluded_after_cutoff: 0,
  warnings: ["Vynecháno 1 nedatovaných a 0 údajů."],
};
const checked: CheckedProfile = { facts: PROFILE.facts, evidence_cutoff: "2026-10-17" };

const citation = (content: string, url = PUBMED) => ({ type: "url_citation", url_citation: { url, content } });
const answer = (content: string, annotations: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  usage: { server_tool_use_details: { web_search_requests: 1 } },
  choices: [{ finish_reason: "stop", message: { content, annotations } }],
  ...extra,
});

// A fetch that serves the catalog and the model answer, and records the calls (never the network).
function server(chat: () => Response | Promise<Response>, catalog: Record<string, unknown>[] = [{ id: "a", name: "Astra", supported_parameters: ["temperature", "reasoning"], reasoning: { supported_efforts: ["low", "high"] } }]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://openrouter.ai/api/v1/models") return Response.json({ data: catalog });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return chat();
    throw new Error("unexpected url");
  }) as typeof fetch;
  return { fetchFn, calls, chatCalls: () => calls.filter((c) => c.url.endsWith("/chat/completions")) };
}
const run = (fetchFn: typeof fetch, over: Record<string, unknown> = {}) =>
  searchStudies({ profile: PROFILE, apiKey: "test-secret", model: "a", modelLabel: "Test model", routeOnly: "test/eu", fetchFn, now: NOW, ...over });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modelOf = (r: Record<string, unknown>): any => (r.models as unknown[])[0];

beforeEach(() => resetCatalogCache());

describe("prompt", () => {
  it("is the Python prompt, byte for byte", () => {
    expect(PROGNOSIS_PROMPT).toBe(PROMPT_PY);
    expect(PROGNOSIS_PROMPT.length).toBeGreaterThan(1000);
  });
});

describe("dates and urls", () => {
  it("reads partial dates at their latest day", () => {
    expect(dateEnd("9/23")).toBe("2023-09-30");
    expect(dateEnd("2026-02")).toBe("2026-02-28");
    expect(dateEnd("11/2023 až 6/2025")).toBe("2025-06-30");
    expect(dateEnd("31.2.2026")).toBeNull();
  });
  it("accepts only plain public https URLs", () => {
    for (const v of ["javascript:alert(1)", "http://127.0.0.1/", "https://127.0.0.1/", "https://a:b@example.org", "https://example.org:99/", "https://localhost/", "https://intranet/x", null]) expect(safeUrl(v)).toBeNull();
    expect(safeUrl("https://Example.org:443/a?b=1")).toBe("https://Example.org:443/a?b=1");
  });
  it("ignores tracking parameters and keeps semantic ones in the identity", () => {
    expect(urlKey("https://Journal.example/article/?utm_source=x&id=2&gclid=1")).toBe("journal.example/article?id=2");
    expect(urlKey("https://journal.example/article?id=1")).not.toBe(urlKey("https://journal.example/article?id=2"));
  });
});

describe("normalizeRow", () => {
  it("has unknown similarity with a null score, and drops what has no evidence", () => {
    const a = normalizeRow(row(), "a", checked);
    expect(a.similarity.score).toBeNull();
    expect(a.similarity.coverage).toBe(0);
    const bad1 = row();
    bad1.endpoints.os_12.quote = "";
    expect(normalizeRow(bad1, "a", checked).endpoints.os_12).toBeNull();
    const bad2 = row();
    bad2.time_origin = null;
    expect(normalizeRow(bad2, "a", checked).endpoints.os_12).toBeNull();
    const bad3 = row();
    bad3.matching = { histology: { status: "match", patient_quote: "invented diagnosis", study_quote: "histology matches" } };
    expect(normalizeRow(bad3, "a", checked).similarity.score).toBeNull();
    const bad4 = row();
    bad4.source.year = 2027;
    expect(normalizeRow(bad4, "a", checked)).toBeNull();
  });

  it("scores only known dimensions, rounds like Python, and lists critical mismatches", () => {
    const r = row();
    const excerpt = "Histology adenocarcinoma. EGFR mutated. ECOG 0-1 allowed.";
    r.matching = {
      histology: { status: "match", patient_quote: "adenokarcinom plic", study_quote: "Histology adenocarcinoma." },
      biomarkers: { status: "mismatch", patient_quote: "EGFR negativní", study_quote: "EGFR mutated." },
      performance_status: { status: "match", patient_quote: "KPS 70 %, ECOG 2", study_quote: "ECOG 0-1 allowed." },
    };
    const out = normalizeRow(r, "a", checked, { [KEY]: [excerpt] });
    // known = 25 + 15 + 10 = 50, matches 35 -> 70
    expect(out.similarity).toMatchObject({ score: 70, coverage: 50, critical_mismatches: ["biomarkers"] });
    // Half rounds to even, as in Python: 10 of 80 known is 12.5 -> 12 (Math.round would give 13).
    const m = (status: string) => ({ status, patient_quote: "adenokarcinom plic", study_quote: "Histology adenocarcinoma." });
    const half = row();
    half.matching = { histology: m("mismatch"), stage: m("mismatch"), biomarkers: m("mismatch"), treatment_line: m("mismatch"), prior_treatment: m("match") };
    expect(normalizeRow(half, "a", checked, { [KEY]: [excerpt] }).similarity.score).toBe(12);
  });

  it("uses only the newest ECOG/KPS fact for performance status", () => {
    const r = row();
    r.matching = { performance_status: { status: "match", patient_quote: "KPS 80 %, ECOG 1", study_quote: "Study ECOG 0-1" } };
    const out = normalizeRow(r, "a", checked);
    expect(out.similarity.dimensions.find((x: { key: string }) => x.key === "performance_status").status).toBe("unknown");
  });

  it("needs the row URL among the citations, and the quote inside one excerpt", () => {
    const r = row();
    expect(normalizeRow(r, "a", checked, {})).toBeNull();
    expect(normalizeRow(r, "a", checked, { [KEY]: ["Different excerpt"] }).endpoints.os_12).toBeNull();
    const ok = normalizeRow(r, "a", checked, { [KEY]: [r.endpoints.os_12.quote] });
    expect(ok.endpoints.os_12).toMatchObject({ value: 80, quote_matched_search_excerpt: true, verification: "model_extracted_unverified" });
    // two excerpts that together hold the quote do not
    const q: string = r.endpoints.os_12.quote;
    expect(normalizeRow(r, "a", checked, { [KEY]: [q.slice(0, 20), q.slice(20)] }).endpoints.os_12).toBeNull();
    r.endpoints.os_12.source_url = "https://example.org/later";
    expect(normalizeRow(r, "a", checked, { [KEY]: ["Different excerpt"] }).endpoints.os_12).toBeNull();
    const other = { ...row(), source: { ...row().source, url: "https://journal.example/article?id=2" } };
    expect(normalizeRow(other, "a", checked, { "journal.example/article?id=1": ["Different excerpt"] })).toBeNull();
  });

  it("nulls a number that is not in its quote, a unit mismatch and a negative or over-100 percentage", () => {
    const notInQuote = row(80);
    notInQuote.endpoints.os_12.value = 81;
    expect(normalizeRow(notInQuote, "a", checked).endpoints.os_12).toBeNull();
    const unit = row();
    unit.endpoints.os_12.unit = "months";
    expect(normalizeRow(unit, "a", checked).endpoints.os_12).toBeNull();
    const over = row(180);
    expect(normalizeRow(over, "a", checked).endpoints.os_12).toBeNull();
    const decimal = row();
    decimal.endpoints.os_12 = { value: 12.5, unit: "%", quote: "Survival at 12 months was 12,5 % in Arm A.", source_url: PUBMED };
    expect(normalizeRow(decimal, "a", checked).endpoints.os_12.value).toBe(12.5);
  });

  it("drops a row published after the cutoff or with a bad date", () => {
    const late = row();
    late.source.published_date = "2026-10-18";
    expect(normalizeRow(late, "a", checked)).toBeNull();
    const junk = row();
    junk.source.published_date = "yesterday";
    expect(normalizeRow(junk, "a", checked)).toBeNull();
    const fine = row();
    fine.source.published_date = "2026-10-17";
    expect(normalizeRow(fine, "a", checked)).not.toBeNull();
  });

  it("reads excerpts per source and splits them at [...]", () => {
    const out = excerptCitations({ annotations: [null, citation("One [...] Two"), { type: "url_citation", url_citation: { url: "http://insecure.example/x", content: "x" } }] });
    expect(out[KEY]).toEqual(["One", "Two"]);
    expect(Object.keys(out)).toEqual([KEY]);
  });
});

describe("deduplicate", () => {
  it("merges the same study and keeps conflicting values as conflicts", () => {
    const a = normalizeRow(row(), "a", checked), b = normalizeRow(row(85), "b", checked), c = normalizeRow(row(80), "c", checked);
    const merged = deduplicate([a, b, c]);
    expect(merged).toHaveLength(1);
    expect(merged[0].found_by).toEqual(["a", "b", "c"]);
    expect(merged[0].endpoints.os_12).toBeNull();
    expect(merged[0].conflicts).toHaveLength(1);
    b.arm = "Arm B";
    expect(deduplicate([a, b])).toHaveLength(2);
  });
  it("treats DOI spellings as one publication and ignores wording in the explanation", () => {
    const a = normalizeRow(row(), "a", checked);
    const b = structuredClone(a);
    a.source.doi = "https://doi.org/10.1234/ABC";
    b.source.doi = "doi:10.1234/abc";
    expect(deduplicate([a, b])).toHaveLength(1);
    a.similarity.dimensions[0].explanation = "Different phrasing";
    expect(deduplicate([a, b])[0]).not.toHaveProperty("similarity_variants");
  });
  it("keeps stable cohorts with different time origins apart", () => {
    const a = normalizeRow(row(), "a", checked);
    const b = structuredClone(a);
    for (const x of [a, b]) Object.assign(x, { cohort_id: "Cohort A", arm_id: "Arm A", analysis_id: "Primary analysis" });
    b.time_origin = "Diagnosis";
    b.endpoints.os_6 = structuredClone(b.endpoints.os_12);
    b.endpoints.os_12 = null;
    expect(deduplicate([a, b])).toHaveLength(2);
  });
  it("suppresses the score when the models disagree on similarity", () => {
    const a = normalizeRow(row(), "a", checked);
    const b = structuredClone(a);
    b.found_by = ["b"];
    b.similarity = { ...b.similarity, score: 50, coverage: 25 };
    const [m] = deduplicate([a, b]);
    expect(m.similarity.score).toBeNull();
    expect(m.similarity_variants).toHaveLength(2);
  });
});

describe("recoverCompleteRows", () => {
  const prefix = () => `{"rows":[${JSON.stringify(row())},${JSON.stringify(row(85))},`;
  it("returns only complete objects from a cut-off answer", () => {
    expect(recoverCompleteRows(prefix() + '{"study_title":"unfinished')).toHaveLength(2);
    expect(recoverCompleteRows(prefix())).toHaveLength(2);
    expect(recoverCompleteRows(prefix() + '{"a": ')).toHaveLength(2);
  });
  it("rejects junk instead of guessing", () => {
    for (const bad of [prefix() + "EVIL", prefix() + '{"value": not_json}', prefix() + "{} EVIL", prefix() + "] trailing garbage", "pretend " + prefix(), prefix() + '{"a": tru']) {
      expect(() => recoverCompleteRows(bad), bad.slice(-20)).toThrow();
    }
  });
});

describe("searchStudies", () => {
  const good = () => Response.json(answer(JSON.stringify({ rows: [row()], limitations: ["Jedna studie."] }), [citation(row().endpoints.os_12.quote)]));

  it("returns a grounded row with the Python result shape, in one model call", async () => {
    const s = server(good);
    const r = await run(s.fetchFn);
    expect(s.chatCalls()).toHaveLength(1);
    expect(Object.keys(r)).toEqual(["profile", "models", "rows", "searched_at", "scheduled_date", "cache_hit", "warnings"]);
    expect(r).toMatchObject({ cache_hit: false, scheduled_date: "2026-10-17", searched_at: "2026-10-17T10:00:00+00:00" });
    expect((r.profile as CheckedProfile).evidence_cutoff).toBe("2026-10-17");
    expect(modelOf(r)).toMatchObject({ id: "a", label: "Test model", catalog_name: "Astra", status: "success", error: null, finish_reason: "stop", row_count: 1, web_search_requests: 1, warnings: ["Jedna studie."] });
    expect(Object.keys(modelOf(r))).toEqual(["id", "label", "catalog_name", "status", "error", "error_code", "finish_reason", "output_chars", "parse_error", "row_count", "web_search_requests", "warnings"]);
    const rows = r.rows as { endpoints: { os_12: { value: number } } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endpoints.os_12.value).toBe(80);
    expect((r.warnings as string[]).slice(0, 1)).toEqual(PROFILE.warnings);
  });

  it("sends the pinned request and no secret outside the Authorization header", async () => {
    const s = server(good);
    await run(s.fetchFn, { reasoningEffort: "low" });
    const call = s.chatCalls()[0]!;
    const body = JSON.parse(call.init!.body as string);
    expect(body).toMatchObject({
      model: "a",
      temperature: 0,
      reasoning: { effort: "low", exclude: true },
      tools: [{ type: "openrouter:web_search", parameters: { engine: "exa", max_uses: 4, max_results: 5, max_total_results: 20 } }],
      max_tokens: 14000,
      max_tool_calls: 4,
      response_format: { type: "json_object" },
      provider: { only: ["test/eu"], allow_fallbacks: false, data_collection: "deny", zdr: true },
    });
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT_PY });
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ scheduled_date: "2026-10-17", evidence_cutoff: "2026-10-17" });
    expect(JSON.stringify(body)).not.toContain("test-secret");
    expect((call.init!.headers as Record<string, string>).Authorization).toBe("Bearer test-secret");
    expect(call.init!.redirect).toBe("manual");
  });

  it("leaves out temperature and reasoning the catalog does not list, and refuses an invalid effort", async () => {
    const s = server(good, [{ id: "a" }]);
    await run(s.fetchFn, { reasoningEffort: "low" });
    const body = JSON.parse(s.chatCalls()[0]!.init!.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("reasoning");
    await expect(run(server(good).fetchFn, { reasoningEffort: "ludicrous" })).rejects.toMatchObject({ code: "invalid_reasoning_effort", status: 503 });
  });

  it("uses the earlier of today and the MDT date as the evidence cutoff", async () => {
    const future = { ...PROFILE, scheduled_date: "2026-12-01" };
    const r = await run(server(good).fetchFn, { profile: future });
    expect((r.profile as CheckedProfile).evidence_cutoff).toBe("2026-10-17");
    const past = await run(server(good).fetchFn, { profile: { ...PROFILE, scheduled_date: "2026-03-01" } });
    expect((past.profile as CheckedProfile).evidence_cutoff).toBe("2026-03-01");
  });

  it("stops before a call when the key or model is missing or not in the catalog", async () => {
    const s = server(good);
    await expect(run(s.fetchFn, { apiKey: "" })).rejects.toMatchObject({ code: "missing_key", status: 503 });
    await expect(run(s.fetchFn, { model: "" })).rejects.toMatchObject({ code: "models_not_configured" });
    await expect(run(s.fetchFn, { model: "zzz" })).rejects.toMatchObject({ code: "model_unavailable", status: 503 });
    expect(s.chatCalls()).toHaveLength(0);
  });

  it("asks the catalog once an hour per isolate", async () => {
    const s = server(good);
    await run(s.fetchFn);
    await run(s.fetchFn);
    expect(s.calls.filter((c) => c.url.endsWith("/models"))).toHaveLength(1);
  });

  it("nulls an endpoint whose quote is in no citation excerpt, and warns when rows are dropped", async () => {
    const s = server(() => Response.json(answer(JSON.stringify({ rows: [row(), row(85)] }), [citation("Some other passage from the same page.")])));
    const r = await run(s.fetchFn);
    const rows = r.rows as { endpoints: { os_12: unknown } }[];
    expect(rows[0]!.endpoints.os_12).toBeNull();
    const none = await run(server(() => Response.json(answer(JSON.stringify({ rows: [row()] })))).fetchFn);
    expect(none.rows).toEqual([]);
    expect(modelOf(none).warnings).toEqual(expect.arrayContaining(["Služba neposkytla zdrojové úryvky. Nepodložené řádky a hodnoty byly skryty.", "Některé řádky nemají dohledaný zdroj nebo datum publikace před MDT a byly skryty."]));
  });

  it("drops a row whose URL is not among the citations", async () => {
    const s = server(() => Response.json(answer(JSON.stringify({ rows: [row()] }), [citation("Twelve month overall survival was 80% in Arm A.", "https://elsewhere.example/paper")])));
    expect((await run(s.fetchFn)).rows).toEqual([]);
  });

  it("nulls OS without a time origin, a number not in its quote, and a unit mismatch inside a full run", async () => {
    const noOrigin = row(), badNumber = row(), badUnit = row();
    noOrigin.time_origin = null;
    badNumber.endpoints.os_12.value = 79;
    badUnit.endpoints.os_12.unit = "months";
    for (const r of [noOrigin, badNumber, badUnit]) {
      const s = server(() => Response.json(answer(JSON.stringify({ rows: [r] }), [citation(r.endpoints.os_12.quote)])));
      const out = await run(s.fetchFn);
      expect((out.rows as { endpoints: { os_12: unknown } }[])[0]!.endpoints.os_12).toBeNull();
    }
  });

  it("recovers a truncated answer row by row and marks the model partial", async () => {
    const content = `{"rows":[${JSON.stringify(row())},${JSON.stringify(row(85))},{"study_title":"unfinished`;
    const quotes = row().endpoints.os_12.quote + " [...] " + row(85).endpoints.os_12.quote;
    const s = server(() => Response.json({ usage: { server_tool_use_details: { web_search_requests: 1 } }, choices: [{ finish_reason: "length", message: { content, annotations: [citation(quotes)] } }] }));
    const r = await run(s.fetchFn);
    expect(modelOf(r)).toMatchObject({ status: "partial", finish_reason: "length", output_chars: content.length });
    expect((r.rows as unknown[]).length).toBeGreaterThan(0);
    expect(modelOf(r).warnings).toContain("Odpověď dosáhla limitu výstupu. Zobrazeny jsou pouze celé dokončené řádky; zbytek byl vynechán.");
  });

  it("does not recover without a length signal, and reports malformed JSON as a safe error", async () => {
    const cut = `{"rows":[${JSON.stringify(row())},{"study_title":"unfinished`;
    for (const content of [cut, "not JSON"]) {
      const r = await run(server(() => Response.json(answer(content))).fetchFn);
      expect(r.rows).toEqual([]);
      expect(modelOf(r)).toMatchObject({ status: "error", error_code: "model_invalid_json", parse_error: "invalid_json", error: "Model nevrátil požadovaná strukturovaná data." });
    }
    const schema = await run(server(() => Response.json(answer(JSON.stringify({ rows: "x" })))).fetchFn);
    expect(modelOf(schema)).toMatchObject({ error_code: "model_invalid_schema" });
  });

  it("reads both current and legacy search usage, and refuses an answer with no web search", async () => {
    for (const usage of [{ server_tool_use_details: { web_search_requests: 1 } }, { server_tool_use: { web_search_requests: 1 } }]) {
      const r = await run(server(() => Response.json({ usage, choices: [{ message: { content: JSON.stringify({ rows: [] }) } }] })).fetchFn);
      expect(modelOf(r).status).toBe("success");
    }
    for (const usage of [undefined, {}, { server_tool_use_details: { web_search_requests: 0 } }, { server_tool_use: { web_search_requests: true } }]) {
      const r = await run(server(() => Response.json({ usage, choices: [{ message: { content: JSON.stringify({ rows: [row()] }) } }] })).fetchFn);
      expect(r.rows).toEqual([]);
      expect(modelOf(r)).toMatchObject({ status: "error", error_code: "ungrounded_response" });
    }
  });

  it("maps a provider error to a category without echoing the input, and does not retry or cache it", async () => {
    let calls = 0;
    const s = server(() => {
      calls++;
      return Response.json({ error: { code: 402, message: "Insufficient credits. Sensitive echo: fictional patient XYZ diagnosis." } });
    });
    const r = await run(s.fetchFn);
    expect(modelOf(r).error).toBe("OpenRouter (402): Nedostatečný kredit nebo omezení účtování.");
    expect(JSON.stringify(r)).not.toContain("XYZ");
    expect(JSON.stringify(r)).not.toContain("Sensitive echo");
    await run(s.fetchFn);
    expect(calls).toBe(2);
    const cases: [unknown, string][] = [
      [{ code: 401, message: "Invalid API key" }, "OpenRouter (401): Služba odmítla ověření klíče."],
      [{ code: 429, message: "Rate limit" }, "OpenRouter (429): Služba omezila počet požadavků."],
      [{ code: 404, message: "No endpoints found matching your data policy" }, "OpenRouter (404): Není dostupný poskytovatel odpovídající nastavení soukromí."],
      [{ code: 400, message: "tool not supported" }, "OpenRouter (400): Služba odmítla nástroj nebo parametr požadavku."],
      [{ code: 400, message: "maximum tokens exceeded" }, "OpenRouter (400): Požadavek překročil limit kontextu nebo tokenů."],
      [{ code: "x", message: "weird XYZ" }, "OpenRouter (neznámý kód): Služba vrátila chybu v odpovědi."],
      ["boom XYZ", "OpenRouter (neznámý kód): Služba vrátila chybu v odpovědi."],
    ];
    for (const [error, expected] of cases) {
      const out = await run(server(() => Response.json({ error })).fetchFn);
      expect(modelOf(out)).toMatchObject({ status: "error", error_code: "provider_error", error: expected });
    }
  });

  it("refuses a redirect, an HTTP error status and a network failure with fixed messages", async () => {
    const redirect = await run(server(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } })).fetchFn);
    expect(modelOf(redirect)).toMatchObject({ status: "error", error_code: "redirect", error: "Neočekávané přesměrování služby." });
    const http = await run(server(() => new Response("secret body XYZ", { status: 503 })).fetchFn);
    expect(modelOf(http)).toMatchObject({ error_code: "provider_http", error: "OpenRouter vrátil HTTP 503. Bez automatického opakování." });
    const network = await run(server(() => Promise.reject(new TypeError("connection secret XYZ"))).fetchFn);
    expect(modelOf(network)).toMatchObject({ error_code: "provider_network" });
    const notJson = await run(server(() => new Response("<html>")).fetchFn);
    expect(modelOf(notJson)).toMatchObject({ error_code: "provider_json" });
    expect(JSON.stringify([redirect, http, network])).not.toContain("XYZ");
  });

  it("refuses a response over the size cap", async () => {
    const big = () => new Response(new Uint8Array(2_000_001).fill(32));
    const r = await run(server(big).fetchFn);
    expect(modelOf(r)).toMatchObject({ status: "error", error_code: "response_too_large", error: "Odpověď překročila povolenou velikost." });
  });

  it("aborts after the budget", async () => {
    const hang = () => new Promise<Response>(() => undefined);
    const base = server(good);
    // A fetch that never answers the chat call but honours the abort signal, with the clock sped up.
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return base.fetchFn(input, init);
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        void hang;
      });
    }) as typeof fetch;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => realSetTimeout(fn, ms === 240_000 ? 5 : ms)) as typeof setTimeout;
    try {
      expect(modelOf(await run(fetchFn))).toMatchObject({ error_code: "provider_network" });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

describe("prognosisConfig and PrognosisProblem", () => {
  it("reports presence of the key and model, never the key", () => {
    expect(prognosisConfig({})).toEqual({ configured: false, available: false, models: [{ id: "", label: "" }] });
    expect(prognosisConfig({ OPENROUTER_API_KEY: "k" })).toMatchObject({ configured: false, available: true });
    // No endpoint means no search: OpenRouter would otherwise choose where the clinical profile goes.
    expect(prognosisConfig({ OPENROUTER_API_KEY: "k", PROGNOSIS_MODEL: "m" })).toMatchObject({ configured: false, available: true });
    const c = prognosisConfig({ OPENROUTER_API_KEY: "k", PROGNOSIS_MODEL: "m", PROGNOSIS_MODEL_LABEL: "Test model", PROGNOSIS_ROUTE_ONLY: "test/eu" });
    expect(c).toEqual({ configured: true, available: true, models: [{ id: "m", label: "Test model" }] });
    expect(JSON.stringify(c)).not.toContain('"k"');
    expect(new PrognosisProblem("x", "y", 502)).toMatchObject({ code: "x", status: 502, message: "y" });
  });
});
