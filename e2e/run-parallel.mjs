// Runs the browser suite on N local Workers at once (default 4): each Worker is its own `wrangler dev` with its own
// local D1 and R2 state (--persist-to) and port, all copied from one seeded state, and each Playwright worker talks
// to one of them (servers.ts), so a test's demo reset never touches another test's data. Stops the Workers on exit.
//
// Usage, from the repository root, after `npm --prefix api run stage` (the Workers serve api/.assets):
//   npm --prefix e2e run test:parallel                         # 4 Workers
//   E2E_WORKERS=2 npm --prefix e2e run test:parallel -- specs/calendar.spec.ts   # Playwright arguments after --
// Options: --reseed seeds the template state again even when its inputs did not change.
// Environment: E2E_WORKERS (default 4), E2E_PORT_BASE (default 8801; Worker i listens on E2E_PORT_BASE + i).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const api = path.join(root, "api");
// Under api/.wrangler (gitignored), next to wrangler dev's own default state, so the seed's relative paths work.
const stateRoot = path.join(api, ".wrangler", "e2e");
const template = path.join(stateRoot, "seed");

const args = process.argv.slice(2);
const reseed = args.includes("--reseed");
const playwrightArgs = args.filter((a) => a !== "--reseed");
const workers = Number(process.env.E2E_WORKERS ?? 4);
const portBase = Number(process.env.E2E_PORT_BASE ?? 8801);
if (!Number.isInteger(workers) || workers < 1) throw new Error(`E2E_WORKERS must be a positive integer, got ${process.env.E2E_WORKERS}`);

const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

if (!existsSync(path.join(api, ".assets", "index.html"))) {
  console.error("api/.assets is missing: run `npm --prefix api run stage` first (it builds the app the Workers serve).");
  process.exit(1);
}

// What the seeded state is made from. When none of it changed, the template from an earlier run is reused: seeding
// puts every R2 object one wrangler call at a time and takes minutes.
function seedInputsHash() {
  const h = createHash("sha256");
  const add = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) for (const f of readdirSync(p).sort()) add(path.join(p, f));
    // READMEs and notes do not reach the database.
    else if (!p.endsWith(".md")) h.update(path.relative(root, p)).update(readFileSync(p));
  };
  for (const p of ["api/migrations", "api/seed/seed.py", "fixtures", "data/derived/page-index.json", "samples"]) {
    const full = path.join(root, p);
    if (existsSync(full)) add(full);
  }
  return h.digest("hex");
}

const stampFile = path.join(stateRoot, "seed.stamp");
const want = seedInputsHash();
const have = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : "";
if (reseed || have !== want || !existsSync(path.join(template, "v3", "d1"))) {
  console.log("seeding the template state (api/.wrangler/e2e/seed) ...");
  rmSync(template, { recursive: true, force: true });
  mkdirSync(template, { recursive: true });
  const r = spawnSync("uv", ["run", "seed/seed.py", "--target", "local", "--reset", "--persist-to", path.relative(api, template)], { cwd: api, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(r.error ? `could not run uv (${r.error.message}); the seed needs uv` : "the seed failed");
    process.exit(1);
  }
  writeFileSync(stampFile, want + "\n");
  console.log(`seeded (${secs()})`);
} else console.log("reusing the seeded template state (inputs unchanged; --reseed to force)");

// One copy of the seeded state per Worker; a copy-on-write clone where the file system offers one.
const children = [];
let stopping = false;
const urls = [];
for (let i = 0; i < workers; i++) {
  const dir = path.join(stateRoot, `w${i}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(template, dir, { recursive: true, mode: constants.COPYFILE_FICLONE });
  const port = portBase + i;
  urls.push(`http://127.0.0.1:${port}`);
  const log = createWriteStream(path.join(stateRoot, `w${i}.log`));
  // detached: the Worker and the workerd process it starts form one process group, which stop() ends as a whole.
  const child = spawn("npx", ["wrangler", "dev", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(portBase + 100 + i), "--persist-to", path.relative(api, dir), "--show-interactive-dev-session=false"], { cwd: api, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    child.exited = true;
    if (!stopping) console.error(`Worker ${i} (port ${port}) exited with ${code}; its log: api/.wrangler/e2e/w${i}.log`);
  });
  children.push(child);
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exited) continue;
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {}
  }
}
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stop(); process.exit(130); });

async function waitHealthy(url, i) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (children[i].exited) throw new Error(`Worker ${i} stopped before it answered; see api/.wrangler/e2e/w${i}.log`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Worker ${i} at ${url} did not answer /api/health within 3 minutes; see api/.wrangler/e2e/w${i}.log`);
}

try {
  await Promise.all(urls.map(waitHealthy));
} catch (e) {
  console.error(e.message);
  stop();
  process.exit(1);
}
console.log(`${workers} Workers ready (${secs()}): ${urls.join(" ")}`);

const pw = spawn("npx", ["playwright", "test", ...playwrightArgs], { cwd: here, stdio: "inherit", env: { ...process.env, E2E_BASE_URLS: urls.join(",") } });
const code = await new Promise((res) => pw.on("exit", (c, sig) => res(c ?? (sig ? 1 : 0))));
console.log(`suite finished with ${code} after ${secs()} in total`);
stop();
process.exit(code);
