// Offline fact extraction over the synthetic sample cases, for pipeline/eval.py (issue #20 phase 2).
//
//   cd api && npm run extract:eval -- [--out DIR] [--case S04] [--cache-only] [--dev-vars PATH] [--effort medium] [--whole]
//
// It sends exactly what the Worker sends (services/model-payload.ts: pseudonymized text, the gate) to the model named
// in wrangler.jsonc, with the key from api/.dev.vars (never printed), and turns the answers into run fragments with
// the same server-side checks (domain/extract/build.ts). Answers are cached under api/.cache/extract/ (gitignored), so
// a rerun after a change to the checks costs no model call; a prompt change misses the cache by its hash.
//
// Only synthetic data: data/derived/pages (FNO's synthetic patients and ours) and samples/derived/pages. The patient
// identities below are the synthetic ones printed on those pages; they only drive the pseudonymization.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFromAnswer, sha256Hex, type CallAnswer, type PageReading } from "../src/domain/extract/build";
import { pageIdentity } from "../src/domain/extract/identity";
import type { ModelAnswer } from "../src/domain/extract/schema";
import type { CaseIdentity } from "../src/domain/pseudonymize";
import { loadPrompt, type LoadedPrompt } from "../src/prompts";
import { imageIdentity } from "../src/services/redaction";
import { buildPayload } from "../src/services/model-payload";
import { fetchWithRetry } from "../src/services/retry";

const API = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(API, "..");
const PROMPT_ID = "extract-facts-cs" as const;
const MAX_OUTPUT_TOKENS = 24000;

type CaseDef = { id: string; documentId: string; pagesDir: string; patientNames: string[]; birthNumber: string | null };

function fixtureCase(id: string, file: string, documentId: string, pagesDir: string, pick: (d: Record<string, any>) => { name: string; rc: string | null }): CaseDef {
  const d = JSON.parse(readFileSync(join(REPO, "fixtures/data", file), "utf8"));
  const p = pick(d);
  return { id, documentId, pagesDir, patientNames: [p.name], birthNumber: p.rc };
}

const CASES: CaseDef[] = [
  fixtureCase("10", "mock-case-10.json", "10_pacient", "data/derived/pages/10_pacient", (d) => ({ name: d.patient.name, rc: d.patient.birth_number })),
  fixtureCase("S01", "mock-case-S01.json", "S01_pacient", "data/derived/pages/S01_pacient", (d) => ({ name: d.list_entry.name, rc: d.list_entry.rc })),
  fixtureCase("S02", "mock-case-S02.json", "S02_pacient", "data/derived/pages/S02_pacient", (d) => ({ name: d.list_entry.name, rc: d.list_entry.rc })),
  // As printed on their first pages (samples/S03_pacient, samples/S04_pacient).
  { id: "S03", documentId: "S03_pacient", pagesDir: "samples/derived/pages/S03_pacient", patientNames: ["Bořivoj Klenovský"], birthNumber: "571107/1003" },
  { id: "S04", documentId: "S04_pacient", pagesDir: "samples/derived/pages/S04_pacient", patientNames: ["Ludmila Vrbenská"], birthNumber: "615203/1006" },
];

// The seed's staff surnames (api/seed/seed.py STAFF_DEPTS, COORD, ADMIN), as the org's staff in D1 would give them.
function seedStaff(): string[] {
  const seed = readFileSync(join(API, "seed/seed.py"), "utf8");
  const block = /^STAFF_DEPTS = \[([\s\S]*?)\n\]/m.exec(seed)?.[1] ?? "";
  const names = [...block.matchAll(/\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
  for (const m of seed.matchAll(/"sur": "([^"]+)"/g)) names.push(m[1]!);
  return [...new Set(names)];
}

function readVar(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined;
  return new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file, "utf8"))?.[1]?.trim() || undefined;
}

function wranglerVar(name: string): string {
  const m = new RegExp(`"${name}":\\s*"([^"]*)"`).exec(readFileSync(join(API, "wrangler.jsonc"), "utf8"));
  if (!m) throw new Error(`${name} missing in wrangler.jsonc`);
  return m[1]!;
}

function tessWords(tsv: string) {
  const rows = tsv.split("\n").slice(1).map((l) => l.split("\t"));
  // Tesseract read a 300 dpi render; the page image and its boxes are 150 dpi (page_index.SCALE).
  return rows
    .filter((r) => r.length >= 12 && r[11]!.trim())
    .map((r) => ({ t: r[11]!.trim(), b: [7, 6, 8, 9].map((i) => Math.round(Number(r[i]) / 2)) as [number, number, number, number], c: Math.round(Number(r[10])) }));
}

// The page tools of the container, run from pipeline/harness_tools.py: readability, redaction, reading comparison.
function tool<T>(args: string[], input = ""): T {
  const out = execFileSync("uv", ["run", "--quiet", "python", "harness_tools.py", ...args], { cwd: join(REPO, "pipeline"), encoding: "utf8", input, stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim().split("\n").pop()!) as T;
}

type PageInfo = { level: NonNullable<PageReading["readability"]>; disagreements: number; layer_chars: number };

// The reading the extraction gets without the vision model: the PDF text layer when it has text, else Tesseract,
// judged by the page's readability. (The stored p<n>.vision.md transcriptions of the development cases came from a
// development sub-agent, with no prompt in the repository; they are used only with --stored-vision.)
function readPage(dir: string, n: number, info: PageInfo | undefined, storedVision: boolean): Omit<PageReading, "identity"> {
  const f = (ext: string) => join(dir, `p${n}.${ext}`);
  const words = existsSync(f("tess.tsv")) ? tessWords(readFileSync(f("tess.tsv"), "utf8")) : null;
  const base = { page: n, words, readability: info?.level ?? null, verify: [] as [number, number][] };
  if (storedVision && existsSync(f("vision.md"))) {
    const text = readFileSync(f("vision.md"), "utf8");
    return { ...base, text, quoteText: "vision", engine: "vision (stored transcription)", verify: tool<{ verify: [number, number][] }>(["compare", dir, String(n)], text).verify };
  }
  const layer = existsSync(f("layer.txt")) ? readFileSync(f("layer.txt"), "utf8") : "";
  if (layer.trim().length > 40) return { ...base, text: layer, quoteText: "pdf_text", engine: "pdf text layer" };
  return { ...base, text: readFileSync(f("tess.txt"), "utf8"), quoteText: "tesseract", engine: "tesseract (stored output)" };
}

// Which pages the vision model reads: a page that is not judged good, whose text layer and Tesseract disagree on
// several tokens, or that has no text layer (a scan). Agreement of two OCR readings does not prove them right (FNO's
// text layers are OCR too), so "fair" pages are read as well.
const needsVision = (info: PageInfo | undefined) => !info || info.level !== "good" || info.disagreements >= 3 || info.layer_chars < 40;

async function main() {
  const args = process.argv.slice(2);
  // The runs hold verbatim quotes, so they go to the gitignored cache unless --out names another folder.
  const out = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : join(API, ".cache/runs-ai"));
  const only = args.flatMap((a, i) => (args[i - 1] === "--case" ? [a] : []));
  const cacheOnly = args.includes("--cache-only");
  const cacheDir = join(API, ".cache/extract");
  mkdirSync(out, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  // --dev-vars names another .dev.vars (a git worktree has none of its own); the key is read, never printed.
  const devVars = args.includes("--dev-vars") ? resolve(args[args.indexOf("--dev-vars") + 1]!) : join(API, ".dev.vars");
  const key = readVar(devVars, "AZURE_OPENAI_KEY");
  const base = wranglerVar("MODEL_BASE");
  const model = wranglerVar("MODEL_NAME");
  // --effort overrides the configured reasoning effort, to measure whether "low" holds quality.
  const effort = (args.includes("--effort") ? args[args.indexOf("--effort") + 1] : wranglerVar("MODEL_REASONING_EFFORT")) || null;
  // Page by page by default: on case 10 one call over the whole document returned 21 to 49 facts depending on the run,
  // page by page 105 (docs/research/2026-10-19-extraction-eval.md). --whole sends the document in one call.
  const perPage = !args.includes("--whole");
  const prompt = await loadPrompt(PROMPT_ID);
  const readPrompt = await loadPrompt("read-page-cs");
  // --vision auto (default): pages that need it (needsVision); all: every page; off: none.
  const vision = args.includes("--vision") ? args[args.indexOf("--vision") + 1]! : "auto";
  const storedVision = args.includes("--stored-vision");
  const staff = seedStaff();

  for (const c of CASES.filter((c) => !only.length || only.includes(c.id))) {
    const dir = join(REPO, c.pagesDir);
    if (!existsSync(dir)) {
      console.log(`${c.id}: no pages at ${c.pagesDir}, skipped`);
      continue;
    }
    const ns = readdirSync(dir).flatMap((f) => /^p(\d+)\.tess\.txt$/.exec(f)?.[1] ?? []).map(Number).sort((a, b) => a - b);
    const identity: CaseIdentity = { patientNames: c.patientNames, birthNumber: c.birthNumber, birthDate: null, staffNames: staff };
    const infos = tool<Record<string, PageInfo>>(["readability", dir]);
    let seconds = 0;
    // One model call, cached by prompt and payload. "filtered" when the content filter refuses it; null on a failure.
    const ask = async (p: LoadedPrompt, text: { ref: number; text: string }[], images: string[], label: string) => {
      const { body, parts } = buildPayload({ prompt: p, text, imagesBase64: images, identity, model, maxOutputTokens: MAX_OUTPUT_TOKENS, reasoningEffort: effort, maxInputChars: 200000, purpose: label });
      const payload = JSON.stringify(body);
      const inputSha = await sha256Hex(payload);
      const cacheFile = join(cacheDir, `${p.ref}-${p.sha256.slice(0, 12)}-${inputSha}.json`);
      let output: string;
      if (existsSync(cacheFile)) {
        const hit = JSON.parse(readFileSync(cacheFile, "utf8"));
        if (hit.filtered) return "filtered" as const;
        output = hit.output;
      } else if (cacheOnly || !key) {
        console.log(`${c.id} ${label}: no cached answer${key ? "" : " and no key"}`);
        return null;
      } else {
        const t0 = Date.now();
        const { res, attempts } = await fetchWithRetry(`${base.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: payload }, { attempts: 4, baseMs: 2000, maxDelayMs: 20000, timeoutMs: 300000, deadlineMs: 600000 });
        seconds += (Date.now() - t0) / 1000;
        const d = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown } | null;
        const choice = d?.choices?.[0];
        if (choice?.finish_reason === "content_filter") {
          writeFileSync(cacheFile, JSON.stringify({ filtered: true, model, prompt: p.ref }));
          return "filtered" as const;
        }
        if (!res.ok || !choice?.message?.content || choice.finish_reason !== "stop") {
          console.log(`${c.id} ${label}: model answered ${res.status}, finish ${choice?.finish_reason ?? "-"}, attempts ${attempts}`);
          return null;
        }
        output = choice.message.content;
        writeFileSync(cacheFile, JSON.stringify({ output, model, prompt: p.ref, usage: d?.usage ?? null }));
      }
      return { output, parts: parts.map((x) => x.p) };
    };

    // The page readings. A page that needs it is read by the vision model from its redacted image; its reading is
    // compared with Tesseract's words, and every disagreement is an "ověřit" range that marks the facts quoting it.
    const pages: PageReading[] = [];
    let visionPages = 0;
    for (const n of ns) {
      const info = infos[String(n)];
      let r = readPage(dir, n, info, storedVision);
      if (vision === "all" || (vision === "auto" && needsVision(info))) {
        const red = tool<{ png_b64: string; reasons: string[] }>(["redact", dir, String(n)], JSON.stringify(imageIdentity(identity)));
        const got = await ask(readPrompt, [], [red.png_b64], `read p${n}`);
        if (got && got !== "filtered") {
          const text = got.output;
          const verify = tool<{ verify: [number, number][] }>(["compare", dir, String(n)], text).verify;
          // The page's readability stays: it describes the scan, and a defect in the image itself reads cleanly.
          r = { ...r, text, quoteText: "vision", engine: `vision ${model} ${readPrompt.ref}`, verify };
          visionPages++;
        }
      }
      // Whose page it is comes from the local, unredacted reading: the vision model saw the names blacked out.
      const local = readPage(dir, n, info, false);
      pages.push({ ...r, identity: pageIdentity(local.text, identity) });
    }

    const extract = async (idx: number[]): Promise<CallAnswer | "filtered" | null> => {
      const got = await ask(prompt, idx.map((i) => ({ ref: pages[i]!.page, text: pages[i]!.text })), [], `pages ${idx.map((i) => i + 1).join(",")}`);
      if (!got || got === "filtered") return got;
      return { pages: idx, parts: got.parts, answer: JSON.parse(got.output) as ModelAnswer };
    };

    // Page by page (or, with --whole, the document in one call, falling back to pages when the content filter
    // refuses it); a page still refused is listed as not read.
    const calls: CallAnswer[] = [];
    const unreadPages: number[] = [];
    const failed: string[] = [];
    const all = pages.map((_, i) => i);
    const whole = perPage ? "filtered" : await extract(all);
    if (whole === null) continue;
    if (whole !== "filtered") calls.push(whole);
    else
      for (const i of all) {
        const one = await extract([i]);
        if (one && one !== "filtered") calls.push(one);
        else {
          unreadPages.push(i);
          failed.push(`p${i + 1}:${one === "filtered" ? "content filter" : "no answer"}`);
        }
      }
    const built = await buildFromAnswer({ caseId: c.id, doc: { documentId: c.documentId, part: null, pages }, calls, unreadPages });
    const fromModel = calls.reduce((n, x) => n + x.answer.facts.length, 0);
    const run = {
      schema: "codebridge.extraction/2",
      case_id: c.id,
      content_language: "cs",
      run: {
        id: `run-ai-${c.id}`,
        producer: "pipeline",
        created_at: new Date().toISOString(),
        stages: [
          ...(visionPages ? [{ name: "read_pages", model, prompt: readPrompt.ref, prompt_sha256: readPrompt.sha256, temperature: null }] : []),
          { name: "extract_facts", model, prompt: prompt.ref, prompt_sha256: prompt.sha256, temperature: null },
        ],
        supersedes: null,
      },
      documents: [{ document_id: c.documentId, sha256: null, parts: [] }],
      sources: built.sources,
      facts: built.facts,
      checks: built.checks,
      alerts: built.alerts,
      brief: null,
      question_draft: null,
    };
    writeFileSync(join(out, `${c.id}.json`), JSON.stringify(run, null, 1));
    const ids = pages.map((p) => `p${p.page}:${p.identity}`).join(" ");
    const filtered = failed.length ? `, not read ${failed.join(" ")}` : "";
    console.log(`${c.id}: ${visionPages} page(s) read by vision; ${fromModel} from the model in ${calls.length} call(s)${filtered}, kept ${built.report.kept} (verify ${built.report.verify}, quarantined ${built.report.quarantined}), dropped ${JSON.stringify(built.report.dropped)}, reasons ${JSON.stringify(built.report.reasons)}${seconds ? `, ${seconds.toFixed(1)} s` : ", cached"}; ${ids}`);
  }
}

main().catch((e) => {
  // The message only: an error object from fetch carries no key, but the request headers are never printed either way.
  console.error(`extract-eval failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
