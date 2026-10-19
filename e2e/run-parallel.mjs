// Runs the browser suite on N local Workers at once (default 4): each Worker is its own `wrangler dev` with its own
// local D1 and R2 state (--persist-to) and port, all copied from one seeded state, and each Playwright worker talks
// to one of them (servers.ts), so a test's demo reset never touches another test's data. Stops the Workers on exit.
//
// Usage, from the repository root, after `npm --prefix api run stage` (the Workers serve api/.assets):
//   npm --prefix e2e run test:parallel                         # 4 Workers
//   E2E_WORKERS=2 npm --prefix e2e run test:parallel -- specs/calendar.spec.ts   # Playwright arguments after --
// Options: --reseed seeds the template state again even when its inputs did not change.
// Environment: E2E_WORKERS (default 4), E2E_PORT_BASE (default 8801; Worker i listens on E2E_PORT_BASE + i).
// The login spec (specs/login.spec.ts) gets one more Worker in AUTH_MODE=oidc on E2E_PORT_BASE + 50 and the mock IdP
// (mock-oidc.mjs) on E2E_PORT_BASE + 60; E2E_OIDC=off leaves them out.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  // package-lock.json: a new Wrangler may store local state differently.
  for (const p of ["package-lock.json", "api/migrations", "api/seed/seed.py", "fixtures", "data/derived", "data/rakathon-26", "samples"]) {
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
  // The stamp goes first, so a seed that stops half way is never taken for a finished one.
  rmSync(stampFile, { force: true });
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

// The login spec's own Worker (AUTH_MODE=oidc) and the mock IdP it logs in at (mock-oidc.mjs), on ports after the
// demo Workers' range. E2E_OIDC=off leaves both out (the login spec then skips).
const withOidc = process.env.E2E_OIDC !== "off";
const oidcPort = portBase + 50;
const idpPort = portBase + 60;
const ports = [...Array.from({ length: workers }, (_, i) => portBase + i), ...(withOidc ? [oidcPort, idpPort] : [])];

// A port that already answers belongs to another run or another Worker: the suite would reset that Worker's demo.
for (const p of ports) {
  const url = `http://127.0.0.1:${p}`;
  const busy = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, (e) => e.name === "TimeoutError");
  if (busy) {
    console.error(`port ${p} is in use (another run, or a Worker left over?); stop it or set E2E_PORT_BASE.`);
    process.exit(1);
  }
}

// One copy of the seeded state per Worker; a copy-on-write clone where the file system offers one.
const children = [];
let stopping = false;
const urls = [];
const byName = new Map();
function startWorker(name, port, inspectorPort, vars) {
  const dir = path.join(stateRoot, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(template, dir, { recursive: true, mode: constants.COPYFILE_FICLONE });
  const log = createWriteStream(path.join(stateRoot, `${name}.log`));
  // Vars on the command line win over wrangler.jsonc (whose AUTH_MODE is the deployed "oidc"), so each Worker runs in
  // the mode its specs expect whatever a developer's api/.dev.vars says.
  const varArgs = Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]);
  // detached: the Worker and the workerd process it starts form one process group, which stop() ends as a whole.
  const child = spawn("npx", ["wrangler", "dev", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort), "--persist-to", path.relative(api, dir), "--show-interactive-dev-session=false", ...varArgs], { cwd: api, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    child.exited = true;
    if (!stopping) console.error(`${name} (port ${port}) exited with ${code}; its log: api/.wrangler/e2e/${name}.log`);
  });
  children.push(child);
  byName.set(name, child);
}
for (let i = 0; i < workers; i++) {
  urls.push(`http://127.0.0.1:${portBase + i}`);
  startWorker(`w${i}`, portBase + i, portBase + 100 + i, { AUTH_MODE: "demo" });
}
const oidcUrl = `http://127.0.0.1:${oidcPort}`;
if (withOidc) {
  // A client secret and a session key made up for this run only; nothing real is used or needed.
  const secret = randomBytes(18).toString("base64url");
  const idp = spawn(process.execPath, [path.join(here, "mock-oidc.mjs"), "--port", String(idpPort), "--client", "e2e-client", "--secret", secret, "--app", oidcUrl], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const idpLog = createWriteStream(path.join(stateRoot, "idp.log"));
  idp.stdout.pipe(idpLog);
  idp.stderr.pipe(idpLog);
  idp.on("exit", (code) => {
    idp.exited = true;
    if (!stopping) console.error(`the mock IdP exited with ${code}; its log: api/.wrangler/e2e/idp.log`);
  });
  children.push(idp);
  startWorker("oidc", oidcPort, portBase + 150, {
    AUTH_MODE: "oidc",
    OIDC_ISSUER: `http://127.0.0.1:${idpPort}`,
    OIDC_CLIENT_ID: "e2e-client",
    OIDC_CLIENT_SECRET: secret,
    SESSION_KEY: randomBytes(32).toString("base64"),
  });
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
let pw;
process.on("exit", stop);
// While the suite runs, a signal goes to Playwright, which finishes its report and exits; the Workers stop after it.
// Before that, the Workers stop at once.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (pw && pw.exitCode === null) pw.kill(sig);
    else {
      stop();
      process.exit(130);
    }
  });
}

// Each Worker must answer in the mode it was started in: a demo Worker that came up in OIDC mode would fail every spec.
async function waitHealthy(url, name, mode) {
  const child = byName.get(name);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child?.exited) throw new Error(`${name} stopped before it answered; see api/.wrangler/e2e/${name}.log`);
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        const h = await r.json();
        if (h.auth_mode !== mode) throw new Error(`${name} at ${url} runs in auth mode ${h.auth_mode}, not ${mode}`);
        return;
      }
    } catch (e) {
      if (/runs in auth mode/.test(e.message)) throw e;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`${name} at ${url} did not answer /api/health within 3 minutes; see api/.wrangler/e2e/${name}.log`);
}

try {
  await Promise.all([...urls.map((u, i) => waitHealthy(u, `w${i}`, "demo")), ...(withOidc ? [waitHealthy(oidcUrl, "oidc", "oidc")] : [])]);
} catch (e) {
  console.error(e.message);
  stop();
  process.exit(1);
}
console.log(`${workers} Workers ready (${secs()}): ${urls.join(" ")}${withOidc ? `; the login Worker ${oidcUrl} with the mock IdP on port ${idpPort}` : ""}`);

pw = spawn("npx", ["playwright", "test", ...playwrightArgs], {
  cwd: here,
  stdio: "inherit",
  env: { ...process.env, E2E_BASE_URLS: urls.join(","), ...(withOidc ? { E2E_OIDC_URL: oidcUrl } : {}) },
});
const code = await new Promise((res) => pw.on("exit", (c, sig) => res(c ?? (sig ? 1 : 0))));
console.log(`suite finished with ${code} after ${secs()} in total`);
stop();
process.exit(code);
