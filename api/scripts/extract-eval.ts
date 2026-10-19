// Offline fact extraction over the synthetic sample cases, for pipeline/eval.py (issue #20 phase 2).
//
//   cd api && npm run extract:eval -- [--out DIR] [--case S04] [--cache-only] [--dev-vars PATH]
//
// It sends exactly what the Worker sends (services/model-payload.ts: pseudonymized text, the gate) to the model named
// in wrangler.jsonc, with the key from api/.dev.vars (never printed), and turns the answers into run fragments with
// the same server-side checks (domain/extract/build.ts). Answers are cached under api/.cache/extract/ (gitignored), so
// a rerun after a change to the checks costs no model call; a prompt change misses the cache by its hash.
//
// Only synthetic data: data/derived/pages (FNO's synthetic patients and ours) and samples/derived/pages. The patient
// identities below are the synthetic ones printed on those pages; they only drive the pseudonymization.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFromAnswer, sha256Hex, type PageReading } from "../src/domain/extract/build";
import { pageIdentity } from "../src/domain/extract/identity";
import type { ModelAnswer } from "../src/domain/extract/schema";
import type { CaseIdentity } from "../src/domain/pseudonymize";
import { loadPrompt } from "../src/prompts";
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

// The reading the model gets: the stored vision transcription when there is one, else the PDF text layer when it
// has text, else Tesseract. Phase 2's page reading replaces the stored transcriptions with read-page-cs output.
function readPage(dir: string, n: number): Omit<PageReading, "identity"> {
  const f = (ext: string) => join(dir, `p${n}.${ext}`);
  const words = existsSync(f("tess.tsv")) ? tessWords(readFileSync(f("tess.tsv"), "utf8")) : null;
  const base = { page: n, words, readability: null, verify: [] as [number, number][] };
  if (existsSync(f("vision.md"))) return { ...base, text: readFileSync(f("vision.md"), "utf8"), quoteText: "vision", engine: "vision (stored transcription)" };
  const layer = existsSync(f("layer.txt")) ? readFileSync(f("layer.txt"), "utf8") : "";
  if (layer.trim().length > 40) return { ...base, text: layer, quoteText: "pdf_text", engine: "pdf text layer" };
  return { ...base, text: readFileSync(f("tess.txt"), "utf8"), quoteText: "tesseract", engine: "tesseract (stored output)" };
}

async function main() {
  const args = process.argv.slice(2);
  const out = resolve(args[args.indexOf("--out") + 1] ?? join(REPO, "samples/derived/runs-ai"));
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
  const effort = wranglerVar("MODEL_REASONING_EFFORT") || null;
  const prompt = await loadPrompt(PROMPT_ID);
  const staff = seedStaff();

  for (const c of CASES.filter((c) => !only.length || only.includes(c.id))) {
    const dir = join(REPO, c.pagesDir);
    if (!existsSync(dir)) {
      console.log(`${c.id}: no pages at ${c.pagesDir}, skipped`);
      continue;
    }
    const ns = readdirSync(dir).flatMap((f) => /^p(\d+)\.tess\.txt$/.exec(f)?.[1] ?? []).map(Number).sort((a, b) => a - b);
    const identity: CaseIdentity = { patientNames: c.patientNames, birthNumber: c.birthNumber, birthDate: null, staffNames: staff };
    const pages: PageReading[] = ns.map((n) => {
      const r = readPage(dir, n);
      return { ...r, identity: pageIdentity(r.text, identity) };
    });
    const { body, parts } = buildPayload({ prompt, text: pages.map((p) => ({ ref: p.page, text: p.text })), imagesBase64: [], identity, model, maxOutputTokens: MAX_OUTPUT_TOKENS, reasoningEffort: effort, maxInputChars: 200000, purpose: "extract_facts" });
    const payload = JSON.stringify(body);
    const inputSha = await sha256Hex(payload);
    const cacheFile = join(cacheDir, `${prompt.ref}-${prompt.sha256.slice(0, 12)}-${inputSha}.json`);
    let output: string;
    let ms = 0;
    if (existsSync(cacheFile)) output = JSON.parse(readFileSync(cacheFile, "utf8")).output;
    else if (cacheOnly || !key) {
      console.log(`${c.id}: no cached answer${key ? "" : " and no key"}, skipped`);
      continue;
    } else {
      const t0 = Date.now();
      const { res, attempts } = await fetchWithRetry(`${base.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers: { "api-key": key, "content-type": "application/json" }, body: payload }, { attempts: 4, baseMs: 2000, maxDelayMs: 20000, timeoutMs: 300000, deadlineMs: 600000 });
      ms = Date.now() - t0;
      const d = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: unknown } | null;
      const choice = d?.choices?.[0];
      if (!res.ok || !choice?.message?.content || choice.finish_reason !== "stop") {
        console.log(`${c.id}: model answered ${res.status}, finish ${choice?.finish_reason ?? "-"}, attempts ${attempts}; nothing kept`);
        continue;
      }
      output = choice.message.content;
      writeFileSync(cacheFile, JSON.stringify({ output, model, prompt: prompt.ref, usage: d?.usage ?? null }));
    }
    const answer = JSON.parse(output) as ModelAnswer;
    const built = await buildFromAnswer({ caseId: c.id, doc: { documentId: c.documentId, part: null, pages }, parts: parts.map((x) => x.p), answer });
    const run = {
      schema: "codebridge.extraction/2",
      case_id: c.id,
      content_language: "cs",
      run: { id: `run-ai-${c.id}`, producer: "pipeline", created_at: new Date().toISOString(), stages: [{ name: "extract_facts", model, prompt: prompt.ref, prompt_sha256: prompt.sha256, temperature: null }], supersedes: null },
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
    console.log(`${c.id}: ${answer.facts.length} from the model, kept ${built.report.kept} (verify ${built.report.verify}, quarantined ${built.report.quarantined}), dropped ${JSON.stringify(built.report.dropped)}, reasons ${JSON.stringify(built.report.reasons)}${ms ? `, ${(ms / 1000).toFixed(1)} s` : ", cached"}; ${ids}`);
  }
}

main().catch((e) => {
  // The message only: an error object from fetch carries no key, but the request headers are never printed either way.
  console.error(`extract-eval failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
